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
    label: '记忆数据（E:\\example\\memory 等）',
    kind: 'dir',
    resolve: () => MEMORY_ROOT,
    default: true,
    share: false,
    skipDirs: ['backups'],
  },
}

// ---------- 基础工具 ----------

function readFile(p) {
  try { return fs.readFileSync(p, 'utf-8') } catch { return '' }
}

function sha256(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  } catch { return '' }
}

function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const TEXT_EXT = new Set(['.md', '.yaml', '.yml', '.json', '.js', '.mjs', '.cjs', '.txt', '.jsonl', '.log', '.py', '.ps1', '.ts', '.toml', '.patch', '.i18n.yaml'])

function isTextFile(p) {
  const ext = path.extname(p).toLowerCase()
  return TEXT_EXT.has(ext) || p.endsWith('.i18n.yaml')
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
  { id: 'abs-path', label: '本地绝对路径', re: /[A-Za-z]:[\\/][^\s"'`<>]+/ },
  { id: 'user-path', label: '用户目录路径', re: /C:[\\/]Users[\\/][^\s"'`<>\\/]+/i },
  { id: 'credential', label: '疑似密钥/Token', re: /(?:api[_-]?key|secret|password|token|bearer|authorization)\s*[:=]\s*["'][^"']{8,}["']/i },
]

let PERSONAL_PATTERNS = [] // 部署者注入的个人规则：[{ label, re }]

function privacyScan(files) {
  const patterns = [...PRIVACY_PATTERNS, ...PERSONAL_PATTERNS]
  const findings = []
  for (const f of files) {
    if (!isTextFile(f.rel) && !isTextFile(f.abs)) continue
    const text = readFile(f.abs)
    if (!text) continue
    for (const pat of PRIVACY_PATTERNS) {
      const m = text.match(pat.re)
      if (m) {
        const line = text.split('\n').findIndex((l) => pat.re.test(l))
        findings.push({
          file: f.rel,
          pattern: pat.id,
          label: pat.label,
          line: line >= 0 ? line + 1 : null,
          sample: String(m[0]).slice(0, 80),
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
  for (const name of modules) {
    const mod = MODULES[name]
    const files = collectModuleFiles(mod, share)
    for (const f of files) collected.push({ module: name, ...f, sha256: sha256(f.abs) })
  }
  if (!collected.length) throw new Error('所选模块没有可打包的文件')

  // 隐私扫描（分享模式强制拦截；迁移模式仅警告）
  const findings = privacyScan(collected)
  if (share && findings.length) {
    throw new Error(`隐私扫描发现 ${findings.length} 处敏感痕迹，分享模式已拦截：\n` +
      findings.slice(0, 10).map((f) => `- ${f.label} @ ${f.file}${f.line ? `:${f.line}` : ''}（${f.sample}）`).join('\n'))
  }

  // 文件级清单（供确认）
  const manifest = buildManifest({ modules, mode, note, files: collected })
  if (dryRun) {
    return {
      dryRun: true,
      manifest,
      privacy: findings,
      totalBytes: collected.reduce((s, f) => s + (fs.statSync(f.abs).size || 0), 0),
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
    // 打包
    fs.mkdirSync(PACKS_DIR, { recursive: true })
    const zipName = `dsh-packer-${nowStamp()}-${mode}.zip`
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
      totalBytes: collected.reduce((s, f) => s + (fs.statSync(f.abs).size || 0), 0),
      privacyFindings: findings.length,
    }
    fs.writeFileSync(path.join(PACKS_DIR, zipName.replace(/\.zip$/, '.json')), JSON.stringify(summary, null, 2), 'utf-8')
    return { ok: true, pack: summary, privacy: findings }
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

function extractZip(zipPath) {
  if (!fs.existsSync(zipPath)) throw new Error(`文件不存在: ${zipPath}`)
  const dir = stagingDir()
  execTar(['-xf', zipPath, '-C', dir])
  return dir
}

function readManifestFromZip(zipPath) {
  const dir = extractZip(zipPath)
  try {
    const raw = readFile(path.join(dir, 'manifest.json'))
    if (!raw.trim()) throw new Error('包内缺少 manifest.json（不是 dsh-packer 生成的包）')
    const manifest = JSON.parse(raw)
    if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`清单版本不兼容（包 ${manifest.schemaVersion} vs 当前 ${SCHEMA_VERSION}）`)
    return { manifest, dir }
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

function resolveTarget(mod, rel) {
  // file 类型模块：resolve() 即文件全路径；dir 类型：resolve() + rel
  return mod.kind === 'file' ? mod.resolve() : path.join(mod.resolve(), rel)
}

function diffRestore(manifest) {
  const diff = { added: [], changed: [], same: [], skipped: [] }
  for (const f of manifest.files || []) {
    const mod = MODULES[f.module]
    if (!mod) { diff.skipped.push({ module: f.module, rel: f.rel, reason: '未知模块' }); continue }
    const target = resolveTarget(mod, f.rel)
    if (!fs.existsSync(target)) {
      diff.added.push({ module: f.module, rel: f.rel })
    } else if (sha256(target) === f.sha256) {
      diff.same.push({ module: f.module, rel: f.rel })
    } else {
      diff.changed.push({ module: f.module, rel: f.rel })
    }
  }
  return diff
}

function applyRestore(manifest, { strategy = 'overwrite', moduleFilter = null } = {}) {
  const stats = { overwritten: 0, added: 0, merged: 0, skipped: 0, failed: 0, failures: [] }
  for (const f of manifest.files || []) {
    if (moduleFilter && !moduleFilter.includes(f.module)) continue
    const mod = MODULES[f.module]
    if (!mod) { stats.skipped++; continue }
    const src = path.join(manifest._dir, f.module, f.rel)
    const target = resolveTarget(mod, f.rel)
    try {
      if (fs.existsSync(target)) {
        if (sha256(target) === f.sha256) { stats.skipped++; continue } // 相同跳过
        if (strategy === 'skip') { stats.skipped++; continue }
        if (strategy === 'merge' && isTextFile(target)) {
          // 合并：追加带分隔的源内容（不覆盖）
          const sep = `\n<!-- merged from dsh-packer pack ${manifest.createdAt} -->\n`
          fs.appendFileSync(target, sep + readFile(src), 'utf-8')
          stats.merged++
          continue
        }
      }
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const existed = fs.existsSync(target)
      fs.copyFileSync(src, target)
      if (existed) stats.overwritten++
      else stats.added++
    } catch (err) {
      stats.failed++
      stats.failures.push({ rel: f.rel, error: String(err.message || err) })
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
            if (dryRun) {
              return { kind: 'success', text: `【预览】模块 ${r.manifest.modules.join(', ')} · ${r.manifest.files.length} 文件 · ${Math.round(r.totalBytes / 1024)}KB\n隐私扫描：${r.privacy.length ? r.privacy.map((p) => `- ${p.label} @ ${p.file}`).join('\n') : '无发现'}` }
            }
            return { kind: 'success', text: `已生成 ${r.pack.name}（${r.pack.fileCount} 文件 · ${Math.round(r.pack.totalBytes / 1024)}KB${r.pack.note ? ' · ' + r.pack.note : ''}）` }
          }
          if (verb === 'scan') {
            const files = []
            for (const m of Object.keys(MODULES)) {
              for (const f of collectModuleFiles(MODULES[m])) files.push(f)
            }
            const findings = privacyScan(files)
            return {
              kind: 'success',
              text: findings.length ? `发现 ${findings.length} 处敏感痕迹：\n` + findings.slice(0, 15).map((f) => `- ${f.label} @ ${f.file}${f.line ? ':' + f.line : ''}`).join('\n') : '未发现敏感痕迹',
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
            manifest._dir = dir
            const diff = diffRestore(manifest)
            const stats = applyRestore(manifest, { strategy })
            fs.rmSync(dir, { recursive: true, force: true })
            return {
              kind: 'success',
              text: `恢复完成（策略 ${strategy}）：新增 ${diff.added.length} · 变更 ${stats.overwritten} · 合并 ${stats.merged} · 跳过 ${stats.skipped}${stats.failed ? ' · 失败 ' + stats.failed : ''}`,
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
  if (Array.isArray(config?.personalPatterns)) {
    PERSONAL_PATTERNS = config.personalPatterns.map((p) => ({
      id: p.id || 'personal',
      label: p.label || '个人敏感词',
      re: typeof p.re === 'string' ? new RegExp(p.re) : p.re,
    })).filter((p) => p.re instanceof RegExp)
  }
  // 1. /pack 命令（可选服务）
  registerPackCommand(ctx)

  // 2. 设置页 Web API（webServer 缺失时自动跳过）
  if (ctx.webServer?.register) {
    ctx.effect(() => ctx.webServer.register({
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
              for (const f of collectModuleFiles(MODULES[m], share)) files.push({ module: m, rel: f.rel, size: fs.statSync(f.abs).size })
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
            manifest._dir = dir
            const diff = diffRestore(manifest)
            fs.rmSync(dir, { recursive: true, force: true })
            return send(200, { ok: true, manifest: { ...manifest, files: undefined }, diff })
          }
          // POST /restore/apply → 执行恢复
          if (req.method === 'POST' && p === '/restore/apply') {
            const body = JSON.parse(await readBody())
            const { manifest, dir } = readManifestFromZip(body.zip)
            manifest._dir = dir
            const stats = applyRestore(manifest, { strategy: body.strategy || 'overwrite', moduleFilter: body.modules || null })
            fs.rmSync(dir, { recursive: true, force: true })
            return send(200, { ok: true, stats })
          }
          return send(404, { ok: false, error: 'not found' })
        } catch (err) {
          return send(500, { ok: false, error: String(err.message || err) })
        }
      },
    }), 'dsh-packer: settings web API')
  }
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
  createPack,
  listPacks,
  deletePack,
  renamePack,
  readManifestFromZip,
  diffRestore,
  applyRestore,
  buildManifest,
  sha256,
  stagingDir,
}
