# dsh-packer v0.5.0 契约（在 api-v040.md 之上的「收敛」增量）

> 目标：**小而美**。本版只做删减与合并，接口 15 → 9，UI 三 Tab → 两 Tab，文案只留中文。
> 未在本文件提到的 v0.4.0 行为一律保留。

## 0. 用户已拍板的决策（2026-10-25）

| 项 | 决定 |
|---|---|
| 进度 + 取消 | **保留**（几千文件必须有反馈） |
| 加密包 | **保留**最小形态：打包页一个「设口令」勾选 + 口令弹层 |
| 独立 verify | **删接口/按钮**，并入「查看」：`GET /packs/:name/info` 顺带校验 |
| 回收站 | **删自建回收站**，改用 **Windows 系统回收站**（删除包时进系统回收站） |
| 定时自动备份 | **不加**（踩平台化红线） |
| 打包完成提示 | **加**一行「包已生成 + 复制路径」 |

## 1. 接口终态（9 个）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | `/status` | 模块概览 + 包列表 + 目录 + 磁盘占用 |
| 2 | POST | `/scan` | 文件清单 + 隐私扫描（必须带 abs，v0.4.0 已修，保留） |
| 3 | POST | `/create` | dryRun 同步；否则 `{jobId}`；**结果里新增 `packPath`** |
| 4 | GET | `/jobs/:id` | 作业进度 done/total（保留；`/jobs` 列表也保留，不展示） |
| 5 | POST | `/jobs/:id/cancel` | 取消（保留） |
| 6 | GET | `/packs/:name/info` | **包内容 + 顺带 SHA-256 校验**（加密包需 password） |
| 7 | POST | `/packs/rename` | 重命名（保留） |
| 8 | DELETE | `/packs/:name` | **移入 Windows 回收站** |
| 9 | POST | `/restore/import` / `/restore/apply` / `GET /restore/backups` / `POST /restore/rollback` | 恢复四件套（保留） |

删除的接口（连同实现一并删）：`GET /packs/trash`、`POST /packs/trash/restore`、`POST /packs/trash/purge`、`POST /packs/:name/verify`、`POST /backup/settings`、`POST /backup/run-now`。

## 2. `/status` 字段终态

```json
{ "ok": true,
  "modules": { "<id>": { "label","kind","default","share","count","bytes" } },
  "packs": [ { "name","mode","createdAt","note","fileCount","totalBytes","encrypted" } ],
  "packsDir": "…",
  "schemaVersion": 1,
  "disk": { "packsBytes": 0 } }
```
**删掉**：`trashCount`、`retention`、`autoBackup`、`disk.trashBytes`。

## 3. `/packs/:name/info` 新形状（合并 verify）

```json
{ "ok": true,
  "manifest": { "schemaVersion","mode","modules","note","createdAt" },
  "files": [ { "module","rel","size" } ],
  "encrypted": false,
  "verify": { "checked": 12, "failures": [ { "module":"skills","rel":"a.md","error":"sha256 mismatch" } ] } }
```
- 校验必须逐个文件重算 SHA-256（与 manifest 比对）；加密包需 `password`，无/错口令 → 400 `bad_password`。
- verify 失败**不是**错误响应（200 + failures 数组），UI 显示红字。

## 4. DELETE `/packs/:name` → Windows 回收站

- Windows：用 PowerShell 5.1 自带 `Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile(..., RecycleOption::SendToRecycleBin)`（`execFile('powershell', ['-NoProfile','-NonInteractive','-Command', …])`），成功返回 `{ ok:true, recycled:true }`。
- 非 Windows 或 PowerShell 失败：降级为永久删除并返回 `{ ok:true, recycled:false, warning:"…" }`（**不得静默**）。
- 同步删除同名 `.json` 摘要；`.pkenc` 同样适用。
- 「零外部命令」的表述要限定：**zip 读写零外部命令**；删除进回收站属 Windows 系统能力，如实写进 README。

## 5. `/create` 结果新增 `packPath`

`result.pack` 增加 `path`（zip/pkenc 的绝对路径）；dryRun 不带。UI 用「复制路径」按钮（`navigator.clipboard.writeText`），不调接口。

## 6. UI 终态（lib/client.js）

- **两 Tab**：`打包` / `恢复`。顶部一行状态：包目录（可点复制）+ 占用。
- **打包页**：模块卡（2 列，整卡可点，显示 文件数·大小）→ 模式分段（迁移/分享；分享时敏感模块置灰+一行解释，且 mode 同步为 share）→ 备注（单行）→ `[设口令]` 勾选（勾了才出输入框）→ 主按钮「开始打包」/ 次按钮「仅预览」→ 进度条 + 取消 → 完成卡：`包已生成 · 名称 · 大小 · [复制路径]`。
- **恢复页**：顶部「包」行 = 下拉选包（含加密标记）+「浏览/手输路径」；行内小按钮：`查看`（抽屉：文件清单 + 校验结果）、`改名`、`删除`（自研确认层，文案说明「会进 Windows 回收站」）、`恢复这个包`（预填并滚到下方）；「导入检查」→ 四态差异（截断 50 条 + 「另有 N 条」）→ 模块勾选 + `includeDb`（红字警告）→ 策略三选 → 执行 + 进度 + 结果卡（备份目录 + 回滚）。
- **删除**：`window.prompt/confirm/alert` 一律禁止，自研弹层（原样保留 v0.4.0 做法）。
- **文案**：只留 `zh-CN`，删掉整个 `en` copy 表；`copy` 结构可简化为直接常量表（但需保持 zh 单一来源）。
- **视觉**：沿用 v0.4.0 的双主题 + 品牌琥珀 + 4/8px 栅格 + 字号 12/14/16/20 + 三态 + `:focus-visible` + reduced-motion；**不新增色值/字号**；界面元素总数必须比 v0.4.0 少。
- 目标：`lib/client.js` ≤ 1100 行。

## 7. 测试要求

- 删除：trash / backup settings / run-now / verify 端点的用例（连同实现）。
- 新增/改写：`DELETE /packs/:name` 走回收站分支（测试环境注入 `recycleFn` 桩，断言 recycled=true；再注入失败桩断言 recycled=false + warning）；`/packs/:name/info` 的 verify（干净包全过 / 篡改包 failures 非空）；加密包 info 校验需口令。
- 保留：/status 不产生快照、share_scope、bad_strategy、加密往返、作业进度与取消、includeDb 默认排除、恢复备份/回滚。
- 全部通过（目标 ≤ 60 个用例，宁少不滥）。
