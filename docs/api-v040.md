# dsh-packer v0.4.0 API 契约（唯一事实来源）

> 本文件由 Lead 定义，backend 与 UI 两侧都按它实现；分歧以本文件为准，需要改契约先改本文件并通知对方。
> 现有 v0.3.0 接口保持路径不变，只做**向后兼容的扩展**；已有 51 个测试必须继续全绿。

## 0. 通用

- 所有接口挂在 `/packer/api` 前缀下；响应统一 `{ ok: true, ... }` 或 `{ ok: false, code, error }`。
- 参数非法一律 **400 + code**（fail-closed），不得静默降级。
- 鉴权/限速/体积上限沿用 v0.3.0 的 guard（不改行为）。
- `pack` 对象统一形状：
  ```json
  { "name": "dsh-packer-2026-10-25-031500-ab12cd-migrate.zip",
    "mode": "migrate", "createdAt": "ISO", "note": "",
    "fileCount": 123, "totalBytes": 456789,
    "encrypted": false }
  ```

## 1. GET /status

**必须不产生 SQLite 快照**（v0.3.0 的 bug：每次打开设置页 VACUUM INTO 一次记忆库并泄漏）。

响应新增字段：
```json
{ "ok": true,
  "modules": { "skills": { "label": "...", "kind": "dir", "default": true, "share": true, "count": 12, "bytes": 3456 } },
  "packs": [ pack ],
  "packsDir": "C:\\Users\\...\\.dsh\\packs",
  "schemaVersion": 1,
  "trashCount": 0,
  "disk": { "packsBytes": 123456, "trashBytes": 0 },
  "retention": { "keep": 10, "maxBytes": 2147483648 },
  "autoBackup": { "enabled": false, "intervalHours": 24, "keep": 5, "lastRunAt": null, "nextRunAt": null } }
```
- 模块计数：普通模块走目录枚举（不读文件内容、不算哈希）；`memoryDb` **只 stat 文件大小**，绝不 VACUUM。

## 2. POST /scan  `{ modules: string[], mode: 'migrate'|'share' }`

- **修 v0.3.0 假阴性**：传给 `privacyScan` 的文件项必须带 `abs`（真实绝对路径），否则恒零命中。
- 响应：`{ ok, files: [{ module, rel, size }], privacy: [{ file, pattern, label, line, count, sample }], share: boolean }`
- `mode` 非法 → 400 `bad_mode`。

## 3. POST /create

请求：`{ modules, mode, note, dryRun, encrypt, password }`
- 校验：`mode ∈ {migrate,share}`；`modules` 非空且都是已知模块；否则 400（`bad_mode` / `bad_modules`）。
- **分享模式服务端也要拦**（不能只靠 UI）：`mode==='share' && modules` 命中 `sessions|profiles|settings|presets|memory|memoryDb` → 400 `share_scope`（错误文案说明哪些模块被拒）。
- `encrypt===true` 且 `password` 长度 < 8 → 400 `weak_password`。
- **dryRun=true**：同步返回
  ```json
  { "ok": true, "dryRun": true,
    "manifest": { "modules": [], "mode": "migrate",
                  "files": [{ "module": "skills", "rel": "a/b.md", "size": 123, "sha256": "..." }] },
    "totalBytes": 456,
    "privacy": [], "unreadable": [{ "module": "memoryDb", "rel": "x.db", "error": "..." }] }
  ```
  （v0.3.0 的 `manifest.files` 缺 `size`，前端显示「—」，此处必须带 `size`。）
- **dryRun 省略或 false**：改为**异步作业**
  ```json
  { "ok": true, "jobId": "job-xxxx" }
  ```
  作业结果 `result` = 旧版同步返回体（`{ pack, privacy, unreadable }`）。

## 4. 异步作业（create / restore-apply 共用）

- `GET /jobs/:id` → `{ ok, job: { id, kind, phase, done, total, cancelled, error, result } }`
  - `kind ∈ {create, restore}`、`phase ∈ {collect, hash, scan, zip, write, prepare, apply, rollback, done}`
  - `total` = 预计文件数，`done` = 已处理数（用于进度条百分比）
- `POST /jobs/:id/cancel` → `{ ok: true }`；作业在**文件边界**检查取消标志，中止后返回 `cancelled:true`、不留下半成品 zip（清理已写文件）。
- `GET /jobs` → 最近 20 个作业（可选，UI 不需轮询列表）。
- 内存保留最近 20 条，超过淘汰最旧；作业一旦 done/error/cancelled 保留 5 分钟。

## 5. 包管理

- `GET /packs` → `{ ok, packs: [pack] }`（`packs` 含 `.zip` 与加密包）
- `GET /packs/:name/info` → `{ ok, manifest: {...}, files: [{ module, rel, size }], encrypted: boolean }`
- `POST /packs/:name/verify` → `{ ok, checked: n, failures: [{ module, rel, error }] }`（重算 SHA-256，逐个比对 manifest）
- `DELETE /packs/:name` → **移入回收站**（`PACKS_DIR/.trash/`），返回 `{ ok, trashed: true }`；不再物理删除。
- `GET /packs/trash` → `{ ok, items: [{ name, deletedAt, bytes }] }`
- `POST /packs/trash/restore` `{ name }` → `{ ok }`；`POST /packs/trash/purge` `{ name? }`（省略 name=清空）→ `{ ok }`
- `POST /packs/rename` `{ from, to }` → `{ ok }`（名称校验：不允许路径分隔符/..；长度上限 120）

## 6. 备份设置 / 自动备份

- `POST /backup/settings` `{ enabled, intervalHours, keep, maxBytes }` → 持久化到 `PACKS_DIR/.packer-config.json`，返回 `{ ok, autoBackup, retention }`。
  - 校验：`intervalHours ∈ [1, 720]`、`keep ∈ [1, 100]`、`maxBytes ∈ [1048576, 1e12]`，非法 400。
- `POST /backup/run-now` → 立即用 migrate 预设全模块打一个包（异步作业，返回 `{ ok, jobId }`）。
- 定时器：`apply()` 里用 `ctx.effect()` 起 `setInterval`（最小 1 小时粒度，启动时若 `nextRunAt<=now` 立即跑一次），卸载时清除；配置变更后重排。运行限制写进响应/README：**只在 DSH 运行期间生效**。
- 保留策略 `retention {keep, maxBytes}`：每次打包成功后自动清理超出 `keep` 个数或 `maxBytes` 的**最旧包**（移入回收站，不物理删）；`trash` 不计入 `maxBytes`。

## 7. 恢复

- `POST /restore/import` `{ zip, password? }` →
  ```json
  { "ok": true,
    "manifest": { "schemaVersion": 1, "mode": "migrate", "modules": [], "note": "", "createdAt": "ISO" },
    "files": [{ "module": "skills", "rel": "a.md", "size": 12, "status": "added|changed|same|skipped" }],
    "diff": { "added": 0, "changed": 0, "same": 0, "skipped": 0 },
    "encrypted": false }
  ```
  （v0.3.0 的 `diff` 只有计数数组，v0.4.0 额外给逐文件 `status`，UI 需要画列表。）
- `POST /restore/apply` `{ zip, strategy, modules?, includeDb?, password?, async? }`
  - `strategy ∈ {overwrite, skip, merge}`，否则 400 `bad_strategy`（**修 v0.3.0 非法值退化成 overwrite**）。
  - `modules` 若给：必须是已知模块子集，否则 400 `bad_modules`。
  - `includeDb === true` 才恢复 `*.db*`（README/CLI 与 UI 都要能传）。
  - `async` 省略/false → 同步 `{ ok, stats }`；`async:true` → `{ ok, jobId }`，作业 `result = { ok, stats }`。
  - `stats` 形状沿用 v0.3.0（overwritten/added/merged/skipped/failed/failures/excluded/aborted/rolledBack/rollbackFailures/backupDir）。
- `GET /restore/backups` → `{ ok, items: [{ dir, createdAt, files, bytes }] }`（`PACKS_DIR/.restore-backups/*`）
- `POST /restore/rollback` `{ dir }` → `{ ok, restored: n, failed: n }`；`dir` 必须落在 `.restore-backups` 内（containment 校验，否则 400 `bad_dir`）。

## 8. 加密包格式（`crypto.mjs`）

- 文件：`<原名>.pkenc`（不写 `.zip`）；`summary.json` 带 `encrypted: true`。
- 二进制布局：`magic "PKENC1\0"` + `salt[16]` + `iv[12]` + `tag[16]` + `ciphertext`。
- 算法：`scrypt(password, salt, 32)` 派生 key（N=16384,r=8,p=1），`aes-256-gcm` 加密 zip 明文。
- 解包：`parseZip` / `readZipFile` 前先嗅探 magic，命中则要求 password，密码错 → 400 `bad_password`（不得抛出 500）。
- `listPacks` 同时识别 `.zip` 与 `.pkenc`；包名对 UI 展示时保留原始文件名。

## 9. CLI（`/pack` 命令）同步补齐

- `create` 支持 `--encrypt <password>`（≥8 位）
- `restore` 支持 `--include-db`、`--modules a,b`、`--password <pw>`
- `verify <包名>`、`list` 显示 `[加密]` 标记
- 命令输出与 Web UI 能力等价，README 不得再宣称未实现的能力。

## 10. 前端（lib/client.js）要求

风格：**现代极简 + 品牌琥珀橙**（packer 品牌色），深浅双主题，4/8px 栅格，字号 12/14/16/20/28，行高 ≥1.6。
结构改为 **Tab 三页**（不再单页四段平铺）：

1. **打包**：顶部状态条（包目录、占用、上次备份、自动备份开关）→ 模块卡网格（2 列，含文件数/大小，点击整卡切换，禁止只用小 checkbox）→ 模式分段控件（迁移/分享，选中分享时对敏感模块置灰并给一行解释）→ 备注 → 主按钮「开始打包」（次按钮「仅预览」）→ 进度条 + 取消。
2. **包库**：表格式列表（名称/模式/大小/时间/文件数/加密标记），行内操作：恢复、查看（抽屉列出文件清单）、校验、重命名、删除；回收站折叠区（恢复/清空）；保留策略与自动备份设置在同一页底部。
3. **恢复**：先选包（下拉来自包库）+ 或「浏览…」手输路径；「导入检查」后展示差异列表（四态色点 + 逐文件）；选择性恢复：模块勾选 + `includeDb` 开关（打开时红字警告）；策略三选 → 主按钮「执行恢复」→ 进度 + 结果卡（含备份目录与回滚按钮）。

交互细节（必须）：
- 所有异步操作显示进度（`done/total` 百分比），可取消；失败显示 `code` + 可读原因。
- 禁用 `window.prompt` / `window.confirm`（Electron 不支持 prompt）→ 自研输入弹层与确认弹层。
- 空/载/错三态齐全；按钮有 `:focus-visible`；`prefers-reduced-motion` 降级。
- 文案 zh-CN / en 两套（现有 `copy` 结构扩展），不得硬编码中文串到 JSX 之外。
- 不用 `--pk-` 之外的新硬编码色值；主色 `#F59E0B`（亮）/`#FBBF24`（暗），错误 `#C62828`、成功 `#2E7D32`、警告 `#ED6C02`；其余走 `--dsw-alias-*` 兜底。

## 11. 验收（Lead 负责跑）

- `node --test tests/*.test.mjs` 全绿（旧 51 + 新增）。
- 新增强制用例：/scan 带 abs（用一个含 `C:\` 路径的临时文件断言命中）、share_scope 400、bad_strategy 400、/status 不产生临时快照、加密包往返、回收站恢复、作业进度与取消。
- `E:\DE\tools\plugin-release-check.cjs` 通过；版本四处一致（package.json / description / lock / README 横幅+历史表）。
- npm pack → 安装 tgz → 重启后设置页可用（人工确认项）。
