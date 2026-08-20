// dsh-packer 单元测试（node:test）——全部隔离在临时目录，不触碰真实 ~/.dsh
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

test('恢复：applyRestore merge 策略追加不覆盖', () => {
  const r = I.createPack({ modules: ['settings'], mode: 'migrate' })
  const zipPath = path.join(I.PACKS_DIR, r.pack.name)
  const { manifest, dir } = I.readManifestFromZip(zipPath)
  manifest._dir = dir
  fs.writeFileSync(path.join(fakeHome, 'settings.yaml'), 'original\n')
  const stats = I.applyRestore(manifest, { strategy: 'merge' })
  assert.equal(stats.merged, 1)
  const after = fs.readFileSync(path.join(fakeHome, 'settings.yaml'), 'utf-8')
  assert.ok(after.includes('original'))
  assert.ok(after.includes('agent-default-model'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('恢复：非 packer 包报错', () => {
  const fake = path.join(tmpRoot, 'fake.zip')
  fs.writeFileSync(fake, 'not a zip')
  assert.throws(() => I.readManifestFromZip(fake))
})

test('清单指纹：sha256 稳定', () => {
  const p = path.join(fakeHome, 'settings.yaml')
  const a = I.sha256(p)
  const b = I.sha256(p)
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})
