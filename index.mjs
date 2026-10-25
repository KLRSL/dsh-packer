// ============================================================================
// dsh-packer — 配置打包器（Agent Config Packer for DeepSeek Harness）
//
// 把本地 Agent 资产按模块打包成 zip（迁移/分享两用），支持：
//   1. 模块打包：Skills / 会话记录 / 会话附件对象库 / Profile 配置 / 全局设置 / Agent 预设 / 记忆数据
//   2. 双模式预设：迁移全选 / 分享精选（分享自动排除会话、附件与记忆数据）
//   3. 隐私安全扫描：打包前检测本地路径/用户名/API key/个人昵称，分享模式强制拦截
//   4. 文件级操作清单：打包/恢复前预览具体文件操作
//   5. 包管理：列表 / 详情（顺带逐文件 SHA-256 校验）/ 重命名 / 删除
//      （删除 = 送进 Windows 系统回收站；不支持时降级永久删除并回报 warning）
//   6. 恢复：清单校验 → 逐文件差异（added/changed/same/skipped）→ 冲突三选（覆盖/跳过/合并）
//      → 备份目录 + 一键回滚；可选只恢复指定模块、可选恢复 SQLite 库
//   7. 分享包自动附 README 说明
//   8. v0.4.0：加密包（crypto.mjs：PKENC1 + scrypt + aes-256-gcm）、异步作业（/jobs + 取消 + 进度）
//   9. v0.5.0 收敛：删掉自建回收站、定时自动备份/保留策略、独立 verify 接口；
//      接口 15 → 9（见 docs/api-v050.md），删除交给 Windows 系统回收站（PowerShell 系统能力）
//  10. v0.5.1 隐私「真处理」（见 docs/api-v051.md）：打包时二选一 ——
//      ① sanitize=true 清理后打包：只改**包内副本**（源文件一个字节都不动），按 finding.kind
//         把命中的路径/凭据替换成固定占位符；② sanitize=false 保真打包（迁移优先），
//      含凭据又未加密时用 warnings[] 明确告警。share 模式强制 sanitize=true。
//      恢复 sanitized 包时回填 <用户目录> / <用户名>，其余占位符保留并计入 stats.warnings。
//      另新增 plugins 模块：迁移时带上 profiles/<profile>/node_modules 的一级包目录。
//  11. v0.6.5：会话里的图片/附件以 `attachmentId` 引用存在，字节在 <DSH_HOME>/attachments——
//      新增 attachments 模块（内容寻址，恢复后引用不用改写），并修正 MEMORY_ROOT 跟随 DSH_HOME。
//
// 异步 IO（v0.2.4）：全部文件与子进程操作走 node:fs/promises + execFile，
//   对外 API 一律返回 Promise（可 await），调用点（/pack 命令、Web API）全链路 async。
//   大文件/大批量场景不再阻塞事件循环——哈希与复制走有界并发（IO_CONCURRENCY），
//   没有 `await new Promise(setImmediate)` 之类的假异步。
//
// 安全：.credentials.yaml / .anonymous-user-id 永不打包
//   - 恢复：目标路径白名单 + containment 校验；清单指纹 fail-closed；先备份目标 → 写临时文件 → rename
//     原子替换；任一环节失败即中止并回滚已替换文件；SQLite 库（*.db*）默认不打包不恢复
//   - 解包：先列成员做白名单校验（拒绝绝对路径/盘符/UNC/`..`/链接类型），临时目录 try/finally 统一清理
//   - Web API（/packer/api/*）：速率限制（最外层）→ 鉴权（默认 fail-closed）→ 体积上限 → 路由
//     authMode 'auto'（默认）只用官方 connection.requestRejection，鉴权服务缺失即 403；
//     'token' 是显式 opt-in 回退（同源校验 + 一次性令牌）；'off' 仅供隔离测试
//
// 官方契约要点（cordis-plugin-development SKILL + rc.5/rc.6 实测）：
//   - 可选服务用 ctx.get(name) + 缺失处理；硬依赖才声明 inject
//   - 副作用用 ctx.effect()（返回 disposer）
//   - webServer 由 dsh-web-app 提供（ctx.get('webServer') 判空）
//   - connection 由 dsh-client-connection 提供：requestRejection(req) 是官方给
//     「另一条 Web 路由」复用的 Host/Origin 信任 + 浏览器会话鉴权入口（401/403/undefined）
//   - 命令 handler(invocation) -> { kind: 'success'|'error', text }，允许返回 Promise
//   - zip 读写为**纯 JS 实现**（zip.mjs，node:zlib；不调用 tar/unzip/zip 等外部命令）——
//     此前依赖系统 tar 导致 Windows/Linux 产出的包互不兼容（GNU tar 读不了真 zip）。
//     「零外部命令」仅指 zip 读写：删除包时调 PowerShell 的
//     Microsoft.VisualBasic.FileIO.FileSystem 把文件送进 Windows 系统回收站（系统能力，非打包依赖）。
// ============================================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildZip, readZipFile, entryKind, readEntryData } from './zip.mjs'
import {
  PKENC_EXT,
  MIN_PASSWORD_LENGTH,
  isEncryptedBuffer,
  isBadPasswordError,
  BadPasswordError,
  encryptZipBuffer,
  decryptZipBuffer,
} from './crypto.mjs'

export const inject = []

const execFileAsync = promisify(execFile)

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PACKS_DIR = process.env.DSH_PACKS_DIR || path.join(DSH_HOME, 'packs')
const MEMORY_ROOT = process.env.DSH_MEMORY_ROOT || path.join(DSH_HOME, 'memory')

const SCHEMA_VERSION = 1
const NEVER_PACK = ['.credentials.yaml', '.anonymous-user-id']

// 运行中的 SQLite 数据库（含 WAL/SHM/journal）：默认不打包、不恢复（见 memory 模块 skipFiles）
const DB_FILE_RE = /(^|\.)db(-wal|-shm|-journal)?$|\.sqlite3?$/i

// ---------- v0.4.0 常量 ----------

/** 恢复备份目录（applyRestore 的目标备份 + journal，用于 /restore/rollback） */
const RESTORE_BACKUP_DIR = '.restore-backups'
/** 送系统回收站的外部命令调用超时（毫秒）：超时即视为失败并降级，不无限挂住请求 */
const RECYCLE_TIMEOUT_MS = 30_000
/**
 * 有系统回收站的平台（v0.6.4 起按平台分派：Windows PowerShell / macOS Finder / Linux freedesktop Trash）。
 * 其余平台（鸿蒙、未知）返回 false，由 deletePack 降级为永久删除并回报 warning。
 */
const TRASH_PLATFORMS = new Set(['win32', 'darwin', 'linux'])
/**
 * 宿主能提供系统文件选择框的平台。
 * 注意：网页层拿不到宿主机路径，所以本插件**不渲染**任何「添加文件/浏览」按钮；
 * 这张表只用于判断「当前平台要不要把『手填包路径』当主入口提示」（鸿蒙等平台为 false）。
 */
const FILE_PICKER_PLATFORMS = new Set(['win32', 'darwin', 'linux'])

/** 分享模式服务端强制拦截的敏感模块（契约 §3：不能只靠 UI 置灰） */
const SENSITIVE_MODULES = ['sessions', 'attachments', 'profiles', 'settings', 'presets', 'memory', 'memoryDb', 'plugins']
/** 恢复策略白名单（fail-closed：非法值 400 bad_strategy，不再退化成 overwrite） */
const RESTORE_STRATEGIES = new Set(['overwrite', 'skip', 'merge'])
/** 包文件名：.zip（明文）或 .pkenc（加密）；其余文件一律不当成包 */
const PACK_EXT_RE = /\.(zip|pkenc)$/i
const PACK_NAME_MAX = 120

/** 作业保留：内存最多 20 条；终态作业保留 5 分钟（契约 §4） */
const JOB_MAX = 20
const JOB_RETAIN_MS = 5 * 60 * 1000

// ---------- 记忆真库（SQLite）快照 ----------
// 默认 <DSH_BIOMEMORY_DIR || ~/.dsh/biomemory>/biomemory.db —— 与 dsh-memory-layer 的 db.mjs 同一解析口径。
// 运行中的库带 WAL，直接复制可能得到半写状态；VACUUM INTO 产出一致副本（实测只读连接亦可，
// 2.78MB 源 → 2.57MB 快照，条目与审计行均可读）。失败绝不静默降级为"直接复制"。
const BIOMEMORY_DIR = process.env.DSH_BIOMEMORY_DIR || path.join(DSH_HOME, 'biomemory')
const BIOMEMORY_DB = path.join(BIOMEMORY_DIR, 'biomemory.db')

/** 本次进程内已生成的快照：src -> { path, dir } | null（null = 已失败，不再重试） */
const SNAPSHOT_CACHE = new Map()
/** 快照失败原因（createPack 会把它们并入 unreadable 如实上报） */
const SNAPSHOT_WARNINGS = []

/** 取 SQLite 一致快照；失败返回 null 并记录原因（不抛错，不复制运行中的库） */
async function snapshotSqlite(src) {
  if (SNAPSHOT_CACHE.has(src)) return SNAPSHOT_CACHE.get(src)
  try {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pack-snap-'))
    const out = path.join(dir, path.basename(src))
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(src, { readOnly: true })
    try {
      db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
    const rec = { path: out, dir }
    SNAPSHOT_CACHE.set(src, rec)
    return rec
  } catch (err) {
    SNAPSHOT_WARNINGS.push({ src, error: String(err?.message || err) })
    SNAPSHOT_CACHE.set(src, null)
    return null
  }
}

/** 清理本次打包产生的快照目录（createPack 收尾调用；失败不影响结果） */
async function cleanupSnapshots() {
  for (const rec of SNAPSHOT_CACHE.values()) {
    if (!rec) continue
    try { await fsp.rm(rec.dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
  SNAPSHOT_CACHE.clear()
}

// 异步 IO 的有界并发：既不串行等 I/O，也不为大批量文件同时打开上千个句柄
const IO_CONCURRENCY = 16
const HASH_CHUNK_BYTES = 1024 * 1024

// ---------- 模块定义（逻辑名 → 本地路径；恢复时按当前机器映射） ----------

const MODULES = {
  skills: {
    label: 'Skills（含记忆机制 skill）',
    kind: 'dir',
    resolve: () => path.join(DSH_HOME, 'skills'),
    default: true,   // 迁移预设
    share: true,     // 分享预设
    exclude: ['_shared'], // 分享时排除的本地子目录（个人 skill）
  },
  sessions: {
    label: '会话记录',
    kind: 'dir',
    resolve: () => path.join(DSH_HOME, 'sessions'),
    default: true,
    share: false,
  },
  attachments: {
    // v0.6.5：会话里的图片/文件**不在** sessions 日志里——日志只存 `{"type":"image",
    // "attachment":{"attachmentId":"sha256:<64hex>"}}` 这样的引用，字节在
    // <DSH_HOME>/attachments/v1/objects/<前2位>/<sha256>（内容寻址、去重、只增不删）。
    // 所以只备份 sessions = 换机器恢复后图全裂：本模块补上对象库本身。
    // 根取 attachments（含 v1/objects、v1/file-objects、v1/files）；tmp 是写入暂存，不备份。
    // 对象名就是内容哈希，目标机不需要改写会话日志里的任何引用。
    label: '会话附件对象库（图片/文件；内容寻址，不含可重建的请求图片缓存）',
    kind: 'dir',
    resolve: () => path.join(DSH_HOME, 'attachments'),
    default: true,   // 迁移预设带上：不带就等于恢复后会话里的图片全裂
    share: false,    // 附件就是用户的截图与文件，分享绝不带
    skipDirs: ['tmp'],
  },
  profiles: {
    label: 'Profile 配置（不含 node_modules）',
    kind: 'dir',
    resolve: () => path.join(DSH_HOME, 'profiles'),
    default: true,
    share: false,
    skipDirs: ['node_modules', 'node_modules/.pnpm'],
  },
  settings: {
    label: '全局设置（settings.yaml）',
    kind: 'file',
    resolve: () => path.join(DSH_HOME, 'settings.yaml'),
    default: true,
    share: false,
  },
  presets: {
    label: 'Agent 预设',
    kind: 'dir',
    resolve: () => path.join(DSH_HOME, '.agent-presets'),
    default: true,
    share: false,
  },
  memory: {
    // v0.2.5 语义澄清（自审 P6）：本模块打包的是**记忆的 Markdown 只读镜像**，
    // 而记忆的运行时事实源是 SQLite 库（默认 <DSH_BIOMEMORY_DIR || ~/.dsh/biomemory>/biomemory.db），
    // 它被 skipFiles 排除、且不在本模块扫描范围内——因为运行中的 WAL 库复制出来可能是坏的。
    // 所以「打包了记忆」只意味着带走了可读副本；要迁移真库请在停止 DSH 后手动复制那个 .db。
    label: '记忆镜像（Markdown 只读副本；运行时 SQLite 真库不在包内）',
    kind: 'dir',
    resolve: () => MEMORY_ROOT,
    default: true,
    share: false,
    skipDirs: ['backups'],
    // 运行中的 SQLite 库被 DSH / 记忆插件持有，复制或覆盖都可能损坏，默认排除
    skipFiles: DB_FILE_RE,
  },
  memoryDb: {
    // v0.2.6：记忆的**运行时事实源**（SQLite 真库）单独成模块并支持安全快照。
    // 此前它被完全排除、只字不提，等于「打包了记忆」却不含真库——迁移过去是空壳。
    // 现在：存在即用 VACUUM INTO 取一致副本（只读连接，不碰运行中的 WAL）；
    // 取不到就跳过并如实上报，绝不复制一个可能半写的库。
    label: '记忆真库（SQLite 一致快照：VACUUM INTO，含条目与审计；不含 -wal/-shm）',
    kind: 'file',
    resolve: () => BIOMEMORY_DB,
    default: true,   // 迁移预设：记忆数据不可丢，默认带上
    share: false,    // 分享包绝不带真库
    snapshot: true,
  },
  plugins: {
    // v0.5.1（契约 §4）：迁移的第一用途是「换机器/换平台」，光带 profiles 的配置文本不够——
    // 已安装的第三方插件本体在 profiles/<profile>/node_modules 里，不带过去新机器就是空壳。
    // 只收 **一级包目录**（@scope 取两级），排除 pnpm 的 .pnpm 仓库、.bin、.modules.yaml、.cache。
    label: '已安装插件本体（profiles/<profile>/node_modules 一级包；体积大）',
    kind: 'dir',
    resolve: () => path.join(DSH_HOME, 'profiles'),
    default: true,   // 迁移预设带上（迁移没插件本体等于没迁移）
    share: false,    // 分享绝不带第三方插件本体（体积 + 许可问题）
    packageDirs: true, // collectModuleFiles 走「一级包目录」收集逻辑，不是普通递归
  },
}

// ---------- 基础工具（全部异步） ----------

/** 存在性判断：唯一允许的「探测」方式，不抛错 */
async function exists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

/** 读文本文件；读不出返回空串（与旧 readFile 语义一致） */
async function readFileText(p) {
  try {
    return await fsp.readFile(p, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * 流式 SHA-256：用 filehandle.read 分块读取，大文件不再整份进内存；
 * 计算失败必须抛错（绝不返回空串，否则空指纹会与"目标侧也算不出指纹"撞成"相同"，
 * 完整性校验被静默跳过）。
 */
async function sha256(p) {
  const hash = crypto.createHash('sha256')
  const handle = await fsp.open(p, 'r')
  try {
    const buf = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null)
      if (bytesRead <= 0) break
      hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

/** 比较用哈希：目标读不出来时返回 null（与"合法指纹"永远不相等） */
async function trySha256(p) {
  try {
    return await sha256(p)
  } catch {
    return null
  }
}

async function fileSize(p) {
  try {
    return (await fsp.stat(p)).size
  } catch {
    return 0
  }
}

/**
 * 有界并发映射：保留输入顺序，workers 数受限，绝不为大批量文件同时开句柄。
 * 单条 fn 抛错由调用方自行处理（本函数不吞错）。
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const width = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      out[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

const SHA256_RE = /^[0-9a-f]{64}$/i

/** 清单指纹必须存在且是合法 SHA-256（fail-closed） */
function isValidSha256(s) {
  return typeof s === 'string' && SHA256_RE.test(s)
}

function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 唯一后缀：同一秒内多次打包不再互相覆盖 */
function uniqueSuffix() {
  return crypto.randomBytes(3).toString('hex')
}

// 已知文本后缀：直接按文本扫描
const TEXT_EXT = new Set(['.md', '.yaml', '.yml', '.json', '.js', '.mjs', '.cjs', '.txt', '.jsonl', '.log', '.py', '.ps1', '.ts', '.toml', '.patch', '.i18n.yaml'])

// 明确二进制后缀：直接跳过扫描（不做内容嗅探）
const BINARY_EXT = new Set(['.zstd', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3',
  '.exe', '.dll', '.node', '.so', '.dylib', '.wasm', '.bin', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.webm'])

// 无扩展名但确定是文本的常见文件（如 .env），必须纳入扫描
const TEXT_BASENAMES = new Set(['.env', 'Dockerfile', 'Makefile', 'LICENSE', 'Procfile'])

/** 内容嗅探：前 4KB 出现 NUL 字节视为二进制；读不到则按二进制处理（不扫，避免产生假结果） */
async function looksBinary(p) {
  let handle
  try {
    handle = await fsp.open(p, 'r')
    const buf = Buffer.allocUnsafe(4096)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    for (let i = 0; i < bytesRead; i++) if (buf[i] === 0) return true
    return false
  } catch {
    return true
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close()
      } catch {
        /* ignore */
      }
    }
  }
}

/** 是否按文本处理：已知文本后缀 / 已知文本文件名（.env）→ 是；已知二进制或含 NUL → 否 */
async function isTextFile(p) {
  const base = path.basename(p)
  const ext = path.extname(p).toLowerCase()
  if (BINARY_EXT.has(ext)) return false
  if (TEXT_EXT.has(ext) || p.endsWith('.i18n.yaml')) return true
  if (TEXT_BASENAMES.has(base) || base.startsWith('.env.')) return true
  return !(await looksBinary(p))
}

// ---------- 模块文件收集 ----------

/** node_modules 里绝不能当「插件本体」带走的东西（pnpm 仓库 / 可执行 shim / 元数据 / 缓存） */
const PACKAGE_SKIP_NAMES = new Set(['.pnpm', '.bin', '.modules.yaml', '.cache'])

/**
 * v0.5.1（契约 §4）：收集 `profiles/<profile>/node_modules` 的**一级包目录**。
 * - `@scope/pkg` 取两级；
 * - 排除 `.pnpm` / `.bin` / `.modules.yaml` / `.cache`（其它隐藏项如 `.package-lock.json` 也跳过）；
 * - 判目录用 `stat` 而不是 dirent 类型：pnpm 的顶层包目录通常是符号链接/junction，必须跟进去，
 *   否则会出现「装了插件、包里一个文件都没有」；每次跟链用 realpath 记录，防止链接成环。
 * rel 形如 `<profile>/node_modules/<pkg>/...`；恢复时按同一相对路径写回（resolve() = profiles 根）。
 */
async function collectPackageDirs(root) {
  const out = []
  let profiles = []
  try {
    profiles = await fsp.readdir(root, { withFileTypes: true })
  } catch (err) {
    if (err?.code === 'ENOENT') return out // profiles 目录还没建：空结果不是错误
    throw new Error(`读取 profiles 目录失败：${String(err?.message || err)}`)
  }
  /** 递归收集一个包的整个目录树（含它自己的嵌套 node_modules，这样目标机才是自包含的） */
  const walkTree = async (startDir, startRel) => {
    const visited = new Set()
    const walk = async (dir, rel) => {
      let real
      try {
        real = await fsp.realpath(dir)
      } catch {
        return // 悬空 junction：跳过这一支，不阻断整包
      }
      if (visited.has(real)) return // 链接成环
      visited.add(real)
      let entries = []
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (NEVER_PACK.includes(e.name)) continue
        const full = path.join(dir, e.name)
        const relPath = rel ? `${rel}/${e.name}` : e.name
        let st
        try {
          st = await fsp.stat(full) // 跟随链接（pnpm 的包目录本身就是链接）
        } catch {
          continue
        }
        if (st.isDirectory()) await walk(full, relPath)
        else if (st.isFile()) out.push({ rel: relPath, abs: full })
      }
    }
    await walk(startDir, startRel)
  }
  for (const profile of profiles) {
    if (!profile.isDirectory()) continue
    const nm = path.join(root, profile.name, 'node_modules')
    let entries = []
    try {
      entries = await fsp.readdir(nm, { withFileTypes: true })
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') continue // 该 profile 没装插件
      throw new Error(`读取 ${nm} 失败：${String(err?.message || err)}`)
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || PACKAGE_SKIP_NAMES.has(e.name)) continue
      const full = path.join(nm, e.name)
      const relBase = `${profile.name}/node_modules/${e.name}`
      let st
      try {
        st = await fsp.stat(full)
      } catch {
        continue
      }
      if (!st.isDirectory()) continue // 一级普通文件（.package-lock.json 之类）不收
      if (e.name.startsWith('@')) {
        let scoped = []
        try {
          scoped = await fsp.readdir(full, { withFileTypes: true })
        } catch {
          continue
        }
        for (const s of scoped) {
          if (s.name.startsWith('.')) continue
          const sFull = path.join(full, s.name)
          let sSt
          try {
            sSt = await fsp.stat(sFull)
          } catch {
            continue
          }
          if (!sSt.isDirectory()) continue
          await walkTree(sFull, `${relBase}/${s.name}`)
        }
      } else {
        await walkTree(full, relBase)
      }
    }
  }
  return out
}

async function collectModuleFiles(mod, excludeSharePersonal = false) {
  const root = mod.resolve()
  const files = []
  // v0.5.1：插件本体模块只收一级包目录，不走通用递归（通用递归会跳过 node_modules）
  if (mod.packageDirs) return collectPackageDirs(root)
  if (mod.kind === 'file') {
    if (!(await exists(root)) || NEVER_PACK.includes(path.basename(root))) return files
    // v0.2.6：声明 snapshot 的模块走一致快照（如运行中的 SQLite 库）
    if (mod.snapshot) {
      const snap = await snapshotSqlite(root)
      if (!snap) return files // 快照失败 → 不打包该文件（原因由 SNAPSHOT_WARNINGS 上报）
      files.push({ rel: path.basename(root), abs: snap.path })
      return files
    }
    files.push({ rel: path.basename(root), abs: root })
    return files
  }
  if (!(await exists(root))) return files
  const skipDirs = new Set(mod.skipDirs || [])
  const walk = async (dir, rel) => {
    let entries = []
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || skipDirs.has(e.name)) continue
      if (NEVER_PACK.includes(e.name)) continue
      const full = path.join(dir, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        // 分享模式排除个人 skill（如桌宠）
        if (excludeSharePersonal && mod.exclude?.includes(e.name)) continue
        await walk(full, relPath)
      } else if (e.isFile()) {
        if (mod.skipFiles && mod.skipFiles.test(e.name)) continue
        files.push({ rel: relPath, abs: full })
      }
    }
  }
  await walk(root, '')
  return files
}

/**
 * 统计模块大小（/status 用）。
 *
 * v0.4.0 P0 修复：旧实现走 collectModuleFiles —— 对 memoryDb（snapshot:true）会执行
 * `VACUUM INTO` 生成快照。而 /status 是「一打开设置页就调」的高频接口，结果每次调用
 * 都在系统临时目录里留下一个 `dsh-pack-snap-*` 目录（永不清理）＝磁盘泄漏。
 * 现在：file 类模块（含 memoryDb）只 `stat` 文件大小，绝不 VACUUM、绝不读文件内容；
 * dir 类模块只枚举目录 + stat，不算哈希。
 */
async function moduleStats(mod) {
  const root = mod.resolve()
  if (mod.kind === 'file') {
    try {
      const st = await fsp.stat(root)
      return { count: st.isFile() ? 1 : 0, bytes: st.isFile() ? st.size : 0 }
    } catch (err) {
      // 文件不存在是正常状态（模块未启用）；其它错误（权限等）按 0 计但留下日志可诊断
      if (err?.code !== 'ENOENT') console.warn(`[dsh-packer] 模块 stat 失败（${root}）：${String(err?.message || err)}`)
      return { count: 0, bytes: 0 }
    }
  }
  const files = await collectModuleFiles(mod)
  const sizes = await mapLimit(files, IO_CONCURRENCY, (f) => fileSize(f.abs))
  return { count: files.length, bytes: sizes.reduce((s, n) => s + n, 0) }
}

// ---------- 隐私安全扫描 ----------

// 通用隐私规则（开源默认）。个人化规则（昵称/用户名等）由部署者通过 config.personalPatterns 注入，
// 不硬编码进开源代码——每个部署者自己的本地规则自己配。
const PRIVACY_PATTERNS = [
  { id: 'abs-path', label: '本地绝对路径（盘符）', re: /[A-Za-z]:[\\/][^\s"'`<>|?*]+/g },
  { id: 'unc-path', label: 'UNC / 网络路径', re: /\\\\[A-Za-z0-9._$-]+\\[^\s"'`<>|?*]+/g },
  { id: 'unix-path', label: 'Unix 绝对路径', re: /(?<![\w.-])\/(?:home|Users|root|mnt|media|opt|srv|etc|var|tmp|usr)\/[^\s"'`<>|]+/g },
  { id: 'user-path', label: '用户目录路径', re: /(?:[A-Za-z]:[\\/]Users[\\/]|\/(?:home|Users)\/)[^\s"'`<>\\/:]+/g },
  { id: 'credential', label: '疑似密钥 / Token 赋值', re: /(?:api[_-]?key|apikey|access[_-]?key|secret|password|passwd|token|bearer|authorization|credential)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{8,}["']?/gi },
  { id: 'key-shape', label: '密钥形状（sk-/ghp_/AKIA/JWT 等）', re: /(?:\bsk-[A-Za-z0-9_-]{16,}|\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g },
]

let PERSONAL_PATTERNS = [] // 部署者注入的个人规则：[{ label, re }]

/**
 * v0.5.1（契约 §2）：`/scan` 每条 finding 都带 `kind`，枚举固定，UI 按它分组
 * （可清理 = 路径类/密钥类；需你确认 = personal）。
 */
const PRIVACY_KINDS = ['path', 'userpath', 'unc', 'unix', 'credential', 'key', 'personal']

/** 扫描规则 id → kind（部署者个人规则一律归 personal） */
const PATTERN_KIND = {
  'abs-path': 'path',
  'user-path': 'userpath',
  'unc-path': 'unc',
  'unix-path': 'unix',
  credential: 'credential',
  'key-shape': 'key',
}

/** 部署者个人隐私规则注入（应用配置 + 测试共用） */
export function setPersonalPatterns(list) {
  PERSONAL_PATTERNS = Array.isArray(list)
    ? list.map((p) => ({
        id: String(p.id || 'personal'),
        label: String(p.label || '个人敏感词'),
        re: p.re instanceof RegExp ? p.re : new RegExp(String(p.re)),
      }))
    : []
}

/** 命中总数（按行聚合的条目用 count 累加，绝不低报） */
function countFindings(findings) {
  return findings.reduce((s, f) => s + (f.count || 1), 0)
}

function formatFinding(f) {
  const line = f.line ? `:${f.line}` : ''
  const times = f.count > 1 ? `（本行 ${f.count} 处）` : ''
  return `${f.label} @ ${f.file}${line}${times}${f.sample ? `（${f.sample}）` : ''}`
}

/**
 * 隐私扫描：文本文件按规则全量匹配（g 循环），按"文件 + 规则 + 行"聚合计数——
 * 既不低报命中数，也不会让大文件把结果数组撑爆。
 */
async function privacyScan(files) {
  const patterns = [...PRIVACY_PATTERNS, ...PERSONAL_PATTERNS]
  const findings = []
  for (const f of files) {
    const probe = f.abs || f.rel
    if (!(await isTextFile(probe))) continue
    const text = await readFileText(probe)
    if (!text) continue
    // 行起始偏移：把命中位置映射回行号
    const lineStarts = [0]
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
    const lineOf = (idx) => {
      let lo = 0
      let hi = lineStarts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (lineStarts[mid] <= idx) lo = mid
        else hi = mid - 1
      }
      return lo
    }
    for (const pat of patterns) {
      const re = pat.re.global ? pat.re : new RegExp(pat.re.source, `${pat.re.flags}g`)
      re.lastIndex = 0
      const perLine = new Map()
      let m
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue }
        const line = lineOf(m.index)
        const cur = perLine.get(line)
        if (cur) cur.count++
        else perLine.set(line, { count: 1, sample: String(m[0]).slice(0, 80) })
      }
      for (const [line, info] of perLine) {
        findings.push({
          file: f.rel,
          pattern: pat.id,
          // v0.5.1：kind 是契约固定枚举（path|userpath|unc|unix|credential|key|personal），
          // 打包端按 kind 映射占位符、UI 按 kind 分组
          kind: PATTERN_KIND[pat.id] || 'personal',
          label: pat.label,
          line: line + 1,
          count: info.count,
          sample: info.sample,
        })
      }
    }
  }
  return findings
}

// ---------- 隐私「真处理」：包内副本脱敏（v0.5.1 契约 §1） ----------
// 只改**包内副本**（staging）里的文本，源文件一个字节都不动。
// 占位符是固定词表（契约 §1，勿改）：恢复端按这些字面量回填 / 统计。

/** kind → 固定占位符 */
const KIND_PLACEHOLDER = {
  path: '<本机路径>',
  userpath: '<用户目录>',
  unc: '<UNC路径>',
  unix: '<Unix路径>',
  credential: '<已移除的密钥>',
  key: '<已移除的密钥>',
  personal: '<个人信息>',
}

/** 恢复时能自动回填的占位符（其余保留原样并计入 stats.warnings） */
const PLACEHOLDER_HOME = '<用户目录>'
const PLACEHOLDER_USER = '<用户名>'
const RETAINED_PLACEHOLDERS = ['<本机路径>', '<UNC路径>', '<Unix路径>', '<已移除的密钥>', '<个人信息>']

/**
 * 结构敏感字符：出现在「被删掉的那段文本」里，就说明这段可能跨了语法边界
 * （引号里再出现引号、JSON/YAML 的括号逗号、注释符、HTML 尖括号等）——
 * 这种情况一律**跳过该处替换并记 warning**：宁可不脱敏，也不产出坏文件。
 * 刻意不含 `:`：盘符 `C:` 必须能替换；路径里的冒号后面永远是 `\` 或 `/`，
 * 不会变成 YAML 的 `: ` 分隔符，所以不会改变标记化结果。
 */
const SANITIZE_UNSAFE_CHARS = /["'`{}[\],|#&*!<>]/

/**
 * 脱敏规则（顺序即优先级；同一起点取靠前的规则）。
 * 每条规则可带：
 *   - `spanOf(m)`：**被删掉的那段**（结构字符检查只针对它；userpath 会保留子路径，不能拿整段判）
 *   - `rebuild(m, ph)`：如何拼回替换结果（默认整段换成占位符）
 * 顺序要点：
 *   1. user-path 最优先：`C:\Users\me\a\b` → `<用户目录>\a\b`（保留子路径，迁移到新机最省事）
 *      并且**一次吃掉整条路径**（含子路径）——否则剩下的 `\a\b` 会被后面的 UNC 规则误当成 `\\host\share`
 *   2. 盘符路径：`[A-Za-z]:` 后面必须跟 `\` 或单个 `/`（排除 `https://` / `file://` 这类协议前缀）
 *   3. UNC：`\\host\share` 与 JSON 转义写法 `\\\\host\\share` 都认（2~4 个反斜杠起头）
 *   4. Unix 绝对路径
 *   5. credential **只替换值**（key 名 / 冒号 / 引号原样保留；整段替换会把
 *      `password: xxx` 这行变成裸标量，YAML 映射结构就坏了）
 *   6. key-shape 整段替换（sk-/ghp_/AKIA/JWT 等）
 *   7. 部署者个人规则 → `<个人信息>`
 *
 * 路径片段字符集刻意**排除** YAML/JSON 的流式结构符 `{ } [ ] , ;`、引号、注释/HTML 符
 * `# & ! < >` 与括号 —— 这样命中不会跨过语法边界（例如 pnpm-lock.yaml 的
 * `{..., tarball: file:E:/x.tgz}` 只会替换到 `tgz`，右花括号原样留下），
 * 而不是「匹配到结构字符 → 整处放弃 → 路径继续泄漏」。
 */
// 路径片段允许的字符：排除空白、引号（含反引号）、`< > | ? *`、YAML/JSON 流式结构符 `{ } [ ] , ;`、
// 括号与 `# & !`（注释/HTML符）。反引号单独拼接，避免模板字符串里无法写 `\``。
const PATH_TAIL = String.raw`[^\s"'<>|?*{}[\],;()#&!` + '`' + ']'

function sanitizeRules() {
  return [
    {
      kind: 'userpath',
      // 组 1 = 用户目录之后剩下的子路径（原样保留，包括 JSON 里的双反斜杠写法）
      re: new RegExp(
        String.raw`(?:[A-Za-z]:(?:\\{1,2}|\/(?!\/))Users(?:\\{1,2}|\/)|\/(?:home|Users)\/)[^\s"'<>\\/:]+((?:[\\/]{1,2}`
          + `${PATH_TAIL}+)*)`,
        'g',
      ),
      spanOf: (m) => m[0].slice(0, m[0].length - (m[1] || '').length),
      rebuild: (m, ph) => ph + (m[1] || ''),
    },
    { kind: 'path', re: new RegExp(String.raw`[A-Za-z]:(?:\\{1,2}|\/(?!\/))` + `${PATH_TAIL}+`, 'g') },
    { kind: 'unc', re: new RegExp(String.raw`\\{2,4}[A-Za-z0-9._$-]+\\{1,2}` + `${PATH_TAIL}+`, 'g') },
    { kind: 'unix', re: new RegExp(String.raw`(?<![\w.-])\/(?:home|Users|root|mnt|media|opt|srv|etc|var|tmp|usr)\/` + `${PATH_TAIL}+`, 'g') },
    {
      kind: 'credential',
      re: /((?:api[_-]?key|apikey|access[_-]?key|secret|password|passwd|token|bearer|authorization|credential)[ \t]*[:=][ \t]*["']?)([A-Za-z0-9_\-./+=]{8,})(["']?)/gi,
      spanOf: (m) => String(m[2] ?? ''),
      rebuild: (m, ph) => `${m[1]}${ph}${m[3] || ''}`,
    },
    { kind: 'key', re: /(?:\bsk-[A-Za-z0-9_-]{16,}|\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g },
    ...PERSONAL_PATTERNS.map((p) => ({ kind: 'personal', re: p.re })),
  ]
}

/** Buffer → SHA-256（打包期脱敏后要按新内容重算清单指纹） */
function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * 对一段文本做脱敏。返回 `{ text, redactions, skipped }`。
 *
 * 实现是**单遍扫描**（不是链式 String.replace）：从左往右找「所有规则里最靠前的一个命中」，
 * 命中段整体消费掉再继续。这样做有两个关键好处：
 *   ① 保留下来的子路径（userpath 的 group 1）不会被后续规则再扫一遍、误判成别的类型；
 *   ② 已经插入的占位符永远不会被后面的规则二次处理。
 * 每处替换前先检查「被删片段」是否含语法结构字符；含则跳过该处（保原文）并记入 skipped。
 */
function sanitizeText(text, rel = '') {
  let redactions = 0
  const skipped = []
  if (typeof text !== 'string' || !text) return { text, redactions, skipped }
  const rules = sanitizeRules().map((rule) => {
    const flags = rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`
    return { ...rule, re: new RegExp(rule.re.source, flags) }
  })
  let out = ''
  let cursor = 0
  let line = 1
  while (cursor < text.length) {
    let best = null
    for (const rule of rules) {
      rule.re.lastIndex = cursor
      const m = rule.re.exec(text)
      if (!m) continue
      if (m[0] === '') continue
      // 同一起点取靠前的规则（userpath 优先于 path，path 优先于 unc）
      if (best === null || m.index < best.m.index) best = { rule, m }
    }
    if (!best) {
      out += text.slice(cursor)
      break
    }
    const { rule, m } = best
    const gap = text.slice(cursor, m.index)
    out += gap
    line += (gap.match(/\n/g) || []).length
    const ph = KIND_PLACEHOLDER[rule.kind] || KIND_PLACEHOLDER.personal
    const span = rule.spanOf ? String(rule.spanOf(m) ?? '') : m[0]
    const skip = (reason) => {
      skipped.push({ rel, line, reason })
      out += m[0] // 保留原文
    }
    if (!span) {
      out += m[0]
    } else if (/[\r\n]/.test(m[0])) {
      skip('命中跨行')
    } else if (SANITIZE_UNSAFE_CHARS.test(span)) {
      skip('命中含语法结构字符')
    } else {
      out += rule.rebuild ? rule.rebuild(m, ph) : ph
      redactions++
    }
    line += (m[0].match(/\n/g) || []).length
    cursor = m.index + m[0].length
  }
  return { text: out, redactions, skipped }
}

/**
 * 脱敏后的可解析性校验（契约 §5「替换后必须仍是可解析的文本」）。
 * - `.json` / `.jsonl`：真跑 JSON.parse（Node 内置，零依赖）；失败返回原因；
 * - 其它（YAML/JS/文本）：Node 没有内置 YAML 解析器（不引依赖），
 *   改由「逐片段不含结构字符」+ `sameLineShape` 行结构不变量共同保证语法骨架没动。
 * @returns {string|null} null = 通过；否则是失败原因
 */
function validateSanitizedStructured(text, ext) {
  if (ext === '.json') {
    try {
      JSON.parse(text)
      return null
    } catch (err) {
      return `JSON.parse 失败：${String(err?.message || err)}`
    }
  }
  if (ext === '.jsonl' || ext === '.ndjson') {
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      try {
        JSON.parse(lines[i])
      } catch (err) {
        return `第 ${i + 1} 行 JSON.parse 失败：${String(err?.message || err)}`
      }
    }
  }
  return null
}

/** 行数 + 每行缩进必须完全不变（替换本身不含换行，这是最后一道保险） */
function sameLineShape(a, b) {
  const la = a.split('\n')
  const lb = b.split('\n')
  if (la.length !== lb.length) return false
  for (let i = 0; i < la.length; i++) {
    if ((/^[ \t]*/.exec(la[i]) || [''])[0] !== (/^[ \t]*/.exec(lb[i]) || [''])[0]) return false
  }
  return true
}

/**
 * 打包期脱敏一个文件：读源 →（必要时）写**脱敏后的副本**到 staging 的 dest；源文件绝不写。
 * 三重兜底（任一不过就整文件回退原文 + warning，绝不产出坏文件）：
 *   ① 源文件必须是合法 UTF-8（否则按 utf-8 读再写会毁内容 → 不脱敏）；
 *   ② 逐片段结构字符检查（sanitizeText 内）；
 *   ③ JSON 解析校验 + 行结构不变量。
 * @returns {{ redactions: number, warnings: string[] }}
 */
async function sanitizePackFile(src, dest, rel) {
  const buf = await fsp.readFile(src)
  // 非 UTF-8 文本（例如 GBK 的 .txt）：不做脱敏（读成再写回会毁内容），如实告警
  if (!Buffer.from(buf.toString('utf-8'), 'utf-8').equals(buf)) {
    await fsp.writeFile(dest, buf)
    return { redactions: 0, warnings: [`已跳过脱敏（不是合法 UTF-8 文本）：${rel}`] }
  }
  const original = buf.toString('utf-8')
  if (!original) {
    await fsp.writeFile(dest, buf)
    return { redactions: 0, warnings: [] }
  }
  const { text, redactions, skipped } = sanitizeText(original, rel)
  const warnings = skipped.map((s) => `已跳过 1 处脱敏（${s.reason}）：${s.rel}:${s.line}`)
  if (redactions === 0) {
    await fsp.writeFile(dest, buf) // 没改动就按原字节写，不做无谓的编码往返
    return { redactions: 0, warnings }
  }
  const ext = path.extname(rel).toLowerCase()
  const reason = validateSanitizedStructured(text, ext)
  if (reason || !sameLineShape(original, text)) {
    await fsp.writeFile(dest, buf) // 回退：包内保留原文
    warnings.push(`脱敏后校验失败，已回退原文：${rel}（${reason || '行结构变化'}）`)
    return { redactions: 0, warnings }
  }
  await fsp.writeFile(dest, text, 'utf-8')
  return { redactions, warnings }
}

// ---------- 归档（纯 JS zip） ----------

/** 递归收集 staging 目录里的文件，返回 { name（'/' 分隔）, data }[] */
async function collectStageEntries(root, rel = '') {
  const out = []
  const entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true })
  for (const e of entries) {
    const childRel = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...(await collectStageEntries(root, childRel)))
    else if (e.isFile()) out.push({ name: childRel, data: await fsp.readFile(path.join(root, childRel)) })
    // 其它类型（符号链接/设备）不进包：staging 是我们自己拷贝出来的，正常不会出现
  }
  return out
}

function stagingDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'packer-'))
}

// ---------- 打包主流程 ----------

function buildManifest({ modules, mode, note, files, sanitized = false, redactions = 0 }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'dsh-packer',
    createdAt: new Date().toISOString(),
    mode,
    note: note || '',
    modules,
    // v0.5.1（契约 §1/§3）：恢复端靠 manifest.sanitized 决定要不要回填 <用户目录>/<用户名>
    sanitized: sanitized === true,
    redactions: Number(redactions) || 0,
    // v0.4.0：清单条目必须带 size（契约 §3 dryRun 预览要显示大小；旧包没有 size 由消费方兜底）
    files: files.map((f) => ({ module: f.module, rel: f.rel, size: Number(f.size) || 0, sha256: f.sha256 })),
  }
}

/** 作业取消：只在文件边界抛出，由 createPack / applyRestore 捕获后清理半成品 */
class JobCancelled extends Error {
  constructor(message = '任务已取消') {
    super(message)
    this.name = 'JobCancelled'
    this.code = 'cancelled'
  }
}

/**
 * 打包主流程。
 * v0.4.0 扩展：encrypt/password（加密包 PKENC1）、hooks（异步作业的进度与取消）。
 * v0.5.1 扩展：sanitize（清理后打包）—— share 模式强制 true（契约 §1）。
 * 取消语义（契约 §4）：在**文件边界**检查取消标志；中止后不留半成品 zip
 * （先写隐藏临时文件，最后一步才 rename 到正式名）。
 */
async function createPackInner({ modules, mode = 'migrate', note = '', dryRun = false, encrypt = false, password = '', sanitize = false, hooks = null }) {
  if (!Array.isArray(modules) || !modules.length) throw new Error('未选择任何模块')
  for (const m of modules) {
    if (!MODULES[m]) throw new Error(`未知模块: ${m}`)
  }
  // 内部入口也走白名单（fail-closed）：非法模式绝不退化成 migrate，避免 CLI/调用方传错时静默产出错包
  if (mode !== 'migrate' && mode !== 'share') throw new Error(`非法模式: ${mode}（只能是 migrate 或 share）`)
  if (encrypt && (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)) {
    throw new Error(`加密密码至少 ${MIN_PASSWORD_LENGTH} 位`)
  }
  const share = mode === 'share'
  // 契约 §1：share 模式忽略传入值、强制脱敏 —— 分享出去的内容必须已清理
  const doSanitize = share || sanitize === true
  // 进度/取消回调：回调自身出错不能打断打包，但要留下日志（不静默吞）
  const report = (phase, done, total) => {
    try {
      hooks?.progress?.(phase, done, total)
    } catch (err) {
      console.warn(`[dsh-packer] 作业进度回调失败：${String(err?.message || err)}`)
    }
  }
  const checkCancel = () => {
    if (hooks?.shouldCancel?.()) throw new JobCancelled()
  }

  // ---------- 阶段 1：收集模块文件（不读内容） ----------
  report('collect', 0, 0)
  const plans = []
  for (const name of modules) {
    checkCancel()
    plans.push({ name, files: await collectModuleFiles(MODULES[name], share) })
    report('collect', plans.reduce((s, p) => s + p.files.length, 0), 0)
  }
  const plannedTotal = plans.reduce((s, p) => s + p.files.length, 0)
  report('collect', plannedTotal, plannedTotal)

  // ---------- 阶段 2：指纹 + 体积（有界并发，逐文件检查取消） ----------
  const flat = []
  for (const p of plans) for (const f of p.files) flat.push({ module: p.name, ...f })
  let hashedCount = 0
  const collected = []
  const unreadable = []
  const hashed = await mapLimit(flat, IO_CONCURRENCY, async (f) => {
    checkCancel()
    try {
      const st = await fsp.stat(f.abs)
      const digest = await sha256(f.abs)
      hashedCount++
      report('hash', hashedCount, plannedTotal)
      return { module: f.module, rel: f.rel, abs: f.abs, size: st.size, sha256: digest }
    } catch (err) {
      // 读不出内容的文件绝不写入空指纹，直接跳过并如实上报
      hashedCount++
      report('hash', hashedCount, plannedTotal)
      unreadable.push({ module: f.module, rel: f.rel, error: String(err.message || err) })
      return null
    }
  })
  for (const f of hashed) if (f) collected.push(f)
  // v0.2.6：SQLite 快照失败的文件不打包，但必须如实出现在 unreadable 里（不静默）
  for (const w of SNAPSHOT_WARNINGS) {
    unreadable.push({ module: 'memoryDb', rel: path.basename(w.src), error: `SQLite 快照失败（VACUUM INTO）：${w.error}` })
  }
  if (!collected.length) throw new Error('所选模块没有可打包的文件')

  // 隐私扫描：v0.5.1 起分享模式**不再一票否决**，而是强制脱敏（契约 §1：
  // 「隐私不能只提示，要处理掉」）。迁移模式保真打包，含凭据又未加密时用 warnings 明确告警。
  report('scan', collected.length, collected.length)
  const findings = await privacyScan(collected)
  const findingTotal = countFindings(findings)
  const warnings = []
  const credentialTotal = countFindings(findings.filter((f) => f.kind === 'credential' || f.kind === 'key'))
  if (!doSanitize && credentialTotal > 0 && encrypt !== true) {
    warnings.push(`包含 ${credentialTotal} 处凭据且未加密，建议设置口令（或改选「清理后打包」）`)
  }

  // v0.2.6（自审 P10）：读不出内容的文件没被扫描（未写指纹，privacyScan 也看不到），
  // 但此前仍会被打进包——分享模式下等于把未扫描内容发给别人。分享模式直接失败（fail-closed）；
  // 迁移模式保留行为，但 UI/命令都会如实上报 unreadable。
  if (share && unreadable.length) {
    throw new Error(`分享模式拒绝打包：${unreadable.length} 个文件读不出内容、未经过隐私扫描（fail-closed）：\n` +
      unreadable.slice(0, 10).map((f) => `- ${f.module}/${f.rel}：${f.error}`).join('\n'))
  }

  const totalBytes = collected.reduce((s, f) => s + f.size, 0)

  // 预览：只出清单不落盘。sanitized = 「真要打包会不会脱敏」（share 恒 true）。
  if (dryRun) {
    const manifest = buildManifest({ modules, mode, note, files: collected, sanitized: doSanitize })
    return {
      dryRun: true,
      manifest,
      privacy: findings,
      unreadable,
      totalBytes,
      encrypted: encrypt === true,
      sanitized: doSanitize,
      warnings,
    }
  }

  // ---------- 阶段 3：staging 复制（+ 脱敏）→ 清单 → 归档 ----------
  const stage = await stagingDir()
  const ext = encrypt ? PKENC_EXT : '.zip'
  await fsp.mkdir(PACKS_DIR, { recursive: true })
  const zipName = `dsh-packer-${nowStamp()}-${uniqueSuffix()}-${mode}${ext}`
  const zipPath = path.join(PACKS_DIR, zipName)
  // 先写隐藏临时文件再 rename：取消或失败都不会留下半个包（契约 §4）
  const tmpZipPath = path.join(PACKS_DIR, `.${zipName}.${process.pid}.tmp`)
  const summaryTmpPath = path.join(PACKS_DIR, `.${packSummaryName(zipName)}.${process.pid}.tmp`)
  let redactions = 0
  let summary = null
  try {
    // v0.5.1 脱敏要点（契约 §1）：
    //   ① 只把**脱敏后的副本**写进 staging，源文件从头到尾不写（绝不改源文件）；
    //   ② 脱敏后按**新内容**重算 size/sha256 写回清单——否则清单指纹与包内实际内容不符，
    //      恢复端会按 fail-closed 直接拒绝（等于把包打废）。
    const packedFiles = new Array(collected.length)
    let copied = 0
    const sanitizeWarnings = []
    await mapLimit(collected, IO_CONCURRENCY, async (f, index) => {
      checkCancel()
      const dest = path.join(stage, f.module, f.rel)
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      let size = f.size
      let digest = f.sha256
      if (doSanitize && (await isTextFile(f.abs))) {
        const r = await sanitizePackFile(f.abs, dest, `${f.module}/${f.rel}`)
        redactions += r.redactions
        if (r.warnings.length) sanitizeWarnings.push(...r.warnings)
        if (r.redactions > 0) {
          size = (await fsp.stat(dest)).size
          digest = await sha256(dest)
        }
      } else {
        await fsp.copyFile(f.abs, dest)
      }
      packedFiles[index] = { module: f.module, rel: f.rel, size, sha256: digest }
      copied++
      report('zip', copied, collected.length)
    })
    if (sanitizeWarnings.length) warnings.push(...sanitizeWarnings)
    // 备注本身也会进包（manifest.json / README）：脱敏模式下同样清理，避免「用户手写的路径」漏出去
    let packNote = String(note || '')
    if (doSanitize && packNote) {
      const noteSan = sanitizeText(packNote, 'manifest.note')
      packNote = noteSan.text
      redactions += noteSan.redactions
      if (noteSan.skipped.length) {
        warnings.push(...noteSan.skipped.map((s) => `已跳过 1 处脱敏（${s.reason}）：${s.rel}`))
      }
    }
    const manifest = buildManifest({
      modules,
      mode,
      note: packNote,
      files: packedFiles,
      sanitized: doSanitize,
      redactions,
    })
    summary = {
      name: zipName,
      createdAt: manifest.createdAt,
      mode,
      note,
      modules,
      fileCount: packedFiles.length,
      totalBytes: packedFiles.reduce((s, f) => s + f.size, 0),
      encrypted: encrypt === true,
      privacyFindings: findingTotal,
      // v0.5.1（契约 §2）：结果 pack 里要能看到「是否脱敏 / 脱敏了几处 / 告警」
      sanitized: doSanitize,
      redactions,
      warnings: warnings.slice(),
    }
    await fsp.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    // 分享包自动附 README
    if (share) {
      await fsp.writeFile(path.join(stage, 'README.md'), shareReadme(manifest), 'utf-8')
    }
    checkCancel()
    report('write', packedFiles.length, packedFiles.length)
    const zipEntries = await collectStageEntries(stage)
    const zipBuf = buildZip(zipEntries)
    const outBuf = encrypt ? await encryptZipBuffer(zipBuf, password) : zipBuf
    await fsp.writeFile(tmpZipPath, outBuf)
    // v0.6.0（UI 重做）：结果与摘要都要带包文件本身的 SHA-256，界面用它做「指纹」核对是否传坏。
    summary.sha256 = await sha256(tmpZipPath)
    await fsp.writeFile(summaryTmpPath, JSON.stringify(summary, null, 2), 'utf-8')
    // 最后一个取消检查放在 rename 之前：此刻取消可完整清理，不留正式文件
    checkCancel()
    await fsp.rename(tmpZipPath, zipPath)
    await fsp.rename(summaryTmpPath, path.join(PACKS_DIR, packSummaryName(zipName)))
  } finally {
    await fsp.rm(stage, { recursive: true, force: true })
    // 取消/失败：清掉可能残留的临时文件（正式包已 rename 的不会被误删）
    await fsp.rm(tmpZipPath, { force: true })
    await fsp.rm(summaryTmpPath, { force: true })
  }

  // 注意：这里不报 'done' —— job.phase='done' 由作业运行器在写入 result 之后统一设置，
  // 否则轮询者可能看到「phase=done 但 result 还是 null」的中间态（竞态）。
  report('write', summary.fileCount, summary.fileCount)
  // 契约 §5：result.pack 带 path（zip/pkenc 的绝对路径），UI 用它做「复制路径」；dryRun 不带。
  // 注意 path 不写进 summary（summary JSON 落盘时不应内嵌本机绝对路径）。
  return { ok: true, pack: { ...summary, path: zipPath }, privacy: findings, unreadable, warnings }
}

/**
 * 打包入口。包一层只为两件事：①每次运行清空快照告警；②无论成功、失败还是预览，
 * 都清理 VACUUM INTO 落在系统临时目录里的快照（进程不退出也不该留垃圾）。
 */
async function createPack(opts) {
  SNAPSHOT_WARNINGS.length = 0
  try {
    return await createPackInner(opts)
  } finally {
    await cleanupSnapshots()
  }
}

function shareReadme(manifest) {
  return `# dsh-packer 配置包

此压缩包由 **dsh-packer**（DeepSeek Harness 配置打包器）生成。

## 包含内容
${manifest.modules.map((m) => `- ${MODULES[m]?.label || m}`).join('\n')}

## 安装方法
1. 将本 zip 放到目标机器任意位置
2. 在 DSH 设置页 →「配置打包」→「恢复」，选择本文件
3. 按提示选择冲突策略（覆盖/跳过/合并）后应用

## 说明
- 生成时间：${manifest.createdAt}
- 用途：${manifest.mode === 'share' ? '分享' : '迁移'}
${manifest.note ? `- 备注：${manifest.note}` : ''}
- 本包不包含任何凭据（API Key 等）${manifest.sanitized ? `\n- 已脱敏：${Number(manifest.redactions) || 0} 处路径/密钥类命中已替换为占位符（<用户目录> / <用户名> 在恢复时自动回填目标机）` : ''}
- manifest.json 内含每个文件的 SHA-256 指纹，用于完整性校验

---
Generated by dsh-packer
`
}

// ---------- 包管理（.zip 与 .pkenc 双格式：列表 + 详情（含校验）+ 重命名 + 删除） ----------

/** 包名 → 去后缀基名（.zip / .pkenc 都识别） */
function packBaseName(name) {
  return String(name).replace(PACK_EXT_RE, '')
}

/** 摘要 JSON 文件名（旧版 .zip → .json，加密包 .pkenc → .json，同一规则） */
function packSummaryName(name) {
  return packBaseName(name) + '.json'
}

function packFilePath(name) {
  return path.join(PACKS_DIR, name)
}

function packSummaryPath(name) {
  return path.join(PACKS_DIR, packSummaryName(name))
}

function isEncryptedPackName(name) {
  return String(name).toLowerCase().endsWith(PKENC_EXT)
}

/**
 * 包名校验（契约 §5：不允许路径分隔符 / `..`；长度上限 120）。
 * fail-closed：所有「用户给出的包名」都先过这里，绝不把原始串直接拼进路径。
 */
function validatePackName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new ApiError(400, 'bad_name', '包名不能为空')
  const n = name.trim()
  if (n.length > PACK_NAME_MAX) throw new ApiError(400, 'bad_name', `包名过长（上限 ${PACK_NAME_MAX} 字符）`)
  if (n.includes('\0')) throw new ApiError(400, 'bad_name', '包名含非法字符（NUL）')
  if (/[<>:"|?*\u0000-\u001f]/.test(n)) throw new ApiError(400, 'bad_name', '包名含非法字符（<>:"|?* 或控制字符）')
  if (n.includes('/') || n.includes('\\')) throw new ApiError(400, 'bad_name', '包名不得包含路径分隔符（/ 或 \\）')
  if (n.includes('..')) throw new ApiError(400, 'bad_name', '包名不得包含 ..')
  if (!PACK_EXT_RE.test(n)) throw new ApiError(400, 'bad_name', '包名必须以 .zip 或 .pkenc 结尾')
  return n
}

/** 摘要 JSON 读取（损坏/缺失都走调用方兜底，不在此抛错） */
async function readPackSummary(name) {
  try {
    const parsed = JSON.parse(await fsp.readFile(packSummaryPath(name), 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null // 缺失或非 JSON：由 listPacks 用文件 stat 兜底（不是错误路径）
  }
}

/**
 * 包列表：同时识别 `.zip` 与 `.pkenc`（契约 §5 / §8）。
 * 摘要缺失或损坏时用文件 stat 兜底，保证包不会「消失」，且 encrypted 标志始终由真实后缀/摘要共同判定。
 */
async function listPacks() {
  let names
  try {
    names = await fsp.readdir(PACKS_DIR)
  } catch (err) {
    if (err?.code === 'ENOENT') return [] // 包目录还没建：空列表是正确结果
    throw new Error(`读取包目录失败：${String(err?.message || err)}`) // 其它错误必须上报，不再静默返回空
  }
  const out = []
  for (const f of names) {
    if (!PACK_EXT_RE.test(f)) continue
    let st
    try {
      st = await fsp.stat(packFilePath(f))
    } catch (err) {
      if (err?.code === 'ENOENT') continue // 列目录后被并发删除
      throw new Error(`读取包文件信息失败（${f}）：${String(err?.message || err)}`)
    }
    if (!st.isFile()) continue
    const summary = await readPackSummary(f) || {}
    out.push({
      name: f,
      mode: typeof summary.mode === 'string' ? summary.mode : '',
      createdAt: typeof summary.createdAt === 'string' ? summary.createdAt : st.mtime.toISOString(),
      note: typeof summary.note === 'string' ? summary.note : '',
      fileCount: Number(summary.fileCount) || 0,
      totalBytes: Number(summary.totalBytes) || 0,
      encrypted: summary.encrypted === true || isEncryptedPackName(f),
      // v0.6.0（UI）：列表要能显示「内容」列与「指纹」，缺字段时前端显示「—」
      modules: Array.isArray(summary.modules) ? summary.modules : [],
      sha256: typeof summary.sha256 === 'string' ? summary.sha256 : null,
    })
  }
  out.sort((a, b) => {
    const byTime = String(b.createdAt).localeCompare(String(a.createdAt))
    if (byTime !== 0) return byTime
    // 同一毫秒打的两个包：文件名含时间戳+随机后缀，字典序倒序近似「新的在前」
    return String(b.name).localeCompare(String(a.name))
  })
  return out
}

// ---------- 删除：按平台送进系统回收站（契约 §4，v0.6.4 三平台分派） ----------

/**
 * 归一化平台标识：鸿蒙的 Node 可能报 ohos / openharmony / harmonyos，统一成 'harmony'。
 * 其余平台原样返回（win32 / darwin / linux / 其它）。
 */
function platformTag(platform = process.platform) {
  const p = String(platform || '').toLowerCase()
  if (p === 'ohos' || p.includes('harmony')) return 'harmony'
  return p
}

/** 当前平台是否有系统回收站（win32 / darwin / linux → true；鸿蒙/未知 → false） */
function hasSystemTrash(platform = process.platform) {
  return TRASH_PLATFORMS.has(platformTag(platform))
}

/**
 * 当前平台的宿主是否有系统文件选择框（鸿蒙等 → false）。
 * 本插件在网页层拿不到宿主机路径，因此任何平台都**不渲染**选择框按钮；
 * 这个判断只决定「是否把『手填包路径』当主入口并在界面提示」。
 */
function hasSystemFilePicker(platform = process.platform) {
  return FILE_PICKER_PLATFORMS.has(platformTag(platform))
}

/** PowerShell 单引号字符串：内部单引号翻倍转义（避免路径里的引号被当成语句边界） */
function psSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Windows：PowerShell 5.1 自带的 Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile(..., SendToRecycleBin)。
 * 不装任何模块/依赖（v0.5.0 起的既有实现，v0.6.4 行为保持不变）。
 */
async function recycleFileWindows(filePath, exec = execFileAsync) {
  const script = 'Add-Type -AssemblyName Microsoft.VisualBasic; '
    + `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${psSingleQuoted(filePath)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`
  await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: RECYCLE_TIMEOUT_MS,
  })
  return true
}

/** AppleScript 字符串字面量转义：先反斜杠再双引号（顺序反了会双重转义） */
function escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * macOS：让 Finder 删除 `tell application "Finder" to delete POSIX file "<path>"`。
 * 纯函数（只拼命令不执行）→ 在 Windows 上也能单测「命令拼装」。
 */
function buildMacRecycleArgs(filePath) {
  return ['-e', `tell application "Finder" to delete POSIX file "${escapeAppleScriptString(filePath)}"`]
}

/** macOS：osascript 调 Finder 删除（进废纸篓）；失败/超时抛出，由 deletePack 降级并回报 */
async function recycleFileMac(filePath, exec = execFileAsync) {
  await exec('osascript', buildMacRecycleArgs(filePath), { timeout: RECYCLE_TIMEOUT_MS })
  return true
}

/**
 * freedesktop Trash 规范的根目录：`$XDG_DATA_HOME`（缺省 `~/.local/share`）+ `Trash`。
 */
function trashDataHome(env = process.env, homeDir = os.homedir()) {
  const xdg = typeof env.XDG_DATA_HOME === 'string' ? env.XDG_DATA_HOME.trim() : ''
  return xdg || path.join(homeDir, '.local', 'share')
}

/**
 * `.trashinfo` 的 `Path=` 值：逐段 percent-encode、保留 `/` 分隔符。
 * 例：`/home/u/a b/中文.txt` → `/home/u/a%20b/%E4%B8%AD%E6%96%87.txt`
 */
function encodeTrashPath(absPath) {
  return String(absPath).split('/').map((seg) => encodeURIComponent(seg)).join('/')
}

/** `.trashinfo` 的 `DeletionDate=` 值：本地时间 `YYYY-MM-DDThh:mm:ss`（规范要求，不带时区） */
function formatTrashDate(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

/** 一份 `.trashinfo` 的内容：`[Trash Info]` 段 + Path + DeletionDate */
function buildTrashInfo(absPath, date = new Date()) {
  return `[Trash Info]\nPath=${encodeTrashPath(absPath)}\nDeletionDate=${formatTrashDate(date)}\n`
}

/** files/ 与 info/ 都必须没占用才算可用名；冲突按规范加 `.1` / `.2` … 后缀 */
async function uniqueTrashBaseName(filesDir, infoDir, baseName) {
  let candidate = baseName
  for (let i = 1; i <= 1000; i += 1) {
    const inFiles = await exists(path.join(filesDir, candidate))
    const inInfo = await exists(path.join(infoDir, `${candidate}.trashinfo`))
    if (!inFiles && !inInfo) return candidate
    candidate = `${baseName}.${i}`
  }
  throw new Error('回收站同名文件过多（>1000）')
}

/**
 * Linux：按 freedesktop Trash 规范把文件移进回收站（纯 Node，不调外部命令）。
 * - 文件 → `$XDG_DATA_HOME/Trash/files/<name>`（缺省 `~/.local/share`），同名冲突加后缀；
 * - 记录 → `$XDG_DATA_HOME/Trash/info/<name>.trashinfo`（Path URL 编码 + 本地时间 DeletionDate）。
 * @param {string} filePath 源文件路径
 * @param {{ env?: Record<string, string|undefined>, homeDir?: string, xdgDataHome?: string, now?: Date }} [opts] 测试注入点
 */
async function recycleFileLinux(filePath, opts = {}) {
  const env = opts.env || process.env
  const homeDir = opts.homeDir || os.homedir()
  const dataHome = opts.xdgDataHome || trashDataHome(env, homeDir)
  const filesDir = path.join(dataHome, 'Trash', 'files')
  const infoDir = path.join(dataHome, 'Trash', 'info')
  const abs = path.resolve(filePath)
  const stat = await fsp.stat(abs)
  if (!stat.isFile()) throw new Error('只支持把普通文件移入回收站')
  await fsp.mkdir(filesDir, { recursive: true })
  await fsp.mkdir(infoDir, { recursive: true })
  const name = await uniqueTrashBaseName(filesDir, infoDir, path.basename(abs))
  const dest = path.join(filesDir, name)
  const infoPath = path.join(infoDir, `${name}.trashinfo`)
  // 先写 .trashinfo 再挪文件：挪失败就把 info 回滚掉，绝不留「有记录没文件」的空壳
  await fsp.writeFile(infoPath, buildTrashInfo(abs, opts.now), { mode: 0o600 })
  try {
    await fsp.rename(abs, dest)
  } catch (err) {
    if (err?.code !== 'EXDEV') {
      await fsp.rm(infoPath, { force: true })
      throw err
    }
    // 跨设备（源文件与回收站不在同一分区）：复制 + 删源
    try {
      await fsp.copyFile(abs, dest)
      await fsp.unlink(abs)
    } catch (copyErr) {
      await fsp.rm(dest, { force: true })
      await fsp.rm(infoPath, { force: true })
      throw copyErr
    }
  }
  return true
}

/**
 * 把单个文件送进系统回收站（默认实现，v0.6.4 起按平台分派）。
 * - Windows：PowerShell + SendToRecycleBin；
 * - macOS：osascript 让 Finder 删除（进废纸篓）；
 * - Linux：freedesktop Trash（纯 Node 实现）；
 * - 鸿蒙 / 其它：返回 false（JS 层拿不到 ArkTS 的 @ohos.file.trash，仍走永久删除 + warning）。
 * 调用失败（命令缺失/被杀/超时/报错）直接抛出，由 deletePack 降级并如实回报，绝不静默。
 * @param {string} filePath 要删除的文件
 * @param {string} [platform] 平台标识（测试注入；默认 process.platform）
 */
async function recycleFileNative(filePath, platform = process.platform) {
  switch (platformTag(platform)) {
    case 'win32': return recycleFileWindows(filePath)
    case 'darwin': return recycleFileMac(filePath)
    case 'linux': return recycleFileLinux(filePath)
    default: return false
  }
}

/**
 * 删除包（契约 §4）。
 * 优先送进**当前平台的系统回收站**（v0.6.4：Windows 回收站 / macOS 废纸篓 / Linux Trash），
 * 成功返回 `{ ok:true, recycled:true }`；
 * 该平台没有回收站（鸿蒙等）或回收站调用失败 → 降级为永久删除，返回 `{ ok:true, recycled:false, warning }`（不得静默）。
 * 同名 `.json` 摘要一并删除（`.pkenc` 与 `.zip` 同一套逻辑）。
 * @param {string} name 包名
 * @param {(filePath: string) => Promise<boolean>} [recycleFn] 回收站实现（测试注入点）
 */
async function deletePack(name, recycleFn = recycleFileNative) {
  const n = validatePackName(name)
  let st
  try {
    st = await fsp.stat(packFilePath(n))
  } catch (err) {
    if (err?.code === 'ENOENT') throw new ApiError(404, 'pack_not_found', `包不存在: ${n}`)
    throw err
  }
  if (!st.isFile()) throw new ApiError(404, 'pack_not_found', `包不存在: ${n}`)
  const filePath = packFilePath(n)
  const summaryPath = packSummaryPath(n)
  let recycled = false
  let failure = null
  try {
    const claimed = await recycleFn(filePath)
    // 声称成功但文件仍在（桩/以后换实现防错）：按失败处理，走降级分支
    if (claimed && !(await exists(filePath))) recycled = true
    else if (claimed) failure = new Error('回收站调用返回成功但文件仍存在')
  } catch (err) {
    failure = err
  }
  // 摘要只是元数据：跟着一起删（不进回收站，避免包目录留下孤立 JSON）
  if (recycled) {
    await fsp.rm(summaryPath, { force: true })
    return { ok: true, recycled: true, name: n }
  }
  await fsp.rm(filePath, { force: true })
  await fsp.rm(summaryPath, { force: true })
  const reason = failure
    ? `回收站调用失败（${String(failure?.message || failure)}）`
    : `当前平台（${platformTag()}）没有系统回收站（支持 Windows 回收站 / macOS 废纸篓 / Linux Trash）`
  return {
    ok: true,
    recycled: false,
    name: n,
    warning: `未能移入系统回收站：${reason}；已永久删除 ${n}（不可恢复）`,
  }
}

/**
 * 包详情（契约 §5 + v0.5.0 §3）：manifest + 逐文件 size + encrypted，
 * **顺带**逐个文件重算 SHA-256 与清单比对，结果放 `verify:{ checked, failures }`。
 *
 * - 校验失败不是错误响应：200 + failures 数组（UI 显示红字），一次返回全部问题；
 * - 加密包需要密码（错误/缺失 → 400 bad_password，由 crypto.mjs 的 BadPasswordError 统一映射）。
 */
async function getPackInfo(name, password) {
  const n = validatePackName(name)
  if (!(await exists(packFilePath(n)))) throw new ApiError(404, 'pack_not_found', `包不存在: ${n}`)
  const { manifest, dir, encrypted } = await readManifestFromZip(packFilePath(n), password)
  const files = []
  let checked = 0
  const failures = []
  try {
    for (const f of manifest.files || []) {
      const module = String(f.module)
      const rel = String(f.rel)
      // 优先用清单里的 size（v0.4.0 新包都有）；旧包没有 size 时从解压结果 stat 兜底
      let size = Number(f.size)
      try {
        const mod = MODULES[module]
        if (!mod) throw new Error(`未知模块: ${module}`)
        assertSafeRel(rel)
        const src = path.resolve(dir, module, rel)
        if (!pathContained(dir, src)) throw new Error('包内路径越界（fail-closed）')
        if (!(await exists(src))) throw new Error('包内文件缺失')
        if (!isValidSha256(f.sha256)) throw new Error('清单指纹非法（fail-closed）')
        if (!Number.isFinite(size) || size < 0) size = await fileSize(src)
        const actual = await sha256(src)
        if (actual !== f.sha256) throw new Error(`SHA-256 不匹配（清单 ${f.sha256} ≠ 实际 ${actual}）`)
        checked++
      } catch (err) {
        failures.push({ module, rel, error: String(err?.message || err) })
        if (!Number.isFinite(size) || size < 0) size = 0
      }
      files.push({ module, rel, size })
    }
    return { ok: true, manifest: publicManifest(manifest), files, encrypted, verify: { checked, failures } }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

/** 对外 manifest：去掉内部字段（`_dir`）与逐文件数组（详情用 files 单独返回） */
function publicManifest(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    mode: manifest.mode,
    modules: Array.isArray(manifest.modules) ? manifest.modules : [],
    note: manifest.note || '',
    createdAt: manifest.createdAt,
    // v0.5.1：UI 的「查看」抽屉可以据此显示「本包已脱敏 N 处」
    sanitized: manifest.sanitized === true,
    redactions: Number(manifest.redactions) || 0,
  }
}

/**
 * 重命名（契约 §5）：先过包名校验，再要求加密后缀不变（不允许 .zip ↔ .pkenc，否则内容与名字不符）。
 */
async function renamePack(oldName, newName) {
  const from = validatePackName(oldName)
  const to = validatePackName(newName)
  if (isEncryptedPackName(from) !== isEncryptedPackName(to)) {
    throw new ApiError(400, 'bad_name', '不允许把 .zip 改成 .pkenc（或反之）：后缀必须与包内容一致')
  }
  if (from === to) return { ok: true, renamed: { from, to } }
  if (!(await exists(packFilePath(from)))) throw new ApiError(404, 'pack_not_found', `包不存在: ${from}`)
  if (await exists(packFilePath(to))) throw new ApiError(409, 'pack_exists', `目标已存在: ${to}`)
  await fsp.rename(packFilePath(from), packFilePath(to))
  const oldSumPath = packSummaryPath(from)
  if (await exists(oldSumPath)) {
    const summary = await readPackSummary(from)
    if (summary) {
      summary.name = to
      await fsp.writeFile(packSummaryPath(to), JSON.stringify(summary, null, 2), 'utf-8')
    } else {
      // 摘要本身损坏：原样搬过去，别因为解析失败丢掉用户文件
      await fsp.rename(oldSumPath, packSummaryPath(to))
    }
    if (await exists(oldSumPath)) await fsp.rm(oldSumPath, { force: true })
  }
  return { ok: true, renamed: { from, to } }
}

// ---------- 模块预设 / 磁盘占用 ----------

/** 按模式取模块预设（迁移=default，分享=share） */
function defaultModulesFor(mode = 'migrate') {
  const flag = mode === 'share' ? 'share' : 'default'
  return Object.keys(MODULES).filter((m) => MODULES[m][flag])
}

/** 磁盘占用（契约 §2：disk 只剩 packsBytes = 包目录内所有包文件字节数） */
async function packsDiskUsage() {
  let packsBytes = 0
  let names
  try {
    names = await fsp.readdir(PACKS_DIR)
  } catch (err) {
    if (err?.code === 'ENOENT') return { packsBytes: 0 }
    throw new Error(`读取包目录失败：${String(err?.message || err)}`)
  }
  for (const f of names) {
    if (!PACK_EXT_RE.test(f)) continue
    packsBytes += await fileSize(path.join(PACKS_DIR, f))
  }
  return { packsBytes }
}

// ---------- 异步作业（契约 §4） ----------
// 内存保留最近 20 条；终态作业（done/error/cancelled）保留 5 分钟。
// 取消只在**文件边界**生效；取消/失败都不留半成品（create 写临时文件后 rename）。

const JOBS = new Map()
let JOB_SEQ = 0

function isJobTerminal(job) {
  return job.finishedAt !== null
}

/** 清理过期作业 + 控制总量（惰性 prune，无定时器，内存有界） */
function pruneJobs(now = Date.now()) {
  for (const [id, job] of JOBS) {
    if (isJobTerminal(job) && now - job.finishedAt > JOB_RETAIN_MS) JOBS.delete(id)
  }
  while (JOBS.size > JOB_MAX) {
    let oldest = null
    for (const job of JOBS.values()) {
      if (!oldest || job.createdAt < oldest.createdAt) oldest = job
    }
    if (!oldest) break
    JOBS.delete(oldest.id)
  }
}

function newJob(kind) {
  pruneJobs()
  const job = {
    id: `job-${Date.now().toString(36)}-${(++JOB_SEQ).toString(36)}`,
    kind,
    phase: 'collect',
    done: 0,
    total: 0,
    cancelled: false,
    error: null,
    result: null,
    cancelRequested: false,
    createdAt: Date.now(),
    finishedAt: null,
  }
  JOBS.set(job.id, job)
  pruneJobs()
  return job
}

function jobView(job) {
  return {
    id: job.id,
    kind: job.kind,
    phase: job.phase,
    done: job.done,
    total: job.total,
    cancelled: job.cancelled,
    error: job.error,
    result: job.result,
  }
}

function getJob(id) {
  pruneJobs()
  const job = JOBS.get(String(id))
  if (!job) throw new ApiError(404, 'job_not_found', `作业不存在或已过期: ${id}`)
  return job
}

function listJobs() {
  pruneJobs()
  return [...JOBS.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, JOB_MAX)
    .map(jobView)
}

function cancelJob(id) {
  const job = getJob(id)
  // 已终态也返回 ok（幂等），没跑完则置取消标志，等文件边界生效
  if (!isJobTerminal(job)) job.cancelRequested = true
  return { ok: true, cancelled: !isJobTerminal(job) }
}

/** 作业进度钩子：file 边界产生 {phase, done, total}（契约 §4） */
function jobHooks(job) {
  return {
    progress: (phase, done, total) => {
      if (isJobTerminal(job)) return
      job.phase = phase
      job.done = Number(done) || 0
      job.total = Number(total) || 0
    },
    shouldCancel: () => job.cancelRequested === true,
  }
}

function startCreateJob(opts) {
  const job = newJob('create')
  const hooks = jobHooks(job)
  setImmediate(() => { void runCreateJob(job, opts, hooks) })
  return job
}

async function runCreateJob(job, opts, hooks) {
  try {
    const result = await createPack({ ...opts, hooks })
    job.result = result
    job.done = job.total || result?.pack?.fileCount || job.done
    job.total = job.total || result?.pack?.fileCount || job.done
    job.phase = 'done'
  } catch (err) {
    if (err?.code === 'cancelled' || job.cancelRequested) {
      job.cancelled = true
      job.result = { ok: false, code: 'cancelled', error: '任务已取消，未生成包（无半成品残留）' }
    } else {
      job.error = String(err?.message || err)
    }
    job.phase = 'done'
  } finally {
    job.finishedAt = Date.now()
  }
}

function startRestoreJob(opts) {
  const job = newJob('restore')
  const hooks = jobHooks(job)
  setImmediate(() => { void runRestoreJob(job, opts, hooks) })
  return job
}

async function runRestoreJob(job, opts, hooks) {
  try {
    const { manifest, dir } = await readManifestFromZip(opts.zip, opts.password)
    try {
      manifest._dir = dir
      const eligible = (manifest.files || []).filter((f) => !opts.modules || opts.modules.includes(f.module))
      job.total = eligible.length
      const stats = await applyRestore(manifest, {
        strategy: opts.strategy,
        moduleFilter: opts.modules,
        includeDb: opts.includeDb,
        onProgress: hooks.progress,
        shouldCancel: hooks.shouldCancel,
      })
      job.result = { ok: !(stats.aborted && stats.cancelled), stats }
      if (stats.aborted && stats.cancelled) job.cancelled = true
      job.done = job.total
      job.phase = 'done'
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  } catch (err) {
    if (err?.code === 'cancelled' || job.cancelRequested) {
      job.cancelled = true
      job.result = { ok: false, code: 'cancelled', error: '任务已取消，已回滚本次已应用的文件' }
    } else if (isBadPasswordError(err)) {
      // 密码错误/缺失：作业层面保留稳定 code，UI 才能提示「密码错误」而不是一句内部报错
      job.error = String(err?.message || err)
      job.result = { ok: false, code: 'bad_password', error: job.error }
    } else {
      job.error = String(err?.message || err)
    }
    job.phase = 'done'
  } finally {
    job.finishedAt = Date.now()
  }
}

// ---------- 恢复 ----------

/** 直接对加密包调用解包接口时，给出明确的 bad_password 语义（而不是「不是有效 zip」的 500） */
async function rejectEncryptedPath(p) {
  if (!(await exists(p))) return
  const head = await readHeadBytes(p, 8)
  if (isEncryptedBuffer(head)) {
    throw new BadPasswordError('该包已加密（PKENC1）：请通过恢复接口并提供正确密码访问')
  }
}

/** 读中央目录并做白名单校验：成员名不得是绝对路径/盘符/UNC/含 .. ；类型只放行普通文件与目录 */
async function listSafeEntries(zipPath) {
  await rejectEncryptedPath(zipPath)
  let entries
  try {
    entries = readZipFile(zipPath).entries
  } catch (err) {
    throw new Error(`包内清单非法或包已损坏（无法读取成员列表）: ${String(err.message || err)}`)
  }
  if (!entries.length) throw new Error('包内没有任何成员（空包或不是有效 zip）')
  for (const e of entries) {
    const name = e.name.replace(/^\.\//, '')
    if (!name) continue
    if (name.includes('\0')) throw new Error('包内成员名含非法字符，已拒绝解包（fail-closed）')
    if (/^[A-Za-z]:/.test(name)) throw new Error(`包内成员名非法（盘符路径）: ${name}`)
    if (name.startsWith('/') || name.startsWith('\\')) throw new Error(`包内成员名非法（绝对路径/UNC）: ${name}`)
    if (name.split(/[\\/]/).includes('..')) throw new Error(`包内成员名越界（含 .. 片段）: ${name}`)
    const kind = entryKind(e)
    if (kind !== 'file' && kind !== 'dir') {
      throw new Error(`包内含不允许的成员类型（${kind}），已拒绝解包（fail-closed）: ${name}`)
    }
  }
  return entries
}

/** 成员名列表（对外语义不变：字符串数组） */
async function validateArchiveMembers(zipPath) {
  const entries = await listSafeEntries(zipPath)
  return entries.map((e) => e.name)
}

/** 解压后再查一层：解压结果中出现符号链接即拒绝（防列表解析被绕过） */
async function assertNoLinkEntries(dir) {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries = []
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      let st
      try {
        st = await fsp.lstat(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) throw new Error(`包内成员为符号链接，已拒绝解包（fail-closed）: ${path.relative(dir, full)}`)
      if (st.isDirectory()) stack.push(full)
    }
  }
}

async function extractZip(zipPath) {
  if (!(await exists(zipPath))) throw new Error(`文件不存在: ${zipPath}`)
  // 契约 §8：解包入口先嗅探 PKENC1 魔数，命中则要求密码（400 bad_password），不按损坏 zip 处理
  await rejectEncryptedPath(zipPath)
  const { buf, entries } = readZipFile(zipPath)
  // 校验与解包复用同一份中央目录：先全量校验，再落盘——任一成员非法则一个字节都不写
  await listSafeEntries(zipPath)
  const dir = await stagingDir()
  try {
    for (const e of entries) {
      const rel = e.name.replace(/^\.\//, '')
      if (!rel || entryKind(e) === 'dir') continue
      const dest = path.join(dir, ...rel.split('/'))
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.writeFile(dest, readEntryData(buf, e))
    }
    await assertNoLinkEntries(dir)
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw err
  }
  return dir
}

/** 读文件头 N 字节（嗅探 PKENC1 魔数用） */
async function readHeadBytes(p, n = 8) {
  const handle = await fsp.open(p, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await handle.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * 得到「可直接解析的 zip 路径」：明文包原样返回；PKENC1 加密包解密到临时 zip（调用方负责清理 tempRoot）。
 * 密码缺失/错误 → BadPasswordError（code=bad_password），HTTP 层映射 400，绝不漏成 500（契约 §8）。
 */
async function openPackZipPath(packPath, password) {
  if (!(await exists(packPath))) throw new Error(`文件不存在: ${packPath}`)
  const head = await readHeadBytes(packPath, 8)
  if (!isEncryptedBuffer(head)) return { zipPath: packPath, tempRoot: null, encrypted: false }
  if (typeof password !== 'string' || password.length === 0) {
    throw new BadPasswordError('该包已加密（PKENC1），需要提供密码')
  }
  const packed = await fsp.readFile(packPath)
  const plain = await decryptZipBuffer(packed, password) // 失败 → BadPasswordError
  const tempRoot = await stagingDir()
  const tempZip = path.join(tempRoot, 'decrypted.zip')
  await fsp.writeFile(tempZip, plain)
  return { zipPath: tempZip, tempRoot, encrypted: true }
}

/**
 * 读取并校验包内 manifest。v0.4.0：支持 .pkenc（先嗅探魔数 → 需要密码 → 解密后按普通 zip 处理）。
 * @returns {{manifest: object, dir: string, encrypted: boolean}} dir 由调用方清理
 */
async function readManifestFromZip(packPath, password) {
  const opened = await openPackZipPath(packPath, password)
  try {
    const dir = await extractZip(opened.zipPath)
    try {
      const raw = await readFileText(path.join(dir, 'manifest.json'))
      if (!raw.trim()) throw new Error('包内缺少 manifest.json（不是 dsh-packer 生成的包）')
      const manifest = JSON.parse(raw)
      if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`清单版本不兼容（包 ${manifest.schemaVersion} vs 当前 ${SCHEMA_VERSION}）`)
      if (!Array.isArray(manifest.files)) throw new Error('清单缺少 files 数组，已拒绝恢复（fail-closed）')
      // 清单路径整体校验：任一条目非法即拒绝整包（避免半个包被应用）
      for (const f of manifest.files) {
        const mod = MODULES[f.module]
        if (!mod) continue // 未知模块留给 diff/apply 逐条跳过
        resolveTarget(mod, f.rel)
      }
      return { manifest, dir, encrypted: opened.encrypted }
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true })
      throw err
    }
  } finally {
    // 解密出来的临时 zip 不留在临时目录（无论成功失败）
    if (opened.tempRoot) await fsp.rm(opened.tempRoot, { recursive: true, force: true })
  }
}


/**
 * 清单 rel 白名单校验：显式拒绝绝对路径 / 盘符路径 / UNC / `..` 片段 / NUL。
 * 打包时 rel 由相对遍历生成，绝不会出现这些形状——出现即为篡改。
 */
function assertSafeRel(rel) {
  if (typeof rel !== 'string' || !rel) throw new Error('清单条目 rel 非法（空或非字符串），已拒绝恢复（fail-closed）')
  if (rel.includes('\0')) throw new Error('清单条目 rel 含非法字符，已拒绝恢复（fail-closed）')
  if (/^[A-Za-z]:/.test(rel)) throw new Error(`目标路径越界（盘符路径）: ${rel}，已拒绝恢复（fail-closed）`)
  if (rel.startsWith('/') || rel.startsWith('\\')) throw new Error(`目标路径越界（绝对路径/UNC）: ${rel}，已拒绝恢复（fail-closed）`)
  if (path.isAbsolute(rel)) throw new Error(`目标路径越界（绝对路径）: ${rel}，已拒绝恢复（fail-closed）`)
  const segs = rel.split(/[\\/]/)
  if (segs.includes('..')) throw new Error(`目标路径越界（含 .. 片段）: ${rel}，已拒绝恢复（fail-closed）`)
  if (segs.some((s) => s === '')) throw new Error(`目标路径非法（空路径段）: ${rel}，已拒绝恢复（fail-closed）`)
  return rel
}

/**
 * 目标路径：先做 rel 白名单校验，再在 resolve 后校验前缀必须落在模块目标根内。
 * file 类型模块：resolve() 即文件全路径；dir 类型：resolve() + rel。
 */
function resolveTarget(mod, rel) {
  assertSafeRel(rel)
  const root = path.resolve(mod.resolve())
  const target = mod.kind === 'file' ? root : path.resolve(root, rel)
  const base = mod.kind === 'file' ? path.dirname(root) : root
  if (!pathContained(base, target)) {
    throw new Error(`目标路径越界（不在模块目标根内）: ${rel}，已拒绝恢复（fail-closed）`)
  }
  return target
}

/**
 * 目标路径是否落在「某个模块的目标根」内（journal 回滚用）：
 * 防手工伪造 journal 把文件写到任意路径（fail-closed）。
 */
function isAllowedModuleTarget(target) {
  const abs = path.resolve(String(target || ''))
  for (const mod of Object.values(MODULES)) {
    const root = path.resolve(mod.resolve())
    if (mod.kind === 'file') {
      if (abs === root) return true
    } else if (pathContained(root, abs)) {
      return true
    }
  }
  return false
}

// ---------- 恢复期回填（v0.5.1 契约 §3：只对 sanitized 包） ----------

/** 当前用户名（回填 `<用户名>` 用）：home 的末段；取不到用环境变量兜底 */
function currentUsername() {
  const base = path.basename(os.homedir())
  if (base) return base
  return process.env.USER || process.env.USERNAME || 'user'
}

/**
 * 反向回填：`<用户目录>` → 目标机 `os.homedir()`、`<用户名>` → 当前用户名。
 * 其余占位符（`<本机路径>` / `<UNC路径>` / `<Unix路径>` / `<已移除的密钥>` / `<个人信息>`）
 * **保留原样**——目标机上的信息无从得知，只能留给用户手工重填（由调用方汇总进 stats.warnings）。
 * @returns {{ text: string, backfilled: number }} backfilled = 实际替换的处数
 */
function backfillText(text) {
  if (typeof text !== 'string' || !text) return { text, backfilled: 0 }
  const parts = text.split(PLACEHOLDER_HOME)
  const homeHits = parts.length - 1
  let out = parts.join(os.homedir())
  const userParts = out.split(PLACEHOLDER_USER)
  const userHits = userParts.length - 1
  if (userHits) out = userParts.join(currentUsername())
  return { text: out, backfilled: homeHits + userHits }
}

/** 文本里还剩多少处「无法自动回填」的占位符（按固定词表统计） */
function retainedPlaceholderCounts(text) {
  const counts = new Map()
  if (typeof text !== 'string' || !text) return counts
  for (const ph of RETAINED_PLACEHOLDERS) {
    const n = text.split(ph).length - 1
    if (n > 0) counts.set(ph, n)
  }
  return counts
}

/**
 * sanitized 包在**目标机**上应有的 SHA-256（回填后的内容）。
 * 非 sanitized 包直接用清单指纹。没有解压目录（manifest._dir）或非文本文件时退回清单指纹。
 */
async function expectedTargetSha(manifest, f) {
  if (manifest?.sanitized !== true || !manifest._dir) return f.sha256
  if (!isValidSha256(f.sha256)) return f.sha256
  const src = path.resolve(manifest._dir, String(f.module), String(f.rel))
  if (!pathContained(manifest._dir, src)) return f.sha256
  if (!(await exists(src))) return f.sha256
  if (!(await isTextFile(src))) return f.sha256
  const raw = await readFileText(src)
  if (!raw) return f.sha256
  const { text } = backfillText(raw)
  if (text === raw) return f.sha256
  return sha256Buffer(Buffer.from(text, 'utf-8'))
}

async function diffRestore(manifest) {
  const diff = { added: [], changed: [], same: [], skipped: [] }
  for (const f of manifest.files || []) {
    const mod = MODULES[f.module]
    if (!mod) { diff.skipped.push({ module: f.module, rel: f.rel, reason: '未知模块' }); continue }
    let target
    try {
      target = resolveTarget(mod, f.rel)
    } catch (err) {
      diff.skipped.push({ module: f.module, rel: f.rel, reason: String(err.message || err) })
      continue
    }
    if (!isValidSha256(f.sha256)) {
      diff.skipped.push({ module: f.module, rel: f.rel, reason: '清单缺少合法 SHA-256 指纹（fail-closed）' })
      continue
    }
    if (!(await exists(target))) {
      diff.added.push({ module: f.module, rel: f.rel })
    } else if ((await trySha256(target)) === (await expectedTargetSha(manifest, f))) {
      // v0.5.1：sanitized 包的目标内容 = 回填后的文本（与清单指纹天生不同），
      // 必须比对「回填后应有的指纹」，否则导入检查会把整包误报成「全部已改动」
      diff.same.push({ module: f.module, rel: f.rel })
    } else {
      diff.changed.push({ module: f.module, rel: f.rel })
    }
  }
  return diff
}

// 结构化配置文件：禁止通用 append merge（JSON/YAML 拼接即损坏），fail-closed 拒绝
const STRUCTURED_EXT = new Set(['.json', '.yaml', '.yml', '.jsonl', '.toml'])

function isStructuredFile(p) {
  return STRUCTURED_EXT.has(path.extname(p).toLowerCase())
}

/** 包内路径越界检测：src 解析后必须仍在解压目录内（防 manifest/zip 被改后越界恢复） */
function pathContained(base, target) {
  const b = path.resolve(base)
  const t = path.resolve(target)
  return t === b || t.startsWith(b + path.sep)
}

/**
 * 执行恢复：先备份目标 → 写临时文件 → rename 原子替换；任意环节失败即中止，
 * 并按记录回滚已替换/已追加的文件（不再"失败只累计"）。
 * memory 等模块的 SQLite 库默认排除（includeDb=true 才恢复）。
 * v0.4.0：①策略白名单 fail-closed（非法值直接抛 400 bad_strategy，不再退化成 overwrite）；
 *   ②每步改动写 journal.json，供 /restore/rollback 还原；③onProgress/shouldCancel 支持异步作业与取消。
 */
async function applyRestore(manifest, {
  strategy = 'overwrite',
  moduleFilter = null,
  includeDb = false,
  backupRoot = null,
  onProgress = null,
  shouldCancel = null,
} = {}) {
  // v0.4.0 P0：恢复策略白名单（契约 §7）。旧实现 `strategy || 'overwrite'` 把任何非法值
  // 都静默当成覆盖——误操作会直接覆盖用户文件，必须 fail-closed。
  if (!RESTORE_STRATEGIES.has(strategy)) {
    throw new ApiError(400, 'bad_strategy', "strategy 只能是 'overwrite' / 'skip' / 'merge'")
  }
  const stats = {
    overwritten: 0, added: 0, merged: 0, skipped: 0, failed: 0, failures: [],
    excluded: [], aborted: false, cancelled: false, rolledBack: 0, rollbackFailures: [], backupDir: null,
    // v0.5.1（契约 §3）：回填了几处 + 无法自动回填的占位符汇总（warnings 是给人看的字符串）
    backfilled: 0, warnings: [],
  }
  // sanitized 包才做回填；其余占位符按词表累计，收尾统一写进 stats.warnings
  const doBackfill = manifest.sanitized === true
  const retained = new Map()
  const tallyRetained = (text) => {
    for (const [ph, n] of retainedPlaceholderCounts(text)) retained.set(ph, (retained.get(ph) || 0) + n)
  }
  /**
   * sanitized 包写盘前的内容准备：文本文件 → 回填 <用户目录>/<用户名>。
   * 返回 null = 无需处理（非文本 / 读不出 / 非 sanitized 包），由调用方按原字节复制。
   */
  const prepareContent = async (src) => {
    if (!doBackfill) return null
    if (!(await isTextFile(src))) return null
    const raw = await readFileText(src)
    if (!raw) return null
    const { text, backfilled } = backfillText(raw)
    return { text, raw, backfilled, changed: text !== raw }
  }
  /** 真正落盘：需要回填就写文本，否则按原字节复制（不做无谓的编码往返） */
  const writePrepared = async (dest, src, prepared) => {
    if (prepared?.changed) {
      await fsp.writeFile(dest, prepared.text, 'utf-8')
      stats.backfilled += prepared.backfilled
    } else {
      await fsp.copyFile(src, dest)
    }
    if (prepared) tallyRetained(prepared.text)
  }
  const eligible = (manifest.files || []).filter((f) => !moduleFilter || moduleFilter.includes(f.module))
  const total = eligible.length
  let done = 0
  const report = (phase = 'apply') => {
    try {
      onProgress?.(phase, done, total)
    } catch (err) {
      console.warn(`[dsh-packer] 恢复进度回调失败：${String(err?.message || err)}`)
    }
  }
  const applied = []
  let backupDir = null
  let seq = 0
  const ensureBackupDir = async () => {
    if (!backupDir) {
      const root = backupRoot || path.join(PACKS_DIR, RESTORE_BACKUP_DIR)
      backupDir = path.join(root, `${nowStamp()}-${uniqueSuffix()}`)
      await fsp.mkdir(backupDir, { recursive: true })
      stats.backupDir = backupDir
    }
    return backupDir
  }
  /** 增量写 journal：恢复中途崩溃/被取消时，用户仍能从 /restore/rollback 还原 */
  const writeJournal = async () => {
    if (!applied.length) return
    // 纯新增（没有覆盖既有文件）也要建备份目录：否则 /restore/rollback 无法撤销「新增」的文件
    if (!backupDir) await ensureBackupDir()
    const records = applied.map((r) => ({ target: r.target, backup: r.backup, kind: r.kind }))
    await fsp.writeFile(path.join(backupDir, 'journal.json'), JSON.stringify(records, null, 2), 'utf-8')
  }
  const backupTarget = async (target) => {
    const dest = path.join(await ensureBackupDir(), `${String(seq++).padStart(4, '0')}-${path.basename(target)}`)
    await fsp.copyFile(target, dest)
    return dest
  }
  const rollback = async () => {
    for (const rec of applied.reverse()) {
      try {
        if (rec.backup && (await exists(rec.backup))) {
          const tmp = `${rec.target}.packer-rb-${uniqueSuffix()}`
          await fsp.copyFile(rec.backup, tmp)
          await fsp.rename(tmp, rec.target) // 原子还原
        } else {
          await fsp.rm(rec.target, { force: true })
        }
        if (rec.kind === 'overwrite') stats.overwritten--
        else if (rec.kind === 'merge') stats.merged--
        else stats.added--
        stats.rolledBack++
      } catch (err) {
        stats.rollbackFailures.push({ target: rec.target, error: String(err.message || err) })
      }
    }
  }

  report('prepare')
  for (const f of eligible) {
    // 契约 §4：取消只在文件边界生效；中止后回滚本次已应用的文件，不留半恢复状态
    if (shouldCancel?.()) {
      stats.aborted = true
      stats.cancelled = true
      await rollback()
      break
    }
    const mod = MODULES[f.module]
    if (!mod) { stats.skipped++; done++; report(); continue }
    try {
      // 目标路径校验（fail-closed）：rel 白名单 + 落在模块目标根内
      const target = resolveTarget(mod, f.rel)
      if (!includeDb && DB_FILE_RE.test(path.basename(target))) {
        stats.skipped++
        stats.excluded.push({ rel: f.rel, reason: 'SQLite 数据库（含 WAL/SHM）默认不恢复，避免覆盖运行中的记忆数据' })
        continue
      }
      // 清单指纹必须存在且合法：缺指纹/格式非法一律拒绝（不再"缺指纹即放行"）
      if (!isValidSha256(f.sha256)) {
        throw new Error('清单条目缺少合法 SHA-256 指纹，已拒绝恢复（fail-closed）')
      }
      // 源侧校验：必须在解压目录内 + 与清单 SHA-256 一致
      const src = path.resolve(manifest._dir, f.module, f.rel)
      if (!pathContained(manifest._dir, src)) throw new Error('包内路径越界，已拒绝恢复（fail-closed）')
      if (!(await exists(src))) throw new Error('包内源文件缺失')
      const srcHash = await sha256(src)
      if (srcHash !== f.sha256) {
        throw new Error(`源文件完整性校验失败（${f.sha256} ≠ ${srcHash}），已拒绝恢复（fail-closed）`)
      }
      // v0.5.1（契约 §3）：sanitized 包写盘前回填 <用户目录>/<用户名>。
      // prepared = null 表示无需处理（非文本 / 非 sanitized 包），后面按原字节复制。
      const prepared = await prepareContent(src)
      // 「目标机上应有的指纹」：sanitized 包是回填后的内容，直接比 f.sha256 会永远不相同
      const expectedSha = prepared?.changed
        ? sha256Buffer(Buffer.from(prepared.text, 'utf-8'))
        : f.sha256
      if (await exists(target)) {
        if ((await trySha256(target)) === expectedSha) { stats.skipped++; continue } // 已是最新（含回填后内容）
        if (strategy === 'skip') { stats.skipped++; continue }
        if (strategy === 'merge' && (await isTextFile(target))) {
          if (isStructuredFile(target)) {
            // 结构化配置（JSON/YAML）禁用通用 append merge：拼接即坏文件
            throw new Error('结构化配置文件不支持 append merge（会破坏语法），请改用 overwrite 策略或手工合并')
          }
          const backup = await backupTarget(target)
          const sep = `\n<!-- merged from dsh-packer pack ${manifest.createdAt} -->\n`
          // v0.2.6（自审 P1）：README 一直宣称"每个被覆盖/**追加**的目标先写临时文件再 rename 原子替换"，
          // 但这里其实是直接 appendFile——中途失败会留下半截文件，只能靠备份兜底。
          // 现在改为：复制到临时文件 → 追加 → rename 原子替换 → 失败清理临时文件。
          const mergeTmp = `${target}.merge-tmp-${process.pid}`
          await fsp.copyFile(target, mergeTmp)
          try {
            // 追加的包内内容同样要回填（否则 merge 出来的永远是占位符）
            const appendText = prepared ? prepared.text : await readFileText(src)
            if (prepared?.changed) stats.backfilled += prepared.backfilled
            if (prepared) tallyRetained(prepared.text)
            await fsp.appendFile(mergeTmp, sep + appendText, 'utf-8')
            await fsp.rename(mergeTmp, target)
          } catch (err) {
            try { await fsp.rm(mergeTmp, { force: true }) } catch { /* 忽略 */ }
            throw err
          }
          applied.push({ target, backup, kind: 'merge' })
          stats.merged++
          await writeJournal()
          continue
        }
      }
      const existed = await exists(target)
      const backup = existed ? await backupTarget(target) : null
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const tmp = `${target}.packer-tmp-${uniqueSuffix()}`
      try {
        await writePrepared(tmp, src, prepared)
        await fsp.rename(tmp, target) // 原子替换，写到一半不会留下半个文件
      } catch (err) {
        await fsp.rm(tmp, { force: true }) // 失败不残留临时文件
        throw err
      }
      if (existed) {
        applied.push({ target, backup, kind: 'overwrite' })
        stats.overwritten++
      } else {
        applied.push({ target, backup, kind: 'add' })
        stats.added++
      }
      await writeJournal()
    } catch (err) {
      stats.failed++
      stats.failures.push({ rel: f.rel, error: String(err.message || err) })
      stats.aborted = true
      await rollback() // 任一环节失败即中止并回滚
      break
    } finally {
      // done = 已处理数（成功/跳过/失败都算；取消时不重复计数）
      if (!stats.cancelled) {
        done++
        report('apply')
      }
    }
  }
  // 终态 phase='done' 由作业运行器设置（先写 result 再置 done，避免轮询看到半态）
  // v0.5.1（契约 §3）：无法自动回填的占位符如实汇总（例如 <本机路径> 到新机无处可填）
  for (const [ph, n] of retained) stats.warnings.push(`${n} 处占位符无法自动回填（${ph}）`)
  report('apply')
  return stats
}

/**
 * 导入检查（契约 §7）：解包 → 校验 manifest → 逐文件 status（added/changed/same/skipped）+ diff 计数。
 * v0.4.0 相比 v0.3.0：①每个文件带 status（UI 要画差异列表）；②支持加密包（password）。
 */
async function importRestore(packPath, password) {
  const { manifest, dir, encrypted } = await readManifestFromZip(packPath, password)
  try {
    manifest._dir = dir
    const diff = await diffRestore(manifest)
    const statusByKey = new Map()
    for (const f of diff.added) statusByKey.set(`${f.module}\0${f.rel}`, 'added')
    for (const f of diff.changed) statusByKey.set(`${f.module}\0${f.rel}`, 'changed')
    for (const f of diff.same) statusByKey.set(`${f.module}\0${f.rel}`, 'same')
    for (const f of diff.skipped) statusByKey.set(`${f.module}\0${f.rel}`, 'skipped')
    const files = []
    for (const f of manifest.files || []) {
      const key = `${f.module}\0${f.rel}`
      // 旧包清单没有 size：从解压结果 stat 兜底（读不到就 0，不阻断导入检查）
      let size = Number(f.size)
      if (!Number.isFinite(size) || size < 0) size = await fileSize(path.join(dir, String(f.module), String(f.rel)))
      files.push({ module: f.module, rel: f.rel, size, status: statusByKey.get(key) || 'skipped' })
    }
    return {
      ok: true,
      manifest: publicManifest(manifest),
      files,
      diff: {
        added: diff.added.length,
        changed: diff.changed.length,
        same: diff.same.length,
        skipped: diff.skipped.length,
      },
      encrypted,
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

/** 恢复备份目录列表（契约 §7：items [{dir, createdAt, files, bytes}]） */
async function listRestoreBackups() {
  const base = path.join(PACKS_DIR, RESTORE_BACKUP_DIR)
  let entries
  try {
    entries = await fsp.readdir(base, { withFileTypes: true })
  } catch (err) {
    if (err?.code === 'ENOENT') return []
    throw new Error(`读取恢复备份目录失败：${String(err?.message || err)}`)
  }
  const items = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const abs = path.join(base, e.name)
    let files = 0
    let bytes = 0
    const stack = [abs]
    while (stack.length) {
      const cur = stack.pop()
      const list = await fsp.readdir(cur, { withFileTypes: true })
      for (const c of list) {
        const full = path.join(cur, c.name)
        if (c.isDirectory()) { stack.push(full); continue }
        if (!c.isFile()) continue
        if (cur === abs && c.name === 'journal.json') continue // 索引文件不计入
        files++
        bytes += await fileSize(full)
      }
    }
    const st = await fsp.stat(abs)
    items.push({ dir: abs, createdAt: st.mtime.toISOString(), files, bytes })
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return items
}

/**
 * 一键回滚（契约 §7）：从 .restore-backups/<dir>/journal.json 逆向还原。
 * containment 校验：dir 必须落在 .restore-backups 内（否则 400 bad_dir），备份文件也必须在 dir 内。
 */
async function rollbackRestoreBackup(dir) {
  const base = path.resolve(PACKS_DIR, RESTORE_BACKUP_DIR)
  const abs = path.resolve(String(dir || ''))
  if (typeof dir !== 'string' || !dir || !pathContained(base, abs) || abs === base) {
    throw new ApiError(400, 'bad_dir', 'dir 必须位于恢复备份目录（.restore-backups）内')
  }
  if (!(await exists(abs))) throw new ApiError(400, 'bad_dir', '备份目录不存在')
  const journalPath = path.join(abs, 'journal.json')
  if (!(await exists(journalPath))) throw new ApiError(400, 'bad_dir', '备份目录缺少 journal.json，无法回滚')
  let journal
  try {
    journal = JSON.parse(await fsp.readFile(journalPath, 'utf-8'))
  } catch (err) {
    throw new ApiError(400, 'bad_dir', `备份目录的 journal.json 非法：${String(err?.message || err)}`)
  }
  if (!Array.isArray(journal)) throw new ApiError(400, 'bad_dir', 'journal.json 必须是记录数组')
  let restored = 0
  let failed = 0
  const failures = []
  // 逆序回滚：先还原最后应用的文件
  for (const rec of [...journal].reverse()) {
    try {
      const target = String(rec?.target || '')
      if (!target) throw new Error('journal 记录缺少 target')
      // fail-closed：只允许还原到模块目标根内（防伪造 journal 写到任意路径）
      if (!isAllowedModuleTarget(target)) throw new Error('journal 目标不在任何模块目标根内（fail-closed）')
      if (rec.backup) {
        const backup = path.resolve(String(rec.backup))
        if (!pathContained(abs, backup)) throw new Error('备份文件越界（不在备份目录内）')
        if (!(await exists(backup))) throw new Error('备份文件缺失')
        await fsp.mkdir(path.dirname(target), { recursive: true })
        const tmp = `${target}.packer-rb-${uniqueSuffix()}`
        await fsp.copyFile(backup, tmp)
        await fsp.rename(tmp, target) // 原子还原
      } else {
        // 本次恢复新增的文件：回滚=删除
        await fsp.rm(target, { force: true })
      }
      restored++
    } catch (err) {
      failed++
      failures.push({ target: String(rec?.target ?? ''), error: String(err?.message || err) })
    }
  }
  const result = { ok: true, restored, failed }
  if (failures.length) result.failures = failures // 失败明细上报，不静默吞
  return result
}

// ============================================================================
// /packer/api/* 防护：鉴权 + 请求体上限 + 速率限制
//
// 鉴权（默认 fail-closed）：
//   1) authMode 'auto'（默认）—— 官方机制：dsh-client-connection 的
//      `ctx.connection.requestRejection(req)` 是官方明确提供给「另一条 Web 路由」复用的
//      入口（Host/Origin 信任 + 与 authority 绑定的签名会话 Cookie，返回 401/403/undefined）。
//      与官方 `/api` 通道同一套判定，零新依赖。**服务缺失、接口缺失或抛错一律 403，绝不放开**
//      ——不会静默降级到更弱的插件自有令牌，要用令牌必须显式选 'token'。
//   2) authMode 'token'（显式 opt-in，仅用于宿主确实没有 connection 的组合）—— 插件自有的
//      「同源校验 + 一次性令牌」：令牌在 apply 时随机生成，只随 index.html 注入到同源页面
//      （webServer.tapIndex），请求需带 `x-dsh-packer-token` 头，并叠加 Host / Origin /
//      Sec-Fetch-Site 同源校验。取舍与限制见 README「API 鉴权与限额」。
//   3) authMode 'off' —— 仅供隔离测试，README 明确标注为不安全，别在真实部署里开。
//
// 体积：默认 8 MB，可配置。**在完整缓冲请求体之前判定**：先看 Content-Length，超限直接 413
//   不读流；没有长度时边读边累计，一超限立刻解绑监听、pause 并 413（不会把整包读进内存）。
// 速率：按客户端地址（remoteAddress）滑动窗口，默认 60 次/分钟，可配置。用 Map +
//   时间戳数组实现，无定时器（不会泄漏），并对键数量设上限（内存有界）。
//   限流是**最外层**：先于鉴权与读体，未授权流量同样吃同一份配额（拒绝前不读一个字节）。
//
// 错误文案：出网前统一 redactPaths()，服务端绝对路径（含用户目录）不返回给浏览器。
// ============================================================================

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024
const DEFAULT_RATE_LIMIT = 60
const DEFAULT_RATE_WINDOW_MS = 60_000
const MAX_RATE_KEYS = 4096
const TOKEN_HEADER = 'x-dsh-packer-token'
const TOKEN_GLOBAL = '__DSH_PACKER_TOKEN__'

/** 带 HTTP 状态与稳定错误码的拒绝原因 */
class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function positiveIntOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** 定长比较，避免令牌比对泄漏长度/前缀信息 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/**
 * 出网文案脱敏：抹掉盘符路径 / UNC / Unix 用户目录路径。
 * 内部报错常带服务端绝对路径（如「文件不存在: E:\...」），不该出现在浏览器可见的错误里。
 */
function redactPaths(message) {
  return String(message ?? '')
    .replace(/[A-Za-z]:[\\/][^\s"'`<>|?*]+/g, '<路径已隐去>')
    .replace(/\\\\[^\s"'`<>|?*]+/g, '<路径已隐去>')
    .replace(/(?<![\w.-])\/(?:home|Users|root|mnt|media|opt|srv|etc|var|tmp|usr)\/[^\s"'`<>|]*/g, '<路径已隐去>')
}

/** 客户端标识：IPv4-mapped IPv6 归一化，取不到就用 unknown（不会因此放大配额） */
function clientKey(req) {
  const raw = req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  const addr = String(raw).replace(/^::ffff:/i, '')
  return addr || 'unknown'
}

/**
 * 构造 /packer/api/* 的防护器（纯函数、可脱离 HTTP 服务器测试）。
 * @param {object} [options] maxBodyBytes / rateLimit / rateWindowMs / token / authMode
 */
export function createPackApiGuard(options = {}) {
  const maxBodyBytes = positiveIntOr(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES)
  const rateLimit = positiveIntOr(options.rateLimit, DEFAULT_RATE_LIMIT)
  const rateWindowMs = positiveIntOr(options.rateWindowMs, DEFAULT_RATE_WINDOW_MS)
  const authMode = options.authMode === 'token' ? 'token' : options.authMode === 'off' ? 'off' : 'auto'
  const token = typeof options.token === 'string' && options.token.length >= 16
    ? options.token
    : crypto.randomBytes(24).toString('base64url')
  /** key → 窗口内命中时间戳（升序） */
  const windows = new Map()

  /** 清掉所有窗口内已无命中的键：无定时器，靠请求驱动，内存不会无限增长 */
  const prune = (now) => {
    for (const [key, stamps] of windows) {
      const live = stamps.filter((t) => now - t < rateWindowMs)
      if (live.length) windows.set(key, live)
      else windows.delete(key)
    }
  }

  /** 消费一次配额；拒绝时给出建议重试毫秒数 */
  const consume = (key) => {
    const now = Date.now()
    if (!windows.has(key) && windows.size >= MAX_RATE_KEYS) {
      prune(now)
      // 仍然超限：按插入顺序淘汰最旧键，键数量恒有上界
      while (!windows.has(key) && windows.size >= MAX_RATE_KEYS) {
        const oldest = windows.keys().next()
        if (oldest.done) break
        windows.delete(oldest.value)
      }
    }
    const stamps = (windows.get(key) || []).filter((t) => now - t < rateWindowMs)
    if (stamps.length >= rateLimit) {
      windows.set(key, stamps)
      const retryAfterMs = Math.max(1, rateWindowMs - (now - stamps[0]))
      return { ok: false, retryAfterMs, limit: rateLimit }
    }
    stamps.push(now)
    windows.set(key, stamps)
    return { ok: true, remaining: rateLimit - stamps.length }
  }

  /** Host / Origin / Sec-Fetch-Site 同源校验（回退模式的外层防线） */
  const sameOriginRejection = (req) => {
    const headers = req.headers ?? {}
    const host = headers.host
    if (typeof host !== 'string' || !host) {
      return new ApiError(403, 'forbidden', '缺少 Host 头，无法确认请求来源（403）')
    }
    if (headers['sec-fetch-site'] === 'cross-site') {
      return new ApiError(403, 'forbidden', '跨站请求已被拒绝（Sec-Fetch-Site: cross-site，403）')
    }
    const origin = headers.origin
    if (origin === undefined) return null // 无 Origin：交给一次性令牌判定
    try {
      return new URL(origin).host === new URL(`http://${host}`).host
        ? null
        : new ApiError(403, 'forbidden', '请求 Origin 与本机不一致，已拒绝（403）')
    } catch {
      return new ApiError(403, 'forbidden', 'Origin 头无法解析，已拒绝（403）')
    }
  }

  /** 回退模式：同源校验 + 一次性令牌 */
  const tokenRejection = (req) => {
    const provided = req.headers?.[TOKEN_HEADER]
    if (typeof provided === 'string' && provided && safeEqual(provided, token)) return null
    return new ApiError(401, 'unauthorized',
      `未通过 DSH 会话鉴权（401）：请从 DSH 设置页内访问该接口（需要 ${TOKEN_HEADER}）`)
  }

  /**
   * 鉴权：返回 null 表示放行，否则返回 ApiError。
   * @param {object} req node:http 请求（只读 headers）
   * @param {object} [connection] 宿主 ctx.connection（可选服务）
   */
  const authorize = (req, connection) => {
    if (authMode === 'off') return null
    // 显式 opt-in 的回退通道：同源校验 + 一次性令牌
    if (authMode === 'token') return sameOriginRejection(req) || tokenRejection(req)
    // 默认 'auto'：只认官方机制。拿不到鉴权服务 = 无法判定 = 拒绝（fail-closed，绝不静默降级）
    if (!connection || typeof connection.requestRejection !== 'function') {
      return new ApiError(403, 'forbidden',
        '宿主未提供可用的鉴权服务（connection.requestRejection 缺失），按 fail-closed 拒绝（403）。'
        + '若该宿主确实没有 connection 服务，请显式设置 api.authMode = "token" 后再访问')
    }
    let rejection
    try {
      rejection = connection.requestRejection({ headers: req.headers ?? {} })
    } catch {
      return new ApiError(403, 'forbidden', '宿主鉴权层调用失败，按 fail-closed 拒绝（403）')
    }
    if (rejection === 401) {
      return new ApiError(401, 'unauthorized', '未通过 DSH 会话鉴权（401）：请从 `dsh web` 打印的地址重新打开页面')
    }
    if (rejection === 403) {
      return new ApiError(403, 'forbidden', '请求来源不被信任（Host/Origin 非本机回环地址，403）')
    }
    if (rejection !== undefined) {
      return new ApiError(403, 'forbidden', `请求被宿主鉴权层拒绝（${rejection}）`)
    }
    return null
  }

  /**
   * 读取请求体（仅 POST/DELETE 等有体的请求调用）。
   * 超限时抛出 ApiError(413)：先看 Content-Length 直接拒绝，否则边读边累计、一超限
   * 立即解绑并暂停（不把整包读进内存），由调用方回 413 并断开连接。
   */
  const readBody = (req) => new Promise((resolve, reject) => {
    const declared = Number(req.headers?.['content-length'])
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      reject(new ApiError(413, 'payload_too_large',
        `请求体 ${declared} 字节超过上限 ${maxBodyBytes} 字节（413），未读取任何字节`))
      return
    }
    const chunks = []
    let total = 0
    let settled = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      req.off?.('data', onData)
      req.off?.('end', onEnd)
      req.off?.('error', onError)
      if (err) reject(err)
      else resolve(value)
    }
    const onData = (chunk) => {
      total += chunk.length
      if (total > maxBodyBytes) {
        chunks.length = 0 // 立即丢弃已缓冲内容，不把超限请求留在内存里
        req.pause?.()
        finish(new ApiError(413, 'payload_too_large',
          `请求体超过上限 ${maxBodyBytes} 字节（已读 ${total} 字节，413），读取已中断`))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => finish(null, Buffer.concat(chunks).toString('utf-8'))
    const onError = (err) => finish(err)
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })

  /** 把一次性令牌注入 index.html（仅回退模式需要；幂等） */
  const injectToken = (html) => {
    if (typeof html !== 'string' || html.includes(TOKEN_GLOBAL)) return html
    const script = `<script>globalThis.${TOKEN_GLOBAL}=${JSON.stringify(token)}</script>`
    const open = /<head(?:\s[^>]*)?>/i.exec(html)
    if (!open) return script + html
    const at = open.index + open[0].length
    return `${html.slice(0, at)}${script}${html.slice(at)}`
  }

  return {
    maxBodyBytes,
    rateLimit,
    rateWindowMs,
    authMode,
    token,
    headerName: TOKEN_HEADER,
    authorize,
    consume,
    readBody,
    injectToken,
    /** 测试/诊断用：当前被跟踪的客户端键数量 */
    trackedKeys: () => windows.size,
  }
}

/** 请求体里的必填字符串参数（缺/空 → 400 bad_request） */
function requireStringParam(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'bad_request', `${field} 必须是非空字符串`)
  }
  return value
}

/** modules 参数：非空数组 + 每个都是已知模块（未知模块 400 bad_modules，不再静默跳过） */
function normalizeModulesStrict(value) {
  if (!Array.isArray(value) || !value.length) {
    throw new ApiError(400, 'bad_modules', 'modules 必须是非空数组（至少选择一个模块）')
  }
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw) throw new ApiError(400, 'bad_modules', 'modules 只能包含模块名字符串')
    if (!MODULES[raw]) throw new ApiError(400, 'bad_modules', `未知模块: ${raw}`)
    if (!out.includes(raw)) out.push(raw)
  }
  return out
}

/**
 * 构造 /packer/api/* 处理器。
 * @param {object} deps guard（防护器）、getConnection（返回宿主 connection 服务，可空）、
 *   recycleFn（删除包时送系统回收站的实现，可空；测试注入桩用）
 * @returns {(req, res) => Promise<void>} 可以直接交给 webServer.register
 */
export function createPackApiHandler({ guard, getConnection, recycleFn } = {}) {
  const g = guard || createPackApiGuard()
  return async function packApiHandler(req, res) {
    /** 请求是否还带着没读完的体：拒绝它时要断开连接，绝不为它继续缓冲 */
    const bodyPending = () => {
      const len = Number(req.headers?.['content-length'])
      return (Number.isFinite(len) && len > 0) || req.headers?.['transfer-encoding'] !== undefined
    }
    const send = (code, body) => {
      if (res.headersSent) { res.end(); return }
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      // 错误文案可能内嵌服务端绝对路径（如「文件不存在: E:\...」）——统一隐去再出网
      const payload = body && typeof body.error === 'string' ? { ...body, error: redactPaths(body.error) } : body
      if (code >= 400 && bodyPending()) {
        res.setHeader('connection', 'close')
        // 响应写完再断开，避免未读完的请求体把 socket 挂住（RST 在响应落地之后才发生）
        res.once('finish', () => { try { req.destroy?.() } catch { /* ignore */ } })
      }
      res.end(JSON.stringify(payload))
    }
    const parseBody = async () => {
      const raw = await g.readBody(req)
      if (!raw.trim()) return {}
      try {
        return JSON.parse(raw)
      } catch {
        throw new ApiError(400, 'bad_request', '请求体不是合法 JSON（400）')
      }
    }
    try {
      const url = new URL(req.url ?? '/', 'https://dsh.invalid')
      const p = url.pathname.replace(/^\/packer\/api/, '') || '/'

      // 1) 速率限制（最外层，读体与鉴权之前；未授权流量同样吃配额）
      const rate = g.consume(clientKey(req))
      if (!rate.ok) {
        const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000))
        res.setHeader('retry-after', String(seconds))
        return send(429, {
          ok: false,
          code: 'rate_limited',
          error: `请求过于频繁（429）：上限 ${g.rateLimit} 次/${Math.round(g.rateWindowMs / 1000)} 秒，请 ${seconds} 秒后重试`,
          retryAfterSeconds: seconds,
        })
      }

      // 2) 鉴权（默认 fail-closed）
      const connection = typeof getConnection === 'function' ? getConnection() : undefined
      const rejection = g.authorize(req, connection)
      if (rejection) return send(rejection.status, { ok: false, code: rejection.code, error: rejection.message })

      // GET /status → 模块概览 + 包列表 + 磁盘占用（契约 v0.5.0 §2 终态，共 6 个字段）
      // v0.6.4 追加 3 个平台能力字段（platform / trash / filePicker），UI 据此决定回收站文案与「手填路径」入口。
      // v0.4.0 P0：模块计数走 moduleStats —— file 类模块（含 memoryDb）只 stat，
      // 绝不 VACUUM INTO 生成快照（旧实现每开一次设置页就泄漏一个临时快照目录）。
      if (req.method === 'GET' && p === '/status') {
        const moduleInfo = {}
        for (const [key, mod] of Object.entries(MODULES)) {
          const st = await moduleStats(mod)
          moduleInfo[key] = { label: mod.label, kind: mod.kind, default: mod.default, share: mod.share, count: st.count, bytes: st.bytes }
        }
        return send(200, {
          ok: true,
          modules: moduleInfo,
          packs: await listPacks(),
          packsDir: PACKS_DIR,
          schemaVersion: SCHEMA_VERSION,
          disk: await packsDiskUsage(),
          platform: platformTag(),
          trash: hasSystemTrash(),
          filePicker: hasSystemFilePicker(),
        })
      }
      // POST /scan → { modules, mode } → 文件清单 + 隐私扫描（契约 §2）
      // v0.4.0 P0：传给 privacyScan 的条目必须带 abs（真实绝对路径）。
      // 旧实现只传 {module, rel, size}，privacyScan 拿 rel 当路径去读 → 读不到 → 判为二进制 →
      // 恒零命中（假阴性：UI 显示「无敏感痕迹」，分享包却带着本机路径）。
      if (req.method === 'POST' && p === '/scan') {
        const body = await parseBody()
        const mode = body.mode === undefined ? 'migrate' : body.mode
        if (mode !== 'migrate' && mode !== 'share') throw new ApiError(400, 'bad_mode', "mode 只能是 'migrate' 或 'share'")
        const share = mode === 'share'
        const modules = body.modules === undefined ? defaultModulesFor(mode) : normalizeModulesStrict(body.modules)
        const scanned = []
        for (const m of modules) {
          for (const f of await collectModuleFiles(MODULES[m], share)) {
            scanned.push({ module: m, rel: f.rel, abs: f.abs, size: await fileSize(f.abs) })
          }
        }
        const findings = await privacyScan(scanned)
        // 出网不带 abs：不把本机绝对路径回给浏览器
        const files = scanned.map(({ module, rel, size }) => ({ module, rel, size }))
        return send(200, { ok: true, files, privacy: findings, share })
      }
      // POST /create → dryRun 同步预览；否则异步作业（契约 §3）
      if (req.method === 'POST' && p === '/create') {
        const body = await parseBody()
        // v0.4.0 P0：mode 白名单 fail-closed（旧实现缺省/非法值一律当 migrate，静默降级）
        if (body.mode !== 'migrate' && body.mode !== 'share') {
          throw new ApiError(400, 'bad_mode', "mode 只能是 'migrate' 或 'share'")
        }
        const mode = body.mode
        const modules = normalizeModulesStrict(body.modules)
        // v0.4.0 P0：分享模式服务端强制拦截（旧实现只靠 UI 置灰，直接调 API 就能把会话/设置打进分享包）
        if (mode === 'share') {
          const blocked = modules.filter((m) => SENSITIVE_MODULES.includes(m))
          if (blocked.length) {
            throw new ApiError(400, 'share_scope',
              `分享模式不允许包含敏感模块：${blocked.join(', ')}（会话/凭据/机器配置不可安全分享，请改用迁移模式）`)
          }
        }
        const encrypt = body.encrypt === true
        if (encrypt && (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH)) {
          throw new ApiError(400, 'weak_password', `加密密码至少 ${MIN_PASSWORD_LENGTH} 位`)
        }
        const opts = {
          modules,
          mode,
          note: typeof body.note === 'string' ? body.note : '',
          encrypt,
          password: encrypt ? body.password : '',
          // v0.5.1（契约 §2）：清理后打包（share 模式在 createPackInner 里被强制为 true）
          sanitize: body.sanitize === true,
        }
        if (body.dryRun === true) {
          const r = await createPack({ ...opts, dryRun: true })
          return send(200, { ok: true, ...r })
        }
        const job = startCreateJob(opts)
        return send(200, { ok: true, jobId: job.id })
      }
      // ---------------- 异步作业（契约 §4） ----------------
      if (req.method === 'GET' && p === '/jobs') return send(200, { ok: true, jobs: listJobs() })
      if (req.method === 'POST' && p.startsWith('/jobs/') && p.endsWith('/cancel')) {
        const id = decodeURIComponent(p.slice('/jobs/'.length, -'/cancel'.length))
        return send(200, cancelJob(id))
      }
      if (req.method === 'GET' && p.startsWith('/jobs/')) {
        const id = decodeURIComponent(p.slice('/jobs/'.length))
        return send(200, { ok: true, job: jobView(getJob(id)) })
      }
      // ---------------- 包管理（契约 v0.5.0 §1：4 组） ----------------
      if (req.method === 'GET' && p === '/packs') return send(200, { ok: true, packs: await listPacks() })
      if (req.method === 'POST' && p === '/packs/rename') {
        const body = await parseBody()
        return send(200, await renamePack(requireStringParam(body.from, 'from'), requireStringParam(body.to, 'to')))
      }
      {
        // 包详情 = manifest + 逐文件 size + 顺带 SHA-256 校验（v0.5.0：独立 verify 接口已删）
        const infoMatch = /^\/packs\/([^/]+)\/info$/.exec(p)
        if (infoMatch && req.method === 'GET') {
          const name = decodeURIComponent(infoMatch[1])
          return send(200, await getPackInfo(name, url.searchParams.get('password') || ''))
        }
      }
      if (req.method === 'DELETE' && p.startsWith('/packs/')) {
        const name = decodeURIComponent(p.slice('/packs/'.length))
        // 删除 = 送进 Windows 系统回收站；失败/非 Windows 降级永久删除并返回 warning（契约 v0.5.0 §4）
        return send(200, await deletePack(name, recycleFn))
      }
      // ---------------- 恢复（契约 §7：四件套） ----------------
      if (req.method === 'POST' && p === '/restore/import') {
        const body = await parseBody()
        const zip = requireStringParam(body.zip, 'zip')
        const password = typeof body.password === 'string' ? body.password : ''
        return send(200, await importRestore(zip, password))
      }
      if (req.method === 'POST' && p === '/restore/apply') {
        const body = await parseBody()
        const zip = requireStringParam(body.zip, 'zip')
        // v0.4.0 P0：策略白名单 fail-closed（旧实现 `body.strategy || 'overwrite'` 让非法值静默变成覆盖）
        const strategy = body.strategy === undefined ? 'overwrite' : body.strategy
        if (!RESTORE_STRATEGIES.has(strategy)) {
          throw new ApiError(400, 'bad_strategy', "strategy 只能是 'overwrite' / 'skip' / 'merge'")
        }
        const modules = body.modules === undefined ? null : normalizeModulesStrict(body.modules)
        const includeDb = body.includeDb === true
        const password = typeof body.password === 'string' ? body.password : ''
        if (body.async === true) {
          const job = startRestoreJob({ zip, strategy, modules, includeDb, password })
          return send(200, { ok: true, jobId: job.id })
        }
        const { manifest, dir } = await readManifestFromZip(zip, password)
        try {
          manifest._dir = dir
          const stats = await applyRestore(manifest, { strategy, moduleFilter: modules, includeDb })
          return send(200, { ok: true, stats })
        } finally {
          await fsp.rm(dir, { recursive: true, force: true }) // 失败也要清理临时解压目录
        }
      }
      if (req.method === 'GET' && p === '/restore/backups') {
        return send(200, { ok: true, items: await listRestoreBackups() })
      }
      if (req.method === 'POST' && p === '/restore/rollback') {
        const body = await parseBody()
        return send(200, await rollbackRestoreBackup(body.dir))
      }
      return send(404, { ok: false, code: 'not_found', error: `未知接口: ${p}` })
    } catch (err) {
      if (err instanceof ApiError) return send(err.status, { ok: false, code: err.code, error: err.message })
      // 加密包密码错误/缺失：契约 §8 要求 400 bad_password，不得漏成 500
      if (isBadPasswordError(err)) return send(400, { ok: false, code: 'bad_password', error: String(err?.message || err) })
      return send(500, { ok: false, code: 'internal', error: String(err?.message || err) })
    }
  }
}

// ---------- 命令：/pack ----------

/** 解析 `/pack` 参数：`--flag [value]`；booleanFlags 里的开关不需要取值 */
function parsePackArgs(tokens, booleanFlags = []) {
  const positional = []
  const flags = {}
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t.startsWith('--')) {
      positional.push(t)
      continue
    }
    const name = t.slice(2)
    if (!name) throw new Error('存在空的 -- 选项')
    if (booleanFlags.includes(name)) {
      flags[name] = true
      continue
    }
    const value = tokens[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`选项 --${name} 缺少取值`)
    flags[name] = value
    i++
  }
  return { positional, flags }
}

const PACK_USAGE = [
  '用法: /pack list',
  '     | create [--modules a,b] [--mode migrate|share] [--share] [--note 备注] [--dry-run] [--encrypt 密码]',
  '     | restore <包路径> [--strategy overwrite|skip|merge] [--modules a,b] [--include-db] [--password 密码]',
  '     | scan',
].join('\n')

function registerPackCommand(ctx) {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'pack',
      description: '配置打包：list / create / restore / scan',
      async handler(invocation) {
        const { rawInput } = invocation
        const tokens = (rawInput || '').trim().split(/\s+/).filter(Boolean)
        const verb = tokens[0]
        const rest = tokens.slice(1)
        try {
          if (!verb) return { kind: 'success', text: PACK_USAGE }
          if (verb === 'list') {
            const packs = await listPacks()
            if (!packs.length) return { kind: 'success', text: '（暂无配置包）' }
            return {
              kind: 'success',
              // v0.4.0：list 显示 [加密] 标记（契约 §9）
              text: packs.map((p) => `- ${p.name}${p.encrypted ? ' [加密]' : ''}（${p.mode || '?'} · ${p.fileCount || 0} 文件 · ${Math.round((p.totalBytes || 0) / 1024)}KB${p.note ? ' · ' + p.note : ''}）`).join('\n'),
            }
          }
          if (verb === 'create') {
            const { flags } = parsePackArgs(rest, ['dry-run', 'share'])
            const mode = flags.share ? 'share' : (flags.mode || 'migrate')
            if (mode !== 'migrate' && mode !== 'share') throw new Error('--mode 只能是 migrate 或 share')
            const modules = flags.modules
              ? flags.modules.split(',').map((s) => s.trim()).filter(Boolean)
              : defaultModulesFor(mode)
            if (!modules.length) throw new Error('未选择任何模块')
            for (const m of modules) if (!MODULES[m]) throw new Error(`未知模块: ${m}`)
            // 与 Web API 同一套 fail-closed 校验：分享模式不得含敏感模块
            if (mode === 'share') {
              const blocked = modules.filter((m) => SENSITIVE_MODULES.includes(m))
              if (blocked.length) throw new Error(`分享模式不允许包含敏感模块：${blocked.join(', ')}（请改用迁移模式）`)
            }
            // v0.4.0 P0：CLI 补齐 --encrypt（≥8 位），与 Web UI 能力等价（契约 §9）
            const encrypt = flags.encrypt !== undefined
            const password = encrypt ? String(flags.encrypt) : ''
            if (encrypt && password.length < MIN_PASSWORD_LENGTH) throw new Error(`加密密码至少 ${MIN_PASSWORD_LENGTH} 位`)
            const dryRun = flags['dry-run'] === true
            const r = await createPack({ modules, mode, note: flags.note || '', dryRun, encrypt, password })
            const unreadableNote = r.unreadable?.length ? `\n（${r.unreadable.length} 个文件读不出内容已跳过，未写入指纹）` : ''
            if (dryRun) {
              return { kind: 'success', text: `【预览】模块 ${r.manifest.modules.join(', ')} · ${r.manifest.files.length} 文件 · ${Math.round(r.totalBytes / 1024)}KB${r.encrypted ? ' · 将加密（PKENC1）' : ''}\n隐私扫描：${r.privacy.length ? r.privacy.map((p) => `- ${formatFinding(p)}`).join('\n') : '无发现'}${unreadableNote}` }
            }
            return { kind: 'success', text: `已生成 ${r.pack.name}${r.pack.encrypted ? ' [加密]' : ''}（${r.pack.fileCount} 文件 · ${Math.round(r.pack.totalBytes / 1024)}KB${r.pack.note ? ' · ' + r.pack.note : ''}）\n路径：${r.pack.path}${unreadableNote}` }
          }
          if (verb === 'scan') {
            const files = []
            for (const m of Object.keys(MODULES)) {
              for (const f of await collectModuleFiles(MODULES[m])) files.push(f)
            }
            const findings = await privacyScan(files)
            const total = countFindings(findings)
            return {
              kind: 'success',
              text: total ? `发现 ${total} 处敏感痕迹（${findings.length} 个命中点）：\n` + findings.slice(0, 15).map((f) => `- ${formatFinding(f)}`).join('\n') : '未发现敏感痕迹',
            }
          }
          if (verb === 'restore') {
            const { positional, flags } = parsePackArgs(rest, ['include-db'])
            const zip = positional[0]
            if (!zip) return { kind: 'success', text: '用法: /pack restore <包路径> [--strategy overwrite|skip|merge] [--modules a,b] [--include-db] [--password 密码]' }
            const strategy = flags.strategy === undefined ? 'overwrite' : flags.strategy
            if (!RESTORE_STRATEGIES.has(strategy)) throw new Error('--strategy 只能是 overwrite / skip / merge')
            const moduleFilter = flags.modules ? flags.modules.split(',').map((s) => s.trim()).filter(Boolean) : null
            if (moduleFilter) {
              if (!moduleFilter.length) throw new Error('--modules 不能为空')
              for (const m of moduleFilter) if (!MODULES[m]) throw new Error(`未知模块: ${m}`)
            }
            // v0.4.0 P0：CLI 补齐 --include-db / --modules / --password（契约 §9）
            const includeDb = flags['include-db'] === true
            const { manifest, dir } = await readManifestFromZip(zip, flags.password || '')
            try {
              manifest._dir = dir
              const stats = await applyRestore(manifest, { strategy, moduleFilter, includeDb })
              const parts = [
                `恢复完成（策略 ${strategy}）：新增 ${stats.added} · 覆盖 ${stats.overwritten} · 合并 ${stats.merged} · 跳过 ${stats.skipped}`,
              ]
              if (stats.failed) parts.push(`失败 ${stats.failed}${stats.aborted ? '（已中止）' : ''}`)
              if (stats.rolledBack) parts.push(`已回滚 ${stats.rolledBack} 个文件`)
              if (stats.rollbackFailures.length) parts.push(`回滚失败 ${stats.rollbackFailures.length}`)
              if (stats.excluded.length) parts.push(`未恢复 SQLite 库 ${stats.excluded.length} 个（加 --include-db 才恢复）`)
              if (stats.backupDir) parts.push(`备份：${stats.backupDir}（可用 /restore/rollback 回滚）`)
              const detail = stats.failures.length ? '\n' + stats.failures.map((f) => `- ${f.rel}: ${f.error}`).join('\n') : ''
              return { kind: stats.failed ? 'error' : 'success', text: parts.join(' · ') + detail }
            } finally {
              await fsp.rm(dir, { recursive: true, force: true }) // 无论成败都清理临时解压目录
            }
          }
          return { kind: 'success', text: PACK_USAGE }
        } catch (err) {
          return { kind: 'error', text: String(err?.message || err) }
        }
      },
    })
  })
}

// ---------- 插件挂载 ----------

export function apply(ctx, config = {}) {
  // 部署者个人隐私规则（如个人昵称、本机用户名）——不进开源代码，由部署者配置注入
  if (config?.personalPatterns) setPersonalPatterns(config.personalPatterns)
  // 1. /pack 命令（可选服务）
  registerPackCommand(ctx)

  // 2. 设置页 Web API（官方契约：ctx.webServer.register，kind=prefix；webServer 缺失时自动跳过）
  //    注：不能直接访问 ctx.webServer —— Cordis service 未注入时 Proxy getter 抛
  //    "cannot get property without inject"（?. 拦不住）。用 ctx.inject 懒注入：
  ctx.inject(['webServer'], (httpCtx) => {
    const guard = createPackApiGuard(config?.api)
    const handler = createPackApiHandler({
      guard,
      // connection 是可选服务：ctx.get 拿不到就返回 undefined。
      // 默认 'auto' 下这等于 403（fail-closed）；只有显式 authMode: 'token' 才走令牌回退
      getConnection: () => {
        try {
          return httpCtx.get('connection')
        } catch {
          return undefined
        }
      },
    })
    if (typeof httpCtx.webServer?.register !== 'function') return // 宿主没有注册接口：不挂路由（不暴露任何入口）
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'prefix',
      path: '/packer/api',
      handler,
    }), 'dsh-packer: settings web API')

    // 令牌只服务显式 opt-in 的 'token' 模式：注入同源 index.html（跨站页面读不到），
    // 且只在真的注入了才 tap。默认 'auto' 模式不生成任何前端可读的令牌。
    if (guard.authMode === 'token' && typeof httpCtx.webServer.tapIndex === 'function') {
      httpCtx.effect(
        () => httpCtx.webServer.tapIndex((html) => guard.injectToken(html)),
        'dsh-packer: one-time API token injection',
      )
    }
  })
}

// ---------- 测试用内部接口 ----------

export const __internals = {
  DSH_HOME,
  PACKS_DIR,
  MEMORY_ROOT,
  BIOMEMORY_DIR,
  BIOMEMORY_DB,
  snapshotSqlite,
  cleanupSnapshots,
  MODULES,
  collectModuleFiles,
  moduleStats,
  privacyScan,
  PRIVACY_PATTERNS,
  setPersonalPatterns,
  createPack,
  listPacks,
  deletePack,
  renamePack,
  readManifestFromZip,
  diffRestore,
  applyRestore,
  buildManifest,
  sha256,
  isValidSha256,
  isTextFile,
  countFindings,
  stagingDir,
  pathContained,
  assertSafeRel,
  resolveTarget,
  validateArchiveMembers,
  assertNoLinkEntries,
  extractZip,
  DB_FILE_RE,
  buildZip,
  readZipFile,
  readEntryData,
  mapLimit,
  exists,
  createPackApiGuard,
  createPackApiHandler,
  redactPaths,
  TOKEN_HEADER,
  TOKEN_GLOBAL,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_MS,
  // ---- v0.4.0 新增：加密 / 作业 / 包库扩展（v0.5.0 起回收站与备份设置已删） ----
  PKENC_EXT,
  MIN_PASSWORD_LENGTH,
  isEncryptedBuffer,
  encryptZipBuffer,
  decryptZipBuffer,
  SENSITIVE_MODULES,
  RESTORE_STRATEGIES,
  RESTORE_BACKUP_DIR,
  validatePackName,
  packSummaryName,
  recycleFileNative,
  // ---- v0.6.4：回收站按平台分派（导出给测试；真实使用只走 recycleFileNative） ----
  platformTag,
  hasSystemTrash,
  hasSystemFilePicker,
  recycleFileWindows,
  recycleFileMac,
  recycleFileLinux,
  buildMacRecycleArgs,
  escapeAppleScriptString,
  buildTrashInfo,
  encodeTrashPath,
  formatTrashDate,
  trashDataHome,
  getPackInfo,
  publicManifest,
  importRestore,
  listRestoreBackups,
  rollbackRestoreBackup,
  defaultModulesFor,
  packsDiskUsage,
  JobCancelled,
  startCreateJob,
  startRestoreJob,
  getJob,
  listJobs,
  cancelJob,
  jobView,
  /** 当前进程内已生成的 SQLite 快照条数（/status 绝不应让它增长） */
  snapshotCacheSize: () => SNAPSHOT_CACHE.size,
  // ---- v0.5.1 新增：脱敏 / 回填 / 插件本体模块 ----
  PRIVACY_KINDS,
  PATTERN_KIND,
  KIND_PLACEHOLDER,
  PLACEHOLDER_HOME,
  PLACEHOLDER_USER,
  RETAINED_PLACEHOLDERS,
  sanitizeRules,
  sanitizeText,
  sanitizePackFile,
  validateSanitizedStructured,
  sameLineShape,
  sha256Buffer,
  collectPackageDirs,
  PACKAGE_SKIP_NAMES,
  backfillText,
  retainedPlaceholderCounts,
  currentUsername,
  expectedTargetSha,
}
