// ============================================================================
// dsh-packer 契约测试 —— 对照 docs/api-v051.md（v0.5.0 收敛 + v0.5.1 隐私真处理）
//
// v0.5.0 收敛（接口 15 → 9）：删掉自建回收站 / 定时自动备份 / 保留策略 / 独立 verify 接口，
// 对应旧用例已一并删除（不留死测试）。v0.5.1 新增（见文件末尾 v0.5.1 区块）：
//   sanitize=true 包内副本脱敏（源文件不动）/ sanitize=false 保真 + warnings、
//   share 强制脱敏、恢复回填（<用户目录>→home，其余占位符计入 stats.warnings）、
//   /scan 每条 finding 带 kind、plugins 模块（node_modules 一级包目录）、JSON/YAML 结构安全。
//
// 全部隔离在临时目录：DSH_HOME / DSH_PACKS_DIR / DSH_MEMORY_ROOT 都指向 tmpRoot，
// 并把 os.tmpdir() 也重定向到隔离目录 —— 这样「/status 是否泄漏 dsh-pack-snap-*」
// 能确定性地在本进程内断言，不受并发执行的其它测试文件影响。
// ============================================================================
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packer-v040-'))
const isolatedTmp = path.join(tmpRoot, 'tmp')
fs.mkdirSync(isolatedTmp, { recursive: true })
// 必须在 import index.mjs 之前设置：stagingDir / snapshotSqlite 都走 os.tmpdir()
process.env.TMPDIR = isolatedTmp
process.env.TMP = isolatedTmp
process.env.TEMP = isolatedTmp
process.env.DSH_HOME = path.join(tmpRoot, 'home')
process.env.DSH_PACKS_DIR = path.join(tmpRoot, 'packs')
process.env.DSH_MEMORY_ROOT = path.join(tmpRoot, 'memory')

const fakeHome = process.env.DSH_HOME
const fakePacks = process.env.DSH_PACKS_DIR
const fakeMemory = process.env.DSH_MEMORY_ROOT
const settingsPath = path.join(fakeHome, 'settings.yaml')
const ORIGINAL_SETTINGS = 'agent-default-model:\n  provider: deepseek-official\n'

let I = null
let mod = null
let api = null
let port = 0

/** 起一个隔离的 HTTP 服务；opts 透传给 createPackApiHandler（如注入 recycleFn 桩） */
function startApi(handlerOpts = {}) {
  const guard = I.createPackApiGuard({ authMode: 'off', rateLimit: 1000, rateWindowMs: 60_000 })
  const handler = I.createPackApiHandler({ guard, getConnection: () => undefined, ...handlerOpts })
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.statusCode = 500
      res.end(String(error?.message || error))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        server,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function makeAssets() {
  fs.mkdirSync(path.join(fakeHome, 'skills', 'alpha'), { recursive: true })
  fs.writeFileSync(path.join(fakeHome, 'skills', 'alpha', 'SKILL.md'), '# alpha skill\n普通文本，无敏感信息\n')
  fs.writeFileSync(settingsPath, ORIGINAL_SETTINGS)
  fs.mkdirSync(path.join(fakeHome, '.agent-presets', 'p1'), { recursive: true })
  fs.writeFileSync(path.join(fakeHome, '.agent-presets', 'p1', 'preset.yml'), 'enabled: true\n')
  fs.mkdirSync(path.join(fakeMemory, 'hot'), { recursive: true })
  fs.writeFileSync(path.join(fakeMemory, 'hot', 'knowledge.md'), '- [知识] v0.4.0 测试记忆\n')
}

function makeMemoryDb() {
  fs.mkdirSync(path.dirname(I.BIOMEMORY_DB), { recursive: true })
  const db = new DatabaseSync(I.BIOMEMORY_DB)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, text TEXT)')
    const ins = db.prepare('INSERT INTO entries (text) VALUES (?)')
    ins.run('条目一')
    ins.run('条目二')
  } finally {
    db.close()
  }
}

/** 隔离临时目录里当前的快照目录（/status 绝不该产生它们） */
function listSnapshots() {
  return fs.readdirSync(isolatedTmp).filter((n) => n.startsWith('dsh-pack-snap-')).sort()
}

/** 简易 JSON 客户端：path 以 /packer/api 之后的路径传入（如 '/status'） */
function requestOn(targetPort, p, { method = 'GET', body = undefined, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8')
    const h = { host: `127.0.0.1:${targetPort}`, ...headers }
    if (payload) {
      h['content-type'] = 'application/json'
      h['content-length'] = String(payload.length)
    }
    const req = http.request({ host: '127.0.0.1', port: targetPort, method, path: '/packer/api' + p, headers: h }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        let data = null
        try {
          data = JSON.parse(text)
        } catch {
          data = null
        }
        resolve({ status: res.statusCode, data, text })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** 默认请求打到 before() 里起的那个服务 */
function request(p, opts) {
  return requestOn(port, p, opts)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询作业直到终态（done/error/cancelled），返回 job 对象 */
async function waitJob(jobId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const r = await request(`/jobs/${encodeURIComponent(jobId)}`)
    assert.equal(r.status, 200, `GET /jobs/:id 应 200：${r.text}`)
    const job = r.data.job
    if (job.phase === 'done' || job.error || job.cancelled) return job
    if (Date.now() > deadline) throw new Error(`作业超时未完成：${JSON.stringify(job)}`)
    await sleep(15)
  }
}

/** 同步创建一个明文档并返回 { name, path } */
async function createPlainPack(modules = ['settings', 'skills'], note = 'v040 明文包') {
  const r = await request('/create', { method: 'POST', body: { modules, mode: 'migrate', note } })
  assert.equal(r.status, 200, r.text)
  assert.match(r.data.jobId, /^job-/)
  const job = await waitJob(r.data.jobId)
  assert.equal(job.error, null)
  assert.ok(job.result?.pack, `作业结果里应有 pack：${JSON.stringify(job)}`)
  return { pack: job.result.pack, packPath: path.join(fakePacks, job.result.pack.name) }
}

let plain = null

before(async () => {
  makeAssets()
  mod = await import(new URL('../index.mjs', import.meta.url).href)
  I = mod.__internals
  makeMemoryDb()
  api = await startApi()
  port = api.port
})

after(async () => {
  await api?.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

// ============================================================================
// §1 /status：不再 VACUUM INTO（P0）
// ============================================================================
test('/status：不产生 SQLite 快照（memoryDb 只 stat），且返回契约新字段', async () => {
  assert.equal(I.snapshotCacheSize(), 0, '前置条件：本进程内还没有任何快照')
  const dbBytes = fs.statSync(I.BIOMEMORY_DB).size
  const snapshotsBefore = listSnapshots()

  const r = await request('/status')
  assert.equal(r.status, 200, r.text)
  const data = r.data
  assert.equal(data.ok, true)

  // P0：旧实现走 collectModuleFiles → snapshotSqlite → VACUUM INTO，每次打开设置页泄漏一个快照目录
  assert.equal(I.snapshotCacheSize(), 0, '/status 绝不能触发 SQLite 快照（VACUUM INTO）')
  assert.deepEqual(listSnapshots(), snapshotsBefore, '/status 不能在临时目录留下 dsh-pack-snap-*')

  assert.equal(data.modules.memoryDb.count, 1)
  assert.equal(data.modules.memoryDb.bytes, dbBytes, 'memoryDb 只 stat 文件大小')
  assert.equal(typeof data.packsDir, 'string')
  assert.equal(data.packsDir, fakePacks)
  assert.equal(data.schemaVersion, 1)
  // v0.5.0 §2 字段终态：只有这 6 个键，回收站/保留策略/自动备份字段全部删掉
  assert.deepEqual(Object.keys(data).sort(), ['disk', 'modules', 'ok', 'packs', 'packsDir', 'schemaVersion'])
  assert.deepEqual(data.disk, { packsBytes: 0 })
  assert.equal(data.trashCount, undefined, 'v0.5.0：/status 不再有 trashCount')
  assert.equal(data.retention, undefined, 'v0.5.0：/status 不再有 retention')
  assert.equal(data.autoBackup, undefined, 'v0.5.0：/status 不再有 autoBackup')
  assert.deepEqual(data.packs, [])
})

// ============================================================================
// §2 /scan：必须带 abs（P0 假阴性）
// ============================================================================
test('/scan：隐私扫描真命中（传给 privacyScan 的文件项带 abs）', async () => {
  const probeRel = 'v040/probe.md'
  fs.mkdirSync(path.join(fakeHome, 'skills', 'v040'), { recursive: true })
  fs.writeFileSync(path.join(fakeHome, 'skills', 'v040', 'probe.md'), '本地路径 C:\\Users\\Example\\secret.txt\n')

  const r = await request('/scan', { method: 'POST', body: { modules: ['skills'], mode: 'migrate' } })
  assert.equal(r.status, 200, r.text)
  const data = r.data
  assert.equal(data.share, false)
  assert.ok(data.files.some((f) => f.rel === probeRel && f.size > 0), '文件清单必须带 size')
  assert.ok(data.files.every((f) => !('abs' in f)), '出网响应不得回传 abs')
  // 修复前：privacyScan 拿到的是 rel，读不到文件 → 恒零命中
  assert.ok(data.privacy.length > 0, '隐私扫描必须真命中（修复 abs 假阴性）')
  const hit = data.privacy.find((f) => f.file === probeRel)
  assert.ok(hit, `应命中探测文件，实际：${JSON.stringify(data.privacy)}`)
  assert.equal(hit.pattern, 'abs-path')
  assert.ok(hit.count >= 1)
})

test('/scan：mode 非法 → 400 bad_mode；未知模块 → 400 bad_modules', async () => {
  const badMode = await request('/scan', { method: 'POST', body: { modules: ['skills'], mode: 'bogus' } })
  assert.equal(badMode.status, 400)
  assert.equal(badMode.data.code, 'bad_mode')
  const badMod = await request('/scan', { method: 'POST', body: { modules: ['skills', 'nope'], mode: 'migrate' } })
  assert.equal(badMod.status, 400)
  assert.equal(badMod.data.code, 'bad_modules')
})

// ============================================================================
// §3 /create：dryRun / mode / share_scope / weak_password
// ============================================================================
test('/create dryRun：manifest.files 带 size（旧版缺 size，前端显示「—」）', async () => {
  const packsBefore = fs.existsSync(fakePacks) ? fs.readdirSync(fakePacks).length : 0
  const r = await request('/create', { method: 'POST', body: { modules: ['settings'], mode: 'migrate', dryRun: true } })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.data.dryRun, true)
  const file = r.data.manifest.files[0]
  assert.equal(file.module, 'settings')
  assert.equal(typeof file.size, 'number')
  assert.ok(file.size > 0, 'dryRun 文件条目必须带真实 size')
  assert.match(file.sha256, /^[0-9a-f]{64}$/)
  assert.ok(r.data.totalBytes > 0)
  assert.deepEqual(r.data.unreadable, [])
  // v0.5.0 §5：dryRun 不产出 pack 对象（也就不带 path）
  assert.ok(!('pack' in r.data), 'dryRun 不得返回 pack/path')
  const packsAfter = fs.existsSync(fakePacks) ? fs.readdirSync(fakePacks).length : 0
  assert.equal(packsAfter, packsBefore, 'dryRun 不得生成任何文件')
})

test('/create：mode 白名单 fail-closed（缺失/非法 → 400 bad_mode）', async () => {
  for (const body of [{ modules: ['settings'] }, { modules: ['settings'], mode: 'MIGRATE' }, { modules: ['settings'], mode: 'all' }]) {
    const r = await request('/create', { method: 'POST', body })
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.equal(r.data.code, 'bad_mode')
  }
  const noModules = await request('/create', { method: 'POST', body: { modules: [], mode: 'migrate' } })
  assert.equal(noModules.status, 400)
  assert.equal(noModules.data.code, 'bad_modules')
})

test('/create：分享模式服务端拦截敏感模块（400 share_scope，P0）', async () => {
  for (const m of ['sessions', 'profiles', 'settings', 'presets', 'memory', 'memoryDb']) {
    const r = await request('/create', { method: 'POST', body: { modules: [m], mode: 'share' } })
    assert.equal(r.status, 400, `模块 ${m} 必须被服务端拦住`)
    assert.equal(r.data.code, 'share_scope')
    assert.match(r.data.error, /分享模式不允许包含敏感模块/, r.data.error)
    assert.match(r.data.error, new RegExp(m))
  }
  // 混合选择：只要命中一个敏感模块就整单拒绝
  const mixed = await request('/create', { method: 'POST', body: { modules: ['skills', 'settings'], mode: 'share' } })
  assert.equal(mixed.status, 400)
  assert.equal(mixed.data.code, 'share_scope')
})

test('/create：encrypt 密码过短 → 400 weak_password', async () => {
  const r = await request('/create', { method: 'POST', body: { modules: ['settings'], mode: 'migrate', encrypt: true, password: '1234567' } })
  assert.equal(r.status, 400)
  assert.equal(r.data.code, 'weak_password')
})

// ============================================================================
// §3+§4 异步创建作业：jobId / done / total / 结果
// ============================================================================
test('/create 异步作业：done===total、结果 pack（带 path）、/packs 列表与详情顺带校验', async () => {
  const created = await createPlainPack(['settings', 'skills'], 'v040 job')
  plain = created
  assert.ok(plain.pack.name.endsWith('.zip'))
  assert.equal(plain.pack.mode, 'migrate')
  assert.equal(plain.pack.encrypted, false)
  assert.equal(plain.pack.note, 'v040 job')
  assert.ok(plain.pack.fileCount >= 2)
  assert.ok(fs.existsSync(plain.packPath))
  // v0.5.0 §5：result.pack.path = 包的绝对路径（UI「复制路径」用，不调接口）
  assert.equal(typeof plain.pack.path, 'string')
  assert.ok(path.isAbsolute(plain.pack.path), `pack.path 必须是绝对路径：${plain.pack.path}`)
  assert.equal(plain.pack.path, plain.packPath)

  const job = await waitJob((await request('/create', {
    method: 'POST',
    body: { modules: ['settings'], mode: 'migrate' },
  })).data.jobId)
  assert.equal(job.cancelled, false)
  assert.equal(job.error, null)
  assert.equal(job.kind, 'create')
  assert.equal(job.phase, 'done')
  assert.ok(job.total >= 1, `total 必须是预计文件数：${job.total}`)
  assert.equal(job.done, job.total, 'done 必须等于 total')

  const packs = (await request('/packs')).data.packs
  assert.ok(packs.some((p) => p.name === plain.pack.name))
  // /packs 列表形状按契约（不带 path：绝对路径只出现在 create 结果里）
  const listed = packs.find((p) => p.name === plain.pack.name)
  assert.deepEqual(Object.keys(listed).sort(), ['createdAt', 'encrypted', 'fileCount', 'mode', 'modules', 'name', 'note', 'sha256', 'totalBytes'])

  // §5 包详情：files 带 size + 顺带 SHA-256 校验（verify 已并入 info）
  const info = await request(`/packs/${encodeURIComponent(plain.pack.name)}/info`)
  assert.equal(info.status, 200, info.text)
  assert.equal(info.data.encrypted, false)
  assert.ok(info.data.files.length >= 2)
  assert.ok(info.data.files.every((f) => typeof f.size === 'number' && f.size >= 0))
  assert.equal(info.data.manifest.schemaVersion, 1)
  assert.ok(!('files' in info.data.manifest), 'manifest 里的 files 由详情单独返回')
  assert.deepEqual(info.data.verify, { checked: info.data.files.length, failures: [] })
})

test('§4 作业列表 /jobs 与未知作业 404', async () => {
  const list = await request('/jobs')
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.data.jobs))
  assert.ok(list.data.jobs.length >= 1)
  assert.ok(list.data.jobs.length <= 20)
  const missing = await request('/jobs/job-does-not-exist')
  assert.equal(missing.status, 404)
  assert.equal(missing.data.code, 'job_not_found')
})

// ============================================================================
// §7 bad_strategy：非法值 400，且绝不退化成 overwrite（P0）
// ============================================================================
test('§7 bad_strategy：非法策略 400 且不覆盖任何文件', async () => {
  fs.writeFileSync(settingsPath, 'guard-marker: true\n')
  for (const strategy of ['obliterate', 'OVERWRITE', 123, null]) {
    const r = await request('/restore/apply', {
      method: 'POST',
      body: { zip: plain.packPath, strategy },
    })
    assert.equal(r.status, 400, `strategy=${JSON.stringify(strategy)}`)
    assert.equal(r.data.code, 'bad_strategy')
    assert.equal(fs.readFileSync(settingsPath, 'utf-8'), 'guard-marker: true\n', '400 后目标文件必须原封不动')
  }
  // 未给 strategy 仍按 v0.3.0 兼容默认 overwrite（契约要求向后兼容），但要显式写注释（见 index.mjs）
  const compat = await request('/restore/apply', { method: 'POST', body: { zip: plain.packPath, modules: ['settings'] } })
  assert.equal(compat.status, 200, compat.text)
  assert.match(fs.readFileSync(settingsPath, 'utf-8'), /agent-default-model/)

  // modules 必须是已知模块子集（fail-closed）
  const badModules = await request('/restore/apply', {
    method: 'POST',
    body: { zip: plain.packPath, strategy: 'overwrite', modules: ['settings', 'nope'] },
  })
  assert.equal(badModules.status, 400)
  assert.equal(badModules.data.code, 'bad_modules')
})

// ============================================================================
// §8 加密包往返
// ============================================================================
test('§8 加密包：PKENC1 格式、密码错误 400 bad_password、正确密码导入+恢复', async () => {
  const password = 'v040-pass!'
  const r = await request('/create', { method: 'POST', body: { modules: ['settings'], mode: 'migrate', encrypt: true, password } })
  assert.equal(r.status, 200, r.text)
  const job = await waitJob(r.data.jobId)
  assert.equal(job.error, null)
  assert.ok(job.result.pack.name.endsWith('.pkenc'), '加密包不写 .zip 后缀')
  assert.equal(job.result.pack.encrypted, true)
  const encPath = path.join(fakePacks, job.result.pack.name)

  // 二进制布局：magic "PKENC1\0" + salt[16] + iv[12] + tag[16] + ciphertext
  const buf = fs.readFileSync(encPath)
  assert.equal(buf.subarray(0, 7).toString('latin1'), 'PKENC1\0')
  assert.ok(buf.length > 7 + 16 + 12 + 16, '应含密文')
  // summary 带 encrypted:true
  const summary = JSON.parse(fs.readFileSync(path.join(fakePacks, job.result.pack.name.replace(/\.pkenc$/, '.json')), 'utf-8'))
  assert.equal(summary.encrypted, true)
  // listPacks 同时识别 .zip 与 .pkenc
  const packs = (await request('/packs')).data.packs
  assert.ok(packs.some((p) => p.name === job.result.pack.name && p.encrypted === true))

  // 无密码 / 错误密码 → 400 bad_password（不得 500）
  const noPw = await request(`/packs/${encodeURIComponent(job.result.pack.name)}/info`)
  assert.equal(noPw.status, 400, noPw.text)
  assert.equal(noPw.data.code, 'bad_password')
  const wrongPw = await request('/restore/import', { method: 'POST', body: { zip: encPath, password: 'totally-wrong' } })
  assert.equal(wrongPw.status, 400, wrongPw.text)
  assert.equal(wrongPw.data.code, 'bad_password')
  assert.ok(!/PKENC1|scrypt|GCM/i.test(wrongPw.data.error), '错误文案不得泄露实现细节')

  // 正确密码：info 可用，且顺带校验全过（独立 verify 接口已删）
  const info = await request(`/packs/${encodeURIComponent(job.result.pack.name)}/info?password=${encodeURIComponent(password)}`)
  assert.equal(info.status, 200, info.text)
  assert.equal(info.data.encrypted, true)
  assert.ok(info.data.files.length >= 1)
  assert.equal(info.data.verify.checked, info.data.files.length)
  assert.deepEqual(info.data.verify.failures, [])
  // 加密包 info 校验需要口令：无口令仍 400 bad_password（上面 noPw 已断言）
  // 直接对加密包解包 → bad_password（不是「损坏 zip」500）
  await assert.rejects(() => I.extractZip(encPath), (err) => err?.code === 'bad_password')

  // §7 导入：逐文件 status + diff 计数
  const imp = await request('/restore/import', { method: 'POST', body: { zip: encPath, password } })
  assert.equal(imp.status, 200, imp.text)
  assert.equal(imp.data.encrypted, true)
  assert.ok(imp.data.files.length >= 1)
  assert.ok(imp.data.files.every((f) => ['added', 'changed', 'same', 'skipped'].includes(f.status)))
  assert.equal(typeof imp.data.diff.added, 'number')
  assert.equal(typeof imp.data.manifest.mode, 'string')

  // 改坏目标 → 用加密包覆盖恢复
  fs.writeFileSync(settingsPath, 'broken-by-encrypted-test\n')
  const apply = await request('/restore/apply', { method: 'POST', body: { zip: encPath, strategy: 'overwrite', password } })
  assert.equal(apply.status, 200, apply.text)
  assert.ok(apply.data.stats.overwritten >= 1)
  assert.match(fs.readFileSync(settingsPath, 'utf-8'), /agent-default-model/)
})

// ============================================================================
// §4 DELETE /packs/:name → Windows 系统回收站（v0.5.0：自建回收站已删）
// ============================================================================
test('§4 删除走回收站：注入 recycleFn 桩 → recycled=true，包与同名摘要都消失', async () => {
  const created = await createPlainPack(['settings'], 'recycle-target')
  const packName = created.pack.name
  const summaryPath = path.join(fakePacks, packName.replace(/\.zip$/, '.json'))
  assert.ok(fs.existsSync(created.packPath))
  assert.ok(fs.existsSync(summaryPath))

  const calls = []
  const recycleApi = await startApi({
    recycleFn: async (filePath) => {
      calls.push(filePath)
      fs.rmSync(filePath, { force: true })
      return true
    },
  })
  try {
    const del = await requestOn(recycleApi.port, `/packs/${encodeURIComponent(packName)}`, { method: 'DELETE' })
    assert.equal(del.status, 200, del.text)
    assert.equal(del.data.ok, true)
    assert.equal(del.data.recycled, true)
    assert.equal(del.data.warning, undefined, '成功进回收站不应有 warning')
    assert.equal(calls.length, 1, '路由必须把 recycleFn 注入点透传给 deletePack')
    assert.equal(calls[0], created.packPath)
  } finally {
    await recycleApi.close()
  }
  assert.ok(!fs.existsSync(created.packPath), '删除后包目录不得再有该包')
  assert.ok(!fs.existsSync(summaryPath), '同名 .json 摘要应一并删除')
  assert.ok(!(await request('/packs')).data.packs.some((p) => p.name === packName))
  // 自建回收站目录不应再产生
  assert.ok(!fs.existsSync(path.join(fakePacks, '.trash')), 'v0.5.0 不再有自建 .trash 目录')
})

test('§4 回收站失败/非 Windows → 降级永久删除并返回 warning（不得静默）', async () => {
  // ① 回收站实现抛错（PowerShell 失败）：永久删除 + warning 带原因
  const a = await createPlainPack(['settings'], 'recycle-fail')
  const boom = await I.deletePack(a.pack.name, async () => { throw new Error('powershell 不可用') })
  assert.equal(boom.ok, true)
  assert.equal(boom.recycled, false)
  assert.match(boom.warning, /未能移入系统回收站/)
  assert.match(boom.warning, /powershell 不可用/)
  assert.match(boom.warning, /永久删除/)
  assert.ok(!fs.existsSync(a.packPath), '降级后应已永久删除')

  // ② 非 Windows（实现返回 false）：同样永久删除，且必带 warning
  const b = await createPlainPack(['settings'], 'recycle-unsupported')
  const unsupported = await I.deletePack(b.pack.name, async () => false)
  assert.equal(unsupported.recycled, false)
  assert.match(unsupported.warning, /未能移入系统回收站/)
  assert.match(unsupported.warning, /永久删除/)
  assert.ok(!fs.existsSync(b.packPath))

  // ③ 删除不存在的包 → 404（不是静默成功）
  const missing = await request('/packs/no-such-pack.zip', { method: 'DELETE' })
  assert.equal(missing.status, 404)
  assert.equal(missing.data.code, 'pack_not_found')
})

test('v0.5.0 接口终态：被删的 6 个端点一律 404（一个都不许多）', async () => {
  const cases = [
    ['GET', '/packs/trash'],
    ['POST', '/packs/trash/restore'],
    ['POST', '/packs/trash/purge'],
    ['POST', '/packs/p.zip/verify'],
    ['POST', '/backup/settings'],
    ['POST', '/backup/run-now'],
  ]
  for (const [method, p] of cases) {
    const r = await request(p, method === 'POST' ? { method, body: {} } : { method })
    assert.equal(r.status, 404, `${method} ${p} 应已删除（实际 ${r.status}）`)
    assert.equal(r.data.code, 'not_found')
  }
})

test('§5 包名校验：路径分隔符 / .. / 过长 一律 400 bad_name', async () => {
  const { pack } = await createPlainPack(['settings'], 'name-check')
  for (const bad of ['../evil.zip', 'a/b.zip', 'a\\b.zip', '..zip', `${'x'.repeat(130)}.zip`, 'noext']) {
    const r = await request('/packs/rename', { method: 'POST', body: { from: pack.name, to: bad } })
    assert.equal(r.status, 400, `bad=${bad}`)
    assert.equal(r.data.code, 'bad_name')
  }
  // 同后缀的合法改名可以成功
  const okName = `renamed-${pack.name}`
  const ok = await request('/packs/rename', { method: 'POST', body: { from: pack.name, to: okName } })
  assert.equal(ok.status, 200, ok.text)
  assert.ok(fs.existsSync(path.join(fakePacks, okName)))
})

// ============================================================================
// §4 作业取消（P0 契约项）：文件边界中止 + 不留半成品
// ============================================================================
test('§4 作业取消：cancelled=true、不留半成品 zip，且不新增包', async () => {
  // 造一批够大的文件，保证取消请求能在文件边界生效（8MB 量级，哈希+复制约几十毫秒）
  const bulkDir = path.join(fakeHome, 'skills', 'bulk')
  fs.mkdirSync(bulkDir, { recursive: true })
  const chunk = 'y'.repeat(200 * 1024)
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(bulkDir, `f${String(i).padStart(3, '0')}.txt`), chunk)

  const packsBefore = new Set((await request('/packs')).data.packs.map((p) => p.name))
  const r = await request('/create', { method: 'POST', body: { modules: ['skills'], mode: 'migrate' } })
  assert.equal(r.status, 200, r.text)
  assert.match(r.data.jobId, /^job-/)
  const cancelled = await request(`/jobs/${encodeURIComponent(r.data.jobId)}/cancel`, { method: 'POST', body: {} })
  assert.equal(cancelled.status, 200, cancelled.text)

  const job = await waitJob(r.data.jobId)
  assert.equal(job.cancelled, true, `作业应在文件边界被取消（实际：${JSON.stringify(job)}）`)
  assert.equal(job.error, null, '取消不是错误')

  const packsAfter = (await request('/packs')).data.packs.map((p) => p.name)
  for (const name of packsAfter) {
    assert.ok(packsBefore.has(name), `取消后不应产生新包：${name}`)
  }
  assert.deepEqual(fs.readdirSync(fakePacks).filter((f) => f.endsWith('.tmp')), [], '取消后不得残留 .tmp 半成品')

  // 清理 bulk，避免影响后续 /status 统计与包体积
  fs.rmSync(bulkDir, { recursive: true, force: true })
})

test('§4 createPack 取消钩子：shouldCancel 立即取消且不落包', async () => {
  const packsBefore = (await request('/packs')).data.packs.length
  await assert.rejects(
    () => I.createPack({ modules: ['settings'], mode: 'migrate', hooks: { shouldCancel: () => true } }),
    (err) => err?.code === 'cancelled',
  )
  assert.equal((await request('/packs')).data.packs.length, packsBefore)
})

// ============================================================================
// §7 恢复：异步作业进度、备份列表、一键回滚、includeDb
// ============================================================================
test('§7 恢复异步作业：done===total、结果 stats 真实生效', async () => {
  fs.writeFileSync(settingsPath, 'async-restore-broke\n')
  const r = await request('/restore/apply', {
    method: 'POST',
    body: { zip: plain.packPath, strategy: 'overwrite', modules: ['settings'], async: true },
  })
  assert.equal(r.status, 200, r.text)
  const job = await waitJob(r.data.jobId)
  assert.equal(job.kind, 'restore')
  assert.equal(job.error, null)
  assert.equal(job.cancelled, false)
  assert.equal(job.phase, 'done')
  assert.equal(job.total, 1, '只恢复 settings 模块 → total 应为 1')
  assert.equal(job.done, job.total)
  assert.ok(job.result.stats.overwritten >= 1)
  assert.match(fs.readFileSync(settingsPath, 'utf-8'), /agent-default-model/)
})

test('§7 恢复备份列表 + 一键回滚（containment 校验）', async () => {
  fs.writeFileSync(settingsPath, 'before-rollback\n')
  const apply = await request('/restore/apply', {
    method: 'POST',
    body: { zip: plain.packPath, strategy: 'overwrite', modules: ['settings'] },
  })
  assert.equal(apply.status, 200, apply.text)
  const stats = apply.data.stats
  assert.ok(stats.backupDir, '覆盖恢复必须留下备份目录')
  assert.ok(fs.existsSync(stats.backupDir))

  const backups = (await request('/restore/backups')).data.items
  const item = backups.find((b) => b.dir === stats.backupDir)
  assert.ok(item, `备份列表应含 ${stats.backupDir}：${JSON.stringify(backups)}`)
  assert.ok(item.files >= 1)
  assert.ok(item.bytes >= 1)

  const rb = await request('/restore/rollback', { method: 'POST', body: { dir: stats.backupDir } })
  assert.equal(rb.status, 200, rb.text)
  assert.ok(rb.data.restored >= 1)
  assert.equal(rb.data.failed, 0)
  assert.equal(fs.readFileSync(settingsPath, 'utf-8'), 'before-rollback\n', '回滚后应回到恢复前内容')

  // containment：备份目录之外的一律 400 bad_dir
  for (const dir of [fakePacks, path.join(fakePacks, 'not-exists'), '', null]) {
    const bad = await request('/restore/rollback', { method: 'POST', body: { dir } })
    assert.equal(bad.status, 400, `dir=${JSON.stringify(dir)}`)
    assert.equal(bad.data.code, 'bad_dir')
  }
})

test('§7 includeDb：默认不恢复 SQLite 库，includeDb=true 才恢复', async () => {
  const { packPath } = await createPlainPack(['memoryDb'], 'memory-db-pack')
  const withoutDb = await request('/restore/apply', { method: 'POST', body: { zip: packPath, strategy: 'overwrite' } })
  assert.equal(withoutDb.status, 200, withoutDb.text)
  assert.ok(withoutDb.data.stats.excluded.length >= 1, '默认必须排除 *.db*')
  const withDb = await request('/restore/apply', { method: 'POST', body: { zip: packPath, strategy: 'overwrite', includeDb: true } })
  assert.equal(withDb.status, 200, withDb.text)
  assert.equal(withDb.data.stats.excluded.length, 0, 'includeDb=true 时不应再排除')
  assert.ok(withDb.data.stats.overwritten + withDb.data.stats.skipped >= 1)
})

// ============================================================================
// §3 info 顺带校验：干净包全过 / 篡改包 failures 非空（200，不是错误响应）
// ============================================================================
test('§3 info 顺带 SHA-256 校验：干净包全过 / 篡改包 failures 非空', async () => {
  const created = await createPlainPack(['settings', 'skills'], 'verify-merge')

  const clean = await request(`/packs/${encodeURIComponent(created.pack.name)}/info`)
  assert.equal(clean.status, 200, clean.text)
  assert.deepEqual(clean.data.verify, { checked: clean.data.files.length, failures: [] })

  // 契约 §1：POST /packs/:name/verify 已删（上面的「接口终态」用例已断言 404）
  // 篡改：重写 zip 里一个文件的内容，manifest 不变 → SHA-256 必然不匹配
  const { buf, entries } = I.readZipFile(created.packPath)
  const victim = 'settings/settings.yaml'
  assert.ok(entries.some((e) => e.name === victim), `包里应含 ${victim}`)
  const rewritten = entries.map((e) => {
    const data = I.readEntryData(buf, e)
    return {
      name: e.name,
      data: e.name === victim ? Buffer.concat([data, Buffer.from('\n# tampered by test\n')]) : data,
    }
  })
  fs.writeFileSync(created.packPath, I.buildZip(rewritten))

  const tampered = await request(`/packs/${encodeURIComponent(created.pack.name)}/info`)
  assert.equal(tampered.status, 200, `校验失败必须是 200 + failures，不是错误响应：${tampered.text}`)
  assert.equal(tampered.data.verify.failures.length, 1)
  assert.equal(tampered.data.verify.checked, tampered.data.files.length - 1)
  const failure = tampered.data.verify.failures[0]
  assert.equal(failure.module, 'settings')
  assert.equal(failure.rel, 'settings.yaml')
  assert.match(failure.error, /SHA-256 不匹配/)
})

// ============================================================================
// v0.5.1 §1–§5：隐私「真处理」（脱敏 / 保真两选）+ 迁移带插件本体
// ============================================================================

const V051_DIR = path.join(fakeHome, 'skills', 'v051')
const V051_MD = path.join(V051_DIR, 'notes.md')
const V051_JSON = path.join(V051_DIR, 'conf.json')
const V051_YAML = path.join(V051_DIR, 'conf.yaml')
const V051_ABS = path.join(V051_DIR, 'abs-only.md')
const V051_UNSAFE = path.join(V051_DIR, 'unsafe.md')
const V051_KEY = 'sk-abcdefghijklmnopqrstuv0123'

/** 造一组脱敏用例文件（每个用例开头重建，保证互不影响），返回源文本 */
function makeV051Fixtures() {
  fs.mkdirSync(V051_DIR, { recursive: true })
  const md = [
    '# v0.5.1 脱敏用例',
    '本机路径 C:\\Users\\Example\\secret.txt 结束',
    `api_key: ${V051_KEY}`,
    '普通链接 https://example.com/x 不动',
    '',
  ].join('\n')
  const json = `${JSON.stringify({
    name: 'v051',
    path: 'C:\\Users\\Example\\data\\x.txt',
    apiKey: V051_KEY,
    nested: { list: [1, 2, 3] },
  }, null, 2)}\n`
  const yaml = `model:\n  provider: deepseek-official\n  token: ${V051_KEY}\npath: C:\\Users\\Example\\data\n`
  const absOnly = '只有盘符 D:\\v051\\data\\x.txt 与 UNC \\\\host\\share\\v051\\y.txt\n'
  const unsafe = '含结构字符 C:\\data\\[x],y.txt 的路径\n'
  fs.writeFileSync(V051_MD, md)
  fs.writeFileSync(V051_JSON, json)
  fs.writeFileSync(V051_YAML, yaml)
  fs.writeFileSync(V051_ABS, absOnly)
  fs.writeFileSync(V051_UNSAFE, unsafe)
  return { md, json, yaml, absOnly, unsafe }
}

/** 直接从 zip 里读一个成员（不解包，避免临时目录残留） */
function readPackedFileSync(packPath, member) {
  const { buf, entries } = I.readZipFile(packPath)
  const e = entries.find((x) => x.name.replace(/^\.\//, '') === member)
  assert.ok(e, `包内应含 ${member}，实际：${entries.map((x) => x.name).join(', ')}`)
  return I.readEntryData(buf, e).toString('utf-8')
}

/** 发起 /create 并等作业到终态 */
async function createPackJob(body) {
  const r = await request('/create', { method: 'POST', body })
  assert.equal(r.status, 200, r.text)
  assert.match(r.data.jobId, /^job-/)
  const job = await waitJob(r.data.jobId)
  assert.equal(job.error, null, `作业失败：${JSON.stringify(job)}`)
  assert.ok(job.result?.pack, `作业结果里应有 pack：${JSON.stringify(job)}`)
  return job
}

test('§1 sanitize=true：包内路径/密钥替换成占位符，源文件一个字节都不动', async () => {
  const src = makeV051Fixtures()
  const job = await createPackJob({ modules: ['skills'], mode: 'migrate', sanitize: true })
  const pack = job.result.pack
  assert.equal(pack.sanitized, true)
  assert.ok(pack.redactions >= 3, `redactions 应是替换处数（实际 ${pack.redactions}）`)
  assert.ok(!job.result.warnings.some((w) => w.includes('凭据')), '清理后打包不该再报「含凭据」告警')

  const md = readPackedFileSync(pack.path, 'skills/v051/notes.md')
  // user-path 先命中 → 保留子路径；密钥只换值
  assert.match(md, /<用户目录>\\secret\.txt/, md)
  assert.ok(!md.includes('C:\\Users\\Example'), `包内不得残留用户目录：${md}`)
  assert.ok(md.includes('<已移除的密钥>'), md)
  assert.ok(!md.includes(V051_KEY), '包内不得残留密钥')
  assert.match(md, /普通链接 https:\/\/example\.com\/x 不动/, '未命中的内容必须原样保留')

  // ② 源文件一个字节都不许变
  assert.equal(fs.readFileSync(V051_MD, 'utf-8'), src.md)
  assert.equal(fs.readFileSync(V051_JSON, 'utf-8'), src.json)
  assert.equal(fs.readFileSync(V051_YAML, 'utf-8'), src.yaml)

  // ③ manifest 记录脱敏状态，且指纹按**脱敏后内容**重算 → info 顺带校验必须全过
  const manifest = JSON.parse(readPackedFileSync(pack.path, 'manifest.json'))
  assert.equal(manifest.sanitized, true)
  assert.equal(manifest.redactions, pack.redactions)
  const info = await request(`/packs/${encodeURIComponent(pack.name)}/info`)
  assert.equal(info.status, 200, info.text)
  assert.deepEqual(info.data.verify.failures, [], '脱敏后必须按新内容重算指纹，否则恢复会被 fail-closed 拒绝')
  assert.equal(info.data.manifest.sanitized, true)
  assert.equal(info.data.manifest.redactions, pack.redactions)
})

test('§1 sanitize=false：内容保真；含凭据且未加密 → warnings 非空；加密则不再告警', async () => {
  const src = makeV051Fixtures()
  const job = await createPackJob({ modules: ['skills'], mode: 'migrate', sanitize: false })
  const pack = job.result.pack
  assert.equal(pack.sanitized, false)
  assert.equal(pack.redactions, 0)
  assert.ok(Array.isArray(job.result.warnings) && job.result.warnings.length >= 1, '含凭据又没加密必须告警')
  assert.match(job.result.warnings.join('\n'), /包含 \d+ 处凭据且未加密/)
  // 保真：包内与源文件逐字节相同
  assert.equal(readPackedFileSync(pack.path, 'skills/v051/notes.md'), src.md)
  assert.equal(readPackedFileSync(pack.path, 'skills/v051/conf.json'), src.json)

  // 不传 sanitize 也默认保真（迁移模式默认不清理，契约 §1）
  const byDefault = await createPackJob({ modules: ['skills'], mode: 'migrate' })
  assert.equal(byDefault.result.pack.sanitized, false)
  assert.equal(byDefault.result.pack.redactions, 0)

  // 已加密 → 凭据由口令保护，不再告警
  const enc = await createPackJob({ modules: ['skills'], mode: 'migrate', encrypt: true, password: 'v051-pass!' })
  assert.deepEqual(enc.result.pack.warnings, [], '加密包不应再出现「含凭据且未加密」告警')
  assert.equal(enc.result.pack.sanitized, false, '加密不等于脱敏，两者各自独立')
})

test('§1 share 模式强制 sanitize（传 false 也按 true 处理），且分享绝不带插件本体', async () => {
  makeV051Fixtures()
  const job = await createPackJob({ modules: ['skills'], mode: 'share', sanitize: false })
  const pack = job.result.pack
  assert.equal(pack.sanitized, true, 'share 模式必须强制脱敏（契约 §1）')
  assert.ok(pack.redactions > 0)
  const md = readPackedFileSync(pack.path, 'skills/v051/notes.md')
  assert.ok(!md.includes('C:\\Users\\Example'), md)
  assert.ok(md.includes('<用户目录>'), md)

  // 插件本体 share=false → 服务端整单拒绝（不靠 UI 置灰）
  const blocked = await request('/create', { method: 'POST', body: { modules: ['plugins'], mode: 'share' } })
  assert.equal(blocked.status, 400, blocked.text)
  assert.equal(blocked.data.code, 'share_scope')
  assert.match(blocked.data.error, /plugins/)
})

test('§3 恢复回填：<用户目录>→home；<本机路径>/<UNC路径> 保留并计入 stats.warnings', async () => {
  makeV051Fixtures()
  const job = await createPackJob({ modules: ['skills'], mode: 'migrate', sanitize: true })
  const packPath = job.result.pack.path

  // 目标改脏，确保真的走写入分支
  fs.writeFileSync(V051_MD, 'dirty-before-restore\n')
  fs.writeFileSync(V051_ABS, 'dirty-before-restore\n')
  const r = await request('/restore/apply', {
    method: 'POST',
    body: { zip: packPath, strategy: 'overwrite', modules: ['skills'] },
  })
  assert.equal(r.status, 200, r.text)
  const stats = r.data.stats
  assert.ok(stats.backfilled >= 1, `应回填 <用户目录>：${JSON.stringify(stats.backfilled)}`)

  const md = fs.readFileSync(V051_MD, 'utf-8')
  assert.ok(md.includes(os.homedir()), `${os.homedir()} 应被回填进去：${md}`)
  assert.ok(!md.includes('<用户目录>'), '不应残留 <用户目录>')
  assert.ok(md.includes('<已移除的密钥>'), '密钥占位符无法猜回，必须保留')
  const abs = fs.readFileSync(V051_ABS, 'utf-8')
  assert.ok(abs.includes('<本机路径>'), '<本机路径> 无法自动回填，必须保留')
  assert.ok(abs.includes('<UNC路径>'), '<UNC路径> 无法自动回填，必须保留')
  const warnText = stats.warnings.join('\n')
  assert.match(warnText, /处占位符无法自动回填（<本机路径>）/, warnText)
  assert.match(warnText, /<UNC路径>/, warnText)

  // 回填后的内容 = 目标机上的应有内容 → 再次导入检查应判 same（不是一堆 changed）
  const imp = await request('/restore/import', { method: 'POST', body: { zip: packPath } })
  assert.equal(imp.status, 200, imp.text)
  const absStatus = imp.data.files.find((f) => f.module === 'skills' && f.rel === 'v051/abs-only.md')
  assert.equal(absStatus.status, 'same', JSON.stringify(imp.data.diff))
})

test('§2 /scan：每条 finding 都带固定枚举 kind', async () => {
  makeV051Fixtures()
  const r = await request('/scan', { method: 'POST', body: { modules: ['skills'], mode: 'migrate' } })
  assert.equal(r.status, 200, r.text)
  const allowed = new Set(I.PRIVACY_KINDS)
  assert.ok(r.data.privacy.length > 0)
  for (const f of r.data.privacy) assert.ok(allowed.has(f.kind), `kind 非法：${JSON.stringify(f)}`)
  const kindOf = new Map(r.data.privacy.map((f) => [f.pattern, f.kind]))
  assert.equal(kindOf.get('abs-path'), 'path')
  assert.equal(kindOf.get('user-path'), 'userpath')
  assert.equal(kindOf.get('unc-path'), 'unc')
  assert.equal(kindOf.get('credential'), 'credential')
  assert.equal(kindOf.get('key-shape'), 'key')
  assert.ok(r.data.privacy.some((f) => f.file === 'v051/notes.md' && f.kind === 'credential'))
})

test('§4 plugins 模块：只收 node_modules 一级包目录，排除 .pnpm/.bin/.cache/.modules.yaml，可打包可写回', async () => {
  const nm = path.join(fakeHome, 'profiles', 'v051profile', 'node_modules')
  fs.mkdirSync(path.join(nm, 'pkg-a'), { recursive: true })
  fs.writeFileSync(path.join(nm, 'pkg-a', 'index.js'), 'export const a = 1\n')
  fs.mkdirSync(path.join(nm, '@scope', 'pkg-b'), { recursive: true })
  fs.writeFileSync(path.join(nm, '@scope', 'pkg-b', 'package.json'), '{"name":"@scope/pkg-b"}\n')
  fs.writeFileSync(path.join(fakeHome, 'profiles', 'v051profile', 'settings.yaml'), 'profile-only: true\n')
  // 必须被排除的东西
  fs.mkdirSync(path.join(nm, '.pnpm', 'pkg-a@1.0.0', 'node_modules', 'pkg-a'), { recursive: true })
  fs.writeFileSync(path.join(nm, '.pnpm', 'pkg-a@1.0.0', 'node_modules', 'pkg-a', 'index.js'), 'store copy\n')
  fs.mkdirSync(path.join(nm, '.bin'), { recursive: true })
  fs.writeFileSync(path.join(nm, '.bin', 'a.cmd'), 'shim\n')
  fs.mkdirSync(path.join(nm, '.cache'), { recursive: true })
  fs.writeFileSync(path.join(nm, '.cache', 'c.json'), '{}\n')
  fs.writeFileSync(path.join(nm, '.modules.yaml'), 'hoistPattern: []\n')

  const rels = (await I.collectModuleFiles(I.MODULES.plugins)).map((f) => f.rel)
  assert.ok(rels.includes('v051profile/node_modules/pkg-a/index.js'), JSON.stringify(rels))
  assert.ok(rels.includes('v051profile/node_modules/@scope/pkg-b/package.json'), JSON.stringify(rels))
  assert.ok(!rels.some((r) => r.includes('.pnpm')), '不得收 pnpm 仓库')
  assert.ok(!rels.some((r) => r.includes('/.bin/')), '不得收 .bin')
  assert.ok(!rels.some((r) => r.includes('.cache')), '不得收缓存')
  assert.ok(!rels.some((r) => r.endsWith('.modules.yaml')), '不得收 .modules.yaml')
  assert.ok(!rels.includes('v051profile/settings.yaml'), '插件本体模块不含 profile 配置文本（那是 profiles 模块的事）')
  assert.equal(I.MODULES.plugins.default, true, '迁移默认带插件本体')
  assert.equal(I.MODULES.plugins.share, false, '分享绝不带插件本体')

  // /status 暴露 plugins 模块（bytes 照常显示）
  const st = await request('/status')
  assert.equal(st.status, 200, st.text)
  assert.ok(st.data.modules.plugins, '/status 必须有 plugins 模块')
  assert.ok(st.data.modules.plugins.count >= 2)
  assert.equal(st.data.modules.plugins.default, true)
  assert.equal(st.data.modules.plugins.share, false)

  // 打包 → 删目标 → 按同一相对路径写回
  const job = await createPackJob({ modules: ['plugins'], mode: 'migrate', sanitize: false })
  const packed = readPackedFileSync(job.result.pack.path, 'plugins/v051profile/node_modules/@scope/pkg-b/package.json')
  assert.match(packed, /@scope\/pkg-b/)
  fs.rmSync(path.join(nm, 'pkg-a'), { recursive: true, force: true })
  const r = await request('/restore/apply', {
    method: 'POST',
    body: { zip: job.result.pack.path, strategy: 'overwrite', modules: ['plugins'] },
  })
  assert.equal(r.status, 200, r.text)
  assert.ok(r.data.stats.added >= 1, JSON.stringify(r.data.stats))
  assert.equal(fs.readFileSync(path.join(nm, 'pkg-a', 'index.js'), 'utf-8'), 'export const a = 1\n')
})

test('§1 JSON/YAML 脱敏不破坏结构；含结构字符的命中跳过并告警（宁可不脱敏也不产出坏文件）', async () => {
  const src = makeV051Fixtures()
  const job = await createPackJob({ modules: ['skills'], mode: 'migrate', sanitize: true })
  const packPath = job.result.pack.path

  // JSON：仍可 parse；键名/引号/嵌套/行数不变，只有命中的字符串值被换掉
  const rawJson = readPackedFileSync(packPath, 'skills/v051/conf.json')
  const parsed = JSON.parse(rawJson) // 解析失败即证明脱敏破坏了结构
  assert.equal(parsed.name, 'v051')
  // 用户目录下的路径优先命中 user-path → 只换掉用户目录前缀，保留子路径（迁移到新机最省事）
  assert.equal(parsed.path, '<用户目录>\\data\\x.txt')
  assert.equal(parsed.apiKey, '<已移除的密钥>')
  assert.deepEqual(parsed.nested, { list: [1, 2, 3] })
  assert.ok(rawJson.includes('"path": "'), '键名与引号必须原样保留')
  assert.equal(rawJson.split('\n').length, src.json.split('\n').length, '行数必须不变')

  // YAML：行数/缩进/键名不变（Node 无内置 YAML 解析器，用结构不变量校验）
  const rawYaml = readPackedFileSync(packPath, 'skills/v051/conf.yaml')
  const yLines = rawYaml.split('\n')
  const srcLines = src.yaml.split('\n')
  assert.equal(yLines.length, srcLines.length, '行数必须不变')
  yLines.forEach((line, i) => {
    const indent = /^[ \t]*/.exec(line)[0]
    assert.equal(indent, /^[ \t]*/.exec(srcLines[i])[0], `第 ${i + 1} 行缩进被改动`)
    const key = /^[ \t]*([A-Za-z_][\w-]*):/.exec(srcLines[i])
    if (key) assert.ok(line.includes(`${key[1]}:`), `键名 ${key[1]} 必须保留`)
  })
  assert.ok(rawYaml.includes('provider: deepseek-official'), '未命中的值不动')
  assert.match(rawYaml, /<已移除的密钥>/)

  // 命中不跨过语法边界：路径里的 `[ ] ,` 属于「结构敏感字符」，替换在它们之前停住
  // （宁可少替换一段，也绝不把流式语法的括号/逗号吃掉）
  const unsafe = readPackedFileSync(packPath, 'skills/v051/unsafe.md')
  assert.ok(!unsafe.includes('C:\\data\\'), `盘符前缀必须被替换：${unsafe}`)
  assert.ok(unsafe.includes('<本机路径>[x],y.txt'), `结构字符必须原样留下：${unsafe}`)
})

test('§1 命中无法安全替换时：跳过该处、保住原文并记 warning（宁可不脱敏，不产出坏文件）', async () => {
  fs.mkdirSync(V051_DIR, { recursive: true })
  const personalMd = path.join(V051_DIR, 'personal.md')
  fs.writeFileSync(personalMd, '这里有 v051[secret] 字样\n')
  // 结构敏感字符出现在命中片段里（["]）→ 该处必须跳过而不是硬替换
  I.setPersonalPatterns([{ id: 'personal', label: '测试个人词', re: /v051\[secret\]/g }])
  try {
    const job = await createPackJob({ modules: ['skills'], mode: 'migrate', sanitize: true })
    const packed = readPackedFileSync(job.result.pack.path, 'skills/v051/personal.md')
    assert.equal(packed, '这里有 v051[secret] 字样\n', '无法安全替换的命中必须原样保留')
    assert.ok(job.result.warnings.some((w) => w.includes('已跳过 1 处脱敏')), JSON.stringify(job.result.warnings))
    // 源文件当然也没动
    assert.equal(fs.readFileSync(personalMd, 'utf-8'), '这里有 v051[secret] 字样\n')
  } finally {
    I.setPersonalPatterns([])
  }
})

