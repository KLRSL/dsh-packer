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
// 安全：.credentials.yaml / .anonymous-user-id 永不打包
//   - 恢复：目标路径白名单 + containment 校验；清单指纹 fail-closed；先备份目标 → 写临时文件 → rename
//     原子替换；任一环节失败即中止并回滚已替换文件；SQLite 库（*.db*）默认不打包不恢复
//   - 解包：先列成员做白名单校验（拒绝绝对路径/盘符/UNC/`..`/链接类型），临时目录 try/finally 统一清理
//
// 官方契约要点（cordis-plugin-development SKILL + rc.5/rc.6 实测）：
//   - 可选服务用 ctx.get(name) + 缺失处理；硬依赖才声明 inject
//   - 副作用用 ctx.effect()（返回 disposer）
//   - webServer 由 dsh-web-app 提供（ctx.webServer?.register 判空）
//   - 命令 handler(invocation) -> { kind: 'success'|'error', text }
//   - zip 打包用系统 bsdtar（tar -a -cf，libarchive 支持 zip；零原生依赖）
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const inject = []

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PACKS_DIR = process.env.DSH_PACKS_DIR || path.join(DSH_HOME, 'packs')
const MEMORY_ROOT = process.env.DSH_MEMORY_ROOT || path.join(os.homedir(), '.dsh', 'memory')

const SCHEMA_VERSION = 1
const NEVER_PACK = ['.credentials.yaml', '.anonymous-user-id']

// 运行中的 SQLite 数据库（含 WAL/SHM/journal）：默认不打包、不恢复（见 memory 模块 skipFiles）
const DB_FILE_RE = /(^|\.)db(-wal|-shm|-journal)?$|\.sqlite3?$/i

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

// ---------- 基础工具 ----------

function readFile(p) {
  try { return fs.readFileSync(p, 'utf-8') } catch { return '' }
}

// 流式 SHA-256：分块读取，大文件不再整份进内存；计算失败必须抛错（绝不返回空串，
// 否则空指纹会与"目标侧也算不出指纹"撞成"相同"，完整性校验被静默跳过）
function sha256(p) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(p, 'r')
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024)
    let n
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(n === buf.length ? buf : buf.subarray(0, n))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

/** 比较用哈希：目标读不出来时返回 null（与"合法指纹"永远不相等） */
function trySha256(p) {
  try { return sha256(p) } catch { return null }
}

function fileSize(p) {
  try { return fs.statSync(p).size } catch { return 0 }
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
function looksBinary(p) {
  let fd
  try {
    fd = fs.openSync(p, 'r')
    const buf = Buffer.allocUnsafe(4096)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true
    return false
  } catch {
    return true
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch { /* ignore */ } }
  }
}

/** 是否按文本处理：已知文本后缀 / 已知文本文件名（.env）→ 是；已知二进制或含 NUL → 否 */
function isTextFile(p) {
  const base = path.basename(p)
  const ext = path.extname(p).toLowerCase()
  if (BINARY_EXT.has(ext)) return false
  if (TEXT_EXT.has(ext) || p.endsWith('.i18n.yaml')) return true
  if (TEXT_BASENAMES.has(base) || base.startsWith('.env.')) return true
  return !looksBinary(p)
}

// ---------- 模块文件收集 ----------

function collectModuleFiles(mod, excludeSharePersonal = false) {
  const root = mod.resolve()
  const files = []
  if (mod.kind === 'file') {
    if (fs.existsSync(root) && !NEVER_PACK.includes(path.basename(root))) {
      files.push({ rel: path.basename(root), abs: root })
    }
    return files
  }
  if (!fs.existsSync(root)) return files
  const skipDirs = new Set(mod.skipDirs || [])
  const walk = (dir, rel) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || skipDirs.has(e.name)) continue
      if (NEVER_PACK.includes(e.name)) continue
      const full = path.join(dir, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        // 分享模式排除个人 skill（如桌宠）
        if (excludeSharePersonal && mod.exclude?.includes(e.name)) continue
        walk(full, relPath)
      } else if (e.isFile()) {
        if (mod.skipFiles && mod.skipFiles.test(e.name)) continue
        files.push({ rel: relPath, abs: full })
      }
    }
  }
  walk(root, '')
  return files
}

// 统计模块大小
function moduleStats(mod) {
  const files = collectModuleFiles(mod)
  let bytes = 0
  for (const f of files) {
    try { bytes += fs.statSync(f.abs).size } catch { /* ignore */ }
  }
  return { count: files.length, bytes }
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
function privacyScan(files) {
  const patterns = [...PRIVACY_PATTERNS, ...PERSONAL_PATTERNS]
  const findings = []
  for (const f of files) {
    const probe = f.abs || f.rel
    if (!isTextFile(probe)) continue
    const text = readFile(probe)
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

function execTar(args) {
  try {
    return execFileSync('tar', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    throw new Error(`tar 执行失败: ${err.stderr || err.message}`)
  }
}

function stagingDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'packer-'))
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

function createPack({ modules, mode = 'migrate', note = '', dryRun = false }) {
  if (!Array.isArray(modules) || !modules.length) throw new Error('未选择任何模块')
  for (const m of modules) {
    if (!MODULES[m]) throw new Error(`未知模块: ${m}`)
  }
  const share = mode === 'share'
  const collected = []
  const unreadable = []
  for (const name of modules) {
    const mod = MODULES[name]
    const files = collectModuleFiles(mod, share)
    for (const f of files) {
      // 读不出内容的文件绝不写入空指纹，直接跳过并如实上报
      let hash
      try { hash = sha256(f.abs) } catch (err) {
        unreadable.push({ module: name, rel: f.rel, error: String(err.message || err) })
        continue
      }
      collected.push({ module: name, ...f, sha256: hash })
    }
  }
  if (!collected.length) throw new Error('所选模块没有可打包的文件')

  // 隐私扫描（分享模式强制拦截；迁移模式仅警告）
  const findings = privacyScan(collected)
  const findingTotal = countFindings(findings)
  if (share && findingTotal) {
    throw new Error(`隐私扫描发现 ${findingTotal} 处敏感痕迹，分享模式已拦截：\n` +
      findings.slice(0, 10).map((f) => `- ${formatFinding(f)}`).join('\n'))
  }

  // 文件级清单（供确认）
  const manifest = buildManifest({ modules, mode, note, files: collected })
  if (dryRun) {
    return {
      dryRun: true,
      manifest,
      privacy: findings,
      unreadable,
      totalBytes: collected.reduce((s, f) => s + fileSize(f.abs), 0),
    }
  }

  // staging：按 module/rel 复制
  const stage = stagingDir()
  try {
    for (const f of collected) {
      const dest = path.join(stage, f.module, f.rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(f.abs, dest)
    }
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    // 分享包自动附 README
    if (share) {
      fs.writeFileSync(path.join(stage, 'README.md'), shareReadme(manifest), 'utf-8')
    }
    // 打包（文件名带唯一后缀，同秒多次打包不互相覆盖）
    fs.mkdirSync(PACKS_DIR, { recursive: true })
    const zipName = `dsh-packer-${nowStamp()}-${uniqueSuffix()}-${mode}.zip`
    const zipPath = path.join(PACKS_DIR, zipName)
    execTar(['-a', '-cf', zipPath, '-C', stage, '.'])
    // 摘要文件（包管理快速读取）
    const summary = {
      name: zipName,
      createdAt: manifest.createdAt,
      mode,
      note,
      modules,
      fileCount: collected.length,
      totalBytes: collected.reduce((s, f) => s + fileSize(f.abs), 0),
      privacyFindings: findingTotal,
    }
    fs.writeFileSync(path.join(PACKS_DIR, zipName.replace(/\.zip$/, '.json')), JSON.stringify(summary, null, 2), 'utf-8')
    return { ok: true, pack: summary, privacy: findings, unreadable }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
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

function listPacks() {
  if (!fs.existsSync(PACKS_DIR)) return []
  const out = []
  for (const f of fs.readdirSync(PACKS_DIR)) {
    if (!f.endsWith('.zip')) continue
    const sumPath = path.join(PACKS_DIR, f.replace(/\.zip$/, '.json'))
    let summary = null
    try { summary = JSON.parse(readFile(sumPath)) } catch { /* ignore */ }
    if (!summary) {
      const st = fs.statSync(path.join(PACKS_DIR, f))
      summary = { name: f, createdAt: st.mtime.toISOString(), modules: [], fileCount: 0, totalBytes: st.size, note: '' }
    }
    out.push(summary)
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

function deletePack(name) {
  if (!/^[\w.-]+\.zip$/.test(name)) throw new Error('非法文件名')
  const zip = path.join(PACKS_DIR, name)
  if (!fs.existsSync(zip)) throw new Error(`包不存在: ${name}`)
  fs.unlinkSync(zip)
  fs.unlinkSync(zip.replace(/\.zip$/, '.json'))
  return { ok: true, deleted: name }
}

function renamePack(oldName, newName) {
  if (!/^[\w.-]+\.zip$/.test(oldName) || !/^[\w.-]+\.zip$/.test(newName)) throw new Error('非法文件名')
  const oldZip = path.join(PACKS_DIR, oldName)
  if (!fs.existsSync(oldZip)) throw new Error(`包不存在: ${oldName}`)
  const newZip = path.join(PACKS_DIR, newName)
  if (fs.existsSync(newZip)) throw new Error(`目标已存在: ${newName}`)
  fs.renameSync(oldZip, newZip)
  const oldSum = oldZip.replace(/\.zip$/, '.json')
  if (fs.existsSync(oldSum)) {
    const sum = JSON.parse(readFile(oldSum))
    sum.name = newName
    fs.writeFileSync(newZip.replace(/\.zip$/, '.json'), JSON.stringify(sum, null, 2), 'utf-8')
    fs.unlinkSync(oldSum)
  }
  return { ok: true, renamed: { from: oldName, to: newName } }
}

// ---------- 恢复 ----------

/**
 * 解包前白名单校验：成员名不得是绝对路径 / 盘符 / UNC / 含 `..` 片段；
 * 成员类型只放行普通文件（-）与目录（d）——符号链接、硬链接、设备文件一律拒绝。
 */
function validateArchiveMembers(zipPath) {
  let listing
  try {
    listing = execTar(['-tf', zipPath])
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
    verbose = execTar(['-tvf', zipPath])
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
function assertNoLinkEntries(dir) {
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries = []
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      let st
      try { st = fs.lstatSync(full) } catch { continue }
      if (st.isSymbolicLink()) throw new Error(`包内成员为符号链接，已拒绝解包（fail-closed）: ${path.relative(dir, full)}`)
      if (st.isDirectory()) stack.push(full)
    }
  }
}

function extractZip(zipPath) {
  if (!fs.existsSync(zipPath)) throw new Error(`文件不存在: ${zipPath}`)
  validateArchiveMembers(zipPath)
  const dir = stagingDir()
  try {
    execTar(['-xf', zipPath, '-C', dir])
    assertNoLinkEntries(dir)
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw err
  }
  return dir
}

function readManifestFromZip(zipPath) {
  const dir = extractZip(zipPath)
  try {
    const raw = readFile(path.join(dir, 'manifest.json'))
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
    fs.rmSync(dir, { recursive: true, force: true })
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

function diffRestore(manifest) {
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
    if (!fs.existsSync(target)) {
      diff.added.push({ module: f.module, rel: f.rel })
    } else if (trySha256(target) === f.sha256) {
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
function applyRestore(manifest, { strategy = 'overwrite', moduleFilter = null, includeDb = false, backupRoot = null } = {}) {
  const stats = {
    overwritten: 0, added: 0, merged: 0, skipped: 0, failed: 0, failures: [],
    excluded: [], aborted: false, rolledBack: 0, rollbackFailures: [], backupDir: null,
  }
  const applied = []
  let backupDir = null
  let seq = 0
  const ensureBackupDir = () => {
    if (!backupDir) {
      const root = backupRoot || path.join(PACKS_DIR, '.restore-backups')
      backupDir = path.join(root, `${nowStamp()}-${uniqueSuffix()}`)
      fs.mkdirSync(backupDir, { recursive: true })
      stats.backupDir = backupDir
    }
    return backupDir
  }
  const backupTarget = (target) => {
    const dest = path.join(ensureBackupDir(), `${String(seq++).padStart(4, '0')}-${path.basename(target)}`)
    fs.copyFileSync(target, dest)
    return dest
  }
  const rollback = () => {
    for (const rec of applied.reverse()) {
      try {
        if (rec.backup && fs.existsSync(rec.backup)) {
          const tmp = `${rec.target}.packer-rb-${uniqueSuffix()}`
          fs.copyFileSync(rec.backup, tmp)
          fs.renameSync(tmp, rec.target) // 原子还原
        } else {
          fs.rmSync(rec.target, { force: true })
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
      if (!fs.existsSync(src)) throw new Error('包内源文件缺失')
      const srcHash = sha256(src)
      if (srcHash !== f.sha256) {
        throw new Error(`源文件完整性校验失败（${f.sha256} ≠ ${srcHash}），已拒绝恢复（fail-closed）`)
      }
      if (fs.existsSync(target)) {
        if (trySha256(target) === f.sha256) { stats.skipped++; continue } // 相同跳过
        if (strategy === 'skip') { stats.skipped++; continue }
        if (strategy === 'merge' && isTextFile(target)) {
          if (isStructuredFile(target)) {
            // 结构化配置（JSON/YAML）禁用通用 append merge：拼接即坏文件
            throw new Error('结构化配置文件不支持 append merge（会破坏语法），请改用 overwrite 策略或手工合并')
          }
          const backup = backupTarget(target)
          const sep = `\n<!-- merged from dsh-packer pack ${manifest.createdAt} -->\n`
          fs.appendFileSync(target, sep + readFile(src), 'utf-8')
          applied.push({ target, backup, kind: 'merge' })
          stats.merged++
          continue
        }
      }
      const existed = fs.existsSync(target)
      const backup = existed ? backupTarget(target) : null
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const tmp = `${target}.packer-tmp-${uniqueSuffix()}`
      try {
        fs.copyFileSync(src, tmp)
        fs.renameSync(tmp, target) // 原子替换，写到一半不会留下半个文件
      } catch (err) {
        fs.rmSync(tmp, { force: true }) // 失败不残留临时文件
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
      rollback() // 任一环节失败即中止并回滚
      break
    }
  }
  return stats
}

// ---------- 命令：/pack ----------

function registerPackCommand(ctx) {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'pack',
      description: '配置打包：list / create / restore / scan',
      handler(invocation) {
        const { rawInput } = invocation
        const tokens = (rawInput || '').trim().split(/\s+/)
        const verb = tokens[0]
        const rest = tokens.slice(1)
        try {
          if (verb === 'list') {
            const packs = listPacks()
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
            const r = createPack({ modules, mode, note, dryRun })
            const unreadableNote = r.unreadable?.length ? `\n（${r.unreadable.length} 个文件读不出内容已跳过，未写入指纹）` : ''
            if (dryRun) {
              return { kind: 'success', text: `【预览】模块 ${r.manifest.modules.join(', ')} · ${r.manifest.files.length} 文件 · ${Math.round(r.totalBytes / 1024)}KB\n隐私扫描：${r.privacy.length ? r.privacy.map((p) => `- ${formatFinding(p)}`).join('\n') : '无发现'}${unreadableNote}` }
            }
            return { kind: 'success', text: `已生成 ${r.pack.name}（${r.pack.fileCount} 文件 · ${Math.round(r.pack.totalBytes / 1024)}KB${r.pack.note ? ' · ' + r.pack.note : ''}）${unreadableNote}` }
          }
          if (verb === 'scan') {
            const files = []
            for (const m of Object.keys(MODULES)) {
              for (const f of collectModuleFiles(MODULES[m])) files.push(f)
            }
            const findings = privacyScan(files)
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
            const { manifest, dir } = readManifestFromZip(zip)
            try {
              manifest._dir = dir
              const stats = applyRestore(manifest, { strategy })
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
              fs.rmSync(dir, { recursive: true, force: true }) // 无论成败都清理临时解压目录
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
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'prefix',
      path: '/packer/api',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'https://dsh.invalid')
        const p = url.pathname.replace(/^\/packer\/api/, '') || '/'
        res.setHeader('content-type', 'application/json; charset=utf-8')
        const send = (code, body) => {
          res.statusCode = code
          res.end(JSON.stringify(body))
        }
        const readBody = () => new Promise((resolve, reject) => {
          const chunks = []
          req.on('data', (c) => chunks.push(c))
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
          req.on('error', reject)
        })
        try {
          // GET /status → 模块概览 + 包列表
          if (req.method === 'GET' && p === '/status') {
            const moduleInfo = {}
            for (const [key, mod] of Object.entries(MODULES)) {
              const st = moduleStats(mod)
              moduleInfo[key] = { label: mod.label, kind: mod.kind, default: mod.default, share: mod.share, count: st.count, bytes: st.bytes }
            }
            return send(200, { ok: true, modules: moduleInfo, packs: listPacks(), packsDir: PACKS_DIR, schemaVersion: SCHEMA_VERSION })
          }
          // POST /scan → { modules, mode } → 文件清单 + 隐私扫描
          if (req.method === 'POST' && p === '/scan') {
            const body = JSON.parse(await readBody())
            const share = body.mode === 'share'
            const files = []
            for (const m of body.modules || []) {
              if (!MODULES[m]) continue
              for (const f of collectModuleFiles(MODULES[m], share)) files.push({ module: m, rel: f.rel, size: fileSize(f.abs) })
            }
            const findings = privacyScan(files)
            return send(200, { ok: true, files, privacy: findings, share })
          }
          // POST /create → 打包
          if (req.method === 'POST' && p === '/create') {
            const body = JSON.parse(await readBody())
            const r = createPack({ modules: body.modules, mode: body.mode || 'migrate', note: body.note || '', dryRun: body.dryRun === true })
            return send(200, { ok: true, ...r })
          }
          // GET /packs / DELETE /packs / POST /packs/rename
          if (req.method === 'GET' && p === '/packs') return send(200, { ok: true, packs: listPacks() })
          if (req.method === 'DELETE' && p.startsWith('/packs/')) {
            const name = decodeURIComponent(p.slice('/packs/'.length))
            return send(200, deletePack(name))
          }
          if (req.method === 'POST' && p === '/packs/rename') {
            const body = JSON.parse(await readBody())
            return send(200, renamePack(body.from, body.to))
          }
          // POST /restore/import → 校验 + 差异报告
          if (req.method === 'POST' && p === '/restore/import') {
            const body = JSON.parse(await readBody())
            const { manifest, dir } = readManifestFromZip(body.zip)
            try {
              manifest._dir = dir
              const diff = diffRestore(manifest)
              return send(200, { ok: true, manifest: { ...manifest, files: undefined }, diff })
            } finally {
              fs.rmSync(dir, { recursive: true, force: true }) // 失败也要清理临时解压目录
            }
          }
          // POST /restore/apply → 执行恢复
          if (req.method === 'POST' && p === '/restore/apply') {
            const body = JSON.parse(await readBody())
            const { manifest, dir } = readManifestFromZip(body.zip)
            try {
              manifest._dir = dir
              const stats = applyRestore(manifest, {
                strategy: body.strategy || 'overwrite',
                moduleFilter: body.modules || null,
                includeDb: body.includeDb === true,
              })
              return send(200, { ok: true, stats })
            } finally {
              fs.rmSync(dir, { recursive: true, force: true }) // 失败也要清理临时解压目录
            }
          }
          return send(404, { ok: false, error: 'not found' })
        } catch (err) {
          return send(500, { ok: false, error: String(err.message || err) })
        }
      },
    }), 'dsh-packer: settings web API')
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
}
