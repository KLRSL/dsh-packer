# dsh-packer

> **Agent 配置打包器**：把本地 DSH 资产按模块打包成标准 zip——迁移、分享、恢复，隐私扫描全程护航。
>
> [简体中文](README.md) · [English](README.en.md)

> **v0.2.2** · MIT License · DSH ≥ 0.1.1-rc.2（已适配 0.1.2-rc.1）· Node ≥ 22.19.0

dsh-packer 是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）的「Agent 配置打包器」插件：把本地 Agent 资产按模块打包成标准 zip，用于两种场景：

- **迁移** —— 换机器或重装后，把整套环境完整搬过去。
- **分享** —— 把 Skills 等资产交给别人，敏感内容自动拦截。

打包内容可按模块自由组合（Skills / 会话 / Profile / 设置 / 预设 / 记忆），恢复带差异对比与冲突策略，隐私安全扫描全程护航——全部能力按需开启。

## 功能特性

| 特性 | 说明 |
| --- | --- |
| 模块化打包 | 六个模块任意组合：`skills` / `sessions` / `profiles` / `settings` / `presets` / `memory` |
| 双模式预设 | **迁移**（全选）/ **分享**（只勾 Skills，自动排除会话、记忆与个人 skill 子目录） |
| 隐私安全扫描 | 打包前检测本地绝对路径、用户目录路径、疑似密钥、个人昵称；**分享命中即拦截，迁移仅报告** |
| 文件级操作预览 | 打包前预览完整文件清单；恢复前差异报告（新增 / 变更 / 相同 / 跳过） |
| 恢复冲突三选 | 覆盖 / 跳过 / 内容合并（合并 = 追加，绝不覆盖已有内容） |
| 清单完整性校验 | `manifest.json` 记录 schemaVersion + 每个文件 SHA-256 指纹，恢复前 fail-closed 校验 |
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

恢复前自动校验 `manifest.json`（schemaVersion + SHA-256），确认差异报告后按策略应用，按需重启 DSH。

## 打包模块

| 模块 | 内容 | 迁移预设 | 分享预设 |
| --- | --- | --- | --- |
| `skills` | Skills（含记忆机制 skill），位于 `~/.dsh/skills` | ✅ | ✅ |
| `sessions` | 会话记录（`.zstd` 格式），位于 `~/.dsh/sessions` | ✅ | ❌ |
| `profiles` | Profile 配置（不含 `node_modules`），位于 `~/.dsh/profiles` | ✅ | ❌ |
| `settings` | 全局设置（`settings.yaml`） | ✅ | ❌ |
| `presets` | Agent 预设（`.agent-presets`） | ✅ | ❌ |
| `memory` | 记忆数据（`DSH_MEMORY_ROOT` 或 `~/.dsh/memory`，不含 `backups/`） | ✅ | ❌ |

**双模式预设**：

- **迁移** —— 全部模块默认勾选，适合搬迁整套环境。
- **分享** —— 只勾 `skills`；会话与记忆数据自动排除，个人 skill 子目录（`_shared`）在分享时也会排除，让敏感内容尽可能少进包。

## 隐私与安全

**扫描规则**（仅针对文本文件）：

| 规则 | 说明 |
| --- | --- |
| 本地绝对路径 | 盘符形式路径（如 `D:\...`、`/home/...`） |
| 用户目录路径 | 操作系统用户配置文件目录下的路径 |
| 疑似密钥 / Token | `api_key`、`secret`、`password`、`token`、`bearer`、`authorization` 等赋值 |
| 个人昵称 | 用户昵称文本 |
| Windows 用户名路径 | 用户名出现在路径中 |

**拦截策略**：

- **分享模式** —— 命中任何规则即返回错误、**强制拦截**，不生成包。分享包是给别人用的，必须严格。
- **迁移模式** —— 仅报告不拦截，可用 `/pack scan` 或 `--dry-run` 提前查看命中点，自行判断。

**永不打包**：`.credentials.yaml`、`.anonymous-user-id`——遍历任何模块时一律跳过，这类本地身份/凭据文件不允许进入任何包（无论迁移还是分享）。

其他安全措施：

- 每个文件的 **SHA-256** 指纹写入 `manifest.json`，恢复时用于完整性校验（fail-closed）。
- 恢复路径做 containment 校验（zip-slip / 篡改清单的 `../` 越界一律拒绝）。
- 打包使用系统 **bsdtar**（libarchive）生成标准 zip，**零原生 npm 依赖**。

## 恢复与差异

恢复流程：

1. **导入 zip** —— 设置页选择文件，或 `/pack restore <zip路径>`。
2. **manifest 校验** —— `manifest.json` 存在、schemaVersion 与当前版本兼容、每个源文件 SHA-256 与清单一致；任一不匹配即 **fail-closed** 整体拒绝（不应用任何文件）。
3. **差异报告** —— 新增 / 变更 / 相同 / 跳过 四类计数与文件清单。
4. **冲突策略三选**：
   - `overwrite` —— 用包内内容覆盖目标文件（默认）；
   - `skip` —— 保留目标文件，跳过冲突项；
   - `merge` —— 文本文件把包内内容**追加**到目标文件末尾（带分隔注释），已有内容绝不覆盖；非文本文件退化为覆盖。
5. 应用，按需重启 DSH。

与包内完全一致的文件在任何策略下都会自动跳过。JSON / YAML 等结构化配置**不支持 merge**（追加即损坏），请使用覆盖或手工合并。

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

**输出目录**：打包结果写入 `~/.dsh/packs/`（`DSH_PACKS_DIR` 可覆盖）；每次打包还会在同目录生成一个同名 `.json` 摘要文件（记录时间 / 模块 / 备注 / 文件数），供包列表与快速识别使用。包列表、删除、重命名也可在设置页「配置打包」标签页操作。

## 配置与环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_PACKS_DIR` | `~/.dsh/packs` | 打包输出目录 |
| `DSH_MEMORY_ROOT` | `~/.dsh/memory` | memory 模块数据位置 |
| `DSH_HOME` | `~/.dsh` | DSH 数据根目录（各模块路径基准） |

设置页提供 **「配置打包」** 标签页（模块勾选 / 预设切换 / 预览 / 打包 / 恢复 / 包管理），与 `/pack` 命令完全等价，习惯图形界面的用户可全程在设置页完成。

## 兼容性

- **Node.js** ≥ 22.19.0
- **DSH 依赖** `@deepseek-ai/dsh-*` ≥ 0.1.1-rc.2（当前 latest 线；v0.2.2 已适配并实测 0.1.2-rc.1；peer 依赖：`@deepseek-ai/cordis` ^4.0.2、`@deepseek-ai/dsh-tools` ≥0.1.1-rc.2、`@deepseek-ai/dsh-session` ≥0.1.1-rc.2）
- **bsdtar**：Windows 10+ 自带 `tar.exe`（bsdtar/libarchive）；macOS 的 `tar` 即 bsdtar。不依赖任何 npm 原生模块。

## 版本历史

| 版本 | 日期 | 类型 | 要点 |
| --- | --- | --- | --- |
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

**包存在哪里？**

默认 `~/.dsh/packs`，可用 `DSH_PACKS_DIR` 环境变量覆盖；每个包在同目录下还带一个同名 `.json` 摘要文件，便于识别与包列表展示。

## 开发

```bash
npm test    # node --test "tests/*.test.mjs"
```

## License

MIT — 详见 [LICENSE](LICENSE)。
