# dsh-packer

> **Agent 配置打包器**：把 Skills、会话、已装插件和设置封成一个 zip，换电脑时一键开箱；敏感内容先脱敏或加密。
>
> [简体中文](README.md) · [English](README.en.md)

> **v0.6.5** · MIT License · DSH 0.2.x（`>=0.2.0-rc.2 <0.3.0-0`，0.2.1-rc.3 桌面版实测）· Node ≥ 22.19.0

dsh-packer 是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）的「Agent 配置打包器」插件：把本地 Agent 资产按模块打包成标准 zip，用于两种场景：

- **迁移** —— 换机器或重装后，把整套环境完整搬过去。
- **分享** —— 把 Skills 等资产交给别人，敏感内容自动拦截。

打包内容可按模块自由组合（Skills / 会话 / 附件 / Profile / 设置 / 预设 / 记忆），恢复带差异对比与冲突策略，隐私安全扫描全程护航——全部能力按需开启。

## 功能特性

| 特性 | 说明 |
| --- | --- |
| 模块化打包 | 九个模块任意组合：`skills` / `sessions` / `attachments`（**会话里图片/附件的字节**，迁移默认带上）/ `profiles` / `plugins`（**已安装插件的本体**，默认迁移带上）/ `settings` / `presets` / `memory`（Markdown 镜像）/ `memoryDb`（**记忆真库 SQLite 一致快照**，默认带上） |
| 双模式预设 | **迁移**（全选，含已装插件本体与会话附件）/ **分享**（只勾 Skills，自动排除会话、附件、记忆、插件与个人 skill 子目录） |
| 隐私扫描 + **真处理** | 检测盘符 / Unix / UNC 路径、用户目录路径、疑似密钥赋值、密钥形状（`sk-`、`ghp_`、`AKIA`、JWT）、个人昵称；命中后**不再只是提示**，打包页给两选：**清理后打包**（只改包内副本：路径→占位符、密钥→`<已移除的密钥>`，源文件不动；分享模式强制）/ **不清理直接打包**（保真，靠口令保护；含凭据又未加密时明确告警） |
| 脱敏安全兜底 | 单遍最左扫描 + 结构字符排除 → 不会吃掉引号/括号/逗号；`.json`/`.jsonl` 脱敏后真跑解析校验、行数缩进必须不变，否则**整文件回退原文**并记 warning；非 UTF-8 文件不脱敏。限制：YAML 无解析器证明（零依赖），极端写法仍可能产生语义差异 |
| 文件级操作预览 | 打包前预览完整文件清单；恢复前差异报告（新增 / 变更 / 相同 / 跳过） |
| 恢复冲突三选 | 覆盖 / 跳过 / 内容合并（合并 = 追加，绝不覆盖已有内容） |
| 恢复安全写入 | 先备份目标到 packs 目录下的 `.restore-backups/<时间戳>/`，写临时文件后 `rename` **原子替换**；任一环节失败即**中止并回滚**已替换/已新增的文件 |
| 清单完整性校验 | `manifest.json` 记录 schemaVersion + 每个文件 SHA-256 指纹；恢复前校验源文件与清单一致，**缺指纹或指纹格式非法一律拒绝**（fail-closed） |
| 包管理与备注 | 包列表（时间 / 大小 / 模块 / 备注）、删除、重命名、打包时填写备注 |
| 分享包自动附 README | 自动生成并附带说明包内容的 `README.md` |
| 深色模式适配 | 设置页跟随 DSH 主题（`--dsw-alias-*` 令牌 + 品牌琥珀双色板，双通道探测） |
| 零原生依赖 | **纯 JS 读写标准 zip**（zip.mjs + node:zlib），不调用 tar/unzip 等外部命令，任何解压工具可打开 |
| 选择性恢复 | 恢复前可按**模块**勾选（只恢复 Skills、不动会话），`includeDb` 单独开关控制是否恢复记忆真库 |
| 恢复前预览 | 导入即算差异：逐文件列出 新增 / 变更 / 相同 / 跳过，并在执行后报告备份目录 |
| 一键回滚 | `/restore/backups` 列出每次恢复前的备份；`/restore/rollback`（设置页「回滚」按钮）把该次覆盖的文件原样还原 |
| 包管理 | 查看包内文件清单并**顺带校验 SHA-256**、重命名、删除（删除送**当前平台的系统回收站**：Windows 回收站 / macOS 废纸篓 / Linux Trash，均可找回；鸿蒙无回收站，删除前会明确提示不可恢复） |
| 加密包 | `AES-256-GCM` + `scrypt` 口令加密（`PKENC1` 容器），加密包只在提供口令时才能读清单/恢复；口令错误 fail-closed |
| 进度与取消 | 打包/恢复都是后台作业（`/jobs/:id`），界面显示 `done/total` 百分比，支持中途取消（文件边界生效，不残留半成品） |

## 安装

### 桌面版：按包名安装（推荐）

1. 打开 DSH 桌面版 → 左侧 **插件** → **加插件**；
2. 在包名输入框填 `dsh-packer`，点 **安装**（安装完自动启用）。

命令行等价：

```bash
# 把 desktop 换成你的 profile 名
dsh plugin --profile desktop add dsh-packer
```

### 从 GitHub 安装（备选）

```bash
# 需要已安装 git
dsh plugin --profile desktop add github:KLRSL/dsh-packer
```

### 本地 bundle（开发 / link）

```bash
# 在项目目录下执行
dsh plugin --profile desktop add link:./dsh-packer
```

`dsh plugin` 会自动把安装的包登记到 profile 的 `dsh.profile.bundles` 并挂载补丁；安装完成后重启 DSH。

**安装后验证**：

1. 打开 **设置页 →「配置打包」标签页**——能看到模块勾选界面与包列表，即安装成功；
2. 或在终端运行 `/pack list`——返回包列表（首次使用为空列表或提示暂无包），即命令已注册；
3. 再跑一次 `/pack create --dry-run`——不生成真实 zip，仅预览文件清单与扫描结果，确认各模块路径可读。

## 快速开始

### 打包（三步）

```bash
# 1. 创建迁移包（默认全选模块）
/pack create --note "迁移到新机器"

# 2. 或创建分享包（只含 Skills，自动排除敏感内容）
/pack create --share --note "分享给朋友"

# 3. 先预览再打包（不生成 zip）
/pack create --mode migrate --dry-run
```

打包完成后，zip 写入 `~/.dsh/packs/`（`DSH_PACKS_DIR` 可覆盖）；分享包自动附带 `README.md`。

### 恢复（三步）

```bash
# 1. 导入包
/pack restore ~/.dsh/packs/dsh-packer-2026-09-05-223045-migrate.zip

# 2. 查看差异报告（新增 / 变更 / 相同 / 跳过）
# 3. 指定冲突策略：overwrite | skip | merge
/pack restore <zip路径> --strategy merge
```

恢复前自动校验 `manifest.json`（schemaVersion + 每条指纹的合法性 + 每个源文件的 SHA-256），确认差异报告后按策略应用；写入前先备份、`rename` 原子替换，失败即中止回滚。完成按需重启 DSH。

## 打包模块

| 模块 | 内容 | 迁移预设 | 分享预设 |
| --- | --- | --- | --- |
| `skills` | Skills（含记忆机制 skill），位于 `~/.dsh/skills` | ✅ | ✅ |
| `sessions` | 会话记录（`.zstd` 格式），位于 `~/.dsh/sessions` | ✅ | ❌ |
| `attachments` | **会话附件对象库**：会话里的图片/文件字节（内容寻址，位于 `~/.dsh/attachments/v1/objects`；不含可重建的请求图片缓存与 `tmp` 暂存） | ✅ | ❌ |
| `profiles` | Profile 配置（不含 `node_modules`），位于 `~/.dsh/profiles` | ✅ | ❌ |
| `plugins` | **已安装插件本体**（`profiles/<profile>/node_modules` 的一级包目录），体积大 | ✅ | ❌ |
| `settings` | 全局设置（`settings.yaml`） | ✅ | ❌ |
| `presets` | Agent 预设（`.agent-presets`） | ✅ | ❌ |
| `memory` | **记忆镜像**（Markdown 只读副本，位于 `DSH_MEMORY_ROOT` 或 `~/.dsh/memory`；不含 `backups/`） | ✅ | ❌ |
| `memoryDb` | **记忆真库**（`<DSH_BIOMEMORY_DIR \|\| ~/.dsh/biomemory>/biomemory.db`）：打包时用 `VACUUM INTO` 取**一致快照**（只读连接、不碰运行中的 WAL），快照失败则该文件不进包并计入 `unreadable` | ✅ | ❌ |

**会话里的图片在 `attachments`**：会话日志里的图片只是 `attachmentId` 引用（`sha256:<64hex>`），字节在 `~/.dsh/attachments/v1/objects`。只备份 `sessions` 的话，恢复后的会话里图片会裂（能打开历史，但图取不到字节）；设置页选**「会话记录」组**（= `sessions` + `attachments`）会一起打包。对象是内容寻址的，目标机不需要改写任何引用。

**双模式预设**：

- **迁移** —— 全部模块默认勾选，适合搬迁整套环境。
- **分享** —— 只勾 `skills`；会话、附件与记忆数据自动排除，个人 skill 子目录（`_shared`）在分享时也会排除，让敏感内容尽可能少进包。

## 隐私与安全

**扫描规则**（扫描范围：已知文本后缀的文件 + 无扩展名但确定是文本的文件，如 `.env`；含 NUL 字节的二进制文件跳过）：

| 规则 | 说明 |
| --- | --- |
| 本地绝对路径（盘符） | 盘符形式路径，如 `D:\...`、`C:/...` |
| Unix 绝对路径 | `/home/...`、`/Users/...`、`/root/...`、`/etc/...`、`/tmp/...` 等 |
| UNC / 网络路径 | `\\服务器\共享\...` |
| 用户目录路径 | 操作系统用户配置文件目录下的路径（`C:\Users\<名>`、`/home/<名>`、`/Users/<名>`） |
| 疑似密钥 / Token 赋值 | `api_key`、`access_key`、`secret`、`password`、`token`、`bearer`、`authorization`、`credential` 等赋值——**带引号或不带引号**都算 |
| 密钥形状 | 裸密钥本身：`sk-...`、`ghp_...`、`github_pat_...`、`glpat-...`、`AKIA...`、`xox?-...`、JWT（`eyJ.....*.*`） |
| 个人昵称 | 用户昵称文本（由部署者通过 `config.personalPatterns` 注入） |

计数按「文件 + 规则 + 行」逐处统计：同一行出现多处命中会如实累计（不会每规则只算 1 处）。

**拦截策略**：

- **分享模式** —— 命中任何规则即返回错误、**强制拦截**，不生成包。分享包是给别人用的，必须严格。
- **迁移模式** —— 仅报告不拦截，可用 `/pack scan` 或 `--dry-run` 提前查看命中点，自行判断。

**永不打包**：`.credentials.yaml`、`.anonymous-user-id`——遍历任何模块时一律跳过，这类本地身份/凭据文件不允许进入任何包（无论迁移还是分享）。

其他安全措施：

- 每个文件的 **SHA-256** 指纹写入 `manifest.json`，恢复时用于完整性校验（fail-closed）；清单条目**缺指纹或指纹格式非法一律拒绝**，不写入指纹的文件在打包时被跳过并如实上报（绝不写空指纹）。
- 恢复对**源路径与目标路径双向**做 containment 校验：源必须在解压目录内，目标必须落在模块目标根内（zip-slip / 篡改清单的 `../` 越界一律拒绝）；绝对路径、盘符路径、UNC 路径、`..` 片段在恢复前就被白名单拒绝。
- 解包前先解析 zip 中央目录做白名单校验（拒绝绝对路径 / 盘符 / UNC / `..`），并拒绝符号链接、硬链接等非普通文件类型；解压后再扫一遍解压结果，出现符号链接即拒绝。临时解压目录统一在 `try/finally` 中清理（成功、失败都不残留）。
- 恢复前先备份目标（`<packs>/.restore-backups/<时间戳>/`），写临时文件后 `rename` 原子替换；任一环节失败即中止并回滚本次已替换/已新增的文件。
- SQLite 库的处理分两侧：**打包**走 `VACUUM INTO` 一致快照（`memoryDb` 模块，v0.2.6 起）——不直接复制被 DSH 持有的 WAL 库，取不到就跳过并计入 `unreadable`；**恢复**默认仍跳过 `*.db*`（`includeDb: true` 才写入），避免覆盖目标机上正在使用的记忆库。

### 记忆怎么迁移

**v0.2.6 起，记忆真库默认就在包里。** 记忆有两个模块，职责不同：

| 模块 | 内容 | 迁移够不够 |
| --- | --- | --- |
| `memoryDb` | `<DSH_BIOMEMORY_DIR || ~/.dsh/biomemory>/biomemory.db` 的 **`VACUUM INTO` 一致快照**（含条目与审计） | ✅ 记忆本体 |
| `memory` | `DSH_MEMORY_ROOT` 下的 Markdown 只读镜像，供人查看 | ⚠️ 只是可读副本 |

快照用**只读连接**打开源库，产出的是 SQLite 自己保证一致的文件，因此**不必先停 DSH**。
取不到快照（库被独占、磁盘满等）时该文件不进包，并如实出现在 `unreadable` 列表里——绝不退化成“直接复制运行中的库”。

**恢复**时 `memoryDb` 默认**不写入**（避免覆盖目标机正在使用的记忆库）：需要时用 `includeDb: true`（命令行 `/pack restore --include-db`，接口参数同名字段）。
只搬镜像不搬真库＝目标机没有记忆本体。
- 打包文件名带唯一后缀（`dsh-packer-<时间戳>-<随机>-<模式>.zip`），同一秒内多次打包不互相覆盖。
- 打包使用**纯 JS zip 实现**（zip.mjs + node:zlib）生成标准 zip，**零原生 npm 依赖**。
- 文件与子进程操作全部异步（`node:fs/promises` + `execFile`），哈希与复制走有界并发（默认 16 路），大批量打包不会卡住 DSH 的事件循环。

### 设置页 Web API（`/packer/api/*`）的鉴权与限额

设置页与 `/pack` 命令等价，走插件自己注册的前缀路由 `/packer/api/*`。这条路由的默认姿态是 **fail-closed**——判定顺序为「速率限制 → 鉴权 → 体积 → 路由」，前三步都在**读取请求体之前**完成：

| 项目 | 默认 | 行为 |
| --- | --- | --- |
| 鉴权 | `api.authMode: 'auto'` | **只用官方机制**：`ctx.get('connection')`（dsh-client-connection）的 `requestRejection(req)`——与官方 `/api` 通道同一套 Host/Origin 信任 + 浏览器会话鉴权。返回 `401` → 401，`403` → 403，只有 `undefined` 才放行 |
| 拿不到鉴权服务 | **硬拒绝 403** | `connection` 服务缺失、没有 `requestRejection`、或该调用抛错，一律 403 并说明原因；**不会静默降级**到更弱的通道（要用插件自有令牌，必须显式选 `authMode: 'token'`） |
| 速率限制 | 60 次 / 60 秒 | **最外层**：按客户端地址（`remoteAddress`）滑动窗口，先于鉴权与读体判定，未授权流量同样吃配额。超限回 429 + `retry-after`；键数量有上界（无定时器、内存有界） |
| 请求体上限 | 8 MB | 在**完整缓冲请求体之前**判定：有 `Content-Length` 先比对（超限直接 413，一个字节都不读）；没有长度则边读边累计，一超限立刻解绑监听、暂停连接并回 413 |
| 错误文案 | 出网脱敏 | 服务端绝对路径（盘符 / UNC / Unix 用户目录）统一替换为 `<路径已隐去>`，不回显本机目录结构 |

`api` 配置项（`apply(ctx, { api: { ... } })`）：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `authMode` | `'auto'` | `'auto'`：只认官方 `connection`，缺失即 403；`'token'`：**显式 opt-in** 的插件自有回退——Host / Origin / `Sec-Fetch-Site` 同源校验 + 一次性令牌（`apply` 时随机生成，经 `webServer.tapIndex` 注入同源 `index.html`，前端自动带 `x-dsh-packer-token` 头），用于宿主确实没有 `connection` 的场合；`'off'`：**不安全**，仅隔离测试用，真实部署别开 |
| `maxBodyBytes` | `8388608` | 请求体上限（字节） |
| `rateLimit` / `rateWindowMs` | `60` / `60000` | 速率限制次数与窗口（毫秒） |
| `token` | 随机生成 | 仅 `authMode: 'token'` 生效；显式传入便于固定令牌/多实例场景 |

`authMode: 'off'` 与显式传入的固定 `token` 都会把安全责任交给部署者，README 记录其存在只为「知道自己选了什么」，不代表推荐。

## 恢复与差异

恢复流程：

1. **导入 zip** —— 设置页选择文件，或 `/pack restore <zip路径>`。
2. **解包校验** —— 先列包内成员做白名单校验（绝对路径 / 盘符 / UNC / `..` / 链接类成员一律拒绝），再读 `manifest.json`。
3. **manifest 校验** —— `manifest.json` 存在、schemaVersion 与当前版本兼容、每条清单条目的 SHA-256 指纹存在且合法、每个源文件哈希与清单一致；任一不匹配即 **fail-closed 拒绝**。
4. **差异报告** —— 新增 / 变更 / 相同 / 跳过 四类计数与文件清单。
5. **冲突策略三选**：
   - `overwrite` —— 用包内内容覆盖目标文件（默认）；
   - `skip` —— 保留目标文件，跳过冲突项；
   - `merge` —— 文本文件把包内内容**追加**到目标文件末尾（带分隔注释），已有内容绝不覆盖；非文本文件退化为覆盖。
6. **备份 → 原子替换 → 失败回滚** —— 每个被覆盖/追加的目标先备份到 `<packs>/.restore-backups/<时间戳>/`，包内内容先写成临时文件再 `rename` 原子替换；**任一环节失败即中止**，并按记录把本次已替换/已新增的文件回滚回去（计数随回滚归零，回滚数单独上报）。
7. 应用，按需重启 DSH。

与包内完全一致的文件在任何策略下都会自动跳过。JSON / YAML 等结构化配置**不支持 merge**（追加即损坏），请使用覆盖或手工合并。运行中的 SQLite 库（`*.db*`）默认跳过不恢复（避免覆盖记忆数据）。

## /pack 命令参考

```text
/pack list                                                 # 列出已有包（含 [加密] 标记）
/pack create [--modules skills,memory] [--mode migrate|share] [--note 备注] [--dry-run] [--encrypt 口令]
/pack create --share                                       # --share 是 --mode share 的简写
/pack restore <zip路径> [--strategy overwrite|skip|merge] [--modules a,b] [--include-db] [--password 口令]
/pack scan                                                 # 对所有可打包模块做隐私扫描
```

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `list` | — | 列出已生成包：创建时间、大小、模块、备注、是否加密 |
| `create` | `--modules a,b` 按名选择模块；`--mode migrate\|share`（默认 `migrate`）；`--share` 简写；`--note 备注`；`--dry-run` 仅预览；`--encrypt 口令` | 不指定 `--modules` 时按模式预设自动选择（migrate = 全选；share = 只选 Skills） |
| `restore` | `<zip路径>`；`--strategy overwrite\|skip\|merge`；`--modules a,b` 只恢复指定模块；`--include-db` 连记忆真库一起恢复（需先停 DSH）；`--password 口令` | 导入 → 校验 → 差异 → 按策略应用；加密包必须给口令 |
| `scan` | — | 对所有可打包模块执行隐私扫描，报告敏感痕迹 |

包完整性校验不再单独开命令：设置页「查看」会在列出文件的同时重算 SHA-256，不一致项直接标红。

**输出目录**：打包结果写入 `~/.dsh/packs/`（`DSH_PACKS_DIR` 可覆盖）；文件名形如 `dsh-packer-<时间戳>-<随机后缀>-<模式>.zip`（唯一后缀保证同秒多次打包不互相覆盖），每次打包还会在同目录生成一个同名 `.json` 摘要文件（记录时间 / 模块 / 备注 / 文件数），供包列表与快速识别使用。恢复时的目标备份写入同目录下的 `.restore-backups/<时间戳>-<随机后缀>/`（可随时删除，列表与本插件都不会读它）。包列表、删除、重命名也可在设置页「配置打包」标签页操作。

## 配置与环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_PACKS_DIR` | `~/.dsh/packs` | 打包输出目录 |
| `DSH_MEMORY_ROOT` | `~/.dsh/memory` | memory 模块数据位置 |
| `DSH_HOME` | `~/.dsh` | DSH 数据根目录（各模块路径基准） |

设置页按「配置打包器」的任务链组织成一页五个区块：**已有的配置包 → 打包内容 → 打包选项 → 恢复（含差异对比）→ 结果明细**。包信息、完整性校验、改名、删除（送当前平台的系统回收站，鸿蒙为永久删除并先提示）都在包列表行上；恢复前先看差异对比，选模块与策略后执行，完成页给出备份目录与一键撤回。界面中文单语、无图标字符，状态一律文字表达。

## 兼容性

- **Node.js** ≥ 22.19.0
- **多平台通用**：Windows / macOS / Linux / 鸿蒙 共用同一套代码与包格式；回收站按平台分派（Windows 回收站 / macOS 废纸篓 / Linux Trash），鸿蒙仍有两项受限（回收站、系统文件选择框），原因与矩阵见 [docs/platform-support.md](docs/platform-support.md)。
- **DSH 版本闸门**：`engines.dsh` = `>=0.2.0-rc.2 <0.3.0-0`（0.2.1-rc.3 桌面版实测）。DSH 的兼容性检查带 `includePrerelease`，预发布号参与范围比较；超出该范围的 DSH 会在安装前被插件管理器拒绝。
- **peer 依赖**：`@deepseek-ai/cordis` ^4.0.2（插件生命周期基准，由宿主提供）；`@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-session` 范围同 `>=0.2.0-rc.2 <0.3.0-0`，且**未被 `index.mjs` 直接 import**——本插件只使用 `ctx.commands` / `ctx.webServer` / `ctx.slots` 等宿主内建服务，故这两项在 `peerDependenciesMeta` 中标记为 `optional: true`。
- **无需外部命令**（打包/恢复全程）：包由 zip.mjs（node:zlib）直接读写，创建 / 列成员 / 解包都不调用 tar、bsdtar、unzip；任何标准解压工具都能打开生成的包。（只有「删除进回收站」会调系统命令：Windows PowerShell / macOS osascript；Linux 为纯 Node。）

## 版本历史

| 版本 | 日期 | 类型 | 要点 |
| --- | --- | --- | --- |
| **v0.6.5** | 2026-10-25 | **会话图片/附件进包（换机迁移硬缺口）** | ①新增 `attachments` 模块（根 `~/.dsh/attachments`、`skipDirs: ['tmp']`、迁移默认带、分享不带）：会话日志里的图片只是 `{"type":"image","attachment":{"attachmentId":"sha256:…"}}` 引用，字节在 `attachments/v1/objects/<前2位>/<sha256>`（内容寻址、去重、只增不删）——只备份 `sessions` 的包，换机器恢复后会话里图片全裂。②`SENSITIVE_MODULES` 加 `attachments`，分享模式服务端强制拦截（不只靠界面置灰）。③设置页「会话记录」组改为 `["sessions","attachments"]`（不改 = 后端有模块、界面选不到）。④修正 `MEMORY_ROOT` 改用 `DSH_HOME`（此前用 `os.homedir()`，与 memoryDb 不同源）。⑤模块表补 `attachments`（顺带补漏写的 `plugins` 行）并写明「会话里的图片在 attachments，选『会话记录』组会一起打包」；对象内容寻址，恢复时无需改写引用。测试 87 → 91。 |
| **v0.6.4** | 2026-10-25 | **回收站三平台分派 + 手填路径兜底** | ①**回收站按平台分派**（`recycleFileNative` 契约不变：成功 `true` / 平台不支持 `false` / 调用失败抛错→`deletePack` 降级并回报 warning）：Windows 保持 PowerShell `SendToRecycleBin`；macOS 用 `osascript -e 'tell application "Finder" to delete POSIX file "<path>"'`（引号/反斜杠转义，30s 超时）；Linux 按 freedesktop Trash 规范纯 Node 实现——文件移入 `$XDG_DATA_HOME/Trash/files/<name>`（缺省 `~/.local/share`，同名加 `.1` 后缀），`Trash/info/<name>.trashinfo` 写 `Path=`（URL 编码绝对路径）与 `DeletionDate=`（本地时间 `YYYY-MM-DDThh:mm:ss`）；鸿蒙/其他仍返回 `false`（永久删除 + warning）。②**手填路径**：恢复页「或填包路径」入口保留；`/status` 新增 `platform` / `trash` / `filePicker` 三个平台能力字段，没有系统文件选择框的平台（鸿蒙）上提示「当前平台请直接填写包路径」并以其为主入口，删除确认文案改为如实告知不可恢复；本插件在网页层拿不到宿主机路径，因此任何平台都不渲染点了没反应的选择框按钮。③路径示例按平台给（`/storage/…`、`/home/…`、`/Users/…`）。测试 80 → 87。 |
| **v0.6.3** | 2026-10-25 | 文档 / 打包范围 | **多平台通用文档随包发布**：`files` 补 `docs`，装好插件后包内自带 `docs/platform-support.md`（Windows / macOS / Linux / 鸿蒙 的支持范围，及两处受限项：回收站、系统文件选择框）；代码与功能无变更。 |
| **v0.6.2** | 2026-10-25 | 简介 / 文案 | 首段改成「封箱 / 开箱」的说法，桌面版实测版本改 0.2.1-rc.3；功能无变更 |
| **v0.6.1** | 2026-10-25 | **插件卡片文案重写** | 显示名「配置打包」+ 一句话简介（`locale/en.json`、`locale/zh.json` 的 `meta`），`description` 去掉版本号与功能罗列；功能无变更。 |
| **v0.6.0** | 2026-10-25 | **设置页按「配置打包器」重做** | 界面从「模块卡 + 一堆按钮的表单」改成一条任务链，一页五个区块：**已有的配置包**（包名/时间/内容/大小/是否加密 + 恢复·包信息·删除，删除进 Windows 回收站）→ **打包内容**（人话清单：技能库 / 已安装插件 / 记忆数据库 / 会话记录 / 配置与预设，带体积与合计）→ **打包选项**（原样 / 清理后打包（脱敏）/ 加密，含口令、扫描结论、进度与取消）→ **恢复**（选包或填路径 → 差异对比表：包内 vs 本机 vs 处理方式 → 模块勾选 + 记忆库开关 → 策略）→ **结果明细**（覆盖/新增/跳过/待确认/失败 + 备份目录 + 一键撤回）。命名全面贴合插件本体（不再用「箱子/封箱/开箱」这类比喻），界面中文单语、**无 emoji 与图标字符**，状态一律文字。`lib/client.js` 1048 → 1421 行（多出来的是配置包列表、包信息与结果明细）。后端补两字段：`GET /packs` 每项带 `modules` 与 `sha256`，`create` 结果 `pack.sha256`。测试 80/80。 |
| **v0.5.1** | 2026-10-25 | **隐私真处理 + 迁移带插件本体** | ①隐私从「只报警」升级为「必须处理」：打包页两选——**清理后打包**（只改包内副本，路径→`<本机路径>`/`<用户目录>`/`<UNC路径>`/`<Unix路径>`，密钥→`<已移除的密钥>`，源文件零修改；分享模式强制）与**不清理直接打包**（保真，含凭据又未加密时明确告警）。②脱敏安全五道闸：单遍最左扫描、结构字符排除、命中含 `{ } [ ] , ; " '` 等符号就跳过并告警、`.json/.jsonl` 脱敏后真跑解析与行形状校验（失败整文件回退）、非 UTF-8 不脱敏；脱敏后按新内容重算 size/sha256（否则恢复端 fail-closed 会把包判坏）。③新增 `plugins` 模块：把**已安装插件本体**（`profiles/*/node_modules` 一级包，@scope 两级，跟 pnpm 链接、防环）打进迁移包，默认带、分享绝不带。④恢复回填：sanitized 包写入前把 `<用户目录>`→本机 home、`<用户名>`→当前用户名，其余占位符保留并计入 `stats.warnings`。⑤`/scan` 每条命中带 `kind`（7 类）。测试 80/80。 |
| **v0.5.0** | 2026-10-25 | **收敛（小而美）** | 只做减法：①**删自建回收站**（3 个接口 + 折叠区）→ 删除包改送 **Windows 系统回收站**，用资源管理器就能找回；②**删定时自动备份/保留策略/配置持久化**（避免做成调度中心）；③**删独立 `verify` 接口与命令** → 并进「查看」：列文件时顺带重算 SHA-256，不一致标红；④`/status` 去掉 `trashCount`/`retention`/`autoBackup`/`disk.trashBytes`；⑤UI **三 Tab → 两 Tab**（打包 / 恢复，包管理并入恢复页包行），**删掉整套英文文案**（个人工具中文单语），`lib/client.js` 2334 → ≤1100 行；⑥打包完成卡新增「复制路径」。接口 15 → 9 组。保留：进度与取消、加密包（一个勾选 + 口令）、选择性恢复、`includeDb`、恢复备份与一键回滚、隐私扫描与分享拦截。 |
| **v0.4.0** | 2026-10-25 | **功能补齐 + UI 重构 + 修复三处安全承诺落空** | ①**修假阴性**：设置页「扫描检查」此前把文件列表降级成 `{module,rel,size}` 丢掉绝对路径，`privacyScan` 按相对路径读不到文件 → 恒零命中却显示「未发现隐私风险」；现补回 `abs`。②**分享保护真正生效**：服务端对 `share` 模式强制校验，勾了 sessions/profiles/settings/presets/memory/memoryDb 直接 400 `share_scope`，不再只靠界面自觉。③**恢复记忆真库**：`includeDb` 从「只有接口有」补到界面开关 + CLI `--include-db`。④`/status` 不再对记忆库做 `VACUUM INTO`（旧实现每打开一次设置页泄漏一份 ~2.9MB 临时快照）。⑤`strategy`/`mode` 白名单 fail-closed（旧实现非法值静默退化成覆盖）。⑥新增：异步作业（进度/取消）、选择性恢复、逐文件差异、包内文件浏览、`/pack verify`、回收站（删除可恢复/清空）、AES-256-GCM 加密包、自动备份 + 保留策略、恢复备份一键回滚。⑦UI 从单页四段平铺改为 **三 Tab（打包 / 包库 / 恢复）**，自研输入弹层与确认弹层（移除 `window.prompt`/`confirm`——Electron 不支持 prompt，重命名按钮此前在桌面端点了没反应）。测试 74/74。 |
| **v0.3.0** | 2026-09-29 | **修 UI 漏模块**：设置页的模块清单此前是硬编码 6 项，导致 v0.2.6 新增的 `memoryDb`（记忆真库）**在界面上根本勾不到**——现改为完全由 host 的 `/status` 驱动（`moduleOrder(status.modules)`），默认勾选也遍历全部模块；新增两条一致性守卫测试（客户端不得再硬编码模块清单、host 的每个模块必须能在客户端渲染）。测试 50/50。 |
| **v0.2.6** | 2026-09-29 | 功能 / 适配 | **记忆真库进包（一致快照）+ 适配 DSH 0.2.0-rc.2**（取代 v0.2.5「真库不在包内」的限制）：①新增 `memoryDb` 模块——把记忆的运行时事实源（`<DSH_BIOMEMORY_DIR || ~/.dsh/biomemory>/biomemory.db`）用 `VACUUM INTO` 取一致快照后入包（只读连接，不复制运行中的 WAL 库；实测 2.78MB 源库 → 2.57MB 可读快照，条目与审计行完整）；快照失败则该文件不进包并计入 `unreadable`，绝不静默降级；快照落在系统临时目录，打包结束（含失败与 `--dry-run`）统一清理。②`dsh.client.inject` 删除 0.2.0 中不存在的 `@deepseek-ai/dsh-client-runtime`。测试 48/48 全绿 |
| **v0.2.5** | 2026-09-20 | 语义澄清 | **包里的「记忆」只是镜像**：memory 模块打包 `~/.dsh/memory` 的 Markdown 只读副本，而记忆的运行时事实源是 SQLite（`~/.dsh/biomemory/biomemory.db`）——被 `skipFiles` 排除且不在扫描范围（运行中的 WAL 库复制出来可能是坏的）。模块标签改为「记忆镜像（…；运行时 SQLite 真库不在包内）」，中英 README 增「记忆怎么迁移（重要）」：**先停 DSH，再手动复制 biomemory.db（含 -wal/-shm）**，"只搬包不搬库＝目标机只有镜像"。另：客户端 bundle 迁入 `lib/client.js`。47 测试全绿 |
| **v0.2.4** | 2026-09-17 | 异步化 / 安全加固 | 文件与子进程操作全链路异步（`node:fs/promises` + `execFile`，哈希改流式、复制与哈希走有界并发 16 路，`sha256()` 失败即抛错），对外 API 一律返回 Promise、不再阻塞事件循环；新增 `/packer/api/*` 防护：鉴权默认 fail-closed（只用官方 `connection.requestRejection`，服务缺失/接口缺失/调用抛错一律 403）、显式 opt-in 的一次性令牌回退（`authMode: 'token'`，同源校验 + `webServer.tapIndex` 注入）、速率限制（60 次/分钟，最外层）与请求体上限（8 MB，在完整缓冲请求体之前判定）、错误文案路径脱敏；`apply()` 明确接线到 `webServer.register({ kind: 'prefix', path: '/packer/api' })`；测试补齐 47 例（含未授权 403 / 超限 413 / 限流 429 / 令牌路径 / 无 connection 默认拒绝 / apply 接线） |
| **v0.2.3** | 2026-09-16 | 安全加固 | 恢复侧目标路径 containment + rel 白名单（拒绝绝对/盘符/UNC/`..`）；完整性 fail-closed（缺指纹或格式非法一律拒绝，`sha256()` 异常改为抛出、改流式哈希）；解包前 `tar -tf` 成员白名单 + 拒绝链接类成员 + 临时目录统一 `try/finally` 清理；恢复改为「备份 → 临时文件 → rename 原子替换 → 失败中止回滚」；`memory` 模块默认排除 `*.db*`；隐私扫描补齐 Unix/UNC 路径、无引号密钥与裸密钥形状、`.env` 等无扩展名文本，命中数按行全量计数；打包文件名加唯一后缀；`peerDependenciesMeta` 标记宿主内建 peer 为 optional；前端错误提示改为展示服务端原因 |
| **v0.2.2** | 2026-09-05 | 适配 / UI | 适配 DSH 0.1.2-rc.1；管理面板按「骨架/血肉/呼吸」设计语言定制——打包工作流布局（阶段流程条 / 器材面板 / diff 色带）+ 橙琥珀青品牌色（打包迁移）+ 深色适配（DSH 主题跟随，双通道探测） |
| **v0.2.1** | 2026-09-05 | UI 重构 | Config Packer 面板 UI 重构——neutralSurface 底 + 白色卡片（max-width 860 居中、圆角 16）、4/8px 栅格、150ms 克制动效；配色为品牌琥珀双主题色板（`--pk-*` 变量集中定义，亮/暗两套，非散落硬编码）；差异报表四列计数徽章 + 语义色点（新增=绿 / 变更=橙 / 相同与跳过=灰）；隐私风险默认警告橙 |
| **v0.2.0** | 2026-09-05 | 安全加固 | 隐私扫描修复：合并后的个人规则真正参与循环；恢复前对每个源文件做 manifest SHA-256 校验（fail-closed）；恢复路径 containment（zip-slip / 篡改清单拒越界）；结构化配置（JSON/YAML）禁用 append 合并（会损坏） |
| **v0.1.2** | — | 元数据 / 依赖 | package.json 补 keywords / files 元数据；peerDeps 放宽 ≥0.1.1-rc.2；README 版本与依赖说明同步 |
| **v0.1.0** | — | 初版 | 模块打包（skills / sessions / profiles / settings / presets / memory）、隐私扫描、恢复差异、包管理、设置面板 |

## 常见问题

**生成的 zip 打不开 / 提示损坏？**

包是纯 JS 生成的标准 zip，Windows 资源管理器与常见解压工具均可打开。若校验失败，请勿手工解压改动包内容（会破坏 `manifest.json` 里的 SHA-256 指纹），直接用 `/pack create` 重新生成。可用 `/pack list` 查看 `~/.dsh/packs`（或 `DSH_PACKS_DIR` 指向的目录）里有哪些包。

**恢复时 manifest 校验失败？**

通常是以下几种情况：该 zip 不是 dsh-packer 生成的（包内没有 `manifest.json`）、`manifest.json` 缺失或 `schemaVersion` 与当前版本不兼容、或包生成后被改动过。请重新分发原包或重新生成。

**分享包被拦截怎么办？**

分享模式刻意严格：只要扫到本地绝对路径、用户目录路径、疑似密钥、个人昵称等敏感痕迹就直接报错、不生成包。先运行 `/pack scan` 看哪些文件命中，清理或替换敏感内容后重试。个人备份可用迁移模式（仅报告），但请勿把这类包发给别人。

**「合并」策略具体怎么工作？**

对文本文件：把包内内容**追加**到目标文件末尾，带分隔注释——已有内容绝不覆盖；非文本文件退化为覆盖；JSON / YAML 等结构化配置不支持合并（追加即损坏），请用覆盖或手工合并。与包内完全一致的文件在任何策略下都自动跳过。

**恢复报「已中止 / 已回滚」是什么意思？**

恢复是「整批或不做」的：任一环节（路径校验、指纹校验、写盘）失败就立即中止，并把本次已经替换/新增的文件按备份回滚回去——`已回滚 N` 表示回滚了多少个文件，失败原因在设置页的失败清单里逐条列出。备份留在 `<packs>/.restore-backups/` 下，可手工核对。

**为什么记忆数据库（`*.db*`）默认不被恢复？**

运行中的 SQLite 库被 DSH / 记忆插件持有，直接覆写可能损坏数据。所以本插件默认不打包也不恢复 `*.db`、`*.db-wal`、`*.db-shm`、`*.sqlite`，恢复时会把它计入「跳过」并单列原因。

要真的把记忆搬过去：**先退出 DSH**，在恢复页打开 `includeDb` 开关（或 `/pack restore <包> --include-db`）再执行。打包侧的记忆真库来自 `VACUUM INTO` 一致快照（`memoryDb` 模块），是完整可用的库。

**恢复报「清单条目缺少合法 SHA-256 指纹」？**

该包不是 dsh-packer 生成的、或 `manifest.json` 被手工改过。指纹缺失/格式非法一律拒绝恢复（fail-closed），请重新分发原包或重新生成。

**包存在哪里？**

默认 `~/.dsh/packs`，可用 `DSH_PACKS_DIR` 环境变量覆盖；每个包在同目录下还带一个同名 `.json` 摘要文件，便于识别与包列表展示。

## 开发

```bash
npm test                          # node --test "tests/*.test.mjs"，37 个用例全绿
node scripts/release-check.mjs    # 发布一致性自检（版本号 / README 版本露出 / files 白名单 / git 状态）
```

**CI**：`.github/workflows/ci.yml` 在 Node 22.x / 24.x 上执行「发布自检 → 单元测试 → `npm pack --dry-run`」（本包零运行时依赖，无需安装步骤），推送与 PR 都会触发。

## License

MIT — 详见 [LICENSE](LICENSE)。
