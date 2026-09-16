# dsh-packer

> **Agent 配置打包器**：把本地 DSH 资产按模块打包成标准 zip——迁移、分享、恢复，隐私扫描全程护航。
>
> [简体中文](README.md) · [English](README.en.md)

> **v0.2.4** · MIT License · DSH ≥ 0.1.1-rc.2（预发布版本号不受 semver 范围约束，已实测 0.1.5-rc.1）· Node ≥ 22.19.0

dsh-packer 是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）的「Agent 配置打包器」插件：把本地 Agent 资产按模块打包成标准 zip，用于两种场景：

- **迁移** —— 换机器或重装后，把整套环境完整搬过去。
- **分享** —— 把 Skills 等资产交给别人，敏感内容自动拦截。

打包内容可按模块自由组合（Skills / 会话 / Profile / 设置 / 预设 / 记忆），恢复带差异对比与冲突策略，隐私安全扫描全程护航——全部能力按需开启。

## 功能特性

| 特性 | 说明 |
| --- | --- |
| 模块化打包 | 六个模块任意组合：`skills` / `sessions` / `profiles` / `settings` / `presets` / `memory`（`memory` 默认排除运行中的 SQLite 库 `*.db*`） |
| 双模式预设 | **迁移**（全选）/ **分享**（只勾 Skills，自动排除会话、记忆与个人 skill 子目录） |
| 隐私安全扫描 | 打包前检测盘符 / Unix / UNC 路径、用户目录路径、疑似密钥赋值、密钥形状（`sk-`、`ghp_`、`AKIA`、JWT 等）、个人昵称；逐行**全量计数**；**分享命中即拦截，迁移仅报告** |
| 文件级操作预览 | 打包前预览完整文件清单；恢复前差异报告（新增 / 变更 / 相同 / 跳过） |
| 恢复冲突三选 | 覆盖 / 跳过 / 内容合并（合并 = 追加，绝不覆盖已有内容） |
| 恢复安全写入 | 先备份目标到 packs 目录下的 `.restore-backups/<时间戳>/`，写临时文件后 `rename` **原子替换**；任一环节失败即**中止并回滚**已替换/已新增的文件 |
| 清单完整性校验 | `manifest.json` 记录 schemaVersion + 每个文件 SHA-256 指纹；恢复前校验源文件与清单一致，**缺指纹或指纹格式非法一律拒绝**（fail-closed） |
| 包管理与备注 | 包列表（时间 / 大小 / 模块 / 备注）、删除、重命名、打包时填写备注 |
| 分享包自动附 README | 自动生成并附带说明包内容的 `README.md` |
| 深色模式适配 | 打包工作流面板跟随 DSH 主题（`--dsw-alias-*` 变量，双通道探测） |
| 零原生依赖 | 系统 bsdtar（libarchive）生成标准 zip，任何解压工具可打开 |

## 安装

### 从 GitHub 安装（推荐）

```bash
# 需要已安装 git；--profile web 换成你的 profile 名
dsh plugin --profile web add github:KLRSL/dsh-packer
```

### 本地 bundle（开发 / link）

```bash
# 在项目目录下执行
dsh plugin --profile web add link:./dsh-packer
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
| `profiles` | Profile 配置（不含 `node_modules`），位于 `~/.dsh/profiles` | ✅ | ❌ |
| `settings` | 全局设置（`settings.yaml`） | ✅ | ❌ |
| `presets` | Agent 预设（`.agent-presets`） | ✅ | ❌ |
| `memory` | 记忆数据（`DSH_MEMORY_ROOT` 或 `~/.dsh/memory`，不含 `backups/` 与运行中的 SQLite 库 `*.db*`） | ✅ | ❌ |

**双模式预设**：

- **迁移** —— 全部模块默认勾选，适合搬迁整套环境。
- **分享** —— 只勾 `skills`；会话与记忆数据自动排除，个人 skill 子目录（`_shared`）在分享时也会排除，让敏感内容尽可能少进包。

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
- 解包前先用 `tar -tf` 列成员做白名单校验（拒绝绝对路径 / 盘符 / UNC / `..`），并拒绝符号链接、硬链接等非普通文件类型；解压后再扫一遍解压结果，出现符号链接即拒绝。临时解压目录统一在 `try/finally` 中清理（成功、失败都不残留）。
- 恢复前先备份目标（`<packs>/.restore-backups/<时间戳>/`），写临时文件后 `rename` 原子替换；任一环节失败即中止并回滚本次已替换/已新增的文件。
- 运行中的 SQLite 库（`*.db`、`*.db-wal`、`*.db-shm`、`*.sqlite`）默认既不打包也不恢复——被 DSH / 记忆插件持有，覆写可能损坏数据。
- 打包文件名带唯一后缀（`dsh-packer-<时间戳>-<随机>-<模式>.zip`），同一秒内多次打包不互相覆盖。
- 打包使用系统 **bsdtar**（libarchive）生成标准 zip，**零原生 npm 依赖**。
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
/pack list                                      # 列出已有包（时间/大小/模块/备注）
/pack create [--modules skills,memory] [--mode migrate|share] [--note 备注] [--dry-run]
/pack create --share                            # --share 是 --mode share 的简写
/pack restore <zip路径> [--strategy overwrite|skip|merge]
/pack scan                                      # 对所有可打包模块做隐私扫描
```

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `list` | — | 列出已生成包：创建时间、大小、包含模块、备注 |
| `create` | `--modules a,b` 按名选择模块；`--mode migrate\|share`（默认 `migrate`）；`--share` 简写；`--note 备注`；`--dry-run` 仅预览 | 不指定 `--modules` 时按模式预设自动选择（migrate = 全选；share = 只选 Skills） |
| `restore` | `<zip路径>` 待恢复包；`--strategy overwrite\|skip\|merge` | 导入 zip → 校验 → 差异报告 → 按所选策略应用 |
| `scan` | — | 对所有可打包模块执行隐私扫描，报告敏感痕迹 |

**输出目录**：打包结果写入 `~/.dsh/packs/`（`DSH_PACKS_DIR` 可覆盖）；文件名形如 `dsh-packer-<时间戳>-<随机后缀>-<模式>.zip`（唯一后缀保证同秒多次打包不互相覆盖），每次打包还会在同目录生成一个同名 `.json` 摘要文件（记录时间 / 模块 / 备注 / 文件数），供包列表与快速识别使用。恢复时的目标备份写入同目录下的 `.restore-backups/<时间戳>-<随机后缀>/`（可随时删除，列表与本插件都不会读它）。包列表、删除、重命名也可在设置页「配置打包」标签页操作。

## 配置与环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_PACKS_DIR` | `~/.dsh/packs` | 打包输出目录 |
| `DSH_MEMORY_ROOT` | `~/.dsh/memory` | memory 模块数据位置 |
| `DSH_HOME` | `~/.dsh` | DSH 数据根目录（各模块路径基准） |

设置页提供 **「配置打包」** 标签页（模块勾选 / 预设切换 / 预览 / 打包 / 恢复 / 包管理），与 `/pack` 命令完全等价，习惯图形界面的用户可全程在设置页完成。

## 兼容性

- **Node.js** ≥ 22.19.0
- **DSH 依赖** `@deepseek-ai/dsh-*` ≥ 0.1.1-rc.2（v0.2.4 已实测 0.1.5-rc.1）。**注意：预发布版本号不受 semver 范围约束**——`>=0.1.1-rc.2` 按 node-semver 规则并不满足 `0.1.5-rc.1`（实测 `satisfies=false`），该范围仅作参考记录，不承担版本闸门作用。
- **peer 依赖**：`@deepseek-ai/cordis` ^4.0.2（插件生命周期基准，由宿主提供）；`@deepseek-ai/dsh-tools` ≥0.1.1-rc.2 与 `@deepseek-ai/dsh-session` ≥0.1.1-rc.2 **未被 `index.mjs` 直接 import**——本插件只使用 `ctx.commands` / `ctx.webServer` / `ctx.slots` 等宿主内建服务，命令与 HTTP 入口都从 context 取，故这两项已在 `package.json` 的 `peerDependenciesMeta` 中标记为 `optional: true`（宿主必定提供，安装时不再强制校验），范围同为参考记录。
- **bsdtar**：Windows 10+ 自带 `tar.exe`（bsdtar/libarchive）；macOS 的 `tar` 即 bsdtar。不依赖任何 npm 原生模块。实测本机 bsdtar 会拒绝 `..` 成员；解包白名单校验在其之前先做，错误信息更明确，且对符号链接成员/其他 tar 实现同样生效。

## 版本历史

| 版本 | 日期 | 类型 | 要点 |
| --- | --- | --- | --- |
| **v0.2.4** | 2026-09-17 | 异步化 / 安全加固 | 文件与子进程操作全链路异步（`node:fs/promises` + `execFile`，哈希改流式、复制与哈希走有界并发 16 路，`sha256()` 失败即抛错），对外 API 一律返回 Promise、不再阻塞事件循环；新增 `/packer/api/*` 防护：鉴权默认 fail-closed（只用官方 `connection.requestRejection`，服务缺失/接口缺失/调用抛错一律 403）、显式 opt-in 的一次性令牌回退（`authMode: 'token'`，同源校验 + `webServer.tapIndex` 注入）、速率限制（60 次/分钟，最外层）与请求体上限（8 MB，在完整缓冲请求体之前判定）、错误文案路径脱敏；`apply()` 明确接线到 `webServer.register({ kind: 'prefix', path: '/packer/api' })`；测试补齐 47 例（含未授权 403 / 超限 413 / 限流 429 / 令牌路径 / 无 connection 默认拒绝 / apply 接线） |
| **v0.2.3** | 2026-09-16 | 安全加固 | 恢复侧目标路径 containment + rel 白名单（拒绝绝对/盘符/UNC/`..`）；完整性 fail-closed（缺指纹或格式非法一律拒绝，`sha256()` 异常改为抛出、改流式哈希）；解包前 `tar -tf` 成员白名单 + 拒绝链接类成员 + 临时目录统一 `try/finally` 清理；恢复改为「备份 → 临时文件 → rename 原子替换 → 失败中止回滚」；`memory` 模块默认排除 `*.db*`；隐私扫描补齐 Unix/UNC 路径、无引号密钥与裸密钥形状、`.env` 等无扩展名文本，命中数按行全量计数；打包文件名加唯一后缀；`peerDependenciesMeta` 标记宿主内建 peer 为 optional；前端错误提示改为展示服务端原因 |
| **v0.2.2** | 2026-09-05 | 适配 / UI | 适配 DSH 0.1.2-rc.1；管理面板按「骨架/血肉/呼吸」设计语言定制——打包工作流布局（阶段流程条 / 器材面板 / diff 色带）+ 橙琥珀青品牌色（打包迁移）+ 深色适配（DSH 主题跟随，双通道探测） |
| **v0.2.1** | 2026-09-05 | UI 重构 | Config Packer 面板 UI 重构——neutralSurface 底 + 白色卡片（max-width 860 居中、圆角 16）、4/8px 栅格、150ms 克制动效；配色取自 dsh-fuse default 令牌（`--pk-*` 变量零硬编码）；差异报表四列计数徽章 + 语义色点（新增=绿 / 变更=橙 / 相同与跳过=灰）；隐私风险默认警告橙 |
| **v0.2.0** | 2026-09-05 | 安全加固 | 隐私扫描修复：合并后的个人规则真正参与循环；恢复前对每个源文件做 manifest SHA-256 校验（fail-closed）；恢复路径 containment（zip-slip / 篡改清单拒越界）；结构化配置（JSON/YAML）禁用 append 合并（会损坏） |
| **v0.1.2** | — | 元数据 / 依赖 | package.json 补 keywords / files 元数据；peerDeps 放宽 ≥0.1.1-rc.2；README 版本与依赖说明同步 |
| **v0.1.0** | — | 初版 | 模块打包（skills / sessions / profiles / settings / presets / memory）、隐私扫描、恢复差异、包管理、设置面板 |

## 常见问题

**生成的 zip 打不开 / 提示损坏？**

包由系统 bsdtar 生成的标准 zip，Windows 资源管理器与常见解压工具均可打开。若校验失败，请勿手工解压改动包内容（会破坏 `manifest.json` 里的 SHA-256 指纹），直接用 `/pack create` 重新生成。可用 `/pack list` 查看 `~/.dsh/packs`（或 `DSH_PACKS_DIR` 指向的目录）里有哪些包。

**恢复时 manifest 校验失败？**

通常是以下几种情况：该 zip 不是 dsh-packer 生成的（包内没有 `manifest.json`）、`manifest.json` 缺失或 `schemaVersion` 与当前版本不兼容、或包生成后被改动过。请重新分发原包或重新生成。

**分享包被拦截怎么办？**

分享模式刻意严格：只要扫到本地绝对路径、用户目录路径、疑似密钥、个人昵称等敏感痕迹就直接报错、不生成包。先运行 `/pack scan` 看哪些文件命中，清理或替换敏感内容后重试。个人备份可用迁移模式（仅报告），但请勿把这类包发给别人。

**「合并」策略具体怎么工作？**

对文本文件：把包内内容**追加**到目标文件末尾，带分隔注释——已有内容绝不覆盖；非文本文件退化为覆盖；JSON / YAML 等结构化配置不支持合并（追加即损坏），请用覆盖或手工合并。与包内完全一致的文件在任何策略下都自动跳过。

**恢复报「已中止 / 已回滚」是什么意思？**

恢复是「整批或不做」的：任一环节（路径校验、指纹校验、写盘）失败就立即中止，并把本次已经替换/新增的文件按备份回滚回去——`已回滚 N` 表示回滚了多少个文件，失败原因在设置页的失败清单里逐条列出。备份留在 `<packs>/.restore-backups/` 下，可手工核对。

**为什么记忆数据库（`*.db*`）没被恢复？**

运行中的 SQLite 库被 DSH / 记忆插件持有，直接覆写可能损坏数据。本插件默认既不打包也不恢复 `*.db`、`*.db-wal`、`*.db-shm`、`*.sqlite`，恢复时会把它计入「跳过」并单列原因。

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
