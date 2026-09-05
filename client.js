window.__ModuleLoader__.load({
	id: "dsh-packer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/** Packer settings page: module picker, pack creation, pack management, restore. */
		const MODULE_ORDER = ["skills", "sessions", "profiles", "settings", "presets", "memory"];
		const copy = {
			"zh-CN": {
				tab: "配置打包",
				title: "配置打包",
				loading: "正在读取状态…",
				unavailable: "暂时无法读取打包器状态，请稍后重试。",
				modules: "模块选择",
				moduleHint: "勾选要打包的模块，选择会保留到下次手动修改。",
				files: "文件",
				selected: "已选 {n} 个模块",
				presetMigrate: "迁移全选",
				presetShare: "分享精选",
				mode: "打包模式",
				migrate: "迁移",
				share: "分享",
				shareHint: "自动排除会话记录与记忆数据，并强制隐私拦截",
				pack: "打包",
				scan: "扫描检查",
				scanning: "扫描中…",
				scanFailed: "扫描失败",
				scanFiles: "共 {n} 个文件",
				privacyTitle: "隐私扫描",
				privacyNone: "未发现隐私风险",
				privacyFound: "发现 {n} 处隐私风险",
				privacyHint: "以下内容疑似含隐私信息（密钥 / Token / 绝对路径等），分享前请人工确认",
				noSelection: "请先选择至少一个模块",
				note: "备注",
				notePlaceholder: "给这个包加一句说明（可选）",
				preview: "预览",
				previewing: "预览中…",
				previewFailed: "预览失败",
				previewTitle: "预览摘要（dry-run）",
				previewHint: "确认无误后点击「打包生成」正式创建",
				create: "打包生成",
				creating: "打包中…",
				createFailed: "打包失败",
				createResult: "打包结果",
				packName: "包名",
				packTime: "时间",
				packMode: "模式",
				packSize: "大小",
				packFilesCount: "文件数",
				packNote: "备注",
				packs: "包管理",
				packsDir: "包目录",
				noPacks: "（暂无配置包）",
				delete: "删除",
				rename: "重命名",
				deleteConfirm: "确定删除配置包「{name}」？此操作不可恢复。",
				renamePrompt: "输入新名称：",
				deleteDone: "已删除",
				deleteFailed: "删除失败",
				renameDone: "已重命名",
				renameFailed: "重命名失败",
				restore: "恢复",
				zipPath: "配置包 zip 路径",
				zipPlaceholder: "例如 C:\\backup\\pack-YYYY-MM-DD.zip",
				zipHint: "填写本地 zip 文件的绝对路径，先「导入检查」查看差异",
				importCheck: "导入检查",
				importing: "检查中…",
				importFailed: "导入检查失败",
				importDone: "导入检查完成",
				noZip: "请先填写 zip 路径",
				diffTitle: "差异报告",
				diffAdded: "新增",
				diffChanged: "变更",
				diffSame: "相同",
				diffSkipped: "跳过",
				manifestInfo: "包内信息",
				schemaVersion: "schema 版本",
				strategy: "冲突策略",
				strategyOverwrite: "覆盖",
				strategyOverwriteHint: "以包内文件覆盖现有文件",
				strategySkip: "跳过",
				strategySkipHint: "保留现有文件，跳过同名冲突",
				strategyMerge: "合并",
				strategyMergeHint: "尝试合并目录与文件内容",
				apply: "执行恢复",
				applying: "恢复中…",
				applyFailed: "恢复失败",
				applyResult: "恢复结果",
				statOverwritten: "覆盖",
				statAdded: "新增",
				statMerged: "合并",
				statSkipped: "跳过",
				statFailed: "失败",
				failures: "失败明细",
				empty: "—"
			},
			en: {
				tab: "Config Packer",
				title: "Config Packer",
				loading: "Reading status…",
				unavailable: "Packer status is temporarily unavailable.",
				modules: "Modules",
				moduleHint: "Pick modules to pack. Selections persist until changed.",
				files: "files",
				selected: "{n} modules selected",
				presetMigrate: "All for migrate",
				presetShare: "All for share",
				mode: "Pack mode",
				migrate: "Migrate",
				share: "Share",
				shareHint: "auto-excludes sessions & memory and forces privacy filtering",
				pack: "Pack",
				scan: "Scan",
				scanning: "Scanning…",
				scanFailed: "Scan failed",
				scanFiles: "{n} files total",
				privacyTitle: "Privacy scan",
				privacyNone: "No privacy risks found",
				privacyFound: "{n} privacy risks found",
				privacyHint: "Likely private content (keys / tokens / absolute paths). Review before sharing.",
				noSelection: "Select at least one module first",
				note: "Note",
				notePlaceholder: "Optional note for this pack",
				preview: "Preview",
				previewing: "Previewing…",
				previewFailed: "Preview failed",
				previewTitle: "Preview (dry-run)",
				previewHint: "Click \"Create pack\" to finalize",
				create: "Create pack",
				creating: "Creating…",
				createFailed: "Create failed",
				createResult: "Result",
				packName: "Name",
				packTime: "Time",
				packMode: "Mode",
				packSize: "Size",
				packFilesCount: "Files",
				packNote: "Note",
				packs: "Packs",
				packsDir: "Packs dir",
				noPacks: "(no packs)",
				delete: "Delete",
				rename: "Rename",
				deleteConfirm: "Delete pack \"{name}\"? This cannot be undone.",
				renamePrompt: "New name:",
				deleteDone: "Deleted",
				deleteFailed: "Delete failed",
				renameDone: "Renamed",
				renameFailed: "Rename failed",
				restore: "Restore",
				zipPath: "Zip path",
				zipPlaceholder: "e.g. C:\\backup\\pack-YYYY-MM-DD.zip",
				zipHint: "Absolute path to a local zip. Run \"Import check\" first.",
				importCheck: "Import check",
				importing: "Checking…",
				importFailed: "Import check failed",
				importDone: "Import check done",
				noZip: "Enter a zip path first",
				diffTitle: "Diff report",
				diffAdded: "Added",
				diffChanged: "Changed",
				diffSame: "Same",
				diffSkipped: "Skipped",
				manifestInfo: "Manifest",
				schemaVersion: "Schema version",
				strategy: "Conflict strategy",
				strategyOverwrite: "Overwrite",
				strategyOverwriteHint: "Overwrite existing files with pack files",
				strategySkip: "Skip",
				strategySkipHint: "Keep existing files, skip conflicts",
				strategyMerge: "Merge",
				strategyMergeHint: "Merge directories and file contents",
				apply: "Apply restore",
				applying: "Restoring…",
				applyFailed: "Restore failed",
				applyResult: "Restore result",
				statOverwritten: "overwritten",
				statAdded: "added",
				statMerged: "merged",
				statSkipped: "skipped",
				statFailed: "failed",
				failures: "Failures",
				empty: "—"
			}
		};
		function text() {
			const primary = (navigator.languages?.[0] || navigator.language || "en").toLowerCase();
			return primary === "zh-cn" || primary.startsWith("zh-hans") ? copy["zh-CN"] : copy.en;
		}
		const inject = ["slots"];
		function formatBytes(n) {
			if (n === void 0 || n === null || Number.isNaN(Number(n))) return "—";
			const units = ["B", "KB", "MB", "GB"];
			let value = Number(n);
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit++;
			}
			return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
		}
		// 设计令牌（dsh-fuse config/theme.json default/dark 主题）：页面内定义为 CSS 变量 --pk-*，样式只引用变量。
		// 颜色优先跟随 DSH 官方主题变量（--dsw-alias-*），缺失时回退 --pk-*；深色由 .pk-page[data-dsh-theme="dark"] 覆盖。
		const styles = `
.pk-page{
  --pk-primary:#EA580C;
  --pk-accent:#0EA5E9;
  --pk-bg:#FFFFFF;
  --pk-surface:#F5F6F8;
  --pk-text:#1A1A1A;
  --pk-muted:#6B7280;
  --pk-border:#E5E7EB;
  --pk-success:#2E7D32;
  --pk-warning:#F59E0B;
  --pk-error:#C62828;
  --pk-on-primary:#0F1115;
  --pk-space-xs:4px;
  --pk-space-sm:8px;
  --pk-space-md:16px;
  --pk-space-lg:24px;
  --pk-space-xl:32px;
  --pk-radius-sm:8px;
  --pk-radius-md:12px;
  --pk-radius-lg:16px;
  --pk-font:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,sans-serif;
  --pk-mono:ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;
  --pk-shadow-card:0 1px 3px rgba(26,26,26,.08);
  --pk-shadow-float:0 10px 30px rgba(26,26,26,.14);
  --pk-primary-soft:color-mix(in srgb,var(--pk-primary) 10%,var(--pk-surface));
  --pk-accent-soft:color-mix(in srgb,var(--pk-accent) 10%,var(--pk-surface));
  --pk-grad:linear-gradient(
    180deg,
    var(--dsw-alias-bg-layer-2,var(--pk-surface)),
    color-mix(in srgb,var(--pk-primary) 3%,var(--dsw-alias-bg-layer-2,var(--pk-surface)))
  );
  display:flex;
  flex-direction:column;
  gap:var(--pk-space-lg);
  max-width:860px;
  margin:0 auto;
  width:100%;
  box-sizing:border-box;
  padding:var(--pk-space-lg);
  border:1px solid var(--dsw-alias-border-l2,var(--pk-border));
  border-radius:var(--pk-radius-lg);
  background:var(--dsw-alias-bg-layer-2,var(--pk-surface));
  background-image:var(--pk-grad);
  color:var(--dsw-alias-label-primary,var(--pk-text));
  font-family:var(--pk-font);
  font-size:14px;
  line-height:1.7
}
.pk-page[data-dsh-theme="dark"]{
  --pk-primary:#FB923C;
  --pk-accent:#22D3EE;
  --pk-bg:#0F1115;
  --pk-surface:#1A1D23;
  --pk-text:#E8EAED;
  --pk-muted:#9AA0A6;
  --pk-border:#2A2E37;
  --pk-success:#34D399;
  --pk-warning:#FBBF24;
  --pk-error:#F87171;
  --pk-shadow-card:0 1px 3px rgba(0,0,0,.4);
  --pk-shadow-float:0 10px 30px rgba(0,0,0,.5)
}
.pk-page h3{margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em;line-height:1.25;color:var(--pk-text)}
.pk-page-sub{margin:var(--pk-space-xs) 0 0;font-size:14px;color:var(--dsw-alias-label-secondary,var(--pk-muted));line-height:1.7}
.pk-page h4{
  margin:0 0 var(--pk-space-md);
  font-size:16px;
  font-weight:600;
  line-height:1.25;
  color:var(--pk-text);
  display:flex;
  align-items:center;
  gap:var(--pk-space-sm)
}
.pk-page h4::before{content:"";width:4px;height:16px;border-radius:999px;background:var(--pk-primary);flex:none}
.pk-page{counter-reset:pk-stage}
.pk-page section.pk-block{counter-increment:pk-stage}
.pk-page section.pk-block h4::before{
  content:counter(pk-stage);
  width:20px;
  height:20px;
  border-radius:999px;
  background:var(--pk-primary-soft);
  color:var(--pk-primary);
  font-size:12px;
  font-weight:600;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex:none
}
.pk-subtitle{margin:var(--pk-space-md) 0 var(--pk-space-xs);font-size:14px;font-weight:600;color:var(--pk-text);line-height:1.7}
.pk-block{
  padding:var(--pk-space-lg);
  border:1px solid var(--pk-border);
  border-radius:var(--pk-radius-lg);
  background:var(--dsw-alias-bg-layer-1,var(--pk-bg));
  box-shadow:var(--pk-shadow-card)
}
.pk-status{
  padding:var(--pk-space-sm) var(--pk-space-md);
  border:1px solid var(--pk-border);
  border-radius:var(--pk-radius-md);
  background:var(--pk-surface);
  color:var(--pk-text);
  font-size:14px;
  line-height:1.7
}
.pk-status.error{
  color:var(--pk-error);
  border-color:var(--pk-border);
  background:var(--pk-bg);
  border-color:color-mix(in srgb,var(--pk-error) 35%,var(--pk-border));
  background:color-mix(in srgb,var(--pk-error) 6%,var(--pk-bg))
}
.pk-status.error::before{content:"✕ ";font-weight:600}
.pk-status.warn{
  color:var(--pk-warning);
  border-color:var(--pk-border);
  background:var(--pk-bg);
  border-color:color-mix(in srgb,var(--pk-warning) 35%,var(--pk-border));
  background:color-mix(in srgb,var(--pk-warning) 6%,var(--pk-bg))
}
.pk-status.warn::before{content:"!";font-weight:600;padding-right:var(--pk-space-xs)}
.pk-modules{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--pk-space-sm)}
.pk-module{
  display:flex;
  align-items:flex-start;
  gap:var(--pk-space-sm);
  padding:var(--pk-space-sm) var(--pk-space-md);
  border:1px solid var(--pk-border);
  border-radius:var(--pk-radius-md);
  background:var(--pk-surface);
  cursor:pointer;
  margin:0;
  transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease
}
.pk-module:hover{border-color:var(--pk-primary);background:var(--pk-bg)}
.pk-module:has(input:checked){
  border-color:var(--pk-primary);
  background:var(--pk-primary-soft);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--pk-primary) 25%,transparent)
}
.pk-module input{
  accent-color:var(--pk-primary);
  margin-top:var(--pk-space-xs);
  width:16px;
  height:16px;
  flex:none
}
.pk-module-text{display:flex;flex-direction:column;gap:var(--pk-space-xs);min-width:0}
.pk-module-name{font-weight:600;color:var(--pk-text);font-size:14px}
.pk-module-meta{color:var(--dsw-alias-label-secondary,var(--pk-muted));font-size:12px}
.pk-actions{display:flex;gap:var(--pk-space-sm);align-items:center;margin-top:var(--pk-space-md);flex-wrap:wrap}
.pk-modes{display:flex;gap:var(--pk-space-sm);margin-top:var(--pk-space-md);flex-wrap:wrap}
.pk-mode{
  display:flex;
  align-items:flex-start;
  gap:var(--pk-space-sm);
  font-size:14px;
  color:var(--pk-text);
  cursor:pointer;
  margin:0;
  padding:var(--pk-space-sm) var(--pk-space-md);
  border:1px solid var(--pk-border);
  border-radius:var(--pk-radius-sm);
  background:var(--pk-surface);
  transition:border-color .15s ease,background-color .15s ease,color .15s ease
}
.pk-mode:hover{border-color:var(--pk-primary);background:var(--pk-bg)}
.pk-mode:has(input:checked){
  border-color:var(--pk-primary);
  background:var(--pk-primary-soft);
  color:var(--pk-primary);
  font-weight:600
}
.pk-mode input{accent-color:var(--pk-primary);margin-top:var(--pk-space-xs);flex:none}
.pk-btn{
  padding:var(--pk-space-sm) var(--pk-space-md);
  border:1px solid var(--pk-border);
  border-radius:var(--pk-radius-sm);
  background:var(--pk-bg);
  color:var(--pk-text);
  font-family:var(--pk-font);
  font-size:14px;
  font-weight:500;
  cursor:pointer;
  min-height:36px;
  transition:background-color .15s ease,border-color .15s ease,color .15s ease,box-shadow .15s ease
}
.pk-btn:hover{
  border-color:var(--pk-primary);
  color:var(--pk-primary);
  background:var(--pk-bg);
  background:color-mix(in srgb,var(--pk-primary) 4%,var(--pk-bg))
}
.pk-btn.primary{background:var(--pk-primary);border-color:var(--pk-primary);color:var(--pk-on-primary)}
.pk-btn.primary:hover{background:var(--pk-accent);border-color:var(--pk-accent);color:var(--pk-on-primary)}
.pk-btn:disabled{opacity:.5;cursor:wait}
.pk-btn:focus-visible{
  outline:none;
  box-shadow:0 0 0 3px color-mix(in srgb,var(--pk-primary) 25%,transparent)
}
.pk-note{color:var(--dsw-alias-label-secondary,var(--pk-muted));font-size:12px;line-height:1.7}
.pk-hint{color:var(--dsw-alias-label-secondary,var(--pk-muted));font-size:12px;margin-top:var(--pk-space-sm);line-height:1.7}
.pk-ok{color:var(--pk-success);font-weight:500}
.pk-err{color:var(--pk-error);font-weight:500}
.pk-warn{color:var(--pk-warning);font-weight:500}
.pk-ok::before{content:"✓ "}
.pk-err::before{content:"✕ "}
.pk-warn::before{content:"! "}
.pk-summary{margin-top:var(--pk-space-md);font-weight:600;color:var(--pk-text);font-size:14px}
.pk-root{margin-top:var(--pk-space-sm);color:var(--dsw-alias-label-secondary,var(--pk-muted));font-size:12px;word-break:break-all}
.pk-field{display:flex;flex-direction:column;gap:var(--pk-space-sm);min-width:0;margin-top:var(--pk-space-md)}
.pk-field label{color:var(--pk-text);font-size:14px;font-weight:600}
.pk-field input[type=text]{
  height:40px;
  padding:0 var(--pk-space-md);
  border:1px solid var(--pk-border);
  border-radius:var(--pk-radius-sm);
  background:var(--pk-bg);
  color:var(--pk-text);
  font-family:var(--pk-font);
  font-size:14px;
  min-width:0;
  width:100%;
  box-sizing:border-box;
  transition:border-color .15s ease,box-shadow .15s ease
}
.pk-field input[type=text]:focus{
  outline:none;
  border-color:var(--pk-primary);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--pk-primary) 25%,transparent)
}
.pk-list{
  margin:var(--pk-space-md) 0 0;
  padding:0;
  list-style:none;
  display:flex;
  flex-direction:column;
  gap:var(--pk-space-xs);
  max-height:280px;
  overflow:auto
}
.pk-list li{
  padding:var(--pk-space-sm);
  border-radius:var(--pk-radius-sm);
  background:var(--pk-surface);
  color:var(--pk-text);
  font-family:var(--pk-mono);
  font-size:12px;
  word-break:break-all
}
.pk-privacy{
  margin:var(--pk-space-sm) 0 0;
  padding:0;
  list-style:none;
  display:flex;
  flex-direction:column;
  gap:var(--pk-space-xs);
  max-height:220px;
  overflow:auto
}
.pk-privacy li{
  padding:var(--pk-space-sm);
  border-radius:var(--pk-radius-sm);
  color:var(--pk-text);
  font-size:12px;
  border:1px solid var(--pk-border);
  background:var(--pk-bg);
  border:1px solid color-mix(in srgb,var(--pk-warning) 35%,var(--pk-border));
  background:color-mix(in srgb,var(--pk-warning) 5%,var(--pk-bg))
}
.pk-privacy-error li{
  border:1px solid color-mix(in srgb,var(--pk-error) 30%,var(--pk-border));
  background:color-mix(in srgb,var(--pk-error) 5%,var(--pk-bg))
}
.pk-privacy-file{font-family:var(--pk-mono);font-weight:600;word-break:break-all;color:var(--pk-warning)}
.pk-privacy-error .pk-privacy-file{color:var(--pk-error)}
.pk-privacy-sample{
  margin-top:var(--pk-space-xs);
  padding-left:var(--pk-space-md);
  border-left:2px solid var(--pk-border);
  color:var(--dsw-alias-label-secondary,var(--pk-muted));
  word-break:break-all
}
.pk-packs{
  margin:var(--pk-space-md) 0 0;
  padding:0;
  list-style:none;
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
  gap:var(--pk-space-md)
}
.pk-pack{
  padding:var(--pk-space-md);
  border:1px solid var(--pk-border);
  border-radius:var(--pk-radius-md);
  background:var(--pk-surface);
  transition:border-color .15s ease,box-shadow .15s ease
}
.pk-pack:hover{border-color:var(--pk-primary);box-shadow:var(--pk-shadow-card)}
.pk-pack-head{display:flex;align-items:center;gap:var(--pk-space-sm);flex-wrap:wrap}
.pk-pack-name{font-weight:600;color:var(--pk-text);font-family:var(--pk-mono);font-size:14px;word-break:break-all}
.pk-pack-meta{color:var(--dsw-alias-label-secondary,var(--pk-muted));font-size:12px}
.pk-pack-note{
  color:var(--dsw-alias-label-secondary,var(--pk-muted));
  font-size:12px;
  margin-top:var(--pk-space-xs);
  word-break:break-all
}
.pk-pack-actions{margin-left:auto;display:flex;gap:var(--pk-space-sm)}
.pk-pack-actions .pk-btn{
  padding:var(--pk-space-xs) var(--pk-space-sm);
  min-height:28px;
  font-size:12px
}
.pk-diff{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(160px,1fr));
  gap:var(--pk-space-md);
  margin-top:var(--pk-space-md)
}
.pk-diff-col{min-width:0}
.pk-diff-col h5{
  margin:0 0 var(--pk-space-sm);
  padding:var(--pk-space-xs) var(--pk-space-sm);
  border-radius:var(--pk-radius-sm);
  font-size:14px;
  font-weight:600;
  color:var(--pk-text);
  background:color-mix(in srgb,var(--pk-primary) 8%,var(--pk-surface));
  display:flex;
  align-items:center;
  gap:var(--pk-space-sm)
}
.pk-diff-col h5::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--pk-primary);flex:none}
.pk-diff-col.diff-added h5{background:color-mix(in srgb,var(--pk-success) 8%,var(--pk-surface))}
.pk-diff-col.diff-added h5::before{background:var(--pk-success)}
.pk-diff-col.diff-changed h5{background:color-mix(in srgb,var(--pk-warning) 8%,var(--pk-surface))}
.pk-diff-col.diff-changed h5::before{background:var(--pk-warning)}
.pk-diff-col.diff-same h5,
.pk-diff-col.diff-skipped h5{background:color-mix(in srgb,var(--pk-muted) 8%,var(--pk-surface))}
.pk-diff-col.diff-same h5::before,
.pk-diff-col.diff-skipped h5::before{
  background:var(--pk-muted)
}
.pk-count{
  display:inline-flex;
  align-items:center;
  height:20px;
  padding:0 var(--pk-space-sm);
  border:1px solid color-mix(in srgb,var(--pk-accent) 25%,var(--pk-border));
  border-radius:999px;
  background:var(--pk-accent-soft);
  color:color-mix(in srgb,var(--pk-accent) 65%,var(--pk-text));
  font-size:12px;
  font-weight:600
}
.pk-diff-list{
  margin:0;
  padding:0;
  list-style:none;
  display:flex;
  flex-direction:column;
  gap:var(--pk-space-xs);
  max-height:180px;
  overflow:auto
}
.pk-diff-list li{
  padding:var(--pk-space-xs) var(--pk-space-sm);
  border-radius:var(--pk-radius-sm);
  background:var(--pk-surface);
  font-family:var(--pk-mono);
  font-size:12px;
  word-break:break-all;
  color:var(--pk-text)
}
.pk-strategy{margin-top:var(--pk-space-md)}
.pk-list::-webkit-scrollbar,
.pk-privacy::-webkit-scrollbar,
.pk-diff-list::-webkit-scrollbar{
  width:6px;
  height:6px
}
.pk-list::-webkit-scrollbar-thumb,
.pk-privacy::-webkit-scrollbar-thumb,
.pk-diff-list::-webkit-scrollbar-thumb{
  background:var(--pk-border);
  border-radius:999px
}
.pk-list::-webkit-scrollbar-thumb:hover,
.pk-privacy::-webkit-scrollbar-thumb:hover,
.pk-diff-list::-webkit-scrollbar-thumb:hover{
  background:color-mix(in srgb,var(--pk-muted) 40%,var(--pk-border))
}
/* 深色补充：层次感（hover 微亮 / 主按钮提亮 / 警示对比提升），浅色保持现状 */
.pk-page[data-dsh-theme="dark"] .pk-module:hover,
.pk-page[data-dsh-theme="dark"] .pk-mode:hover{
  background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--pk-primary) 6%,var(--pk-surface)))
}
.pk-page[data-dsh-theme="dark"] .pk-btn.primary:hover{
  background:var(--pk-primary);
  border-color:var(--pk-primary);
  color:var(--pk-on-primary);
  filter:brightness(1.1)
}
.pk-page[data-dsh-theme="dark"] .pk-privacy li{
  border-color:color-mix(in srgb,var(--pk-warning) 45%,var(--pk-border));
  background:color-mix(in srgb,var(--pk-warning) 8%,var(--pk-bg))
}
.pk-page[data-dsh-theme="dark"] .pk-privacy-error li{
  border-color:color-mix(in srgb,var(--pk-error) 40%,var(--pk-border));
  background:color-mix(in srgb,var(--pk-error) 8%,var(--pk-bg))
}
`;
		// 深色主题探测：优先 DeepSeek 前端标记 data-ds-dark-theme（dark/light），其次 prefers-color-scheme
		function detectDark() {
			if (typeof document === 'undefined') return false;
			const html = document.documentElement.getAttribute('data-ds-dark-theme');
			if (html !== null) return html !== 'light';
			const body = document.body.getAttribute('data-ds-dark-theme');
			if (body !== null) return body !== 'light';
			if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
				return window.matchMedia('(prefers-color-scheme: dark)').matches;
			}
			return false;
		}
		function PackerSettingsPage() {
			const t = text();
			const [dark, setDark] = react.useState(detectDark);
			react.useEffect(() => {
				const sync = () => setDark(detectDark());
				const mq = window.matchMedia('(prefers-color-scheme: dark)');
				mq.addEventListener('change', sync);
				const mo = new MutationObserver(sync);
				mo.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ['data-ds-dark-theme']
				});
				mo.observe(document.body, {
					attributes: true,
					attributeFilter: ['data-ds-dark-theme']
				});
				return () => {
					mq.removeEventListener('change', sync);
					mo.disconnect();
				};
			}, []);
			const [status, setStatus] = react.useState({ kind: "loading" });
			const [selected, setSelected] = react.useState({});
			const [mode, setMode] = react.useState("migrate");
			const [note, setNote] = react.useState("");
			const [scan, setScan] = react.useState(null);
			const [create, setCreate] = react.useState(null);
			const [packs, setPacks] = react.useState([]);
			const [packBusy, setPackBusy] = react.useState(null);
			const [packMsg, setPackMsg] = react.useState(null);
			const [zipPath, setZipPath] = react.useState("");
			const [importResult, setImportResult] = react.useState(null);
			const [strategy, setStrategy] = react.useState("overwrite");
			const [applyResult, setApplyResult] = react.useState(null);
			const loadStatus = react.useCallback(() => {
				const controller = new AbortController();
				fetch("/packer/api/status", {
					credentials: "same-origin",
					signal: controller.signal
				}).then(async (response) => {
					if (!response.ok) throw new Error("status unavailable");
					const data = await response.json();
					if (!data?.ok) throw new Error("status unavailable");
					setStatus({ kind: "ready", value: data });
					setPacks(data.packs || []);
					const mods = data.modules || {};
					setSelected((prev) => {
						if (Object.keys(prev).length > 0) return prev;
						const init = {};
						for (const name of MODULE_ORDER) {
							const m = mods[name];
							if (m) init[name] = !!m.default;
						}
						return init;
					});
				}).catch((error) => {
					if (!(error instanceof DOMException && error.name === "AbortError")) setStatus({ kind: "error" });
				});
				return () => {
					controller.abort();
				};
			}, []);
			react.useEffect(() => loadStatus(), [loadStatus]);
			const selectedModules = () => MODULE_ORDER.filter((name) => !!selected[name]);
			const modeName = (m) => (m === "share" ? t.share : m === "migrate" ? t.migrate : (m || t.empty));
			const presetBy = (flag) => {
				const mods = status.value?.modules || {};
				const next = {};
				for (const name of MODULE_ORDER) {
					const m = mods[name];
					next[name] = !!(m && m[flag]);
				}
				setSelected(next);
			};
			const runScan = () => {
				const modules = selectedModules();
				if (modules.length === 0) {
					setScan({ kind: "error", noSelection: true });
					return;
				}
				setScan({ kind: "running" });
				fetch("/packer/api/scan", {
					method: "POST",
					credentials: "same-origin",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ modules, mode })
				}).then(async (response) => {
					if (!response.ok) throw new Error("scan failed");
					const data = await response.json();
					if (!data?.ok) throw new Error("scan failed");
					setScan({ kind: "done", files: data.files || [], privacy: data.privacy || [], share: data.share });
				}).catch(() => {
					setScan({ kind: "error" });
				});
			};
			const runCreate = (dryRun) => {
				const modules = selectedModules();
				if (modules.length === 0) {
					setCreate({ kind: "error", dryRun, noSelection: true });
					return;
				}
				setCreate({ kind: "running", dryRun });
				fetch("/packer/api/create", {
					method: "POST",
					credentials: "same-origin",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ modules, mode, note: note.trim(), dryRun })
				}).then(async (response) => {
					if (!response.ok) throw new Error("create failed");
					const data = await response.json();
					if (!data?.ok) throw new Error("create failed");
					if (dryRun) {
						setCreate({ kind: "done", dryRun: true, manifest: data.manifest || {}, privacy: data.privacy || [], totalBytes: data.totalBytes });
					} else {
						setCreate({ kind: "done", dryRun: false, pack: data.pack || {}, privacy: data.privacy || [] });
						loadStatus();
					}
				}).catch(() => {
					setCreate({ kind: "error", dryRun });
				});
			};
			const removePack = (name) => {
				if (!window.confirm(t.deleteConfirm.replace("{name}", name))) return;
				setPackBusy(name);
				setPackMsg(null);
				fetch("/packer/api/packs/" + encodeURIComponent(name), {
					method: "DELETE",
					credentials: "same-origin"
				}).then(async (response) => {
					if (!response.ok) throw new Error("delete failed");
					const data = await response.json();
					if (!data?.ok) throw new Error("delete failed");
					setPackMsg({ kind: "ok", text: t.deleteDone });
					loadStatus();
				}).catch(() => {
					setPackMsg({ kind: "err", text: t.deleteFailed });
				}).finally(() => {
					setPackBusy(null);
				});
			};
			const renamePack = (from) => {
				const to = window.prompt(t.renamePrompt, from);
				if (to === null || to.trim() === "" || to.trim() === from) return;
				setPackBusy(from);
				setPackMsg(null);
				fetch("/packer/api/packs/rename", {
					method: "POST",
					credentials: "same-origin",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ from, to: to.trim() })
				}).then(async (response) => {
					if (!response.ok) throw new Error("rename failed");
					const data = await response.json();
					if (!data?.ok) throw new Error("rename failed");
					setPackMsg({ kind: "ok", text: t.renameDone });
					loadStatus();
				}).catch(() => {
					setPackMsg({ kind: "err", text: t.renameFailed });
				}).finally(() => {
					setPackBusy(null);
				});
			};
			const runImport = () => {
				const zip = zipPath.trim();
				if (!zip) {
					setImportResult({ kind: "error", noZip: true });
					return;
				}
				setImportResult({ kind: "running" });
				fetch("/packer/api/restore/import", {
					method: "POST",
					credentials: "same-origin",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ zip })
				}).then(async (response) => {
					if (!response.ok) throw new Error("import failed");
					const data = await response.json();
					if (!data?.ok) throw new Error("import failed");
					setImportResult({ kind: "done", manifest: data.manifest || {}, diff: data.diff || {} });
				}).catch(() => {
					setImportResult({ kind: "error" });
				});
			};
			const runApply = () => {
				const zip = zipPath.trim();
				if (!zip) {
					setApplyResult({ kind: "error", noZip: true });
					return;
				}
				setApplyResult({ kind: "running" });
				fetch("/packer/api/restore/apply", {
					method: "POST",
					credentials: "same-origin",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ zip, strategy })
				}).then(async (response) => {
					if (!response.ok) throw new Error("apply failed");
					const data = await response.json();
					if (!data?.ok) throw new Error("apply failed");
					setApplyResult({ kind: "done", stats: data.stats || {} });
					loadStatus();
				}).catch(() => {
					setApplyResult({ kind: "error" });
				});
			};
			if (status.kind === "loading") {
				return (0, react.createElement)("div", {
					className: "pk-page",
					"data-dsh-theme": dark ? 'dark' : 'light'
				}, (0, react.createElement)("style", null, styles), (0, react.createElement)("h3", null, t.title), (0, react.createElement)("div", { className: "pk-status" }, t.loading));
			}
			if (status.kind === "error") {
				return (0, react.createElement)("div", {
					className: "pk-page",
					"data-dsh-theme": dark ? 'dark' : 'light'
				}, (0, react.createElement)("style", null, styles), (0, react.createElement)("h3", null, t.title), (0, react.createElement)("div", { className: "pk-status error" }, t.unavailable));
			}
			const mods = status.value.modules || {};
			const moduleCards = MODULE_ORDER.map((name) => {
				const m = mods[name];
				if (!m) return null;
				return (0, react.createElement)("label", { key: name, className: "pk-module" }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: !!selected[name],
					onChange: (event) => setSelected({ ...selected, [name]: event.target.checked })
				}), (0, react.createElement)("span", { className: "pk-module-text" }, (0, react.createElement)("span", { className: "pk-module-name" }, m.label || name), (0, react.createElement)("span", { className: "pk-module-meta" }, `${m.count || 0} ${t.files} · ${formatBytes(m.bytes)}`)));
			});
			const selectedCount = selectedModules().length;
			const scanSection = (() => {
				if (scan === null) return null;
				if (scan.kind === "running") {
					return (0, react.createElement)("div", { className: "pk-status" }, t.scanning);
				}
				if (scan.kind === "error") {
					return (0, react.createElement)("div", { className: "pk-status error" }, scan.noSelection ? t.noSelection : t.scanFailed);
				}
				const files = scan.files || [];
				const privacy = scan.privacy || [];
				return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "pk-summary" }, `${t.scanFiles.replace("{n}", String(files.length))}`), files.length === 0 ? (0, react.createElement)("div", { className: "pk-note" }, t.empty) : (0, react.createElement)("ul", { className: "pk-list" }, files.map((f, index) => (0, react.createElement)("li", { key: `${f.module}/${f.rel}-${index}` }, `${f.module}/${f.rel}  ${formatBytes(f.size)}`))), (0, react.createElement)("div", { className: "pk-subtitle" }, privacy.length === 0 ? (0, react.createElement)("span", { className: "pk-ok" }, t.privacyNone) : (0, react.createElement)("span", { className: scan.share ? "pk-err" : "pk-warn" }, `${t.privacyFound.replace("{n}", String(privacy.length))}${scan.share ? " · " + t.privacyHint : ""}`)), privacy.length === 0 ? null : (0, react.createElement)("ul", { className: scan.share ? "pk-privacy pk-privacy-error" : "pk-privacy" }, privacy.map((p, index) => (0, react.createElement)("li", { key: index }, (0, react.createElement)("div", { className: "pk-privacy-file" }, `${p.label || "?"} @ ${p.file}${p.line ? ":" + p.line : ""}`), p.sample ? (0, react.createElement)("div", { className: "pk-privacy-sample" }, p.sample) : null))));
			})();
			const createSection = (() => {
				if (create === null) return null;
				if (create.kind === "running") {
					return (0, react.createElement)("div", { className: "pk-status" }, create.dryRun ? t.previewing : t.creating);
				}
				if (create.kind === "error") {
					return (0, react.createElement)("div", { className: "pk-status error" }, create.noSelection ? t.noSelection : create.dryRun ? t.previewFailed : t.createFailed);
				}
				if (create.dryRun) {
					const manifest = create.manifest || {};
					const files = manifest.files || [];
					return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "pk-summary" }, t.previewTitle), (0, react.createElement)("div", { className: "pk-status" }, `${t.packMode}：${modeName(manifest.mode)}`, (0, react.createElement)("br", null), `${t.files}：${files.length} · ${t.packSize}：${formatBytes(create.totalBytes)}`, manifest.note ? (0, react.createElement)("br", null) : null, manifest.note ? `${t.packNote}：${manifest.note}` : null), files.length === 0 ? null : (0, react.createElement)("ul", { className: "pk-list" }, files.slice(0, 50).map((f, index) => (0, react.createElement)("li", { key: index }, `${f.module}/${f.rel}  ${formatBytes(f.size)}`))), (0, react.createElement)("div", { className: "pk-note" }, t.previewHint));
				}
				const pack = create.pack || {};
				const findings = pack.privacyFindings;
				const findingsCount = Array.isArray(findings) ? findings.length : typeof findings === "number" ? findings : 0;
				return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "pk-summary" }, `${t.createResult}：${pack.name || t.empty}`), (0, react.createElement)("div", { className: "pk-status" }, `${t.packName}：${pack.name || t.empty}`, (0, react.createElement)("br", null), `${t.packMode}：${modeName(pack.mode)} · ${t.packFilesCount}：${pack.fileCount || 0} · ${t.packSize}：${formatBytes(pack.totalBytes)}`, pack.createdAt ? (0, react.createElement)("br", null) : null, pack.createdAt ? `${t.packTime}：${pack.createdAt}` : null, pack.note ? (0, react.createElement)("br", null) : null, pack.note ? `${t.packNote}：${pack.note}` : null), findingsCount > 0 ? (0, react.createElement)("div", { className: "pk-status warn" }, `${t.privacyFound.replace("{n}", String(findingsCount))}`) : (0, react.createElement)("div", { className: "pk-status" }, (0, react.createElement)("span", { className: "pk-ok" }, t.privacyNone)));
			})();
			const packItems = packs.map((p) => (0, react.createElement)("li", { key: p.name, className: "pk-pack" }, (0, react.createElement)("div", { className: "pk-pack-head" }, (0, react.createElement)("span", { className: "pk-pack-name" }, p.name), (0, react.createElement)("span", { className: "pk-pack-meta" }, `${modeName(p.mode)} · ${p.fileCount || 0} ${t.files} · ${formatBytes(p.totalBytes)}`), p.createdAt ? (0, react.createElement)("span", { className: "pk-pack-meta" }, p.createdAt) : null, (0, react.createElement)("span", { className: "pk-pack-actions" }, (0, react.createElement)("button", {
				className: "pk-btn",
				disabled: packBusy === p.name,
				onClick: () => renamePack(p.name)
			}, t.rename), (0, react.createElement)("button", {
				className: "pk-btn",
				disabled: packBusy === p.name,
				onClick: () => removePack(p.name)
			}, t.delete))), p.note ? (0, react.createElement)("div", { className: "pk-pack-note" }, p.note) : null));
			const packMsgNode = packMsg === null ? null : packMsg.kind === "ok" ? (0, react.createElement)("div", { className: "pk-ok pk-summary" }, packMsg.text) : (0, react.createElement)("div", { className: "pk-err pk-summary" }, packMsg.text);
			const importSection = (() => {
				if (importResult === null) return null;
				if (importResult.kind === "running") {
					return (0, react.createElement)("div", { className: "pk-status" }, t.importing);
				}
				if (importResult.kind === "error") {
					return (0, react.createElement)("div", { className: "pk-status error" }, importResult.noZip ? t.noZip : t.importFailed);
				}
				const diff = importResult.diff || {};
				const manifest = importResult.manifest || {};
				const added = diff.added || [];
				const changed = diff.changed || [];
				const same = diff.same || [];
				const skipped = diff.skipped || [];
				const columns = [
					["added", t.diffAdded, added],
					["changed", t.diffChanged, changed],
					["same", t.diffSame, same],
					["skipped", t.diffSkipped, skipped]
				].map(([id, label, items]) => (0, react.createElement)("div", { key: id, className: `pk-diff-col diff-${id}` }, (0, react.createElement)("h5", null, label, (0, react.createElement)("span", { className: "pk-count" }, String(items.length))), items.length === 0 ? (0, react.createElement)("div", { className: "pk-note" }, t.empty) : (0, react.createElement)("ul", { className: "pk-diff-list" }, items.map((item, index) => (0, react.createElement)("li", { key: index }, `${item.module}/${item.rel}`)))));
				return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "pk-summary" }, `${t.diffTitle}：${t.diffAdded} ${added.length} · ${t.diffChanged} ${changed.length} · ${t.diffSame} ${same.length} · ${t.diffSkipped} ${skipped.length}`), (0, react.createElement)("div", { className: "pk-status" }, `${t.manifestInfo}：${t.packMode} ${modeName(manifest.mode)} · ${t.schemaVersion} ${manifest.schemaVersion || t.empty}`, (manifest.modules || []).length ? (0, react.createElement)("br", null) : null, (manifest.modules || []).length ? `${t.modules}：${(manifest.modules || []).join(", ")}` : null, manifest.note ? (0, react.createElement)("br", null) : null, manifest.note ? `${t.packNote}：${manifest.note}` : null), (0, react.createElement)("div", { className: "pk-diff" }, ...columns));
			})();
			const strategyRadios = [
				["overwrite", t.strategyOverwrite, t.strategyOverwriteHint],
				["skip", t.strategySkip, t.strategySkipHint],
				["merge", t.strategyMerge, t.strategyMergeHint]
			].map(([value, label, hint]) => (0, react.createElement)("label", { key: value, className: "pk-mode" }, (0, react.createElement)("input", {
				type: "radio",
				name: "pk-strategy",
				checked: strategy === value,
				onChange: () => setStrategy(value)
			}), (0, react.createElement)("span", null, label, (0, react.createElement)("span", { className: "pk-note" }, `（${hint}）`))));
			const applySection = (() => {
				if (applyResult === null) return null;
				if (applyResult.kind === "running") {
					return (0, react.createElement)("div", { className: "pk-status" }, t.applying);
				}
				if (applyResult.kind === "error") {
					return (0, react.createElement)("div", { className: "pk-status error" }, applyResult.noZip ? t.noZip : t.applyFailed);
				}
				const stats = applyResult.stats || {};
				const failures = stats.failures || [];
				return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "pk-summary" }, `${t.applyResult}：${t.statOverwritten} ${stats.overwritten || 0} · ${t.statAdded} ${stats.added || 0} · ${t.statMerged} ${stats.merged || 0} · ${t.statSkipped} ${stats.skipped || 0} · ${t.statFailed} ${stats.failed || 0}`), failures.length === 0 ? null : (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "pk-subtitle pk-err" }, t.failures), (0, react.createElement)("ul", { className: "pk-list" }, failures.map((f, index) => (0, react.createElement)("li", { key: index }, typeof f === "string" ? f : JSON.stringify(f))))));
			})();
			return (0, react.createElement)("div", {
				className: "pk-page",
				"data-dsh-theme": dark ? 'dark' : 'light'
			}, (0, react.createElement)("style", null, styles), (0, react.createElement)("h3", null, t.title), (0, react.createElement)("div", { className: "pk-page-sub" }, t.moduleHint), (0, react.createElement)("section", { className: "pk-block" }, (0, react.createElement)("h4", null, t.modules), (0, react.createElement)("div", { className: "pk-modules" }, ...moduleCards), (0, react.createElement)("div", { className: "pk-actions" }, (0, react.createElement)("button", {
				className: "pk-btn",
				onClick: () => presetBy("default")
			}, t.presetMigrate), (0, react.createElement)("button", {
				className: "pk-btn",
				onClick: () => presetBy("share")
			}, t.presetShare), (0, react.createElement)("span", { className: "pk-note" }, t.selected.replace("{n}", String(selectedCount)))), (0, react.createElement)("div", { className: "pk-modes" }, (0, react.createElement)("label", { className: "pk-mode" }, (0, react.createElement)("input", {
				type: "radio",
				name: "pk-mode",
				checked: mode === "migrate",
				onChange: () => setMode("migrate")
			}), (0, react.createElement)("span", null, t.migrate)), (0, react.createElement)("label", { className: "pk-mode" }, (0, react.createElement)("input", {
				type: "radio",
				name: "pk-mode",
				checked: mode === "share",
				onChange: () => setMode("share")
			}), (0, react.createElement)("span", null, t.share, mode === "share" ? (0, react.createElement)("span", { className: "pk-note" }, `（${t.shareHint}）`) : null)))), (0, react.createElement)("section", { className: "pk-block" }, (0, react.createElement)("h4", null, t.pack), (0, react.createElement)("div", { className: "pk-actions" }, (0, react.createElement)("button", {
				className: "pk-btn",
				disabled: scan !== null && scan.kind === "running",
				onClick: runScan
			}, t.scan)), scanSection, (0, react.createElement)("div", { className: "pk-field" }, (0, react.createElement)("label", null, t.note), (0, react.createElement)("input", {
				type: "text",
				value: note,
				placeholder: t.notePlaceholder,
				onChange: (event) => setNote(event.target.value)
			})), (0, react.createElement)("div", { className: "pk-actions" }, (0, react.createElement)("button", {
				className: "pk-btn",
				disabled: create !== null && create.kind === "running",
				onClick: () => runCreate(true)
			}, t.preview), (0, react.createElement)("button", {
				className: "pk-btn primary",
				disabled: create !== null && create.kind === "running",
				onClick: () => runCreate(false)
			}, t.create)), createSection), (0, react.createElement)("section", { className: "pk-block" }, (0, react.createElement)("h4", null, t.packs), packs.length === 0 ? (0, react.createElement)("div", { className: "pk-note" }, t.noPacks) : (0, react.createElement)("ul", { className: "pk-packs" }, ...packItems), packMsgNode, status.value.packsDir ? (0, react.createElement)("div", { className: "pk-root" }, `${t.packsDir}：${status.value.packsDir}`) : null), (0, react.createElement)("section", { className: "pk-block" }, (0, react.createElement)("h4", null, t.restore), (0, react.createElement)("div", { className: "pk-field" }, (0, react.createElement)("label", null, t.zipPath), (0, react.createElement)("input", {
				type: "text",
				value: zipPath,
				placeholder: t.zipPlaceholder,
				onChange: (event) => setZipPath(event.target.value)
			}), (0, react.createElement)("span", { className: "pk-hint" }, t.zipHint)), (0, react.createElement)("div", { className: "pk-actions" }, (0, react.createElement)("button", {
				className: "pk-btn",
				disabled: importResult !== null && importResult.kind === "running",
				onClick: runImport
			}, t.importCheck)), importSection, (0, react.createElement)("div", { className: "pk-strategy" }, (0, react.createElement)("div", { className: "pk-subtitle" }, t.strategy), (0, react.createElement)("div", { className: "pk-modes" }, ...strategyRadios)), (0, react.createElement)("div", { className: "pk-actions" }, (0, react.createElement)("button", {
				className: "pk-btn primary",
				disabled: applyResult !== null && applyResult.kind === "running",
				onClick: runApply
			}, t.apply)), applySection));
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "packer-settings",
				order: 60,
				label: () => text().tab
			}, PackerSettingsPage)), "packer: settings");
		}
		//#endregion
		exports.PackerSettingsPage = PackerSettingsPage;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
