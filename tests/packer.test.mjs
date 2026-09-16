// dsh-packer 单元测试（node:test）——全部隔离在临时目录，不触碰真实 ~/.dsh
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
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

before(async () => {
  makeAssets()
  const m = await import(new URL('../index.mjs', import.meta.url).href)
  I = m.__internals
})

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('模块文件收集：skills 含全部子目录', () => {
  const files = I.collectModuleFiles(I.MODULES.skills)
  const rels = files.map((f) => f.rel)
  assert.ok(rels.includes('memory/SKILL.md'))
  assert.ok(rels.includes('pet/SKILL.md'))
})

test('凭据文件永不打包', () => {
  for (const key of ['skills', 'sessions', 'profiles', 'settings', 'presets', 'memory']) {
    const files = I.collectModuleFiles(I.MODULES[key])
    for (const f of files) {
      assert.ok(!f.rel.includes('.credentials'), `不应包含凭据: ${f.rel}`)
      assert.ok(!f.rel.includes('.anonymous-user-id'))
    }
  }
})

test('settings 模块只收集 settings.yaml', () => {
  const files = I.collectModuleFiles(I.MODULES.settings)
  assert.equal(files.length, 1)
  assert.equal(files[0].rel, 'settings.yaml')
})

test('sessions 模块收集 .zstd 二进制', () => {
  const files = I.collectModuleFiles(I.MODULES.sessions)
  assert.equal(files.length, 1)
  assert.ok(files[0].rel.endsWith('.zstd'))
})

test('记忆数据模块收集 hot 内容且跳过 backups', () => {
  const files = I.collectModuleFiles(I.MODULES.memory)
  const rels = files.map((f) => f.rel)
  assert.ok(rels.includes('hot/knowledge.md'))
  assert.ok(!rels.some((r) => r.startsWith('backups/')))
})

test('隐私扫描：检测本地路径/用户名/密钥', () => {
  const files = []
  for (const k of ['skills', 'settings']) {
    for (const f of I.collectModuleFiles(I.MODULES[k])) files.push(f)
  }
  const findings = I.privacyScan(files)
  // skills/memory/SKILL.md 含 C:\Users\Example\foo → abs-path + user-path
  assert.ok(findings.some((f) => f.file === 'memory/SKILL.md' && f.pattern === 'abs-path'))
  assert.ok(findings.some((f) => f.file === 'memory/SKILL.md' && f.pattern === 'user-path'))
  // .credentials.yaml 不应被扫描到（因为不被收集）
  assert.ok(!findings.some((f) => f.file.includes('.credentials')))
})

test('隐私扫描：二进制文件跳过', () => {
  const files = I.collectModuleFiles(I.MODULES.sessions)
  const findings = I.privacyScan(files)
  assert.equal(findings.length, 0, '二进制会话文件不应触发扫描')
})

test('createPack：迁移模式打包成功且含 manifest', () => {
  const r = I.createPack({ modules: ['skills', 'settings'], mode: 'migrate', note: '测试包' })
  assert.equal(r.ok, true)
  assert.equal(r.pack.mode, 'migrate')
  assert.equal(r.pack.note, '测试包')
  assert.ok(r.pack.name.endsWith('.zip'))
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  assert.ok(fs.existsSync(zipPath))
  // 校验 zip 内容
  const { manifest } = I.readManifestFromZip(zipPath)
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.note, '测试包')
  assert.ok(manifest.files.some((f) => f.rel === 'memory/SKILL.md'))
  assert.ok(manifest.files.some((f) => f.rel === 'settings.yaml'))
})

test('createPack：分享模式拦截隐私内容', () => {
  // skills 含 pet/SKILL.md（个人敏感词示例）→ 分享模式应抛错
  assert.throws(() => I.createPack({ modules: ['skills'], mode: 'share' }), /隐私扫描发现/)
})

test('createPack：分享模式排除默认排除项（_shared）', () => {
  const files = I.collectModuleFiles(I.MODULES.skills, true)
  const rels = files.map((f) => f.rel)
  assert.ok(!rels.includes('_shared/common.md'), '分享模式应排除 _shared')
  assert.ok(rels.includes('pet/SKILL.md'), '普通 skill 正常收集')
})

test('createPack：dry-run 不生成文件', () => {
  const packsDir = I.PACKS_DIR
  const before = fs.existsSync(packsDir) ? fs.readdirSync(packsDir).length : 0
  const r = I.createPack({ modules: ['settings'], mode: 'migrate', dryRun: true })
  assert.equal(r.dryRun, true)
  assert.ok(r.manifest.files.length >= 1)
  const after = fs.existsSync(packsDir) ? fs.readdirSync(packsDir).length : 0
  assert.equal(after, before)
})

test('createPack：未知模块报错、空模块报错', () => {
  assert.throws(() => I.createPack({ modules: ['nope'] }), /未知模块/)
  assert.throws(() => I.createPack({ modules: [] }), /未选择任何模块/)
})

test('包管理：list / delete / rename', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate', note: '管理测试' })
  // list
  const packs = I.listPacks()
  assert.ok(packs.some((p) => p.name === r.pack.name))
  // rename
  const newName = 'renamed-' + r.pack.name
  const rr = I.renamePack(r.pack.name, newName)
  assert.equal(rr.ok, true)
  assert.ok(fs.existsSync(path.join(I.PACKS_DIR, newName)))
  // delete
  const d = I.deletePack(newName)
  assert.equal(d.ok, true)
  assert.ok(!fs.existsSync(path.join(I.PACKS_DIR, newName)))
})

test('恢复：diffRestore 正确分类 added/changed/same', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = I.readManifestFromZip(zipPath)
  // 目标已存在且相同（刚打包的就是源文件）→ same
  let diff = I.diffRestore(manifest)
  assert.ok(diff.same.length >= 1)
  assert.equal(diff.added.length, 0)
  // 改掉目标内容 → changed
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'changed: true\n')
  diff = I.diffRestore(manifest)
  assert.ok(diff.changed.length >= 1)
  // 恢复源文件，避免污染后续用例（createPack 打包的是当前内容）
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：applyRestore 覆盖策略', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = I.readManifestFromZip(zipPath)
  manifest._dir = dir
  // 破坏目标 → 覆盖恢复
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'broken\n')
  const stats = I.applyRestore(manifest, { strategy: 'overwrite' })
  const restored = fs.readFileSync(path.join(fakeHome, 'settings.yaml'), 'utf-8')
  assert.ok(restored.includes('agent-default-model'), '应恢复为打包内容')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：applyRestore skip 策略不改已存在文件', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = I.readManifestFromZip(zipPath)
  manifest._dir = dir
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'keep-me\n')
  const stats = I.applyRestore(manifest, { strategy: 'skip' })
  assert.equal(stats.skipped, 1)
  const after = fs.readFileSync(path.join(fakeHome, 'settings.yaml'), 'utf-8')
  assert.equal(after, 'keep-me\n')
  // 恢复源文件，避免污染后续用例
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：applyRestore merge 策略追加不覆盖（文本文件）', () => {
  const r = I.createPack({ modules: ['skills'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = I.readManifestFromZip(zipPath)
  manifest._dir = dir
  fs.writeFileSync(path.join(fakeHome, 'skills', 'memory', 'SKILL.md'), 'original\n')
  const stats = I.applyRestore(manifest, { strategy: 'merge' })
  assert.equal(stats.merged, 1)
  const after = fs.readFileSync(path.join(fakeHome, 'skills', 'memory', 'SKILL.md'), 'utf-8')
  assert.ok(after.includes('original'))
  assert.ok(after.includes('memory skill'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：结构化配置（YAML/JSON）拒绝 append merge（fail-closed）', () => {
  const r = I.createPack({ modules: ['settings', 'presets'], mode: 'migrate' })
  const { manifest, dir } = I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  // 先修改目标文件使其内容 ≠ 包内（否则 sha 相同直接 skipped，不会走到 merge）
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: local\n')
  fs.writeFileSync(path.join(fakeHome, '.agent-presets', 'p1', 'preset.yml'), 'enabled: false\n')
  const stats = I.applyRestore(manifest, { strategy: 'merge' })
  assert.equal(stats.merged, 0)
  assert.ok(stats.failed >= 1)
  assert.ok(stats.failures.some((f) => /结构化|append merge/.test(f.error)))
  // 恢复原内容，避免污染后续用例
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  fs.writeFileSync(path.join(fakeHome, '.agent-presets', 'p1', 'preset.yml'), 'enabled: true\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：非 packer 包报错', () => {
  const fake = path.join(tmpRoot, 'fake.zip')
  fs.writeFileSync(fake, 'not a zip')
  assert.throws(() => I.readManifestFromZip(fake))
})

test('恢复：源文件被篡改 → 完整性校验失败并拒绝（fail-closed）', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const { manifest, dir } = I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  // 篡改解压目录内的源文件（模拟包内容在解压后被替换/污染）
  fs.writeFileSync(path.join(dir, 'settings', 'settings.yaml'), 'tampered: true\n')
  const stats = I.applyRestore(manifest, { strategy: 'overwrite' })
  assert.equal(stats.added, 0)
  assert.equal(stats.failed, 1)
  assert.ok(/完整性|fail-closed/.test(stats.failures[0].error))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：清单 rel 越界（../../）被 containment 拒绝', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const { manifest, dir } = I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  const evil = { ...manifest, files: [{ module: 'settings', rel: '../../escape.txt', sha256: manifest.files[0].sha256 }] }
  const stats = I.applyRestore(evil, { strategy: 'overwrite' })
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

test('隐私扫描：部署者个人规则生效（合并后循环新数组）', () => {
  I.setPersonalPatterns([{ id: 'nick', label: '个人昵称', re: '大肥鱼' }])
  try {
    const f = path.join(tmpRoot, 'nick.txt')
    fs.writeFileSync(f, '我是大肥鱼，今天也是努力的一天\n')
    const hits = I.privacyScan([{ rel: 'nick.txt', abs: f }])
    assert.ok(hits.some((x) => x.pattern === 'nick' && x.label === '个人昵称'))
    assert.equal(hits.length, 1) // 只命中个人规则（通用规则未命中该文本）
    // 控制组：不含个人词 → 零发现
    const clean = path.join(tmpRoot, 'clean.txt')
    fs.writeFileSync(clean, '普通文本\n')
    assert.equal(I.privacyScan([{ rel: 'clean.txt', abs: clean }]).length, 0)
  } finally {
    I.setPersonalPatterns([])
  }
})

test('清单指纹：sha256 稳定', () => {
  const p = path.join(fakeHome, 'settings.yaml')
  const a = I.sha256(p)
  const b = I.sha256(p)
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

// ============================================================================
// v0.2.3 安全加固：目标路径 containment / 指纹 fail-closed / 备份回滚 / 解包白名单
// ============================================================================

test('sha256：文件不存在必须抛错（绝不返回空串，否则完整性校验被静默跳过）', () => {
  assert.throws(() => I.sha256(path.join(tmpRoot, 'no-such-file.bin')))
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

test('恢复：目标路径越界（../ 逃出模块根）被拒绝且不写盘', () => {
  const r = I.createPack({ modules: ['skills'], mode: 'migrate' })
  const { manifest, dir } = I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  const sha = manifest.files.find((f) => f.rel === 'memory/SKILL.md').sha256
  // rel 合法时源侧也在解压目录内，但目标会落到 HOME 根（模块根之外）→ 必须拒绝
  const evil = { ...manifest, files: [{ module: 'skills', rel: '../escape-target.txt', sha256: sha }] }
  const stats = I.applyRestore(evil, { strategy: 'overwrite' })
  assert.equal(stats.failed, 1)
  assert.ok(/越界/.test(stats.failures[0].error))
  assert.ok(!fs.existsSync(path.join(fakeHome, 'escape-target.txt')), '不得写出模块目标根之外')
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'escape-target.txt')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：清单缺 / 非法 SHA-256 指纹一律 fail-closed 拒绝（不复制）', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const { manifest, dir } = I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'untouched-marker\n')
  for (const bad of [undefined, null, '', 'not-a-hash', 'abc123']) {
    const evil = { ...manifest, files: [{ module: 'settings', rel: 'settings.yaml', sha256: bad }] }
    const stats = I.applyRestore(evil, { strategy: 'overwrite' })
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

test('恢复：中途失败即中止，并按记录回滚已新增/已覆盖的文件', () => {
  const r = I.createPack({ modules: ['skills'], mode: 'migrate' })
  const { manifest, dir } = I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
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
  const stats = I.applyRestore(evil, { strategy: 'overwrite' })
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

test('SQLite 数据库：默认不打包、默认不恢复', () => {
  fs.writeFileSync(path.join(fakeMemory, 'biomemory.db'), 'SQLite format 3\u0000')
  const rels = I.collectModuleFiles(I.MODULES.memory).map((f) => f.rel)
  assert.ok(!rels.some((x) => /\.db/.test(x)), '内存模块不得收集 SQLite 库')

  const r = I.createPack({ modules: ['skills'], mode: 'migrate' })
  const { manifest, dir } = I.readManifestFromZip(path.join(I.PACKS_DIR, r.pack.name))
  manifest._dir = dir
  const stats = I.applyRestore(
    { ...manifest, files: [{ module: 'memory', rel: 'biomemory.db', sha256: manifest.files[0].sha256 }] },
    { strategy: 'overwrite' },
  )
  assert.equal(stats.skipped, 1)
  assert.equal(stats.excluded.length, 1)
  assert.equal(stats.failed, 0)
  assert.equal(fs.readFileSync(path.join(fakeMemory, 'biomemory.db'), 'utf-8'), 'SQLite format 3\u0000')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('打包文件名：同一秒内两次打包不互相覆盖', () => {
  const a = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const b = I.createPack({ modules: ['settings'], mode: 'migrate' })
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

test('解包：合法包通过成员白名单校验', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const names = I.validateArchiveMembers(path.join(I.PACKS_DIR, r.pack.name))
  assert.ok(names.some((n) => n.replace(/^\.\//, '') === 'manifest.json'))
})

test('解包：成员名越界（../ 或绝对路径）被白名单拒绝且不解压', () => {
  for (const bad of ['../escape-via-zip.txt', 'sub/../../escape-via-zip.txt']) {
    const evil = path.join(tmpRoot, `evil-${bad.replace(/[^a-z]/gi, '_')}.zip`)
    fs.writeFileSync(evil, makeZip([{ name: bad, data: 'pwned' }]))
    assert.throws(() => I.validateArchiveMembers(evil), /越界|非法|成员/)
    assert.throws(() => I.extractZip(evil), /越界|非法|成员/)
    assert.ok(!fs.existsSync(path.join(tmpRoot, 'escape-via-zip.txt')), '不得解压到包外')
  }
})

test('解包：符号链接成员被类型白名单拒绝（防链接逃逸）', () => {
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
  assert.throws(() => I.validateArchiveMembers(tarPath), /成员类型|fail-closed/)
})

test('解包：解压结果出现符号链接即拒绝（第二层检查）', () => {
  const out = path.join(tmpRoot, 'link-out')
  fs.mkdirSync(out, { recursive: true })
  try {
    fs.symlinkSync('../../outside-secret', path.join(out, 'l'), 'file')
  } catch {
    return
  }
  assert.throws(() => I.assertNoLinkEntries(out), /符号链接/)
})

test('隐私扫描：Unix / UNC 路径、无引号密钥、密钥形状、.env 文件都被识别', () => {
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
  const ids = new Set(I.privacyScan([{ rel: 'privacy-probe.txt', abs: p }]).map((h) => h.pattern))
  for (const id of ['unix-path', 'unc-path', 'credential', 'key-shape']) {
    assert.ok(ids.has(id), `应命中规则 ${id}（实际：${[...ids].join(',')}）`)
  }
  // 无扩展名的点文件（.env）必须纳入扫描
  const env = path.join(tmpRoot, '.env')
  fs.writeFileSync(env, 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx\n')
  const envHits = I.privacyScan([{ rel: '.env', abs: env }])
  assert.ok(envHits.length >= 1, '.env 必须被扫描')
  // 二进制仍跳过
  const bin = path.join(tmpRoot, 'blob.dat')
  fs.writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]))
  assert.equal(I.privacyScan([{ rel: 'blob.dat', abs: bin }]).length, 0)
})

test('隐私扫描：同一行多处命中全量计数（不再每规则只算 1 次）', () => {
  const p = path.join(tmpRoot, 'multi-hit.txt')
  fs.writeFileSync(p, 'D:\\a\\one.txt 与 D:\\a\\two.txt 以及 D:\\a\\three.txt\n')
  const hits = I.privacyScan([{ rel: 'multi-hit.txt', abs: p }]).filter((h) => h.pattern === 'abs-path')
  assert.equal(hits.length, 1, '同一行聚合为一条')
  assert.equal(hits[0].count, 3)
  assert.equal(I.countFindings(hits), 3)
})
