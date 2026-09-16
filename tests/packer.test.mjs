// dsh-packer 单元测试（node:test）——全部隔离在临时目录，不触碰真实 ~/.dsh
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// 隔离环境：DSH_HOME / PACKS_DIR / DSH_MEMORY_ROOT 全部指向临时目录
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packer-test-'))
const fakeHome = path.join(tmpRoot, 'home')
const fakePacks = path.join(tmpRoot, 'packs')
const fakeMemory = path.join(tmpRoot, 'memory')
process.env.DSH_HOME = fakeHome
process.env.DSH_PACKS_DIR = fakePacks
process.env.DSH_MEMORY_ROOT = fakeMemory

// 构造假资产
function makeAssets() {
  // skills
  fs.mkdirSync(path.join(fakeHome, 'skills', 'memory'), { recursive: true })
  fs.mkdirSync(path.join(fakeHome, 'skills', 'pet'), { recursive: true })
  fs.mkdirSync(path.join(fakeHome, 'skills', '_shared'), { recursive: true })
  fs.writeFileSync(path.join(fakeHome, 'skills', 'memory', 'SKILL.md'), '# memory skill\n本地路径示例 C:\\Users\\Example\\foo\n')
  fs.writeFileSync(path.join(fakeHome, 'skills', 'pet', 'SKILL.md'), '# pet skill\nplayful notes\n')
  fs.writeFileSync(path.join(fakeHome, 'skills', '_shared', 'common.md'), '# shared helpers\n')
  // sessions
  fs.mkdirSync(path.join(fakeHome, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(fakeHome, 'sessions', 's1.zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]))
  // settings
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  // presets
  fs.mkdirSync(path.join(fakeHome, '.agent-presets', 'p1'), { recursive: true })
  fs.writeFileSync(path.join(fakeHome, '.agent-presets', 'p1', 'preset.yml'), 'enabled: true\n')
  // memory 数据
  fs.mkdirSync(path.join(fakeMemory, 'hot'), { recursive: true })
  fs.writeFileSync(path.join(fakeMemory, 'hot', 'knowledge.md'), '- [知识] 测试记忆\n')
  // 凭据（永不打包）
  fs.writeFileSync(path.join(fakeHome, '.credentials.yaml'), 'api_key: sk-1234567890abcdef\n')
}

let I
let mod

before(async () => {
  makeAssets()
  mod = await import(new URL('../index.mjs', import.meta.url).href)
  I = mod.__internals
})

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

// 说明：v0.3.0 起对外 API 全链路异步（返回 Promise），本文件所有调用点都 await 后再断言，
// 断言强度与原同步版本一致（原来期望 throw 的，现在用 assert.rejects 期望 reject）。

test('模块文件收集：skills 含全部子目录', async () => {
  const files = await I.collectModuleFiles(I.MODULES.skills)
  const rels = files.map((f) => f.rel)
  assert.ok(rels.includes('memory/SKILL.md'))
  assert.ok(rels.includes('pet/SKILL.md'))
})

test('凭据文件永不打包', async () => {
  for (const key of ['skills', 'sessions', 'profiles', 'settings', 'presets', 'memory']) {
    const files = await I.collectModuleFiles(I.MODULES[key])
    for (const f of files) {
      assert.ok(!f.rel.includes('.credentials'), `不应包含凭据: ${f.rel}`)
      assert.ok(!f.rel.includes('.anonymous-user-id'))
    }
  }
})

test('settings 模块只收集 settings.yaml', async () => {
  const files = await I.collectModuleFiles(I.MODULES.settings)
  assert.equal(files.length, 1)
  assert.equal(files[0].rel, 'settings.yaml')
})

test('sessions 模块收集 .zstd 二进制', async () => {
  const files = await I.collectModuleFiles(I.MODULES.sessions)
  assert.equal(files.length, 1)
  assert.ok(files[0].rel.endsWith('.zstd'))
})

test('记忆数据模块收集 hot 内容且跳过 backups', async () => {
  const files = await I.collectModuleFiles(I.MODULES.memory)
  const rels = files.map((f) => f.rel)
  assert.ok(rels.includes('hot/knowledge.md'))
  assert.ok(!rels.some((r) => r.startsWith('backups/')))
})

test('隐私扫描：检测本地路径/用户名/密钥', async () => {
  const files = []
  for (const k of ['skills', 'settings']) {
    for (const f of await I.collectModuleFiles(I.MODULES[k])) files.push(f)
  }
  const findings = await I.privacyScan(files)
  // skills/memory/SKILL.md 含 C:\Users\Example\foo → abs-path + user-path
  assert.ok(findings.some((f) => f.file === 'memory/SKILL.md' && f.pattern === 'abs-path'))
  assert.ok(findings.some((f) => f.file === 'memory/SKILL.md' && f.pattern === 'user-path'))
  // .credentials.yaml 不应被扫描到（因为不被收集）
  assert.ok(!findings.some((f) => f.file.includes('.credentials')))
})

test('隐私扫描：二进制文件跳过', async () => {
  const files = await I.collectModuleFiles(I.MODULES.sessions)
  const findings = await I.privacyScan(files)
  assert.equal(findings.length, 0, '二进制会话文件不应触发扫描')
})

test('createPack：迁移模式打包成功且含 manifest', async () => {
  const r = await I.createPack({ modules: ['skills', 'settings'], mode: 'migrate', note: '测试包' })
  assert.equal(r.ok, true)
  assert.equal(r.pack.mode, 'migrate')
  assert.equal(r.pack.note, '测试包')
  assert.ok(r.pack.name.endsWith('.zip'))
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  assert.ok(fs.existsSync(zipPath))
  // 校验 zip 内容
  const { manifest } = await I.readManifestFromZip(zipPath)
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.note, '测试包')
  assert.ok(manifest.files.some((f) => f.rel === 'memory/SKILL.md'))
  assert.ok(manifest.files.some((f) => f.rel === 'settings.yaml'))
})

test('createPack：分享模式拦截隐私内容', async () => {
  // skills 含 pet/SKILL.md（个人敏感词示例）→ 分享模式应抛错
  await assert.rejects(async () => I.createPack({ modules: ['skills'], mode: 'share' }), /隐私扫描发现/)
})

test('createPack：分享模式排除默认排除项（_shared）', async () => {
  const files = await I.collectModuleFiles(I.MODULES.skills, true)
  const rels = files.map((f) => f.rel)
  assert.ok(!rels.includes('_shared/common.md'), '分享模式应排除 _shared')
  assert.ok(rels.includes('pet/SKILL.md'), '普通 skill 正常收集')
})

test('createPack：dry-run 不生成文件', async () => {
  const packsDir = I.PACKS_DIR
  const before = fs.existsSync(packsDir) ? fs.readdirSync(packsDir).length : 0
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate', dryRun: true })
  assert.equal(r.dryRun, true)
  assert.ok(r.manifest.files.length >= 1)
  const after = fs.existsSync(packsDir) ? fs.readdirSync(packsDir).length : 0
  assert.equal(after, before)
})

test('createPack：未知模块报错、空模块报错', async () => {
  await assert.rejects(async () => I.createPack({ modules: ['nope'] }), /未知模块/)
  await assert.rejects(async () => I.createPack({ modules: [] }), /未选择任何模块/)
})

test('包管理：list / delete / rename', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate', note: '管理测试' })
  // list
  const packs = await I.listPacks()
  assert.ok(packs.some((p) => p.name === r.pack.name))
  // rename
  const newName = 'renamed-' + r.pack.name
  const rr = await I.renamePack(r.pack.name, newName)
  assert.equal(rr.ok, true)
  assert.ok(fs.existsSync(path.join(I.PACKS_DIR, newName)))
  // delete
  const d = await I.deletePack(newName)
  assert.equal(d.ok, true)
  assert.ok(!fs.existsSync(path.join(I.PACKS_DIR, newName)))
})

test('恢复：diffRestore 正确分类 added/changed/same', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = await I.readManifestFromZip(zipPath)
  // 目标已存在且相同（刚打包的就是源文件）→ same
  let diff = await I.diffRestore(manifest)
  assert.ok(diff.same.length >= 1)
  assert.equal(diff.added.length, 0)
  // 改掉目标内容 → changed
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'changed: true\n')
  diff = await I.diffRestore(manifest)
  assert.ok(diff.changed.length >= 1)
  // 恢复源文件，避免污染后续用例（createPack 打包的是当前内容）
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：applyRestore 覆盖策略', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = await I.readManifestFromZip(zipPath)
  manifest._dir = dir
  // 破坏目标 → 覆盖恢复
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'broken\n')
  await I.applyRestore(manifest, { strategy: 'overwrite' })
  const restored = fs.readFileSync(path.join(fakeHome, 'settings.yaml'), 'utf-8')
  assert.ok(restored.includes('agent-default-model'), '应恢复为打包内容')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：applyRestore skip 策略不改已存在文件', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = await I.readManifestFromZip(zipPath)
  manifest._dir = dir
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'keep-me\n')
  const stats = await I.applyRestore(manifest, { strategy: 'skip' })
  assert.equal(stats.skipped, 1)
  const after = fs.readFileSync(path.join(fakeHome, 'settings.yaml'), 'utf-8')
  assert.equal(after, 'keep-me\n')
  // 恢复源文件，避免污染后续用例
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：applyRestore merge 策略追加不覆盖（文本文件）', async () => {
  const r = await I.createPack({ modules: ['skills'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = await I.readManifestFromZip(zipPath)
  manifest._dir = dir
  fs.writeFileSync(path.join(fakeHome, 'skills', 'memory', 'SKILL.md'), 'original\n')
  const stats = await I.applyRestore(manifest, { strategy: 'merge' })
  assert.equal(stats.merged, 1)
  const after = fs.readFileSync(path.join(fakeHome, 'skills', 'memory', 'SKILL.md'), 'utf-8')
  assert.ok(after.includes('original'))
  assert.ok(after.includes('memory skill'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：结构化配置（YAML/JSON）拒绝 append merge（fail-closed）', async () => {
  const r = await I.createPack({ modules: ['settings', 'presets'], mode: 'migrate' })
  const { manifest, dir } = await I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  // 先修改目标文件使其内容 ≠ 包内（否则 sha 相同直接 skipped，不会走到 merge）
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: local\n')
  fs.writeFileSync(path.join(fakeHome, '.agent-presets', 'p1', 'preset.yml'), 'enabled: false\n')
  const stats = await I.applyRestore(manifest, { strategy: 'merge' })
  assert.equal(stats.merged, 0)
  assert.ok(stats.failed >= 1)
  assert.ok(stats.failures.some((f) => /结构化|append merge/.test(f.error)))
  // 恢复原内容，避免污染后续用例
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  fs.writeFileSync(path.join(fakeHome, '.agent-presets', 'p1', 'preset.yml'), 'enabled: true\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：非 packer 包报错', async () => {
  const fake = path.join(tmpRoot, 'fake.zip')
  fs.writeFileSync(fake, 'not a zip')
  await assert.rejects(async () => I.readManifestFromZip(fake))
})

test('恢复：源文件被篡改 → 完整性校验失败并拒绝（fail-closed）', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const { manifest, dir } = await I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  // 篡改解压目录内的源文件（模拟包内容在解压后被替换/污染）
  fs.writeFileSync(path.join(dir, 'settings', 'settings.yaml'), 'tampered: true\n')
  const stats = await I.applyRestore(manifest, { strategy: 'overwrite' })
  assert.equal(stats.added, 0)
  assert.equal(stats.failed, 1)
  assert.ok(/完整性|fail-closed/.test(stats.failures[0].error))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：清单 rel 越界（../../）被 containment 拒绝', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const { manifest, dir } = await I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  const evil = { ...manifest, files: [{ module: 'settings', rel: '../../escape.txt', sha256: manifest.files[0].sha256 }] }
  const stats = await I.applyRestore(evil, { strategy: 'overwrite' })
  assert.equal(stats.failed, 1)
  assert.ok(/越界/.test(stats.failures[0].error))
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'escape.txt')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('pathContained：目录内通过、目录外拒绝', () => {
  const base = path.join(tmpRoot, 'stage')
  assert.ok(I.pathContained(base, path.join(base, 'a', 'b.txt')))
  assert.ok(I.pathContained(base, base))
  assert.ok(!I.pathContained(base, path.join(tmpRoot, 'other.txt')))
  assert.ok(!I.pathContained(base, path.join(base, '..', '..', 'escape.txt')))
})

test('隐私扫描：部署者个人规则生效（合并后循环新数组）', async () => {
  I.setPersonalPatterns([{ id: 'nick', label: '个人昵称', re: '大肥鱼' }])
  try {
    const f = path.join(tmpRoot, 'nick.txt')
    fs.writeFileSync(f, '我是大肥鱼，今天也是努力的一天\n')
    const hits = await I.privacyScan([{ rel: 'nick.txt', abs: f }])
    assert.ok(hits.some((x) => x.pattern === 'nick' && x.label === '个人昵称'))
    assert.equal(hits.length, 1) // 只命中个人规则（通用规则未命中该文本）
    // 控制组：不含个人词 → 零发现
    const clean = path.join(tmpRoot, 'clean.txt')
    fs.writeFileSync(clean, '普通文本\n')
    assert.equal((await I.privacyScan([{ rel: 'clean.txt', abs: clean }])).length, 0)
  } finally {
    I.setPersonalPatterns([])
  }
})

test('清单指纹：sha256 稳定', async () => {
  const p = path.join(fakeHome, 'settings.yaml')
  const a = await I.sha256(p)
  const b = await I.sha256(p)
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

// ============================================================================
// v0.2.3 安全加固：目标路径 containment / 指纹 fail-closed / 备份回滚 / 解包白名单
// ============================================================================

test('sha256：文件不存在必须抛错（绝不返回空串，否则完整性校验被静默跳过）', async () => {
  await assert.rejects(async () => I.sha256(path.join(tmpRoot, 'no-such-file.bin')))
  assert.equal(I.isValidSha256(''), false)
  assert.equal(I.isValidSha256('not-a-hash'), false)
  assert.equal(I.isValidSha256('a'.repeat(64)), true)
})

test('路径白名单：绝对路径 / 盘符 / UNC / .. 片段一律拒绝', () => {
  for (const bad of ['/etc/passwd', 'C:\\Windows\\x.txt', 'C:/Windows/x.txt', 'C:x.txt', '\\\\server\\share\\x', '//server/share/x', '..', '../x', 'a/../../x', 'a//b', 'memory/']) {
    assert.throws(() => I.assertSafeRel(bad), /越界|非法/, `应拒绝: ${bad}`)
  }
  for (const ok of ['settings.yaml', 'memory/SKILL.md', 'a/b/c.txt', '.env']) {
    assert.equal(I.assertSafeRel(ok), ok)
  }
})

test('恢复：目标路径越界（../ 逃出模块根）被拒绝且不写盘', async () => {
  const r = await I.createPack({ modules: ['skills'], mode: 'migrate' })
  const { manifest, dir } = await I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  const sha = manifest.files.find((f) => f.rel === 'memory/SKILL.md').sha256
  // rel 合法时源侧也在解压目录内，但目标会落到 HOME 根（模块根之外）→ 必须拒绝
  const evil = { ...manifest, files: [{ module: 'skills', rel: '../escape-target.txt', sha256: sha }] }
  const stats = await I.applyRestore(evil, { strategy: 'overwrite' })
  assert.equal(stats.failed, 1)
  assert.ok(/越界/.test(stats.failures[0].error))
  assert.ok(!fs.existsSync(path.join(fakeHome, 'escape-target.txt')), '不得写出模块目标根之外')
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'escape-target.txt')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：清单缺 / 非法 SHA-256 指纹一律 fail-closed 拒绝（不复制）', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const { manifest, dir } = await I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'untouched-marker\n')
  for (const bad of [undefined, null, '', 'not-a-hash', 'abc123']) {
    const evil = { ...manifest, files: [{ module: 'settings', rel: 'settings.yaml', sha256: bad }] }
    const stats = await I.applyRestore(evil, { strategy: 'overwrite' })
    assert.equal(stats.failed, 1, `sha256=${String(bad)} 必须被拒绝`)
    assert.equal(stats.overwritten, 0)
    assert.equal(stats.added, 0)
    assert.ok(/指纹|fail-closed/.test(stats.failures[0].error))
    assert.equal(
      fs.readFileSync(path.join(fakeHome, 'settings.yaml'), 'utf-8'),
      'untouched-marker\n',
      '目标文件不得被改动',
    )
  }
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：中途失败即中止，并按记录回滚已新增/已覆盖的文件', async () => {
  const r = await I.createPack({ modules: ['skills'], mode: 'migrate' })
  const { manifest, dir } = await I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  const byRel = new Map(manifest.files.map((f) => [f.rel, f]))
  // 第一个：目标不存在 → 新增；第二个：目标存在且不同 → 覆盖（先备份）；第三个：缺指纹 → 中止
  fs.rmSync(path.join(fakeHome, 'skills', '_shared', 'common.md'), { force: true })
  fs.writeFileSync(path.join(fakeHome, 'skills', 'pet', 'SKILL.md'), 'rolled-back-original\n')
  const evil = {
    ...manifest,
    files: [
      { module: 'skills', rel: '_shared/common.md', sha256: byRel.get('_shared/common.md').sha256 },
      { module: 'skills', rel: 'pet/SKILL.md', sha256: byRel.get('pet/SKILL.md').sha256 },
      { module: 'skills', rel: 'memory/SKILL.md', sha256: 'broken' },
    ],
  }
  const stats = await I.applyRestore(evil, { strategy: 'overwrite' })
  assert.equal(stats.aborted, true)
  assert.equal(stats.failed, 1)
  assert.equal(stats.added, 0, '新增计数应随回滚归零')
  assert.equal(stats.overwritten, 0, '覆盖计数应随回滚归零')
  assert.equal(stats.rolledBack, 2)
  assert.ok(!fs.existsSync(path.join(fakeHome, 'skills', '_shared', 'common.md')), '新增文件必须被回滚删除')
  assert.equal(
    fs.readFileSync(path.join(fakeHome, 'skills', 'pet', 'SKILL.md'), 'utf-8'),
    'rolled-back-original\n',
    '被覆盖文件必须由备份还原',
  )
  assert.ok(stats.backupDir && fs.existsSync(stats.backupDir), '恢复前必须留下备份')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('SQLite 数据库：默认不打包、默认不恢复', async () => {
  fs.writeFileSync(path.join(fakeMemory, 'biomemory.db'), 'SQLite format 3\u0000')
  const rels = (await I.collectModuleFiles(I.MODULES.memory)).map((f) => f.rel)
  assert.ok(!rels.some((x) => /\.db/.test(x)), '内存模块不得收集 SQLite 库')

  const r = await I.createPack({ modules: ['skills'], mode: 'migrate' })
  const { manifest, dir } = await I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  const stats = await I.applyRestore(
    { ...manifest, files: [{ module: 'memory', rel: 'biomemory.db', sha256: manifest.files[0].sha256 }] },
    { strategy: 'overwrite' },
  )
  assert.equal(stats.skipped, 1)
  assert.equal(stats.excluded.length, 1)
  assert.equal(stats.failed, 0)
  assert.equal(fs.readFileSync(path.join(fakeMemory, 'biomemory.db'), 'utf-8'), 'SQLite format 3\u0000')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('打包文件名：同一秒内两次打包不互相覆盖', async () => {
  const a = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const b = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  assert.notEqual(a.pack.name, b.pack.name)
  assert.ok(fs.existsSync(path.join(I.PACKS_DIR, a.pack.name)))
  assert.ok(fs.existsSync(path.join(I.PACKS_DIR, b.pack.name)))
})

/** 最小 STORED zip 写入器：用于构造"成员名越界"的恶意包做解包白名单测试 */
function makeZip(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf-8')
    const data = Buffer.from(e.data ?? '', 'utf-8')
    const crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(0, 38) // external attrs：普通文件
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += local.length + name.length + data.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cdBuf, eocd])
}

test('解包：合法包通过成员白名单校验', async () => {
  const r = await I.createPack({ modules: ['settings'], mode: 'migrate' })
  const names = await I.validateArchiveMembers(path.join(I.PACKS_DIR, r.pack.name))
  assert.ok(names.some((n) => n.replace(/^\.\//, '') === 'manifest.json'))
})

test('解包：成员名越界（../ 或绝对路径）被白名单拒绝且不解压', async () => {
  for (const bad of ['../escape-via-zip.txt', 'sub/../../escape-via-zip.txt']) {
    const evil = path.join(tmpRoot, `evil-${bad.replace(/[^a-z]/gi, '_')}.zip`)
    fs.writeFileSync(evil, makeZip([{ name: bad, data: 'pwned' }]))
    await assert.rejects(async () => I.validateArchiveMembers(evil), /越界|非法|成员/)
    await assert.rejects(async () => I.extractZip(evil), /越界|非法|成员/)
    assert.ok(!fs.existsSync(path.join(tmpRoot, 'escape-via-zip.txt')), '不得解压到包外')
  }
})

test('解包：符号链接成员被类型白名单拒绝（防链接逃逸）', async () => {
  const stage = path.join(tmpRoot, 'link-stage')
  fs.mkdirSync(stage, { recursive: true })
  fs.writeFileSync(path.join(stage, 'ok.txt'), 'ok\n')
  try {
    fs.symlinkSync('../../outside-secret', path.join(stage, 'escape-link'), 'file')
  } catch {
    return // 本机不允许建符号链接（无权限）→ 跳过该断言
  }
  const tarPath = path.join(tmpRoot, 'with-link.tar')
  execFileSync('tar', ['-cf', tarPath, '-C', stage, '.'])
  await assert.rejects(async () => I.validateArchiveMembers(tarPath), /成员类型|fail-closed/)
})

test('解包：解压结果出现符号链接即拒绝（第二层检查）', async () => {
  const out = path.join(tmpRoot, 'link-out')
  fs.mkdirSync(out, { recursive: true })
  try {
    fs.symlinkSync('../../outside-secret', path.join(out, 'l'), 'file')
  } catch {
    return
  }
  await assert.rejects(async () => I.assertNoLinkEntries(out), /符号链接/)
})

test('隐私扫描：Unix / UNC 路径、无引号密钥、密钥形状、.env 文件都被识别', async () => {
  const p = path.join(tmpRoot, 'privacy-probe.txt')
  fs.writeFileSync(p, [
    'unix: /home/alice/.config/dsh/settings.yaml',
    'unc: \\\\fileserver\\share\\secrets.txt',
    'unquoted: api_key=abcdef1234567890',
    'shape: sk-abcdefghijklmnopqrstuvwxyz0123',
    'aws: AKIAIOSFODNN7EXAMPLE',
    'jwt: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    '',
  ].join('\n'))
  const ids = new Set((await I.privacyScan([{ rel: 'privacy-probe.txt', abs: p }])).map((h) => h.pattern))
  for (const id of ['unix-path', 'unc-path', 'credential', 'key-shape']) {
    assert.ok(ids.has(id), `应命中规则 ${id}（实际：${[...ids].join(',')}）`)
  }
  // 无扩展名的点文件（.env）必须纳入扫描
  const env = path.join(tmpRoot, '.env')
  fs.writeFileSync(env, 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx\n')
  const envHits = await I.privacyScan([{ rel: '.env', abs: env }])
  assert.ok(envHits.length >= 1, '.env 必须被扫描')
  // 二进制仍跳过
  const bin = path.join(tmpRoot, 'blob.dat')
  fs.writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]))
  assert.equal((await I.privacyScan([{ rel: 'blob.dat', abs: bin }])).length, 0)
})

test('隐私扫描：同一行多处命中全量计数（不再每规则只算 1 次）', async () => {
  const p = path.join(tmpRoot, 'multi-hit.txt')
  fs.writeFileSync(p, 'D:\\a\\one.txt 与 D:\\a\\two.txt 以及 D:\\a\\three.txt\n')
  const hits = (await I.privacyScan([{ rel: 'multi-hit.txt', abs: p }])).filter((h) => h.pattern === 'abs-path')
  assert.equal(hits.length, 1, '同一行聚合为一条')
  assert.equal(hits[0].count, 3)
  assert.equal(I.countFindings(hits), 3)
})

// ============================================================================
// v0.2.4 /packer/api/* 防护：限流（最外层）/ 鉴权 fail-closed / 体积上限 / 令牌回退 / 路由接线
// ============================================================================

// 模拟官方 dsh-client-connection 的两种姿态：放行（undefined）与拒绝（401 / 403）
const OPEN_CONNECTION = { requestRejection: () => undefined }
const DENY_403 = { requestRejection: () => 403 }

/** 起一个真 HTTP 服务，handler 就是插件挂到 webServer 上的那一个（connection 省略 = 宿主没有该服务） */
function startApi(guardOptions = {}, connection) {
  const guard = I.createPackApiGuard(guardOptions)
  const handler = I.createPackApiHandler({ guard, getConnection: () => connection })
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.statusCode = 500
      res.end(String(error?.message || error))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        guard,
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

/** 原生请求：Host / Origin / Sec-Fetch-Site 都能精确控制（fetch 不允许改 Host） */
function rawRequest(port, { method = 'GET', path: p = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let answered = false
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        answered = true
        resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf-8') })
      })
    })
    // 服务端拒绝带着未读请求体的请求时会回完就断：响应已到手就不算失败
    req.on('error', (error) => { if (!answered) reject(error) })
    if (body !== null) req.write(body)
    req.end()
  })
}

const json = (r) => JSON.parse(r.text)

test('Web API：宿主没有可用鉴权服务时默认 fail-closed 403（绝不静默放行）', async () => {
  const variants = [
    undefined,
    {},
    { requestRejection: 'not-a-function' },
    { requestRejection: () => { throw new Error('宿主鉴权层炸了') } },
  ]
  for (const connection of variants) {
    const api = await startApi({}, connection)
    try {
      const r = await rawRequest(api.port, { path: '/packer/api/status' })
      assert.equal(r.status, 403, `connection=${JSON.stringify(Object.keys(connection || {}))} 必须 403`)
      assert.equal(json(r).code, 'forbidden')
      assert.match(json(r).error, /fail-closed|鉴权服务/)
    } finally {
      await api.close()
    }
  }
})

test('Web API：默认走官方 connection.requestRejection（401/403 透传，undefined 放行）', async () => {
  for (const [connection, expected] of [[{ requestRejection: () => 401 }, 401], [DENY_403, 403], [OPEN_CONNECTION, 200]]) {
    const api = await startApi({}, connection)
    try {
      const r = await rawRequest(api.port, { path: '/packer/api/status' })
      assert.equal(r.status, expected)
      if (expected === 200) {
        assert.equal(r.headers['cache-control'], 'no-store', 'API 响应不得被缓存')
        assert.equal(json(r).ok, true)
      } else {
        assert.equal(json(r).ok, false)
      }
    } finally {
      await api.close()
    }
  }
})

test('Web API：触发速率限制返回 429（带 retry-after），限流先于鉴权判定', async () => {
  const api = await startApi({ rateLimit: 2, rateWindowMs: 60_000 }, OPEN_CONNECTION)
  try {
    assert.equal((await rawRequest(api.port, { path: '/packer/api/status' })).status, 200)
    assert.equal((await rawRequest(api.port, { path: '/packer/api/status' })).status, 200)
    const r = await rawRequest(api.port, { path: '/packer/api/status' })
    assert.equal(r.status, 429)
    assert.equal(json(r).code, 'rate_limited')
    assert.ok(Number(r.headers['retry-after']) >= 1, '429 必须给 retry-after')
    assert.match(json(r).error, /请求过于频繁/)
  } finally {
    await api.close()
  }

  // 未授权流量同样吃配额：第 1 次 403（鉴权拒绝），第 2 次 429（限流在最外层）
  const denied = await startApi({ rateLimit: 1 }, undefined)
  try {
    assert.equal((await rawRequest(denied.port, { path: '/packer/api/status' })).status, 403)
    assert.equal((await rawRequest(denied.port, { path: '/packer/api/status' })).status, 429)
  } finally {
    await denied.close()
  }

  // 限流键有上界（无定时器、内存有界）：狂造客户端键也不会无限增长
  const guard = I.createPackApiGuard({ rateLimit: 5 })
  for (let i = 0; i < 5000; i++) guard.consume(`k${i}`)
  assert.ok(guard.trackedKeys() <= 4096, `限流键必须有上界，实际 ${guard.trackedKeys()}`)
})

test('Web API：authMode "token"（显式 opt-in）—— 同源 + 一次性令牌才放行', async () => {
  const api = await startApi({ authMode: 'token' }, undefined) // token 模式不依赖 connection
  const token = api.guard.token
  const host = `127.0.0.1:${api.port}`
  const hdr = (extra) => ({ host, ...extra })
  try {
    const noToken = await rawRequest(api.port, { path: '/packer/api/status', headers: hdr() })
    assert.equal(noToken.status, 401, '缺令牌必须 401')
    assert.equal(json(noToken).code, 'unauthorized')

    const wrong = await rawRequest(api.port, { path: '/packer/api/status', headers: hdr({ 'x-dsh-packer-token': 'x'.repeat(token.length) }) })
    assert.equal(wrong.status, 401, '令牌错误必须 401')

    const ok = await rawRequest(api.port, { path: '/packer/api/status', headers: hdr({ 'x-dsh-packer-token': token }) })
    assert.equal(ok.status, 200, '同源 + 正确令牌放行')
    assert.equal(json(ok).ok, true)

    const crossSite = await rawRequest(api.port, { path: '/packer/api/status', headers: hdr({ 'x-dsh-packer-token': token, 'sec-fetch-site': 'cross-site' }) })
    assert.equal(crossSite.status, 403, '跨站请求即使带令牌也拒绝')

    const badOrigin = await rawRequest(api.port, { path: '/packer/api/status', headers: hdr({ 'x-dsh-packer-token': token, origin: 'http://evil.example' }) })
    assert.equal(badOrigin.status, 403, 'Origin 非本机必须拒绝')

    const sameOrigin = await rawRequest(api.port, { path: '/packer/api/status', headers: hdr({ 'x-dsh-packer-token': token, origin: `http://${host}` }) })
    assert.equal(sameOrigin.status, 200, '同源 Origin 放行')

    // 缺 Host：浏览器不会这么发，但请求可能被人为构造 —— 无法确认来源就必须拒绝。
    // node:http 客户端会自动补 Host（连空串都会被替换），所以这一条在 guard 层直接断言。
    const noHost = api.guard.authorize({ headers: {} }, undefined)
    assert.equal(noHost?.status, 403, '缺 Host 无法确认来源，必须拒绝')
    assert.match(noHost.message, /Host/)
  } finally {
    await api.close()
  }
})

test('Web API：请求体超限 → 413（声明的 Content-Length 直接拒，不读一个字节）', async () => {
  const api = await startApi({ maxBodyBytes: 1024 }, OPEN_CONNECTION)
  try {
    const body = Buffer.alloc(4096, 0x61)
    const r = await rawRequest(api.port, {
      method: 'POST',
      path: '/packer/api/scan',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      body,
    })
    assert.equal(r.status, 413)
    const payload = json(r)
    assert.equal(payload.code, 'payload_too_large')
    assert.match(payload.error, /上限 1024 字节/)
    assert.match(payload.error, /未读取任何字节/)
  } finally {
    await api.close()
  }
})

test('Web API：无 Content-Length 时边读边判，一超限立刻中断并 413', async () => {
  const api = await startApi({ maxBodyBytes: 1024 }, OPEN_CONNECTION)
  try {
    const r = await rawRequest(api.port, {
      method: 'POST',
      path: '/packer/api/scan',
      headers: { 'content-type': 'application/json' },
      body: Buffer.alloc(4096, 0x61),
    })
    assert.equal(r.status, 413)
    assert.equal(json(r).code, 'payload_too_large')
    assert.match(json(r).error, /读取已中断/)
  } finally {
    await api.close()
  }
})

test('Web API：readBody 在读完请求体之前就判定超限（不完整缓冲进内存）', async () => {
  const guard = I.createPackApiGuard({ maxBodyBytes: 100, authMode: 'off' })
  // 有 Content-Length：一个字节都不读
  const declared = Readable.from([Buffer.alloc(5000)])
  declared.headers = { 'content-length': '5000' }
  await assert.rejects(
    async () => guard.readBody(declared),
    (err) => err.status === 413 && /未读取任何字节/.test(err.message),
  )
  declared.destroy()
  // 无长度声明：边读边累计，超限立刻停止消费
  const streamed = Readable.from([Buffer.alloc(80), Buffer.alloc(80), Buffer.alloc(80)])
  streamed.headers = {}
  await assert.rejects(
    async () => guard.readBody(streamed),
    (err) => err.status === 413 && /读取已中断/.test(err.message),
  )
})

test('Web API：未知接口 404；错误文案不泄露服务端绝对路径', async () => {
  const api = await startApi({}, OPEN_CONNECTION)
  try {
    const unknown = await rawRequest(api.port, { path: '/packer/api/nope' })
    assert.equal(unknown.status, 404)
    assert.equal(json(unknown).code, 'not_found')

    const zip = path.join(tmpRoot, 'definitely-missing.zip')
    const r = await rawRequest(api.port, {
      method: 'POST',
      path: '/packer/api/restore/import',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zip }),
    })
    assert.equal(r.status, 500)
    const payload = json(r)
    assert.ok(!payload.error.includes(zip), `不得回显绝对路径：${payload.error}`)
    assert.ok(!/[A-Za-z]:[\\/]/.test(payload.error), `不得出现盘符路径：${payload.error}`)
    assert.match(payload.error, /路径已隐去/)

    const badJson = await rawRequest(api.port, {
      method: 'POST',
      path: '/packer/api/scan',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    })
    assert.equal(badJson.status, 400)
    assert.equal(json(badJson).code, 'bad_request')
  } finally {
    await api.close()
  }
})

test('redactPaths：抹掉盘符 / UNC / Unix 用户目录路径，普通文案不动', () => {
  assert.equal(I.redactPaths('文件不存在: E:\\DE\\projects\\x\\y.zip'), '文件不存在: <路径已隐去>')
  assert.equal(I.redactPaths('读不到 /home/alice/.dsh/settings.yaml'), '读不到 <路径已隐去>')
  assert.equal(I.redactPaths('UNC \\\\server\\share\\a.txt 不可读'), 'UNC <路径已隐去> 不可读')
  assert.equal(I.redactPaths('未知模块: skills（未选择任何模块）'), '未知模块: skills（未选择任何模块）')
})

test('apply(ctx)：handler 真的挂到 webServer（kind=prefix / path=/packer/api），token 模式才注入令牌', async () => {
  const makeCtx = () => {
    const registrations = []
    const taps = []
    const effects = []
    const services = {}
    const ctx = {
      get: (name) => services[name],
      inject: (names, cb) => { cb(ctx) },
      effect: (fn, label) => { effects.push(label); return fn() },
      commands: { register: () => {} },
      webServer: {
        register: (opts) => { registrations.push(opts); return () => {} },
        tapIndex: (fn) => { taps.push(fn); return () => {} },
      },
    }
    return { ctx, registrations, taps, effects, services }
  }
  const fakeRes = () => ({
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v },
    end(b) { this.body = String(b) },
  })
  const fakeReq = () => ({
    method: 'GET',
    url: '/packer/api/status',
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  })

  // 默认 'auto'：挂路由、不注入令牌；handler 现取 ctx.get('connection')
  const a = makeCtx()
  mod.apply(a.ctx, {})
  assert.equal(a.registrations.length, 1, 'apply 必须注册路由')
  assert.equal(a.registrations[0].kind, 'prefix')
  assert.equal(a.registrations[0].path, '/packer/api')
  assert.equal(typeof a.registrations[0].handler, 'function')
  assert.equal(a.taps.length, 0, '默认模式不该生成前端可读的一次性令牌')

  const denied = fakeRes()
  await a.registrations[0].handler(fakeReq(), denied)
  assert.equal(denied.statusCode, 403, '拿不到 connection 服务时必须 403（fail-closed）')
  assert.equal(JSON.parse(denied.body).code, 'forbidden')

  // 宿主后来提供了 connection：同一条 handler 立刻按官方判定放行
  a.services.connection = OPEN_CONNECTION
  const allowed = fakeRes()
  await a.registrations[0].handler(fakeReq(), allowed)
  assert.equal(allowed.statusCode, 200)
  assert.equal(JSON.parse(allowed.body).ok, true)

  // 显式 token 模式：才 tap index.html 注入一次性令牌
  const b = makeCtx()
  mod.apply(b.ctx, { api: { authMode: 'token' } })
  assert.equal(b.registrations.length, 1)
  assert.equal(b.taps.length, 1, 'token 模式必须把令牌注入同源页面')
  const html = b.taps[0]('<html><head><title>x</title></head><body></body></html>')
  assert.match(html, /globalThis\.__DSH_PACKER_TOKEN__="?[\w-]{16,}/)
  assert.equal(b.taps[0](html), html, '重复 tap 必须幂等（不注入两次）')

  // 宿主没有 register 接口：不挂路由、不抛错（不暴露任何入口）
  const c = makeCtx()
  c.ctx.webServer = {}
  mod.apply(c.ctx, {})
  assert.equal(c.registrations.length, 0)
})
