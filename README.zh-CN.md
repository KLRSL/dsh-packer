# dsh-packer

[English](README.md)

**dsh-packer** 是 **DeepSeek Harness (DSH)** 的「配置打包器」插件：把本地 Agent 资产按模块打包成 zip，用于两种场景：

- **迁移**——换机器或重装后，把整套环境搬过去。
- **分享**——把 Skills 等资产交给别人。

版本 **v0.1.0** · MIT License

---

## 功能

### 打包模块（全部可选勾选）

| 模块       | 内容 | 迁移预设 | 分享预设 |
|-----------|------|:------:|:------:|
| `skills`  | Skills（含记忆机制 skill），位于 `~/.dsh/skills` | ✅ | ✅ |
| `sessions`| 会话记录（`.zstd` 格式），位于 `~/.dsh/sessions` | ✅ | ❌ |
| `profiles`| Profile 配置（不含 `node_modules`），位于 `~/.dsh/profiles` | ✅ | ❌ |
| `settings`| 全局设置（`settings.yaml`） | ✅ | ❌ |
| `presets` | Agent 预设（`.agent-presets`） | ✅ | ❌ |
| `memory`  | 记忆数据（`DSH_MEMORY_ROOT` 或 `~/.dsh/memory`，不含 `backups/`） | ✅ | ❌ |

### 双模式预设

- **迁移**——全部模块默认勾选。
- **分享**——只勾 `skills`；会话与记忆数据自动排除，个人 skill 子目录在分享时也会排除。

### 核心功能

1. **隐私安全扫描**——打包前自动检测本地绝对路径、用户目录路径、疑似密钥、个人昵称。**分享模式**命中即强制拦截（返回错误）；**迁移模式**仅报告。
2. **文件级操作清单**——打包前预览所有文件；恢复前给出差异对比（新增 / 变更 / 相同 / 跳过）。
3. **包管理**——已生成包列表（时间 / 大小 / 模块 / 备注）、删除、重命名。
4. **恢复**——导入 zip → `manifest.json` 校验（schemaVersion + SHA-256 指纹）→ 差异报告 → 冲突三选：**覆盖 / 跳过 / 内容合并**（合并 = 追加不覆盖）。
5. **分享包自动附 README**——自动生成并附带一份说明包内容的 `README.md`。
6. **包备注**——打包时可填写用途说明。

---

## 安装

在项目目录以本地 bundle 方式安装：

```bash
dsh plugin add .     # 添加本地 bundle
# 开发调试时也可用
pnpm link
```

然后把 `dsh-packer` 加入 profile 的 `dsh.profile.bundles` 列表。重启 DSH 后，打开 **设置页 →「配置打包」标签页**（或直接使用 `/pack` 命令）。

---

## 使用指南

### 打包流程

1. 打开 **设置页 →「配置打包」标签页**，或运行 `/pack create`。
2. 选择模块——或用预设（**迁移** = 全选；**分享** = 只勾 Skills）。
3. 打包前自动执行隐私安全扫描；分享模式下命中任何敏感痕迹都会直接拦截。
4. 确认文件清单（可用 `--dry-run` 只预览、不生成包）。
5. 生成 zip（默认输出到 `~/.dsh/packs`）；分享包自动附带 `README.md`。

### 恢复流程

1. 导入 zip（设置页选择文件，或 `/pack restore <zip>`）。
2. 校验 `manifest.json`（schemaVersion + SHA-256 指纹）。
3. 查看差异报告：新增 / 变更 / 相同 / 跳过。
4. 选择冲突策略：**覆盖 / 跳过 / 内容合并**（合并 = 文本内容追加，不覆盖原内容）。
5. 应用，如需要可重启 DSH。

### `/pack` 命令参考

```
/pack list                                      # 列出已有包（时间/大小/模块/备注）
/pack create [--modules skills,memory] [--mode migrate|share] [--note 备注] [--dry-run]
/pack create --share                            # --share 是 --mode share 的简写
/pack restore <zip路径> [--strategy overwrite|skip|merge]
/pack scan                                      # 对所有可打包模块做隐私扫描
```

说明：

- `list`——显示已生成包：创建时间、大小、包含模块、备注。
- `create`——不指定 `--modules` 时按模式预设自动选择（migrate = 全选；share = 只选 Skills）。`--dry-run` 仅预览文件清单与扫描结果，不生成 zip。
- `restore`——导入 zip → 校验 → 差异报告 → 按所选策略应用。与包内完全一致的文件在任何策略下都会自动跳过。
- `scan`——对所有可打包模块执行隐私扫描，报告敏感痕迹。

包备注在打包时填写，会显示在包列表中；设置页里还可以删除、重命名已生成的包。

---

## 隐私与安全

- **永不打包**：`.credentials.yaml`、`.anonymous-user-id`——遍历任何模块时一律跳过。
- **扫描规则**（仅针对文本文件）：
  - 本地绝对路径（盘符形式）
  - 用户目录路径（操作系统用户配置文件目录下的路径）
  - 疑似密钥/Token（`api_key`、`secret`、`password`、`token`、`bearer`、`authorization` 等赋值）
  - 个人昵称
  - Windows 用户名路径
- **分享模式**：命中任何规则即返回错误，**强制拦截**，不生成包。
- **迁移模式**：仅报告不拦截——可用 `/pack scan` 或 `--dry-run` 提前查看。
- 每个文件的 **SHA-256** 指纹写入 `manifest.json`，恢复时用于完整性校验。
- 打包使用系统 **bsdtar**（libarchive）生成标准 zip，**零原生 npm 依赖**。

---

## 兼容性

- **Node.js** >= 22.19.0
- **DSH 依赖** `@deepseek-ai/dsh-*` 0.1.0-rc.5 及以上（peer 依赖：`@deepseek-ai/cordis` ^4.0.1、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-session`）
- **bsdtar**：Windows 10+ 自带 `tar.exe`（bsdtar/libarchive）；macOS 的 `tar` 即 bsdtar。不使用任何 npm 原生模块。

---

## 常见问题

**生成的 zip 打不开 / 提示损坏？**

包由系统 bsdtar 生成的标准 zip，Windows 资源管理器与常见解压工具均可打开。若校验失败，请勿手工解压改动包内容（会破坏 `manifest.json` 里的 SHA-256 指纹），直接用 `/pack create` 重新生成。可用 `/pack list` 查看 `~/.dsh/packs`（或 `DSH_PACKS_DIR` 指向的目录）里有哪些包。

**恢复时 manifest 校验失败？**

通常是以下几种情况：该 zip 不是 dsh-packer 生成的（包内没有 `manifest.json`）、`manifest.json` 缺失或 `schemaVersion` 与当前版本不兼容、或包生成后被改动过。请重新分发原包或重新生成。

**分享包被拦截怎么办？**

分享模式刻意严格：只要扫到本地绝对路径、用户目录路径、疑似密钥、个人昵称等敏感痕迹就直接报错、不生成包。先运行 `/pack scan` 看哪些文件命中，清理或替换敏感内容后重试。个人备份可用迁移模式（仅报告），但请勿把这类包发给别人。

**「合并」策略具体怎么工作？**

对文本文件：把包内内容**追加**到目标文件末尾，带分隔注释——已有内容绝不覆盖；非文本文件退化为覆盖。与包内完全一致的文件在任何策略下都自动跳过。

**包存在哪里？**

默认 `~/.dsh/packs`，可用 `DSH_PACKS_DIR` 环境变量覆盖。

---

## License

MIT
