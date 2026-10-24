# dsh-packer v0.5.1 契约（隐私「真处理」+ 迁移补齐插件本体）

> 用户 2026-10-25 定调：隐私不能只报警，必须处理掉，且给两种选择；主用途是**迁移**（换平台/换机器的数据导入导出，像换手机），打包对象既有自研插件也有**已安装的第三方插件**。

## 1. 两种隐私处理（打包页单选，按模式默认联动）

| 选项 | 语义 | 默认 |
|---|---|---|
| **清理后打包**（sanitize=true） | 只改**包内副本**：命中的绝对路径/用户目录/UNC 替换为占位符，密钥类替换为 `<已移除的密钥>`；源文件不动 | `share` 模式强制 |
| **不清理，直接打包**（sanitize=false） | 内容保真（迁移要能用）；风险交给口令保护——若扫描命中**密钥类**而没设口令，结果里返回 `warnings[]` 明确告知「包内含凭据且未加密」 | `migrate` 模式默认 |

占位符（固定词表，勿改）：
- `<本机路径>` ← 盘符绝对路径（不可逆，恢复后原样保留）
- `<用户目录>` ← `C:\Users\xxx` / `/home/xxx`（恢复时回填为目标机 home）
- `<用户名>` ← 用户目录里的用户名片段（恢复时回填当前用户名）
- `<UNC路径>` ← `\\host\share\...`
- `<Unix路径>` ← `/home|/Users|/root|...`
- `<已移除的密钥>` ← credential / key-shape 命中（恢复后需重新填）

## 2. 接口变化（仍为 9 组，不新增路径）

- `POST /create` body 增 `sanitize?: boolean`；share 模式忽略传入值、强制 true。
- 结果 `result.pack` 增 `sanitized: boolean`、`redactions: number`；`warnings?: string[]`（例如「包含 3 处凭据且未加密，建议设置口令」）。
- `POST /scan` 响应每条 finding 增 `kind`（`path` | `userpath` | `unc` | `unix` | `credential` | `key` | `personal`），UI 按 kind 分组显示「可清理 / 需你确认」。
- `GET /status` 的 `modules` 新增 `plugins` 模块（见 §4）。

## 3. 恢复时回填（只对 sanitized 包）

`applyRestore` 写盘前做反向替换：`<用户目录>` → 目标机 `os.homedir()`；`<用户名>` → 当前用户名；其余占位符**保留原样**并在 `stats.warnings` 里列出「N 处占位符无法自动回填（`<本机路径>`）」。回填只作用于判定为文本的文件（沿用 `isTextFile`）。

## 4. 新模块 `plugins`（迁移带插件本体）

- 路径：`<DSH_HOME>/profiles/<profile>/node_modules/` 下的**一级包目录**（`@scope/*` 取两级），排除 `.pnpm`、`.bin`、`.modules.yaml`、`node_modules/.cache`。
- `kind: 'dir'`、`default: true`（迁移预设带上）、`share: false`（分享绝不带）。
- 恢复：按同一相对路径写回（`profiles/<profile>/node_modules/...`），沿用现有的原子写 + 备份 + 回滚。
- 体积提醒写进 `/status`（该模块 `bytes` 照常显示）与 README，不做额外提示条。

## 5. 测试要求（新增 ≤ 10 例）

1. sanitize=true：包内文本文件里的 `C:\...` 变 `<本机路径>`、密钥变 `<已移除的密钥>`，**源文件未被修改**。
2. sanitize=false：内容保真；含 key-shape 且无口令时 `warnings` 非空。
3. share 模式强制 sanitize（传 false 也按 true 处理）。
4. 恢复回填：sanitized 包里的 `<用户目录>` 写入后变成本机 home；`<本机路径>` 仍在且计入 warnings。
5. `/scan` 每条 finding 带 `kind`。
6. `plugins` 模块：collect 只收一级包目录（不含 .pnpm/.bin），createPack 能把它打进包，applyRestore 能写回。
7. 回归：既有 72 例全绿。

## 6. UI（打包页，2 个元素以内）

- 「隐私处理」两单选：`清理后打包` / `不清理，直接打包`（切换有 mode 联动 + 一行说明）。
- 结果卡多一句：`已脱敏 19 处` 或 `警告：含凭据且未加密`。
- `/scan` 的命中列表按 kind 分组（可清理 / 需你确认），不新增页面。
