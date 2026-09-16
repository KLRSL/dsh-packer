// ============================================================================
// dsh-packer — 配置打包器（Agent Config Packer for DeepSeek Harness）
//
// 把本地 Agent 资产按模块打包成 zip（迁移/分享两用），支持：
//   1. 模块打包：Skills / 会话记录 / Profile 配置 / 全局设置 / Agent 预设 / 记忆数据
//   2. 双模式预设：迁移全选 / 分享精选（分享自动排除会话与记忆数据）
//   3. 隐私安全扫描：打包前检测本地路径/用户名/API key/个人昵称，分享模式强制拦截
//   4. 文件级操作清单：打包/恢复前预览具体文件操作
//   5. 包管理：列表 / 删除 / 重命名（含备注）
//   6. 恢复：清单校验 → 差异对比（新增/变更/相同）→ 冲突三选（覆盖/跳过/合并）
//   7. 分享包自动附 README 说明
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
//   - zip 打包用系统 bsdtar（tar -a -cf，libarchive 支持 zip；零原生依赖）
// ============================================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const inject = []

const execFileAsync = promisify(execFile)

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PACKS_DIR = process.env.DSH_PACKS_DIR || path.join(DSH_HOME, 'packs')
const MEMORY_ROOT = process.env.DSH_MEMORY_ROOT || path.join(os.homedir(), '.dsh', 'memory')

const SCHEMA_VERSION = 1
const NEVER_PACK = ['.credentials.yaml', '.anonymous-user-id']

// 运行中的 SQLite 数据库（含 WAL/SHM/journal）：默认不打包、不恢复（见 memory 模块 skipFiles）
const DB_FILE_RE = /(^|\.)db(-wal|-shm|-journal)?$|\.sqlite3?$/i

// 异步 IO 的有界并发：既不串行等 I/O，也不为大批量文件同时打开上千个句柄
const IO_CONCURRENCY = 16
const HASH_CHUNK_BYTES = 1024 * 1024
// tar 列表输出（-tvf）可能很大，给足缓冲；这不是分配，只是上限
const TAR_MAX_BUFFER = 64 * 1024 * 1024

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
    label: '记忆数据（DSH_MEMORY_ROOT 或 ~/.dsh/memory 等）',
    kind: 'dir',
    resolve: () => MEMORY_ROOT,
    default: true,
    share: false,
    skipDirs: ['backups'],
    // 运行中的 SQLite 库被 DSH / 记忆插件持有，复制或覆盖都可能损坏，默认排除
    skipFiles: DB_FILE_RE,
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

async function collectModuleFiles(mod, excludeSharePersonal = false) {
  const root = mod.resolve()
  const files = []
  if (mod.kind === 'file') {
    if ((await exists(root)) && !NEVER_PACK.includes(path.basename(root))) {
      files.push({ rel: path.basename(root), abs: root })
    }
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

// 统计模块大小
async function moduleStats(mod) {
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

// ---------- zip 打包（系统 bsdtar，零原生依赖） ----------

/**
 * 异步执行 tar：参数以数组传入，绝不拼接 shell 字符串（Windows 上 tar 即系统自带
 * bsdtar，execFile 直接解析 PATH/PATHEXT，不需要 shell）。
 */
async function execTar(args) {
  try {
    const { stdout } = await execFileAsync('tar', args, {
      encoding: 'utf-8',
      maxBuffer: TAR_MAX_BUFFER,
      windowsHide: true,
    })
    return stdout
  } catch (err) {
    throw new Error(`tar 执行失败: ${err.stderr || err.message}`)
  }
}

function stagingDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'packer-'))
}

// ---------- 打包主流程 ----------

function buildManifest({ modules, mode, note, files }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'dsh-packer',
    createdAt: new Date().toISOString(),
    mode,
    note: note || '',
    modules,
    files: files.map((f) => ({ module: f.module, rel: f.rel, sha256: f.sha256 })),
  }
}

async function createPack({ modules, mode = 'migrate', note = '', dryRun = false }) {
  if (!Array.isArray(modules) || !modules.length) throw new Error('未选择任何模块')
  for (const m of modules) {
    if (!MODULES[m]) throw new Error(`未知模块: ${m}`)
  }
  const share = mode === 'share'
  const collected = []
  const unreadable = []
  for (const name of modules) {
    const mod = MODULES[name]
    const files = await collectModuleFiles(mod, share)
    // 指纹计算有界并发：大批量文件不再串行等待，也不阻塞事件循环
    const hashed = await mapLimit(files, IO_CONCURRENCY, async (f) => {
      try {
        return { module: name, ...f, sha256: await sha256(f.abs) }
      } catch (err) {
        // 读不出内容的文件绝不写入空指纹，直接跳过并如实上报
        unreadable.push({ module: name, rel: f.rel, error: String(err.message || err) })
        return null
      }
    })
    for (const f of hashed) if (f) collected.push(f)
  }
  if (!collected.length) throw new Error('所选模块没有可打包的文件')

  // 隐私扫描（分享模式强制拦截；迁移模式仅警告）
  const findings = await privacyScan(collected)
  const findingTotal = countFindings(findings)
  if (share && findingTotal) {
    throw new Error(`隐私扫描发现 ${findingTotal} 处敏感痕迹，分享模式已拦截：\n` +
      findings.slice(0, 10).map((f) => `- ${formatFinding(f)}`).join('\n'))
  }

  const totalBytes = (await mapLimit(collected, IO_CONCURRENCY, (f) => fileSize(f.abs)))
    .reduce((s, n) => s + n, 0)

  // 文件级清单（供确认）
  const manifest = buildManifest({ modules, mode, note, files: collected })
  if (dryRun) {
    return { dryRun: true, manifest, privacy: findings, unreadable, totalBytes }
  }

  // staging：按 module/rel 复制
  const stage = await stagingDir()
  try {
    await mapLimit(collected, IO_CONCURRENCY, async (f) => {
      const dest = path.join(stage, f.module, f.rel)
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.copyFile(f.abs, dest)
    })
    await fsp.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    // 分享包自动附 README
    if (share) {
      await fsp.writeFile(path.join(stage, 'README.md'), shareReadme(manifest), 'utf-8')
    }
    // 打包（文件名带唯一后缀，同秒多次打包不互相覆盖）
    await fsp.mkdir(PACKS_DIR, { recursive: true })
    const zipName = `dsh-packer-${nowStamp()}-${uniqueSuffix()}-${mode}.zip`
    const zipPath = path.join(PACKS_DIR, zipName)
    await execTar(['-a', '-cf', zipPath, '-C', stage, '.'])
    // 摘要文件（包管理快速读取）
    const summary = {
      name: zipName,
      createdAt: manifest.createdAt,
      mode,
      note,
      modules,
      fileCount: collected.length,
      totalBytes,
      privacyFindings: findingTotal,
    }
    await fsp.writeFile(path.join(PACKS_DIR, zipName.replace(/\.zip$/, '.json')), JSON.stringify(summary, null, 2), 'utf-8')
    return { ok: true, pack: summary, privacy: findings, unreadable }
  } finally {
    await fsp.rm(stage, { recursive: true, force: true })
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
- 本包不包含任何凭据（API Key 等）
- manifest.json 内含每个文件的 SHA-256 指纹，用于完整性校验

---
Generated by dsh-packer
`
}

// ---------- 包管理 ----------

async function listPacks() {
  let names
  try {
    names = await fsp.readdir(PACKS_DIR)
  } catch {
    return []
  }
  const out = []
  for (const f of names) {
    if (!f.endsWith('.zip')) continue
    const sumPath = path.join(PACKS_DIR, f.replace(/\.zip$/, '.json'))
    let summary = null
    try {
      summary = JSON.parse(await readFileText(sumPath))
    } catch {
      /* ignore */
    }
    if (!summary) {
      let size = 0
      let mtime = new Date(0)
      try {
        const st = await fsp.stat(path.join(PACKS_DIR, f))
        size = st.size
        mtime = st.mtime
      } catch {
        /* ignore */
      }
      summary = { name: f, createdAt: mtime.toISOString(), modules: [], fileCount: 0, totalBytes: size, note: '' }
    }
    out.push(summary)
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

async function deletePack(name) {
  if (!/^[\w.-]+\.zip$/.test(name)) throw new Error('非法文件名')
  const zip = path.join(PACKS_DIR, name)
  if (!(await exists(zip))) throw new Error(`包不存在: ${name}`)
  await fsp.rm(zip, { force: true })
  await fsp.rm(zip.replace(/\.zip$/, '.json'), { force: true })
  return { ok: true, deleted: name }
}

async function renamePack(oldName, newName) {
  if (!/^[\w.-]+\.zip$/.test(oldName) || !/^[\w.-]+\.zip$/.test(newName)) throw new Error('非法文件名')
  const oldZip = path.join(PACKS_DIR, oldName)
  if (!(await exists(oldZip))) throw new Error(`包不存在: ${oldName}`)
  const newZip = path.join(PACKS_DIR, newName)
  if (await exists(newZip)) throw new Error(`目标已存在: ${newName}`)
  await fsp.rename(oldZip, newZip)
  const oldSum = oldZip.replace(/\.zip$/, '.json')
  if (await exists(oldSum)) {
    const sum = JSON.parse(await readFileText(oldSum))
    sum.name = newName
    await fsp.writeFile(newZip.replace(/\.zip$/, '.json'), JSON.stringify(sum, null, 2), 'utf-8')
    await fsp.rm(oldSum, { force: true })
  }
  return { ok: true, renamed: { from: oldName, to: newName } }
}

// ---------- 恢复 ----------

/**
 * 解包前白名单校验：成员名不得是绝对路径 / 盘符 / UNC / 含 `..` 片段；
 * 成员类型只放行普通文件（-）与目录（d）——符号链接、硬链接、设备文件一律拒绝。
 */
async function validateArchiveMembers(zipPath) {
  let listing
  try {
    listing = await execTar(['-tf', zipPath])
  } catch (err) {
    throw new Error(`读取包内清单失败: ${String(err.message || err)}`)
  }
  const members = String(listing).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!members.length) throw new Error('包内没有任何成员（空包或不是有效 zip）')
  for (const raw of members) {
    const name = raw.replace(/^\.\//, '')
    if (!name) continue
    if (name.includes('\0')) throw new Error('包内成员名含非法字符，已拒绝解包（fail-closed）')
    if (/^[A-Za-z]:/.test(name)) throw new Error(`包内成员名非法（盘符路径）: ${name}`)
    if (name.startsWith('/') || name.startsWith('\\')) throw new Error(`包内成员名非法（绝对路径/UNC）: ${name}`)
    if (name.split(/[\\/]/).includes('..')) throw new Error(`包内成员名越界（含 .. 片段）: ${name}`)
  }
  // 类型校验（第二遍列表带类型字符）：链接类成员会把解包指向包外
  let verbose
  try {
    verbose = await execTar(['-tvf', zipPath])
  } catch (err) {
    throw new Error(`读取包内成员类型失败: ${String(err.message || err)}`)
  }
  for (const line of String(verbose).split(/\r?\n/)) {
    if (!line) continue
    const type = line[0]
    if (type !== '-' && type !== 'd') {
      throw new Error(`包内含不允许的成员类型（${type}），已拒绝解包（fail-closed）: ${line.slice(0, 120)}`)
    }
  }
  return members
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
  await validateArchiveMembers(zipPath)
  const dir = await stagingDir()
  try {
    await execTar(['-xf', zipPath, '-C', dir])
    await assertNoLinkEntries(dir)
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw err
  }
  return dir
}

async function readManifestFromZip(zipPath) {
  const dir = await extractZip(zipPath)
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
    return { manifest, dir }
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw err
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
    } else if ((await trySha256(target)) === f.sha256) {
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
 */
async function applyRestore(manifest, { strategy = 'overwrite', moduleFilter = null, includeDb = false, backupRoot = null } = {}) {
  const stats = {
    overwritten: 0, added: 0, merged: 0, skipped: 0, failed: 0, failures: [],
    excluded: [], aborted: false, rolledBack: 0, rollbackFailures: [], backupDir: null,
  }
  const applied = []
  let backupDir = null
  let seq = 0
  const ensureBackupDir = async () => {
    if (!backupDir) {
      const root = backupRoot || path.join(PACKS_DIR, '.restore-backups')
      backupDir = path.join(root, `${nowStamp()}-${uniqueSuffix()}`)
      await fsp.mkdir(backupDir, { recursive: true })
      stats.backupDir = backupDir
    }
    return backupDir
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

  for (const f of manifest.files || []) {
    if (moduleFilter && !moduleFilter.includes(f.module)) continue
    const mod = MODULES[f.module]
    if (!mod) { stats.skipped++; continue }
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
      if (await exists(target)) {
        if ((await trySha256(target)) === f.sha256) { stats.skipped++; continue } // 相同跳过
        if (strategy === 'skip') { stats.skipped++; continue }
        if (strategy === 'merge' && (await isTextFile(target))) {
          if (isStructuredFile(target)) {
            // 结构化配置（JSON/YAML）禁用通用 append merge：拼接即坏文件
            throw new Error('结构化配置文件不支持 append merge（会破坏语法），请改用 overwrite 策略或手工合并')
          }
          const backup = await backupTarget(target)
          const sep = `\n<!-- merged from dsh-packer pack ${manifest.createdAt} -->\n`
          await fsp.appendFile(target, sep + (await readFileText(src)), 'utf-8')
          applied.push({ target, backup, kind: 'merge' })
          stats.merged++
          continue
        }
      }
      const existed = await exists(target)
      const backup = existed ? await backupTarget(target) : null
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const tmp = `${target}.packer-tmp-${uniqueSuffix()}`
      try {
        await fsp.copyFile(src, tmp)
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
    } catch (err) {
      stats.failed++
      stats.failures.push({ rel: f.rel, error: String(err.message || err) })
      stats.aborted = true
      await rollback() // 任一环节失败即中止并回滚
      break
    }
  }
  return stats
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

/**
 * 构造 /packer/api/* 处理器。
 * @param {object} deps guard（防护器）与 getConnection（返回宿主 connection 服务，可空）
 * @returns {(req, res) => Promise<void>} 可以直接交给 webServer.register
 */
export function createPackApiHandler({ guard, getConnection } = {}) {
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

      // GET /status → 模块概览 + 包列表
      if (req.method === 'GET' && p === '/status') {
        const moduleInfo = {}
        for (const [key, mod] of Object.entries(MODULES)) {
          const st = await moduleStats(mod)
          moduleInfo[key] = { label: mod.label, kind: mod.kind, default: mod.default, share: mod.share, count: st.count, bytes: st.bytes }
        }
        return send(200, { ok: true, modules: moduleInfo, packs: await listPacks(), packsDir: PACKS_DIR, schemaVersion: SCHEMA_VERSION })
      }
      // POST /scan → { modules, mode } → 文件清单 + 隐私扫描
      if (req.method === 'POST' && p === '/scan') {
        const body = await parseBody()
        const share = body.mode === 'share'
        const files = []
        for (const m of body.modules || []) {
          if (!MODULES[m]) continue
          for (const f of await collectModuleFiles(MODULES[m], share)) files.push({ module: m, rel: f.rel, size: await fileSize(f.abs) })
        }
        const findings = await privacyScan(files)
        return send(200, { ok: true, files, privacy: findings, share })
      }
      // POST /create → 打包
      if (req.method === 'POST' && p === '/create') {
        const body = await parseBody()
        const r = await createPack({ modules: body.modules, mode: body.mode || 'migrate', note: body.note || '', dryRun: body.dryRun === true })
        return send(200, { ok: true, ...r })
      }
      // GET /packs / DELETE /packs / POST /packs/rename
      if (req.method === 'GET' && p === '/packs') return send(200, { ok: true, packs: await listPacks() })
      if (req.method === 'DELETE' && p.startsWith('/packs/')) {
        const name = decodeURIComponent(p.slice('/packs/'.length))
        return send(200, await deletePack(name))
      }
      if (req.method === 'POST' && p === '/packs/rename') {
        const body = await parseBody()
        return send(200, await renamePack(body.from, body.to))
      }
      // POST /restore/import → 校验 + 差异报告
      if (req.method === 'POST' && p === '/restore/import') {
        const body = await parseBody()
        const { manifest, dir } = await readManifestFromZip(body.zip)
        try {
          manifest._dir = dir
          const diff = await diffRestore(manifest)
          return send(200, { ok: true, manifest: { ...manifest, files: undefined }, diff })
        } finally {
          await fsp.rm(dir, { recursive: true, force: true }) // 失败也要清理临时解压目录
        }
      }
      // POST /restore/apply → 执行恢复
      if (req.method === 'POST' && p === '/restore/apply') {
        const body = await parseBody()
        const { manifest, dir } = await readManifestFromZip(body.zip)
        try {
          manifest._dir = dir
          const stats = await applyRestore(manifest, {
            strategy: body.strategy || 'overwrite',
            moduleFilter: body.modules || null,
            includeDb: body.includeDb === true,
          })
          return send(200, { ok: true, stats })
        } finally {
          await fsp.rm(dir, { recursive: true, force: true }) // 失败也要清理临时解压目录
        }
      }
      return send(404, { ok: false, code: 'not_found', error: `未知接口: ${p}` })
    } catch (err) {
      if (err instanceof ApiError) return send(err.status, { ok: false, code: err.code, error: err.message })
      return send(500, { ok: false, code: 'internal', error: String(err?.message || err) })
    }
  }
}

// ---------- 命令：/pack ----------

function registerPackCommand(ctx) {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'pack',
      description: '配置打包：list / create / restore / scan',
      async handler(invocation) {
        const { rawInput } = invocation
        const tokens = (rawInput || '').trim().split(/\s+/)
        const verb = tokens[0]
        const rest = tokens.slice(1)
        try {
          if (verb === 'list') {
            const packs = await listPacks()
            if (!packs.length) return { kind: 'success', text: '（暂无配置包）' }
            return {
              kind: 'success',
              text: packs.map((p) => `- ${p.name}（${p.mode || '?'} · ${p.fileCount || 0} 文件 · ${Math.round((p.totalBytes || 0) / 1024)}KB${p.note ? ' · ' + p.note : ''}）`).join('\n'),
            }
          }
          if (verb === 'create') {
            let modules = []
            let mode = 'migrate'
            let note = ''
            let dryRun = false
            for (let i = 0; i < rest.length; i++) {
              if (rest[i] === '--modules' && rest[i + 1]) { modules = rest[i + 1].split(',').map((s) => s.trim()); i++ }
              if (rest[i] === '--mode' && rest[i + 1]) { mode = rest[i + 1]; i++ }
              if (rest[i] === '--note' && rest[i + 1]) { note = rest[i + 1]; i++ }
              if (rest[i] === '--dry-run') dryRun = true
              if (rest[i] === '--share') mode = 'share'
            }
            if (!modules.length) {
              modules = Object.keys(MODULES).filter((m) => MODULES[m][mode === 'share' ? 'share' : 'default'])
            }
            const r = await createPack({ modules, mode, note, dryRun })
            const unreadableNote = r.unreadable?.length ? `\n（${r.unreadable.length} 个文件读不出内容已跳过，未写入指纹）` : ''
            if (dryRun) {
              return { kind: 'success', text: `【预览】模块 ${r.manifest.modules.join(', ')} · ${r.manifest.files.length} 文件 · ${Math.round(r.totalBytes / 1024)}KB\n隐私扫描：${r.privacy.length ? r.privacy.map((p) => `- ${formatFinding(p)}`).join('\n') : '无发现'}${unreadableNote}` }
            }
            return { kind: 'success', text: `已生成 ${r.pack.name}（${r.pack.fileCount} 文件 · ${Math.round(r.pack.totalBytes / 1024)}KB${r.pack.note ? ' · ' + r.pack.note : ''}）${unreadableNote}` }
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
            const zip = rest.find((t) => !t.startsWith('--'))
            if (!zip) return { kind: 'success', text: '用法: /pack restore <zip路径> [--strategy overwrite|skip|merge]' }
            let strategy = 'overwrite'
            for (let i = 0; i < rest.length; i++) {
              if (rest[i] === '--strategy' && rest[i + 1]) { strategy = rest[i + 1]; i++ }
            }
            const { manifest, dir } = await readManifestFromZip(zip)
            try {
              manifest._dir = dir
              const stats = await applyRestore(manifest, { strategy })
              const parts = [
                `恢复完成（策略 ${strategy}）：新增 ${stats.added} · 覆盖 ${stats.overwritten} · 合并 ${stats.merged} · 跳过 ${stats.skipped}`,
              ]
              if (stats.failed) parts.push(`失败 ${stats.failed}${stats.aborted ? '（已中止）' : ''}`)
              if (stats.rolledBack) parts.push(`已回滚 ${stats.rolledBack} 个文件`)
              if (stats.rollbackFailures.length) parts.push(`回滚失败 ${stats.rollbackFailures.length}`)
              if (stats.excluded.length) parts.push(`未恢复 SQLite 库 ${stats.excluded.length} 个（默认排除）`)
              if (stats.backupDir) parts.push(`备份：${stats.backupDir}`)
              const detail = stats.failures.length ? '\n' + stats.failures.map((f) => `- ${f.rel}: ${f.error}`).join('\n') : ''
              return { kind: 'success', text: parts.join(' · ') + detail }
            } finally {
              await fsp.rm(dir, { recursive: true, force: true }) // 无论成败都清理临时解压目录
            }
          }
          return { kind: 'success', text: '用法: /pack list | create [--modules a,b] [--mode migrate|share] [--note 备注] [--dry-run] | restore <zip> [--strategy overwrite|skip|merge] | scan' }
        } catch (err) {
          return { kind: 'error', text: String(err.message || err) }
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
  execTar,
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
}
