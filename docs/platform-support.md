# 多平台通用

dsh-packer 是**多平台通用**的：一套代码、一种包格式，在 Windows / macOS / Linux / 鸿蒙上都能直接用，
不存在"某个平台的专门版本"。本文说明各平台的支持范围，以及**鸿蒙上仍受限的两项**。

原则：**能通用就通用；被运行环境限制的，如实告知，绝不静默。**

## 一、包格式本身与平台无关

- 标准 zip（Windows 资源管理器可直接打开）；
- 内部路径一律 posix（`/`），恢复时按目标平台自动转换；
- `manifest.json` 记录每个文件的 SHA-256，换平台恢复后仍可校验；
- 加密包（AES-256-GCM）与平台无关，哪一端都能解。

## 二、能力矩阵

| 能力 | Windows | macOS | Linux | 鸿蒙（DSHM） |
|---|---|---|---|---|
| 打包 / 恢复 / 选择性恢复 / 差异对比 | 通用 | 通用 | 通用 | 通用 |
| 完整性校验（manifest + SHA-256） | 通用 | 通用 | 通用 | 通用 |
| 加密包 | 通用 | 通用 | 通用 | 通用 |
| 隐私扫描与出网脱敏 | 通用 | 通用 | 通用 | 通用 |
| 记忆库快照（`node:sqlite`） | 通用 | 通用 | 通用 | 通用（DSHM Node 24 自带） |
| **删除包 → 系统回收站** | 支持（Windows 回收站 · PowerShell） | 支持（Finder 删除 → 废纸篓 · osascript） | 支持（freedesktop Trash · 纯 Node） | **受限：永久删除** |
| **系统文件选择框** | 支持 | 支持 | 支持 | **不可用** |

## 三、鸿蒙两个受限项的原因

packer 跑在 host 的 **Node 运行时**里；鸿蒙把这两项能力放在 **ArkTS** 侧，JS 层拿不到：

- 「送回收站」= `@ohos.file.trash`，文档标注为**系统接口**，三方应用无权调用；
- 「系统文件选择框」= `@ohos.file.picker` 的 `DocumentViewPicker`，仅 ArkTS 可用。

宿主是否把这两类能力桥接给插件层？**已实测核查**：DSHM core `0.2.1-rc.2+dshm.73` 全部 JS 中
`@ohos.` 引用 **0 处**，`requireNapi` / `napi_module` / `ohosBridge` **0 处** ⇒ 当前拿不到。
将来宿主开放桥接时，只需在这两处接上，**其余能力不受影响**。

因此鸿蒙上：删除仍是**永久删除**，界面会先如实告知"删除后不可恢复"；而**手填包路径是这个平台的主入口**
（没有系统文件选择框，界面会提示「当前平台请直接填写包路径」）。

## 四、回收站按平台分派（v0.6.4 起）

| 平台 | 实现 | 落点 |
|---|---|---|
| Windows | PowerShell 5.1 自带 `Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile(..., SendToRecycleBin)` | 系统回收站（资源管理器可找回） |
| macOS | `osascript -e 'tell application "Finder" to delete POSIX file "<path>"'` | 废纸篓 |
| Linux | 纯 Node 实现 freedesktop Trash 规范：文件移到 `$XDG_DATA_HOME/Trash/files/<name>`（缺省 `~/.local/share`，同名加后缀），`Trash/info/<name>.trashinfo` 写 `Path=`（URL 编码的绝对路径）与 `DeletionDate=`（本地时间 `YYYY-MM-DDThh:mm:ss`） | 桌面环境的回收站 |
| 鸿蒙 / 其他 | 返回 `false` | 永久删除 + `warning`（不静默） |

三平台的外部命令调用都有 30s 超时；**调用失败（命令缺失/被杀/超时/报错）绝不静默**，
一律降级为永久删除并回报 `{ ok:true, recycled:false, warning }`。

## 五、其他平台差异（不影响通用）

1. **脱敏路径**：Windows 用户目录与 POSIX 用户目录都识别；未覆盖 `/Volumes`、`/private`、`/nix`；
2. **权限位**：仅 POSIX 有，Windows 打包跳过、恢复不还原；
3. **外部命令**：只有回收站用到系统命令（Windows PowerShell、macOS osascript；Linux 走纯 Node），
   其余全部是 Node 内置模块（zlib / crypto / sqlite）。

## 六、验收（每平台同一套）

1. 打包（技能库 + 插件 + 记忆库）→ 校验 sha256 → 加密包再解一次；
2. 恢复三种策略各一次，检查差异对比与结果明细；
3. 删除包：Windows 看回收站、macOS 看废纸篓、Linux 看桌面回收站，都应能找回；鸿蒙检查 `recycled:false` + 界面 warning；
4. 造一个含 `C:\\Users\\<name>` 与 `/home/<name>` 的文件，确认两处都被脱敏；
5. 鸿蒙额外：`/pack list`、`create`、`restore` 正常，删除返回永久删除 warning，恢复页显示「当前平台请直接填写包路径」。
