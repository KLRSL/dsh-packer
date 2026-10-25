window.__ModuleLoader__.load({
	id: "dsh-packer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/**
		 * dsh-packer 设置页 v0.6.0（UI 重做）。
		 * 一页五个区块，按「配置打包器」的任务链排布：
		 * 标题区、已有的配置包、打包内容、打包选项（含打包结果）、恢复（含差异对比与恢复结果）。
		 * 手写 react.createElement，无构建；中文单语；界面不出现内部字段名；不用 emoji 与图标字符。
		 */
		const h = react.createElement;
		// 打包内容按产品语义分 5 组。组里是接口的模块 id，只用于请求，不显示在界面上。
		const GROUPS = [
			{ id: "skills", label: "技能库", desc: "自定义技能与记忆机制 skill", modules: ["skills"] },
			{ id: "plugins", label: "已安装插件", desc: "插件本体与依赖，换机器必须带上", modules: ["plugins"] },
			{ id: "memory", label: "记忆数据库", desc: "记忆条目与审计记录，恢复前须退出 DSH", modules: ["memoryDb", "memory"] },
			{ id: "sessions", label: "会话记录", desc: "历史对话，体积通常最大", modules: ["sessions"] },
			{ id: "config", label: "配置与预设", desc: "全局设置、档案与 Agent 预设", modules: ["profiles", "settings", "presets"] }
		];
		// 隐私命中的类别，只用于扫描结论里给人看的汇总
		const PRIVACY_KINDS = { path: "路径", userpath: "用户路径", unc: "网络路径", unix: "Unix 路径", credential: "凭据", key: "密钥", personal: "个人信息" };
		// 文案单一来源（中文单语）。界面文案里不出现内部字段名。
		const copy = {
			title: "配置打包器",
			subtitle: "把本机的 DSH 配置打包备份，换机器或换平台时恢复。",
			loading: "正在读取本机配置…",
			unavailable: "暂时无法读取打包器状态",
			retry: "重试",
			empty: "—",
			fieldMissing: "接口未返回",
			unknown: "未知",
			otherContent: "其他内容",
			packsDir: "包目录",
			usage: "占用",
			copied: "已复制",
			copyFailed: "无法写入剪贴板，请手动复制",
			copyAction: "复制",
			close: "关闭",
			cancel: "取消",
			save: "保存",
			working: "处理中…",
			secPacks: "已有的配置包",
			colName: "包名",
			colTime: "时间",
			colContent: "内容",
			colSize: "大小",
			colEncrypted: "是否加密",
			colActions: "操作",
			packsEmptyStrong: "还没有配置包",
			packsEmptyBody: "点下方「开始打包」生成第一个（约 37 MB）。",
			packsHint: "按生成时间倒序排列；已加密的包在恢复与查看时都需要口令。",
			packItemsMore: " 等 {n} 项",
			packFiles: "{n} 文件",
			encryptedYes: "已加密",
			encryptedNo: "未加密",
			actionRestore: "恢复",
			actionInfo: "包信息",
			actionDelete: "删除",
			actionRename: "改名",
			secContents: "打包内容",
			contentsHint: "勾选这次要带走的内容；「已安装插件」体积最大。",
			colContentName: "内容",
			colContentDesc: "说明",
			colContentSize: "体积",
			colContentTake: "是否带上",
			takenOn: "已带上",
			takenOff: "不带",
			contentsEmptyStrong: "没有读到可打包的内容",
			contentsEmptyBody: "DSH 配置目录里还没有内容，或服务端没有返回清单。可以点下方「重试」刷新状态。",
			total: "合计",
			totalMeta: "{n} 组内容 · {f} 个文件",
			contentsReminder: "换机器必须带已安装插件；只给别人时去掉会话记录、已安装插件、记忆数据库和配置与预设。",
			secOptions: "打包选项",
			packMethod: "打包方式",
			optKeep: "原样打包",
			optKeepHint: "内容保真，适合换机器迁移；包内可能带本机路径。",
			optSanitize: "清理后打包（脱敏）",
			optSanitizeHint: "只改包内副本：路径换成占位符、密钥移除；本机源文件不动。",
			optEncrypt: "加密（设置口令）",
			optPassword: "口令",
			optPasswordHint: "至少 8 位；恢复这个包时需要同一口令。",
			passwordPlaceholder: "至少 8 位",
			weakPassword: "口令至少 8 位",
			noteLabel: "备注",
			notePlaceholder: "给这个包加一句说明（可选）",
			noteHint: "备注会写进包内清单，方便以后认出这个包。",
			btnCreate: "开始打包",
			creating: "打包中…",
			btnPreview: "先预览",
			previewing: "预览中…",
			previewFailed: "预览失败",
			createFailed: "打包失败",
			cancelled: "已取消，没有留下半成品包。",
			cancelFailed: "取消失败",
			noSelection: "还没有勾选任何内容，至少选一项才能打包。",
			previewSummary: "预览：{n} 个文件 · 合计 {size}",
			scanClean: "扫描结论：未发现隐私敏感内容。",
			scanFoundKeep: "扫描结论：发现 {n} 处隐私内容（{kinds}），原样打包会保留这些内容；建议改选「清理后打包（脱敏）」或加密。",
			scanFoundSanitize: "扫描结论：发现 {n} 处隐私内容（{kinds}），打包时会替换成占位符。",
			unreadable: "{n} 个文件读不出内容，已排除在包外。",
			progress: "已完成 {done} / {total}",
			progressUnknown: "进度未知",
			phaseCollect: "收集文件",
			phaseHash: "计算指纹",
			phaseScan: "隐私扫描",
			phaseZip: "压缩",
			phaseWrite: "写入磁盘",
			phasePrepare: "准备恢复",
			phaseApply: "写入文件",
			phaseRollback: "撤回",
			phaseDone: "完成",
			packResultTitle: "打包结果",
			resultColItem: "结果项",
			resultColCount: "数量",
			resultColNote: "说明",
			resultFiles: "文件",
			resultFilesNote: "写进配置包的内容文件数",
			resultSize: "合计",
			resultSizeNote: "配置包体积",
			resultSanitize: "脱敏",
			resultSanitizeNote: "包内副本已替换的隐私命中",
			resultNoSanitize: "未脱敏",
			resultNoSanitizeNote: "包内保留原样内容",
			resultEncrypt: "加密",
			resultEncryptNote: "恢复时需要口令",
			resultNoEncryptNote: "没有口令保护",
			redactions: "{n} 处",
			savedPath: "保存路径",
			fingerprint: "SHA-256 指纹",
			secRestore: "恢复",
			restoreHint: "选一个已有的配置包，或直接填包文件路径，先做导入检查再恢复。",
			restoreSource: "配置包",
			restorePlaceholder: "请选择配置包…",
			restoreNoPack: "还没有配置包",
			pathLabel: "或填包路径",
			pathPlaceholder: "例如 C:\\Users\\…\\dsh-packer-…-migrate.zip",
			pathPlaceholderMac: "例如 /Users/…/dsh-packer-…-migrate.zip",
			pathPlaceholderLinux: "例如 /home/…/dsh-packer-…-migrate.zip",
			pathPlaceholderHarmony: "例如 /storage/Users/currentUser/DSH/dsh-packer-…-migrate.zip",
			pathHint: "支持 .zip 与 .pkenc；选择下拉里的包时这里留空即可。",
			pathPrimaryHint: "当前平台请直接填写包路径（本机不提供文件选择框）。",
			importCheck: "导入检查",
			importing: "检查中…",
			importFailed: "导入检查失败",
			importNoPack: "请先选择配置包或填写路径",
			importHint: "还没有做导入检查。检查后会列出包内内容与本机的差异。",
			diffTitle: "差异对比",
			diffColContent: "内容",
			diffColPack: "包内",
			diffColLocal: "本机",
			diffColAction: "处理方式",
			diffAdded: "新增",
			diffChanged: "变更",
			diffSame: "相同",
			diffSkipped: "跳过",
			fileCount: "{n} 个文件",
			localNone: "本机没有",
			diffActionOff: "跳过（未勾选）",
			diffActionOverwrite: "覆盖变更 {c} 个 · 新增 {a} 个",
			diffActionSkip: "跳过变更 {c} 个 · 新增 {a} 个",
			diffActionMerge: "合并写入 {n} 个",
			restoreScope: "恢复范围",
			includeDb: "连记忆数据库一起恢复（需先退出 DSH）",
			includeDbWarn: "会用包内的记忆数据库覆盖本机的，最近的记忆可能丢失；恢复前会自动备份，可一键撤回。",
			strategy: "冲突处理方式",
			strategyOverwrite: "覆盖",
			strategyOverwriteHint: "用包内文件替换本机同名文件",
			strategySkip: "跳过",
			strategySkipHint: "保留本机文件，只写入本机没有的",
			strategyMerge: "合并",
			strategyMergeHint: "按目录合并，保留本机独有的文件",
			btnApply: "开始恢复",
			applying: "恢复中…",
			applyFailed: "恢复失败",
			applyNoImport: "先做导入检查，再开始恢复。",
			noModules: "包内没有可恢复的内容",
			restoreResultTitle: "恢复结果",
			statOverwritten: "覆盖",
			statAdded: "新增",
			statSkipped: "跳过",
			statPending: "待确认项",
			statFailed: "失败",
			noteOverwritten: "被包内文件替换",
			noteAdded: "本机原来没有",
			noteSkipped: "已存在且按所选方式保留",
			notePending: "默认没恢复的项与没自动回填的占位符",
			noteFailed: "逐条原因见下方",
			aborted: "恢复被取消：本次已写入的文件已按备份撤回。",
			excludedTitle: "默认没有恢复的项",
			placeholderTitle: "需要人工确认的占位符",
			failuresTitle: "失败明细",
			backupDir: "恢复前备份",
			backupDirMissing: "本次没有返回备份目录，无法撤回",
			rollback: "一键撤回",
			rollbackTitle: "撤回本次恢复",
			rollbackMessage: "按恢复前的备份把文件还原到恢复前的状态？",
			rollbackFailed: "撤回失败",
			rollbackDone: "已撤回：{restored} 个文件还原成功，{failed} 个失败",
			infoTitle: "包信息",
			infoLoading: "正在读取包信息…",
			infoFailed: "读取包信息失败",
			infoFiles: "包内文件",
			infoVerifyOk: "完整性校验通过：{n} 个文件指纹一致",
			infoVerifyFail: "完整性校验失败：{n} 个文件不一致",
			infoVerifyMissing: "接口未返回完整性校验结果",
			infoSanitize: "已脱敏 {n} 处",
			infoNote: "备注：{note}",
			passwordDialogTitle: "加密包口令",
			passwordDialogHint: "该包已加密，需要口令才能读取内容。",
			passwordWrong: "口令不正确",
			passwordFailed: "口令校验失败",
			passwordSubmit: "解锁",
			renameTitle: "重命名配置包",
			renameLabel: "新名称（含扩展名）",
			renameInvalid: "名称不能包含路径分隔符或 ..",
			renameDone: "已改名",
			renameFailed: "改名失败",
			deleteTitle: "删除配置包",
			deleteMessage: "删除「{name}」？包会进入{trash}，可在{trash}找回。",
			deleteMessageNoTrash: "删除「{name}」？当前平台没有系统回收站，删除后不可恢复。",
			deleteSubmit: "删除",
			deleteDone: "已删除",
			deleteDoneRecycle: "已移入{trash}",
			deleteFailed: "删除失败",
			more: "另有 {n} 条"
		};
		const numOr = (value, fallback) => {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : fallback;
		};
		const formatBytes = (value) => {
			if (value === void 0 || value === null || Number.isNaN(Number(value))) return copy.empty;
			const units = ["B", "KB", "MB", "GB"];
			let size = Number(value);
			let unit = 0;
			while (size >= 1024 && unit < units.length - 1) {
				size /= 1024;
				unit += 1;
			}
			return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
		};
		const formatTime = (iso) => {
			if (!iso) return null;
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return String(iso);
			const pad = (value) => String(value).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		};
		const fill = (template, values) => String(template).replace(/\{(\w+)\}/g, (match, key) => (values && key in values ? String(values[key]) : match));
		// 家目录前缀替换为 ~（只影响展示，复制时仍写完整路径）
		const maskHome = (value) => String(value || "").replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, "~").replace(/^\/(?:home|Users)\/[^/]+/i, "~");
		const reduceMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const groupOfModule = (name) => GROUPS.find((group) => group.modules.includes(name)) || null;
		const moduleLabel = (name) => {
			const group = groupOfModule(name);
			return group ? group.label : copy.otherContent;
		};
		const PHASE_KEY = { collect: "phaseCollect", hash: "phaseHash", scan: "phaseScan", zip: "phaseZip", write: "phaseWrite", prepare: "phasePrepare", apply: "phaseApply", rollback: "phaseRollback", done: "phaseDone" };
		const phaseLabel = (phase) => copy[PHASE_KEY[phase]] || copy.unknown;
		// 加密包的包信息需要口令，口令走查询参数
		const infoPath = (name, password) => "/packs/" + encodeURIComponent(name) + "/info" + (password ? "?password=" + encodeURIComponent(password) : "");
		function text() {
			return copy;
		}
		const inject = ["slots"];
		function detectDark() {
			if (typeof document === "undefined") return false;
			const html = document.documentElement.getAttribute("data-ds-dark-theme");
			if (html !== null) return html !== "light";
			const body = document.body && document.body.getAttribute("data-ds-dark-theme");
			if (body !== null && body !== void 0) return body !== "light";
			if (typeof window !== "undefined" && typeof window.matchMedia === "function") return window.matchMedia("(prefers-color-scheme: dark)").matches;
			return false;
		}
		const apiFetch = async (path, options) => {
			const opt = options || {};
			const token = globalThis.__DSH_PACKER_TOKEN__;
			const headers = token ? { "x-dsh-packer-token": token } : {};
			const init = { credentials: "same-origin", method: opt.method || "GET", headers };
			if (opt.body !== void 0) {
				init.body = JSON.stringify(opt.body);
				headers["Content-Type"] = "application/json";
			}
			let response;
			try {
				response = await fetch("/packer/api" + path, init);
			} catch (error) {
				if (error && error.name === "AbortError") throw error;
				const netError = new Error(error && error.message ? error.message : String(error));
				netError.code = "network";
				throw netError;
			}
			const data = await response.json().catch(() => null);
			if (!data || data.ok !== true) {
				const apiError = new Error((data && data.error) || "HTTP " + response.status);
				apiError.code = (data && data.code) || "http_" + response.status;
				apiError.status = response.status;
				throw apiError;
			}
			return data;
		};
		const errText = (error) => (error ? `${error.code || "error"} · ${error.message || ""}`.trim() : "");
		const withDetail = (label, detail) => (detail ? `${label}（${detail}）` : label);
		// 异步作业轮询：done/total 驱动进度条，终态回传结果
		const useJob = () => {
			const [job, setJob] = react.useState(null);
			const ref = react.useRef({ timer: null, alive: true, finish: null, tick: null });
			react.useEffect(() => {
				ref.current.alive = true;
				return () => {
					ref.current.alive = false;
					if (ref.current.timer) clearTimeout(ref.current.timer);
				};
			}, []);
			const stop = () => {
				if (ref.current.timer) {
					clearTimeout(ref.current.timer);
					ref.current.timer = null;
				}
			};
			ref.current.tick = (id) => {
				apiFetch("/jobs/" + encodeURIComponent(id)).then((data) => {
					if (!ref.current.alive) return;
					const value = data.job || {};
					const terminal = !!(value.error || value.cancelled || value.phase === "done");
					setJob({ id, phase: value.phase || "collect", done: value.done, total: value.total, cancelled: !!value.cancelled, error: value.error || null, code: value.code, result: value.result === void 0 ? null : value.result, running: !terminal });
					if (terminal) {
						stop();
						const callback = ref.current.finish;
						ref.current.finish = null;
						if (typeof callback === "function") callback(value);
					} else {
						ref.current.timer = setTimeout(() => ref.current.tick && ref.current.tick(id), 500);
					}
				}).catch((error) => {
					if (!ref.current.alive) return;
					stop();
					setJob({ id, phase: "error", done: 0, total: 0, cancelled: false, error: error.message || String(error), code: error.code, result: null, running: false });
					const callback = ref.current.finish;
					ref.current.finish = null;
					if (typeof callback === "function") callback(null, error);
				});
			};
			const track = (id, onFinish) => {
				stop();
				ref.current.finish = typeof onFinish === "function" ? onFinish : null;
				setJob({ id, phase: "collect", done: 0, total: 0, cancelled: false, error: null, result: null, running: true });
				ref.current.timer = setTimeout(() => ref.current.tick && ref.current.tick(id), 250);
			};
			return { job, track };
		};
		// 设计令牌：品牌琥珀只用于主按钮 / 选中态 / 进度条 / 焦点，其余走 --dsw-alias-* 并提供 --pk-* 兜底。
		// 4/8px 栅格、字号 12/14/16/20、正文行高 1.7、hover 只做轻微提亮（≤120ms）。
		const styles = `
.pk-page{
  --pk-primary:#F59E0B;--pk-on-primary:#1A1D23;--pk-bg:#FFFFFF;--pk-surface:#F7F8FA;--pk-surface-2:#EDEFF3;--pk-text:#1A1A1A;--pk-muted:#6B7280;--pk-border:#E3E6EB;
  --pk-success:#2E7D32;--pk-warning:#ED6C02;--pk-error:#C62828;--pk-s1:4px;--pk-s2:8px;--pk-s3:12px;--pk-s4:16px;--pk-s6:24px;--pk-s8:32px;
  --pk-r1:4px;--pk-r2:8px;--pk-r3:12px;--pk-r4:16px;--pk-font:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,sans-serif;
  --pk-mono:ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;--pk-shadow:0 1px 2px rgba(16,18,22,.06);--pk-shadow-lg:0 16px 40px rgba(16,18,22,.20);--pk-scrim:rgba(15,17,21,.45);
  display:flex;flex-direction:column;gap:var(--pk-s4);padding:var(--pk-s6);border:1px solid var(--dsw-alias-border-l2,var(--pk-border));border-radius:var(--pk-r4);
  background:var(--dsw-alias-bg-layer-1,var(--pk-bg));color:var(--dsw-alias-label-primary,var(--pk-text));font-family:var(--pk-font);font-size:14px;line-height:1.7;
}
.pk-page[data-dsh-theme="dark"]{
  --pk-primary:#FBBF24;--pk-on-primary:#1A1D23;--pk-bg:#0F1115;--pk-surface:#1A1D23;--pk-surface-2:#22262E;--pk-text:#E8EAED;--pk-muted:#9AA0A6;--pk-border:#2A2E37;
  --pk-success:#4ADE80;--pk-warning:#FB923C;--pk-error:#F87171;--pk-shadow:0 1px 2px rgba(0,0,0,.5);--pk-shadow-lg:0 16px 40px rgba(0,0,0,.6);--pk-scrim:rgba(0,0,0,.6);
}
.pk-page h1,.pk-page h2,.pk-page h3,.pk-page h4{margin:0;color:var(--pk-text);line-height:1.6}
.pk-page button{font-family:var(--pk-font)}
.pk-page :focus-visible{outline:2px solid var(--pk-primary);outline-offset:2px}
.pk-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:var(--pk-s3)}
.pk-head-text{min-width:0}
.pk-title{font-size:20px;font-weight:600}
.pk-sub{margin:var(--pk-s1) 0 0;font-size:12px;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-status{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pk-s2);font-size:12px;color:var(--dsw-alias-label-secondary,var(--pk-muted));min-width:0}
.pk-status-path{display:inline-flex;align-items:center;gap:var(--pk-s2);max-width:100%;min-height:24px;margin-left:calc(-1 * var(--pk-s2));padding:0 var(--pk-s2);border:1px solid transparent;border-radius:var(--pk-r1);background:transparent;color:inherit;font-size:12px;cursor:pointer;transition:background-color 120ms ease,color 120ms ease}
.pk-status-path:hover:not(:disabled){background:var(--pk-surface);color:var(--pk-text)}
.pk-status-path:disabled{cursor:default}
.pk-status-label{white-space:nowrap}
.pk-status-path .pk-mono{color:var(--pk-text);font-weight:500}
.pk-copied{color:var(--pk-success);white-space:nowrap}
.pk-sep{opacity:.5}
.pk-body{display:flex;flex-direction:column;gap:var(--pk-s4);min-width:0}
.pk-section{display:flex;flex-direction:column;gap:var(--pk-s3);padding:var(--pk-s4);border:1px solid var(--pk-border);border-radius:var(--pk-r3);background:var(--dsw-alias-bg-layer-1,var(--pk-bg));box-shadow:var(--pk-shadow);min-width:0}
.pk-section-title{display:flex;align-items:center;gap:var(--pk-s2);font-size:16px;font-weight:600}
.pk-section-title::before{content:"";width:3px;height:14px;flex:none;border-radius:var(--pk-r1);background:color-mix(in srgb,var(--pk-text) 26%,var(--pk-border))}
.pk-hint{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-hint.warn{color:var(--pk-warning)}
.pk-label{font-size:12px;font-weight:600;color:var(--pk-text)}
.pk-line{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-line.ok{color:var(--pk-success)}
.pk-line.warn{color:var(--pk-warning)}
.pk-line.err{color:var(--pk-error);font-weight:600}
.pk-table-wrap{overflow-x:auto;min-width:0}
.pk-table{width:100%;border-collapse:collapse;font-size:14px}
.pk-table th{font-size:12px;font-weight:600;text-align:left;padding:var(--pk-s1) var(--pk-s2);border-bottom:1px solid var(--pk-border);color:var(--dsw-alias-label-secondary,var(--pk-muted));white-space:nowrap}
.pk-table td{padding:var(--pk-s2);border-bottom:1px solid var(--pk-border);vertical-align:top;line-height:1.6}
.pk-table tbody tr:last-child td{border-bottom:0}
.pk-table tbody tr:hover{background:var(--pk-surface)}
.pk-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pk-desc{font-size:12px;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-row-inline{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pk-s1)}
.pk-total{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--pk-s2);padding:var(--pk-s2) var(--pk-s3);border-radius:var(--pk-r1);background:var(--pk-surface)}
.pk-total strong{font-size:16px;font-variant-numeric:tabular-nums}
.pk-total-meta{font-size:12px;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pk-s2)}
.pk-grow{flex:1 1 220px;width:auto}
.pk-field{display:flex;flex-direction:column;gap:var(--pk-s2);min-width:0}
.pk-field>label,.pk-field>.pk-label{font-size:12px;font-weight:600;color:var(--pk-text)}
.pk-input,.pk-select{width:100%;height:40px;box-sizing:border-box;padding:0 var(--pk-s3);border:1px solid var(--pk-border);border-radius:var(--pk-r2);background:var(--dsw-alias-bg-layer-1,var(--pk-bg));color:var(--pk-text);font-family:var(--pk-font);font-size:14px;min-width:0}
.pk-input::placeholder{color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-input:focus,.pk-select:focus{border-color:var(--pk-primary)}
.pk-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--pk-s1)}
.pk-check{display:flex;align-items:center;gap:var(--pk-s2);padding:var(--pk-s1) var(--pk-s2);border-radius:var(--pk-r1);font-size:14px;cursor:pointer;min-width:0}
.pk-check:hover{background:var(--pk-surface)}
.pk-check input{width:16px;height:16px;flex:none;margin:0;accent-color:var(--pk-primary)}
.pk-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--pk-s2)}
.pk-choices.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.pk-choice{display:flex;align-items:flex-start;gap:var(--pk-s2);padding:var(--pk-s2) var(--pk-s3);border:1px solid var(--pk-border);border-radius:var(--pk-r2);background:var(--pk-surface);font-size:14px;cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease}
.pk-choice:hover{border-color:color-mix(in srgb,var(--pk-text) 18%,var(--pk-border))}
.pk-choice.chosen{border-color:var(--pk-primary);background:color-mix(in srgb,var(--pk-primary) 10%,var(--pk-surface))}
.pk-choice input{width:16px;height:16px;flex:none;margin:2px 0 0;accent-color:var(--pk-primary)}
.pk-choice-hint{display:block;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--pk-s1);min-height:36px;padding:0 var(--pk-s4);border:1px solid var(--pk-border);border-radius:var(--pk-r2);background:var(--dsw-alias-bg-layer-1,var(--pk-bg));color:var(--pk-text);font-size:14px;font-weight:600;cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease,filter 120ms ease}
.pk-btn:hover:not(:disabled){background:var(--pk-surface)}
.pk-btn:disabled{opacity:.5;cursor:not-allowed}
.pk-btn.primary{background:var(--pk-primary);border-color:var(--pk-primary);color:var(--pk-on-primary)}
.pk-btn.primary:hover:not(:disabled){background:var(--pk-primary);filter:brightness(1.05)}
.pk-btn.danger{color:var(--pk-error);border-color:color-mix(in srgb,var(--pk-error) 40%,var(--pk-border))}
.pk-btn.danger:hover:not(:disabled){background:color-mix(in srgb,var(--pk-error) 8%,transparent)}
.pk-btn.tiny{min-height:28px;padding:0 var(--pk-s2);font-size:12px;font-weight:500}
.pk-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pk-s2)}
.pk-msg{margin:0;padding:var(--pk-s2) var(--pk-s3);border:1px solid var(--pk-border);border-radius:var(--pk-r1);background:var(--pk-surface);font-size:12px;line-height:1.7;word-break:break-word}
.pk-msg.ok{color:var(--pk-success);border-color:color-mix(in srgb,var(--pk-success) 35%,var(--pk-border))}
.pk-msg.warn{color:var(--pk-warning);border-color:color-mix(in srgb,var(--pk-warning) 35%,var(--pk-border))}
.pk-msg.err{color:var(--pk-error);border-color:color-mix(in srgb,var(--pk-error) 35%,var(--pk-border))}
.pk-empty{padding:var(--pk-s6) var(--pk-s4);border:1px dashed var(--pk-border);border-radius:var(--pk-r2);text-align:center;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-empty strong{display:block;margin-bottom:var(--pk-s1);font-size:14px;color:var(--pk-text)}
.pk-progress{margin-top:var(--pk-s3);padding:var(--pk-s3);border:1px solid var(--pk-border);border-radius:var(--pk-r2);background:var(--pk-surface)}
.pk-progress-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pk-s2);margin-bottom:var(--pk-s2);font-size:12px}
.pk-progress-phase{font-size:14px;font-weight:600;color:var(--pk-text)}
.pk-progress-pct{font-weight:700;color:var(--pk-primary)}
.pk-progress-count{color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-progress-track{height:8px;border-radius:var(--pk-r1);background:var(--pk-surface-2);overflow:hidden}
.pk-progress-fill{height:100%;border-radius:var(--pk-r1);background:var(--pk-primary);transition:width 120ms ease}
.pk-progress-fill.indeterminate{width:40%;animation:pk-slide 1.2s ease-in-out infinite}
.pk-result{display:flex;flex-direction:column;gap:var(--pk-s2);margin-top:var(--pk-s3);padding:var(--pk-s4);border:1px solid color-mix(in srgb,var(--pk-success) 32%,var(--pk-border));border-radius:var(--pk-r2);background:color-mix(in srgb,var(--pk-success) 6%,transparent)}
.pk-result-title{font-size:16px;font-weight:600}
.pk-result-foot{display:flex;flex-direction:column;gap:var(--pk-s1);padding-top:var(--pk-s2);border-top:1px dashed var(--pk-border)}
.pk-foot-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pk-s2);font-size:12px;min-width:0}
.pk-foot-label{flex:none;font-weight:600;color:var(--pk-text)}
.pk-foot-value{flex:1 1 200px;min-width:0;color:var(--dsw-alias-label-secondary,var(--pk-muted));word-break:break-all}
.pk-diff-sum{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pk-s2)}
.pk-diff-tag{display:inline-flex;align-items:center;gap:var(--pk-s1);height:24px;padding:0 var(--pk-s2);border:1px solid var(--pk-border);border-radius:var(--pk-r1);font-size:12px}
.pk-dot{display:inline-block;width:8px;height:8px;flex:none;border-radius:var(--pk-r1)}
.pk-dot.added{background:var(--pk-success)}
.pk-dot.changed{background:var(--pk-warning)}
.pk-dot.same{background:var(--pk-muted)}
.pk-dot.skipped{border:1px solid var(--pk-muted)}
.pk-filelist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:var(--pk-s1);max-height:320px;overflow:auto}
.pk-filelist li{display:flex;align-items:center;gap:var(--pk-s2);padding:var(--pk-s1) var(--pk-s2);border-radius:var(--pk-r1);font-family:var(--pk-mono);font-size:12px;word-break:break-all}
.pk-filelist li:nth-child(odd){background:var(--pk-surface)}
.pk-path{flex:1;min-width:0}
.pk-size{flex:none;color:var(--dsw-alias-label-secondary,var(--pk-muted))}
.pk-tag{display:inline-flex;align-items:center;height:20px;padding:0 var(--pk-s2);border:1px solid var(--pk-border);border-radius:var(--pk-r1);font-size:12px;color:var(--dsw-alias-label-secondary,var(--pk-muted));white-space:nowrap;vertical-align:1px}
.pk-tag.ok{color:var(--pk-success);border-color:color-mix(in srgb,var(--pk-success) 40%,var(--pk-border))}
.pk-tag.warn{color:var(--pk-warning);border-color:color-mix(in srgb,var(--pk-warning) 40%,var(--pk-border))}
.pk-mono{font-family:var(--pk-mono);font-size:12px;word-break:break-all}
.pk-spin{display:inline-block;width:12px;height:12px;margin-right:var(--pk-s1);border-radius:50%;border:2px solid var(--pk-border);border-top-color:var(--pk-primary);animation:pk-rot .8s linear infinite;vertical-align:-1px}
.pk-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:var(--pk-s4);background:var(--pk-scrim)}
.pk-modal{display:flex;flex-direction:column;gap:var(--pk-s3);width:100%;max-width:520px;max-height:86vh;overflow:auto;padding:var(--pk-s4);border:1px solid var(--pk-border);border-radius:var(--pk-r4);background:var(--dsw-alias-bg-layer-2,var(--pk-bg));box-shadow:var(--pk-shadow-lg)}
.pk-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--pk-s2)}
.pk-modal-head h4{font-size:16px;font-weight:600;word-break:break-all}
.pk-modal-body{display:flex;flex-direction:column;gap:var(--pk-s3);min-width:0}
.pk-modal-foot{display:flex;justify-content:flex-end;gap:var(--pk-s2)}
@keyframes pk-rot{to{transform:rotate(360deg)}}
@keyframes pk-slide{0%{transform:translateX(-105%)}100%{transform:translateX(255%)}}
@media (max-width:560px){.pk-checks,.pk-choices,.pk-choices.two{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.pk-page *{transition:none!important;animation:none!important}.pk-progress-fill.indeterminate{width:100%;opacity:.6}}
`;
		const Modal = (props) => h("div", {
			className: "pk-overlay",
			onClick: (event) => {
				if (event.target === event.currentTarget && !props.busy) props.onClose();
			}
		}, h("div", { className: "pk-modal", role: "dialog", "aria-modal": "true", "aria-label": props.title },
			h("div", { className: "pk-modal-head" },
				h("h4", null, props.title),
				h("button", { type: "button", className: "pk-btn tiny", disabled: !!props.busy, onClick: props.onClose, "aria-label": copy.close }, copy.close)),
			h("div", { className: "pk-modal-body" }, props.children),
			props.footer ? h("div", { className: "pk-modal-foot" }, ...props.footer) : null));
		const Progress = (props) => {
			const job = props.job;
			if (!job) return null;
			const total = Number(job.total);
			const done = Number(job.done);
			const doneSafe = Number.isFinite(done) && done >= 0 ? done : 0;
			const hasTotal = Number.isFinite(total) && total > 0;
			const percent = hasTotal ? Math.min(100, Math.round((doneSafe / total) * 100)) : null;
			const label = phaseLabel(job.phase);
			return h("div", { className: "pk-progress" },
				h("div", { className: "pk-progress-head" },
					h("span", { className: "pk-progress-phase" }, label),
					h("span", { className: "pk-progress-pct" }, percent === null ? copy.progressUnknown : percent + "%"),
					hasTotal ? h("span", { className: "pk-progress-count" }, fill(copy.progress, { done: doneSafe, total })) : null,
					props.onCancel ? h("button", { type: "button", className: "pk-btn tiny", onClick: props.onCancel, style: { marginLeft: "auto" } }, copy.cancel) : null),
				h("div", { className: "pk-progress-track", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent === null ? 0 : percent, "aria-label": label },
					h("div", { className: percent === null ? "pk-progress-fill indeterminate" : "pk-progress-fill", style: percent === null ? void 0 : { width: percent + "%" } })));
		};
		// 结果区（打包与恢复共用样式）：表格三列 + 底部固定行（路径可复制 / 指纹）
		const FootRow = (props) => h("div", { className: "pk-foot-row" },
			h("span", { className: "pk-foot-label" }, props.label),
			h("span", { className: "pk-foot-value" + (props.mono === false ? "" : " pk-mono") }, props.value ? props.value : copy.empty),
			props.value ? null : h("span", { className: "pk-tag" }, copy.fieldMissing),
			props.actions || null);
		const ResultCard = (props) => h("div", { className: "pk-result" },
			h("h4", { className: "pk-result-title" }, props.title),
			h("div", { className: "pk-table-wrap" },
				h("table", { className: "pk-table" },
					h("thead", null, h("tr", null,
						h("th", null, copy.resultColItem),
						h("th", { className: "num" }, copy.resultColCount),
						h("th", null, copy.resultColNote))),
					h("tbody", null, ...props.rows.map((row) => h("tr", { key: row.key },
						h("td", null, row.item),
						h("td", { className: "num pk-mono" }, row.count),
						h("td", { className: "pk-desc" }, row.note)))))),
			h("div", { className: "pk-result-foot" }, ...props.footer));
		function PackerSettingsPage() {
			const [dark, setDark] = react.useState(detectDark);
			react.useEffect(() => {
				const sync = () => setDark(detectDark());
				const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
				if (mq && mq.addEventListener) mq.addEventListener("change", sync);
				const mo = new MutationObserver(sync);
				mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
				if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
				return () => {
					if (mq && mq.removeEventListener) mq.removeEventListener("change", sync);
					mo.disconnect();
				};
			}, []);
			const alive = react.useRef(true);
			react.useEffect(() => () => {
				alive.current = false;
			}, []);
			const [status, setStatus] = react.useState({ kind: "loading" });
			const [packs, setPacks] = react.useState([]);
			const [notify, setNotify] = react.useState(null);
			const [copied, setCopied] = react.useState(null);
			const [selected, setSelected] = react.useState({});
			// 打包方式：原样打包 / 清理后打包（脱敏），二选一
			const [privacy, setPrivacy] = react.useState("keep");
			const [note, setNote] = react.useState("");
			const [encrypt, setEncrypt] = react.useState(false);
			const [password, setPassword] = react.useState("");
			const [preview, setPreview] = react.useState(null);
			const [created, setCreated] = react.useState(null);
			const packJob = useJob();
			const [packName, setPackName] = react.useState("");
			const [zipPath, setZipPath] = react.useState("");
			const [imp, setImp] = react.useState(null);
			const [restoreSel, setRestoreSel] = react.useState({});
			const [includeDb, setIncludeDb] = react.useState(false);
			const [strategy, setStrategy] = react.useState("overwrite");
			const [applied, setApplied] = react.useState(null);
			const restoreJob = useJob();
			const [info, setInfo] = react.useState(null);
			const [pwDialog, setPwDialog] = react.useState(null);
			const [renameDialog, setRenameDialog] = react.useState(null);
			const [confirmDialog, setConfirmDialog] = react.useState(null);
			const restoreRef = react.useRef(null);
			const initRef = react.useRef(false);
			const say = (kind, message) => {
				if (alive.current) setNotify({ kind, text: message });
			};
			const loadStatus = react.useCallback(() => apiFetch("/status").then((data) => {
				if (!alive.current) return null;
				setStatus({ kind: "ready", value: data });
				if (Array.isArray(data.packs)) setPacks(data.packs);
				return data;
			}).catch((error) => {
				if (!alive.current || (error && error.name === "AbortError")) return null;
				setStatus((prev) => (prev && prev.kind === "ready" ? prev : { kind: "error", code: error.code, message: error.message }));
				setNotify({ kind: "err", text: withDetail(copy.unavailable, errText(error)) });
				return null;
			}), []);
			react.useEffect(() => {
				loadStatus();
			}, [loadStatus]);
			react.useEffect(() => {
				if (status.kind !== "ready" || initRef.current) return;
				initRef.current = true;
				const mods = status.value.modules || {};
				const next = {};
				for (const group of GROUPS) {
					const present = group.modules.filter((name) => mods[name]);
					next[group.id] = present.length > 0 && present.every((name) => mods[name].default !== false);
				}
				setSelected(next);
			}, [status]);
			const anyDialog = !!(info || pwDialog || renameDialog || confirmDialog);
			react.useEffect(() => {
				if (!anyDialog) return;
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					if ((confirmDialog && confirmDialog.busy) || (pwDialog && pwDialog.busy) || (renameDialog && renameDialog.busy)) return;
					setInfo(null);
					setPwDialog(null);
					setRenameDialog(null);
					setConfirmDialog(null);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [anyDialog, confirmDialog, pwDialog, renameDialog]);
			const ready = status.kind === "ready";
			const st = ready ? status.value : {};
			const mods = st.modules || {};
			const packsDir = typeof st.packsDir === "string" && st.packsDir ? st.packsDir : null;
			const packsBytes = st.disk && typeof st.disk.packsBytes === "number" ? st.disk.packsBytes : null;
			// v0.6.4：平台能力（由 /status 下发，网页层自己拿不到 process.platform）
			const platform = typeof st.platform === "string" ? st.platform : "other";
			const trashSupported = st.trash === true;
			const filePicker = st.filePicker === true;
			// 各平台回收站的叫法；没有回收站的平台（鸿蒙）由 deleteMessageNoTrash 如实告知不可恢复
			const trashName = platform === "darwin" ? "macOS 废纸篓" : platform === "win32" ? "Windows 回收站" : "系统回收站";
			// 手填路径的示例按平台给（鸿蒙是 /storage/…，别再拿 Windows 路径当例子）
			const pathPlaceholderText = platform === "win32" ? copy.pathPlaceholder : platform === "darwin" ? copy.pathPlaceholderMac : platform === "harmony" ? copy.pathPlaceholderHarmony : copy.pathPlaceholderLinux;
			const groups = GROUPS.map((group) => {
				const present = group.modules.filter((name) => mods[name]);
				const bytes = present.reduce((sum, name) => sum + numOr(mods[name] && mods[name].bytes, 0), 0);
				const count = present.reduce((sum, name) => sum + numOr(mods[name] && mods[name].count, 0), 0);
				return { id: group.id, label: group.label, desc: group.desc, present, bytes, count };
			}).filter((group) => group.present.length > 0);
			const chosenGroups = groups.filter((group) => !!selected[group.id]);
			const chosenModules = chosenGroups.flatMap((group) => group.present);
			const chosenBytes = chosenGroups.reduce((sum, group) => sum + group.bytes, 0);
			const chosenFiles = chosenGroups.reduce((sum, group) => sum + group.count, 0);
			const sortedPacks = packs.slice().sort((a, b) => String((b && b.createdAt) || "").localeCompare(String((a && a.createdAt) || "")));
			const zipValue = zipPath.trim() || packName;
			const busyCreating = !!(created && created.kind === "running");
			const busyPreviewing = !!(preview && preview.kind === "running");
			const busyImporting = !!(imp && imp.kind === "running");
			const busyRestoring = !!(applied && applied.kind === "running");
			const passwordOk = !encrypt || password.trim().length >= 8;
			const resetRestore = () => {
				setImp(null);
				setApplied(null);
			};
			const copyText = (value, flag) => {
				if (!value) {
					say("warn", copy.copyFailed + "：" + copy.empty);
					return;
				}
				if (!navigator.clipboard || !navigator.clipboard.writeText) {
					say("warn", copy.copyFailed + "：" + value);
					return;
				}
				navigator.clipboard.writeText(value).then(() => {
					if (!alive.current) return;
					setCopied(flag);
					window.setTimeout(() => {
						if (alive.current) setCopied(null);
					}, 1600);
				}).catch(() => {
					if (alive.current) say("warn", copy.copyFailed + "：" + value);
				});
			};
			const cancelJob = (job) => {
				if (!job || !job.id) return;
				apiFetch("/jobs/" + encodeURIComponent(job.id) + "/cancel", { method: "POST", body: {} }).catch((error) => {
					say("err", withDetail(copy.cancelFailed, errText(error)));
				});
			};
			const createBody = (dryRun) => ({
				modules: chosenModules,
				mode: "migrate",
				note: note.trim(),
				dryRun,
				sanitize: privacy === "sanitize",
				encrypt: !!encrypt,
				password: encrypt ? password : void 0
			});
			const runPreview = () => {
				if (chosenModules.length === 0) {
					setPreview({ kind: "error", code: "no_modules", message: copy.noSelection });
					return;
				}
				if (!passwordOk) {
					setPreview({ kind: "error", code: "weak_password", message: copy.weakPassword });
					return;
				}
				setPreview({ kind: "running" });
				apiFetch("/create", { method: "POST", body: createBody(true) }).then((data) => {
					if (!alive.current) return;
					setPreview({
						kind: "done",
						files: data.manifest && Array.isArray(data.manifest.files) ? data.manifest.files : [],
						totalBytes: data.totalBytes,
						privacy: Array.isArray(data.privacy) ? data.privacy : [],
						unreadable: Array.isArray(data.unreadable) ? data.unreadable : [],
						warnings: Array.isArray(data.warnings) ? data.warnings : [],
						sanitized: data.sanitized === true,
						redactions: typeof data.redactions === "number" ? data.redactions : null
					});
				}).catch((error) => {
					if (alive.current) setPreview({ kind: "error", code: error.code, message: error.message });
				});
			};
			const runCreate = () => {
				if (chosenModules.length === 0) {
					setCreated({ kind: "error", code: "no_modules", message: copy.noSelection });
					return;
				}
				if (!passwordOk) {
					setCreated({ kind: "error", code: "weak_password", message: copy.weakPassword });
					return;
				}
				setCreated({ kind: "running" });
				setPreview(null);
				apiFetch("/create", { method: "POST", body: createBody(false) }).then((data) => {
					if (!alive.current) return;
					if (!data.jobId) {
						setCreated({ kind: "done", pack: data.pack || {}, warnings: Array.isArray(data.warnings) ? data.warnings : [] });
						loadStatus();
						return;
					}
					packJob.track(data.jobId, (job, error) => {
						if (!alive.current) return;
						if (error) return setCreated({ kind: "error", code: error.code, message: error.message });
						if (job && job.cancelled) return setCreated({ kind: "cancelled" });
						if (job && job.error) return setCreated({ kind: "error", code: job.code, message: job.error });
						const result = (job && job.result) || {};
						setCreated({ kind: "done", pack: result.pack || {}, warnings: Array.isArray(result.warnings) ? result.warnings : [] });
						loadStatus();
					});
				}).catch((error) => {
					if (alive.current) setCreated({ kind: "error", code: error.code, message: error.message });
				});
			};
			const applyInfo = (name, data) => setInfo({
				kind: "done",
				name,
				files: Array.isArray(data.files) ? data.files : [],
				manifest: data.manifest || {},
				encrypted: !!data.encrypted,
				verify: data.verify && typeof data.verify === "object" ? data.verify : null
			});
			const askPassword = (onSubmit) => setPwDialog({ onSubmit, value: "", busy: false, error: null });
			const submitPassword = () => {
				const dialog = pwDialog;
				if (!dialog || dialog.busy) return;
				const value = String(dialog.value || "");
				if (!value) return setPwDialog({ ...dialog, error: copy.passwordEmpty });
				setPwDialog({ ...dialog, busy: true, error: null });
				Promise.resolve().then(() => dialog.onSubmit(value)).then(() => {
					if (alive.current) setPwDialog(null);
				}).catch((error) => {
					if (!alive.current) return;
					const prefix = error && error.code === "bad_password" ? copy.passwordWrong : copy.passwordFailed;
					setPwDialog({ ...dialog, busy: false, value: "", error: withDetail(prefix, errText(error)) });
				});
			};
			const openInfo = (pack) => {
				if (!pack) return;
				const name = pack.name;
				if (pack.encrypted === true) {
					askPassword((value) => apiFetch(infoPath(name, value)).then((data) => {
						if (alive.current) applyInfo(name, data);
					}));
					return;
				}
				setInfo({ kind: "loading", name });
				apiFetch(infoPath(name)).then((data) => {
					if (alive.current) applyInfo(name, data);
				}).catch((error) => {
					if (alive.current) setInfo({ kind: "error", name, code: error.code, message: error.message });
				});
			};
			const submitRename = () => {
				const dialog = renameDialog;
				if (!dialog || dialog.busy) return;
				const to = String(dialog.value || "").trim();
				if (!to || to === dialog.from || /[\\/]/.test(to) || to.includes("..")) return setRenameDialog({ ...dialog, error: copy.renameInvalid });
				setRenameDialog({ ...dialog, busy: true, error: null });
				apiFetch("/packs/rename", { method: "POST", body: { from: dialog.from, to } }).then(() => {
					if (!alive.current) return;
					setRenameDialog(null);
					setInfo((prev) => (prev && prev.name === dialog.from ? { ...prev, name: to } : prev));
					setPackName((prev) => (prev === dialog.from ? to : prev));
					resetRestore();
					say("ok", copy.renameDone);
					loadStatus();
				}).catch((error) => {
					if (!alive.current) return;
					setRenameDialog({ ...dialog, busy: false, error: withDetail(copy.renameFailed, errText(error)) });
				});
			};
			const askDelete = (pack) => {
				if (!pack) return;
				const name = pack.name;
				setConfirmDialog({
					title: copy.deleteTitle,
					message: trashSupported ? fill(copy.deleteMessage, { name, trash: trashName }) : fill(copy.deleteMessageNoTrash, { name }),
					confirmLabel: copy.deleteSubmit,
					errorPrefix: copy.deleteFailed,
					danger: true,
					busy: false,
					error: null,
					run: () => apiFetch("/packs/" + encodeURIComponent(name), { method: "DELETE" }).then((data) => {
						if (!alive.current) return;
						const recycled = data && data.recycled === true;
						say(recycled ? "ok" : "warn", recycled ? fill(copy.deleteDoneRecycle, { trash: trashName }) : (data && data.warning) || copy.deleteDone);
						setPackName((prev) => (prev === name ? "" : prev));
						setInfo((prev) => (prev && prev.name === name ? null : prev));
						resetRestore();
						loadStatus();
					})
				});
			};
			const submitConfirm = () => {
				const dialog = confirmDialog;
				if (!dialog || dialog.busy) return;
				setConfirmDialog({ ...dialog, busy: true, error: null });
				Promise.resolve().then(() => dialog.run()).then(() => {
					if (alive.current) setConfirmDialog(null);
				}).catch((error) => {
					if (!alive.current) return;
					setConfirmDialog({ ...dialog, busy: false, error: errText(error) });
				});
			};
			const runImportWith = (pwd) => {
				const zip = zipValue;
				const body = { zip };
				if (pwd) body.password = pwd;
				return apiFetch("/restore/import", { method: "POST", body }).then((data) => {
					if (!alive.current) return data;
					const files = Array.isArray(data.files) ? data.files : [];
					const manifest = data.manifest || {};
					const names = [];
					const fromManifest = Array.isArray(manifest.modules) ? manifest.modules.filter((name) => typeof name === "string") : [];
					for (const name of fromManifest) if (!names.includes(name)) names.push(name);
					for (const file of files) if (file && typeof file.module === "string" && !names.includes(file.module)) names.push(file.module);
					const sel = {};
					for (const group of GROUPS) {
						if (group.modules.some((name) => names.includes(name))) sel[group.id] = true;
					}
					setImp({ kind: "done", files, manifest, diff: data.diff || {}, modules: names, encrypted: !!data.encrypted });
					setRestoreSel(sel);
					setApplied(null);
					return data;
				});
			};
			const runImport = () => {
				if (!zipValue) return setImp({ kind: "error", code: "no_zip", message: copy.importNoPack });
				setImp({ kind: "running" });
				setApplied(null);
				runImportWith(void 0).catch((error) => {
					if (!alive.current) return;
					setImp({ kind: "error", code: error.code, message: error.message });
					if (error && error.code === "bad_password") {
						askPassword((value) => runImportWith(value).catch((inner) => {
							if (alive.current) setImp({ kind: "error", code: inner.code, message: inner.message });
							throw inner;
						}));
					}
				});
			};
			const impGroups = (() => {
				if (!imp || imp.kind !== "done") return [];
				const map = new Map();
				for (const file of imp.files) {
					if (!file) continue;
					const group = groupOfModule(file.module);
					const id = group ? group.id : String(file.module);
					let row = map.get(id);
					if (!row) {
						row = { id, label: group ? group.label : copy.otherContent, count: 0, bytes: 0, added: 0, changed: 0, same: 0, skipped: 0 };
						map.set(id, row);
					}
					row.count++;
					row.bytes += numOr(file.size, 0);
					const status_ = file.status;
					if (status_ === "added") row.added++;
					else if (status_ === "changed") row.changed++;
					else if (status_ === "same") row.same++;
					else row.skipped++;
				}
				return [...map.values()];
			})();
			const impModules = imp && imp.kind === "done" ? imp.modules : [];
			const chosenRestoreModules = impGroups
				.filter((row) => !!restoreSel[row.id])
				.flatMap((row) => {
					const group = GROUPS.find((item) => item.id === row.id);
					if (!group) return [row.id];
					const present = group.modules.filter((name) => impModules.includes(name));
					return present.length ? present : group.modules.filter((name) => impModules.includes(name));
				});
			const runApply = () => {
				const zip = zipValue;
				if (!zip) return setApplied({ kind: "error", code: "no_zip", message: copy.importNoPack });
				if (impGroups.length === 0) return setApplied({ kind: "error", code: "no_modules", message: copy.noModules });
				if (chosenRestoreModules.length === 0) return setApplied({ kind: "error", code: "bad_modules", message: copy.noModules });
				const body = { zip, strategy, async: true, includeDb: !!includeDb };
				body.modules = chosenRestoreModules;
				setApplied({ kind: "running" });
				apiFetch("/restore/apply", { method: "POST", body }).then((data) => {
					if (!alive.current) return;
					if (!data.jobId) {
						setApplied({ kind: "done", stats: data.stats || {} });
						loadStatus();
						return;
					}
					restoreJob.track(data.jobId, (job, error) => {
						if (!alive.current) return;
						if (error) return setApplied({ kind: "error", code: error.code, message: error.message });
						if (job && job.cancelled) return setApplied({ kind: "cancelled" });
						if (job && job.error) return setApplied({ kind: "error", code: job.code, message: job.error });
						const result = (job && job.result) || {};
						setApplied({ kind: "done", stats: result.stats || {} });
						loadStatus();
					});
				}).catch((error) => {
					if (alive.current) setApplied({ kind: "error", code: error.code, message: error.message });
				});
			};
			const askRollback = (dir) => setConfirmDialog({
				title: copy.rollbackTitle,
				message: copy.rollbackMessage,
				confirmLabel: copy.rollback,
				errorPrefix: copy.rollbackFailed,
				danger: true,
				busy: false,
				error: null,
				run: () => apiFetch("/restore/rollback", { method: "POST", body: { dir } }).then((data) => {
					if (!alive.current) return;
					setApplied((prev) => (prev && prev.kind === "done" ? { ...prev, rollback: { restored: data.restored, failed: data.failed } } : prev));
				})
			});
			const restoreFromPack = (pack) => {
				if (!pack) return;
				setPackName(pack.name);
				setZipPath("");
				resetRestore();
				const node = restoreRef.current;
				if (!node) return;
				if (node.scrollIntoView) node.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
				const select = node.querySelector("select");
				if (select && select.focus) select.focus({ preventScroll: true });
			};
			const packContent = (pack) => {
				const ids = Array.isArray(pack.modules) ? pack.modules : [];
				const labels = [];
				for (const id of ids) {
					const label = moduleLabel(id);
					if (!labels.includes(label)) labels.push(label);
				}
				if (labels.length === 0) return h("span", null, copy.empty, " ", h("span", { className: "pk-tag" }, copy.fieldMissing));
				const head = labels.slice(0, 3).join("、");
				const more = labels.length > 3 ? fill(copy.packItemsMore, { n: labels.length }) : "";
				return head + more + " · " + fill(copy.packFiles, { n: numOr(pack.fileCount, 0) });
			};
			const scanNode = (() => {
				if (!preview) return null;
				if (preview.kind === "running") return h("div", { className: "pk-msg" }, h("span", { className: "pk-spin" }), copy.previewing);
				if (preview.kind === "error") return h("div", { className: "pk-msg err" }, withDetail(copy.previewFailed, errText(preview)));
				const findings = Array.isArray(preview.privacy) ? preview.privacy : [];
				const total = findings.reduce((sum, item) => sum + numOr(item && item.count, 1), 0);
				const byKind = {};
				for (const item of findings) {
					const kind = (item && item.kind) || "personal";
					byKind[kind] = (byKind[kind] || 0) + numOr(item && item.count, 1);
				}
				const kinds = Object.keys(byKind).map((kind) => (PRIVACY_KINDS[kind] || copy.otherContent) + " " + byKind[kind] + " 处").join("、");
				const files = Array.isArray(preview.files) ? preview.files : [];
				return h("div", null,
					h("div", { className: "pk-msg " + (total === 0 ? "ok" : "warn") }, fill(copy.previewSummary, { n: files.length, size: formatBytes(preview.totalBytes) }) + "。" + (total === 0 ? copy.scanClean : fill(privacy === "sanitize" ? copy.scanFoundSanitize : copy.scanFoundKeep, { n: total, kinds }))),
					Array.isArray(preview.unreadable) && preview.unreadable.length > 0 ? h("div", { className: "pk-line warn" }, fill(copy.unreadable, { n: preview.unreadable.length })) : null,
					Array.isArray(preview.warnings) ? preview.warnings.map((item, index) => h("div", { key: "w" + index, className: "pk-line warn" }, String(item))) : null);
			})();
			const createdNode = (() => {
				if (!created) return null;
				if (created.kind === "cancelled") return h("div", { className: "pk-msg warn" }, copy.cancelled);
				if (created.kind === "error") return h("div", { className: "pk-msg err" }, withDetail(copy.createFailed, errText(created)));
				if (created.kind !== "done") return null;
				const pack = created.pack || {};
				const path = typeof pack.path === "string" && pack.path ? pack.path : null;
				const sha = typeof pack.sha256 === "string" && pack.sha256 ? pack.sha256 : null;
				const sanitized = pack.sanitized === true;
				const rows = [
					{
						key: "files",
						item: copy.resultFiles,
						count: typeof pack.fileCount === "number" ? String(pack.fileCount) : copy.empty,
						note: typeof pack.fileCount === "number" ? copy.resultFilesNote : copy.fieldMissing
					},
					{ key: "size", item: copy.resultSize, count: formatBytes(pack.totalBytes), note: copy.resultSizeNote },
					{
						key: "sanitize",
						item: copy.resultSanitize,
						count: sanitized ? fill(copy.redactions, { n: numOr(pack.redactions, 0) }) : copy.resultNoSanitize,
						note: sanitized ? copy.resultSanitizeNote : copy.resultNoSanitizeNote
					},
					{
						key: "encrypt",
						item: copy.resultEncrypt,
						count: pack.encrypted === true ? copy.encryptedYes : copy.encryptedNo,
						note: pack.encrypted === true ? copy.resultEncryptNote : copy.resultNoEncryptNote
					}
				];
				return h("div", null,
					h(ResultCard, {
						title: copy.packResultTitle,
						rows,
						footer: [
							h(FootRow, {
								key: "path",
								label: copy.savedPath,
								value: path ? maskHome(path) : null,
								actions: h("button", { type: "button", className: "pk-btn tiny", disabled: !path, onClick: () => copyText(path, "path") }, copied === "path" ? copy.copied : copy.copyAction)
							}),
							h(FootRow, {
								key: "sha",
								label: copy.fingerprint,
								value: sha,
								actions: h("button", { type: "button", className: "pk-btn tiny", disabled: !sha, onClick: () => copyText(sha, "sha") }, copied === "sha" ? copy.copied : copy.copyAction)
							})
						]
					}),
					Array.isArray(created.warnings) ? created.warnings.map((item, index) => h("div", { key: "cw" + index, className: "pk-line warn" }, String(item))) : null);
			})();
			const appliedNode = (() => {
				if (!applied) return null;
				if (applied.kind === "cancelled") return h("div", { className: "pk-msg warn" }, copy.cancelled);
				if (applied.kind === "error") return h("div", { className: "pk-msg err" }, withDetail(copy.applyFailed, errText(applied)));
				if (applied.kind !== "done") return null;
				const stats = applied.stats || {};
				const backupDir = typeof stats.backupDir === "string" && stats.backupDir ? stats.backupDir : null;
				const failures = Array.isArray(stats.failures) ? stats.failures : [];
				const excluded = Array.isArray(stats.excluded) ? stats.excluded : [];
				const warnings = Array.isArray(stats.warnings) ? stats.warnings : [];
				const pending = excluded.length + warnings.length;
				const rows = [
					{ key: "overwritten", item: copy.statOverwritten, count: String(numOr(stats.overwritten, 0)), note: copy.noteOverwritten },
					{ key: "added", item: copy.statAdded, count: String(numOr(stats.added, 0)), note: copy.noteAdded },
					{ key: "skipped", item: copy.statSkipped, count: String(numOr(stats.skipped, 0)), note: copy.noteSkipped },
					{ key: "pending", item: copy.statPending, count: String(pending), note: copy.notePending },
					{ key: "failed", item: copy.statFailed, count: String(numOr(stats.failed, 0)), note: copy.noteFailed }
				];
				return h("div", null,
					h(ResultCard, {
						title: copy.restoreResultTitle,
						rows,
						footer: [
							h(FootRow, {
								key: "backup",
								label: copy.backupDir,
								value: backupDir ? maskHome(backupDir) : null,
								actions: h("button", { type: "button", className: "pk-btn tiny", disabled: !backupDir || !!applied.rollback, onClick: () => askRollback(backupDir) }, copy.rollback)
							})
						]
					}),
					applied.rollback ? h("div", { className: "pk-msg " + (numOr(applied.rollback.failed, 0) > 0 ? "warn" : "ok") }, fill(copy.rollbackDone, { restored: numOr(applied.rollback.restored, 0), failed: numOr(applied.rollback.failed, 0) })) : null,
					stats.aborted === true ? h("div", { className: "pk-line warn" }, copy.aborted) : null,
					failures.length > 0 ? h("div", null,
						h("div", { className: "pk-line err" }, copy.failuresTitle),
						h("ul", { className: "pk-filelist" }, ...failures.slice(0, 10).map((item, index) => h("li", { key: "f" + index },
							h("span", { className: "pk-path" }, moduleLabel(item && item.module) + " / " + (item && item.rel ? item.rel : copy.empty)),
							h("span", { className: "pk-size" }, item && item.error ? String(item.error) : copy.unknown)))),
						failures.length > 10 ? h("div", { className: "pk-hint" }, fill(copy.more, { n: failures.length - 10 })) : null) : null,
					excluded.length > 0 ? h("div", null,
						h("div", { className: "pk-line" }, copy.excludedTitle),
						h("ul", { className: "pk-filelist" }, ...excluded.slice(0, 8).map((item, index) => h("li", { key: "e" + index },
							h("span", { className: "pk-path" }, (item && item.rel ? item.rel : copy.empty) + "：" + (item && item.reason ? item.reason : copy.unknown))))) ) : null,
					warnings.length > 0 ? h("div", null,
						h("div", { className: "pk-line warn" }, copy.placeholderTitle),
						...warnings.slice(0, 8).map((item, index) => h("div", { key: "hw" + index, className: "pk-hint" }, String(item)))) : null);
			})();
			const statusLine = ready ? h("div", { className: "pk-status" },
				h("button", {
					type: "button",
					className: "pk-status-path",
					disabled: !packsDir,
					title: packsDir || copy.fieldMissing,
					onClick: () => copyText(packsDir, "dir")
				},
					h("span", { className: "pk-status-label" }, copy.packsDir),
					h("span", { className: "pk-mono" }, packsDir ? maskHome(packsDir) : copy.empty),
					packsDir ? null : h("span", { className: "pk-tag" }, copy.fieldMissing),
					copied === "dir" ? h("span", { className: "pk-copied" }, copy.copied) : null),
				h("span", { className: "pk-sep" }, "·"),
				h("span", null, copy.usage + " " + (packsBytes === null ? copy.empty : formatBytes(packsBytes))),
				packsBytes === null ? h("span", { className: "pk-tag" }, copy.fieldMissing) : null
			) : null;
			const packsSection = h("section", { className: "pk-section" },
				h("h4", { className: "pk-section-title" }, copy.secPacks),
				sortedPacks.length === 0
					? h("div", { className: "pk-empty" }, h("strong", null, copy.packsEmptyStrong), copy.packsEmptyBody)
					: h("div", { className: "pk-table-wrap" },
						h("table", { className: "pk-table" },
							h("thead", null, h("tr", null,
								h("th", null, copy.colName),
								h("th", null, copy.colTime),
								h("th", null, copy.colContent),
								h("th", { className: "num" }, copy.colSize),
								h("th", null, copy.colEncrypted),
								h("th", null, copy.colActions))),
							h("tbody", null, ...sortedPacks.map((pack) => h("tr", { key: pack.name },
								h("td", { className: "pk-mono" }, pack.name || copy.empty),
								h("td", null, formatTime(pack.createdAt) || copy.empty),
								h("td", { className: "pk-desc" }, packContent(pack)),
								h("td", { className: "num" }, formatBytes(pack.totalBytes)),
								h("td", null, h("span", { className: "pk-tag" }, pack.encrypted === true ? copy.encryptedYes : copy.encryptedNo)),
								h("td", null, h("div", { className: "pk-row-inline" },
									h("button", { type: "button", className: "pk-btn tiny", onClick: () => restoreFromPack(pack) }, copy.actionRestore),
									h("button", { type: "button", className: "pk-btn tiny", onClick: () => openInfo(pack) }, copy.actionInfo),
									h("button", { type: "button", className: "pk-btn tiny danger", onClick: () => askDelete(pack) }, copy.actionDelete)))))))),
				h("p", { className: "pk-hint" }, copy.packsHint));
			const contentsSection = h("section", { className: "pk-section" },
				h("h4", { className: "pk-section-title" }, copy.secContents),
				h("p", { className: "pk-hint" }, copy.contentsHint),
				groups.length === 0
					? h("div", { className: "pk-empty" }, h("strong", null, copy.contentsEmptyStrong), copy.contentsEmptyBody)
					: h("div", { className: "pk-table-wrap" },
						h("table", { className: "pk-table" },
							h("thead", null, h("tr", null,
								h("th", null, copy.colContentName),
								h("th", null, copy.colContentDesc),
								h("th", { className: "num" }, copy.colContentSize),
								h("th", null, copy.colContentTake))),
							h("tbody", null, ...groups.map((group) => h("tr", { key: group.id },
								h("td", null, h("strong", null, group.label)),
								h("td", { className: "pk-desc" }, group.desc),
								h("td", { className: "num" }, formatBytes(group.bytes)),
								h("td", null, h("label", { className: "pk-check" },
									h("input", {
										type: "checkbox",
										checked: !!selected[group.id],
										onChange: () => setSelected((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
									}),
									h("span", null, selected[group.id] ? copy.takenOn : copy.takenOff)))))))),
				h("div", { className: "pk-total" },
					h("span", { className: "pk-total-label" }, copy.total),
					h("strong", null, formatBytes(chosenBytes)),
					h("span", { className: "pk-total-meta" }, fill(copy.totalMeta, { n: chosenGroups.length, f: chosenFiles }))),
				h("p", { className: "pk-hint" }, copy.contentsReminder));
			const optionsSection = h("section", { className: "pk-section" },
				h("h4", { className: "pk-section-title" }, copy.secOptions),
				h("div", { className: "pk-field" },
					h("span", { className: "pk-label" }, copy.packMethod),
					h("div", { className: "pk-choices two" },
						h("label", { className: "pk-choice" + (privacy === "keep" ? " chosen" : "") },
							h("input", { type: "radio", name: "pk-privacy", checked: privacy === "keep", onChange: () => setPrivacy("keep") }),
							h("span", null, h("strong", null, copy.optKeep), h("span", { className: "pk-choice-hint" }, copy.optKeepHint))),
						h("label", { className: "pk-choice" + (privacy === "sanitize" ? " chosen" : "") },
							h("input", { type: "radio", name: "pk-privacy", checked: privacy === "sanitize", onChange: () => setPrivacy("sanitize") }),
							h("span", null, h("strong", null, copy.optSanitize), h("span", { className: "pk-choice-hint" }, copy.optSanitizeHint))))),
				h("div", { className: "pk-field" },
					h("label", { htmlFor: "pk-note" }, copy.noteLabel),
					h("input", { id: "pk-note", className: "pk-input", type: "text", value: note, maxLength: 200, placeholder: copy.notePlaceholder, onChange: (event) => setNote(event.target.value) }),
					h("span", { className: "pk-hint" }, copy.noteHint)),
				h("label", { className: "pk-check" },
					h("input", { type: "checkbox", checked: encrypt, onChange: (event) => setEncrypt(event.target.checked) }),
					h("span", null, copy.optEncrypt)),
				encrypt ? h("div", { className: "pk-field" },
					h("label", { htmlFor: "pk-pack-password" }, copy.optPassword),
					h("input", { id: "pk-pack-password", className: "pk-input", type: "password", value: password, autoComplete: "new-password", placeholder: copy.passwordPlaceholder, onChange: (event) => setPassword(event.target.value) }),
					h("span", { className: passwordOk ? "pk-hint" : "pk-hint warn" }, passwordOk ? copy.optPasswordHint : copy.weakPassword)) : null,
				scanNode,
				h("div", { className: "pk-actions" },
					h("button", { type: "button", className: "pk-btn primary", disabled: !ready || chosenModules.length === 0 || busyCreating || !passwordOk, onClick: runCreate }, busyCreating ? copy.creating : copy.btnCreate),
					h("button", { type: "button", className: "pk-btn", disabled: !ready || chosenModules.length === 0 || busyCreating || busyPreviewing, onClick: runPreview }, busyPreviewing ? copy.previewing : copy.btnPreview),
					chosenGroups.length === 0 ? h("span", { className: "pk-hint" }, copy.noSelection) : null),
				created && created.kind === "running" ? h(Progress, { job: packJob.job, onCancel: () => cancelJob(packJob.job) }) : null,
				createdNode);
			const importNode = (() => {
				if (!imp) return h("p", { className: "pk-hint" }, copy.importHint);
				if (imp.kind === "running") return h("div", { className: "pk-msg" }, h("span", { className: "pk-spin" }), copy.importing);
				if (imp.kind === "error") return h("div", { className: "pk-msg err" }, withDetail(copy.importFailed, errText(imp)));
				return null;
			})();
			const diffNode = (() => {
				if (!imp || imp.kind !== "done") return null;
				const diff = imp.diff || {};
				const counts = [["added", copy.diffAdded], ["changed", copy.diffChanged], ["same", copy.diffSame], ["skipped", copy.diffSkipped]];
				return h("div", null,
					h("div", { className: "pk-label" }, copy.diffTitle),
					h("div", { className: "pk-diff-sum" },
						...counts.map(([key, label]) => h("span", { key, className: "pk-diff-tag" },
							h("span", { className: "pk-dot " + key }),
							label + " " + (typeof diff[key] === "number" ? diff[key] : copy.empty)))),
					impGroups.length === 0
						? h("div", { className: "pk-msg warn" }, copy.noModules)
						: h("div", { className: "pk-table-wrap" },
							h("table", { className: "pk-table" },
								h("thead", null, h("tr", null,
									h("th", null, copy.diffColContent),
									h("th", null, copy.diffColPack),
									h("th", null, copy.diffColLocal),
									h("th", null, copy.diffColAction))),
								h("tbody", null, ...impGroups.map((row) => {
									const localGroup = GROUPS.find((item) => item.id === row.id);
									const localPresent = localGroup ? localGroup.modules.filter((name) => mods[name]) : [];
									const localCount = localPresent.reduce((sum, name) => sum + numOr(mods[name] && mods[name].count, 0), 0);
									const localBytes = localPresent.reduce((sum, name) => sum + numOr(mods[name] && mods[name].bytes, 0), 0);
									const action = !restoreSel[row.id]
										? copy.diffActionOff
										: strategy === "overwrite"
											? fill(copy.diffActionOverwrite, { c: row.changed, a: row.added })
											: strategy === "skip"
												? fill(copy.diffActionSkip, { c: row.changed, a: row.added })
												: fill(copy.diffActionMerge, { n: row.changed + row.added });
									return h("tr", { key: row.id },
										h("td", null, h("strong", null, row.label)),
										h("td", null, fill(copy.fileCount, { n: row.count }) + " · " + formatBytes(row.bytes)),
										h("td", { className: "pk-desc" }, localCount > 0 ? fill(copy.fileCount, { n: localCount }) + " · " + formatBytes(localBytes) : copy.localNone),
										h("td", { className: "pk-desc" }, action));
								})))));
			})();
			const restoreControls = (() => {
				if (!imp || imp.kind !== "done") return h("p", { className: "pk-hint" }, copy.applyNoImport);
				return h("div", null,
					h("div", { className: "pk-field" },
						h("span", { className: "pk-label" }, copy.restoreScope),
						h("div", { className: "pk-checks" },
							...impGroups.map((row) => h("label", { key: row.id, className: "pk-check" },
								h("input", {
									type: "checkbox",
									checked: !!restoreSel[row.id],
									onChange: () => setRestoreSel((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
								}),
								h("span", null, row.label + "（" + fill(copy.fileCount, { n: row.count }) + "）"))))),
					h("label", { className: "pk-check", style: { marginTop: "var(--pk-s2)" } },
						h("input", { type: "checkbox", checked: includeDb, onChange: (event) => setIncludeDb(event.target.checked) }),
						h("span", null, copy.includeDb)),
					includeDb ? h("div", { className: "pk-line err" }, copy.includeDbWarn) : null,
					h("div", { className: "pk-field", style: { marginTop: "var(--pk-s4)" } },
						h("span", { className: "pk-label" }, copy.strategy),
						h("div", { className: "pk-choices" },
							...[
								["overwrite", copy.strategyOverwrite, copy.strategyOverwriteHint],
								["skip", copy.strategySkip, copy.strategySkipHint],
								["merge", copy.strategyMerge, copy.strategyMergeHint]
							].map(([value, label, hint]) => h("label", { key: value, className: "pk-choice" + (strategy === value ? " chosen" : "") },
								h("input", { type: "radio", name: "pk-strategy", checked: strategy === value, onChange: () => setStrategy(value) }),
								h("span", null, h("strong", null, label), h("span", { className: "pk-choice-hint" }, hint)))))),
					h("div", { className: "pk-actions" },
						h("button", {
							type: "button",
							className: "pk-btn primary",
							disabled: !zipValue || impGroups.length === 0 || chosenRestoreModules.length === 0 || busyRestoring,
							onClick: runApply
						}, busyRestoring ? copy.applying : copy.btnApply)));
			})();
			const restoreSection = h("section", { className: "pk-section", ref: restoreRef },
				h("h4", { className: "pk-section-title" }, copy.secRestore),
				h("p", { className: "pk-hint" }, copy.restoreHint),
				// v0.6.4：没有系统文件选择框的平台（鸿蒙）把手填路径当主入口，并如实提示；
				// 本插件在网页层拿不到宿主机路径，所以任何平台都不渲染「添加文件/浏览」按钮（不留点了没反应的按钮）。
				filePicker ? null : h("p", { className: "pk-hint" }, copy.pathPrimaryHint),
				h("div", { className: "pk-row" },
					h("label", { className: "pk-label", htmlFor: "pk-pack-select" }, copy.restoreSource),
					h("select", {
						id: "pk-pack-select",
						className: "pk-select pk-grow",
						value: packName,
						onChange: (event) => {
							setPackName(event.target.value);
							setZipPath("");
							resetRestore();
						}
					},
						h("option", { value: "" }, sortedPacks.length === 0 ? copy.restoreNoPack : copy.restorePlaceholder),
						...sortedPacks.map((pack) => h("option", { key: pack.name, value: pack.name },
							(pack.name || copy.empty) + " · " + formatBytes(pack.totalBytes) + (pack.encrypted === true ? " · " + copy.encryptedYes : "")))),
					h("button", { type: "button", className: "pk-btn primary", disabled: !zipValue || busyImporting || busyRestoring, onClick: runImport }, busyImporting ? copy.importing : copy.importCheck)),
				h("div", { className: "pk-field" },
					h("label", { htmlFor: "pk-zip-path" }, copy.pathLabel),
					h("input", {
						id: "pk-zip-path",
						className: "pk-input",
						value: zipPath,
						placeholder: pathPlaceholderText,
						onChange: (event) => {
							setZipPath(event.target.value);
							if (event.target.value.trim()) setPackName("");
							resetRestore();
						}
					}),
					h("span", { className: "pk-hint" }, copy.pathHint)),
				importNode,
				diffNode,
				restoreControls,
				applied && applied.kind === "running" ? h(Progress, { job: restoreJob.job, onCancel: () => cancelJob(restoreJob.job) }) : null,
				appliedNode);
			const infoNode = info === null ? null : h(Modal, {
				title: copy.infoTitle + " · " + (info.name || copy.empty),
				onClose: () => setInfo(null),
				footer: [
					h("button", {
						key: "rename",
						type: "button",
						className: "pk-btn",
						disabled: !info.name,
						onClick: () => setRenameDialog({ from: info.name, value: info.name, busy: false, error: null })
					}, copy.actionRename),
					h("button", { key: "close", type: "button", className: "pk-btn primary", onClick: () => setInfo(null) }, copy.close)
				]
			},
				info.kind === "loading" ? h("div", { className: "pk-msg" }, h("span", { className: "pk-spin" }), copy.infoLoading) : null,
				info.kind === "error" ? h("div", { className: "pk-msg err" }, withDetail(copy.infoFailed, errText(info))) : null,
				info.kind === "done" ? h("div", null,
					h("div", { className: "pk-diff-sum" },
						h("span", { className: "pk-tag" }, fill(copy.infoFiles, { n: info.files.length })),
						info.encrypted ? h("span", { className: "pk-tag warn" }, copy.encryptedYes) : h("span", { className: "pk-tag" }, copy.encryptedNo),
						info.manifest.createdAt ? h("span", { className: "pk-tag" }, formatTime(info.manifest.createdAt) || copy.empty) : null,
						info.manifest.sanitized === true ? h("span", { className: "pk-tag" }, fill(copy.infoSanitize, { n: numOr(info.manifest.redactions, 0) })) : null),
					info.manifest.note ? h("div", { className: "pk-hint" }, fill(copy.infoNote, { note: info.manifest.note })) : null,
					(() => {
						const verify = info.verify;
						if (!verify || typeof verify.checked !== "number") return h("div", { className: "pk-line" }, copy.infoVerifyMissing);
						const failures = Array.isArray(verify.failures) ? verify.failures : [];
						if (failures.length === 0) return h("div", { className: "pk-line ok" }, fill(copy.infoVerifyOk, { n: verify.checked }));
						return h("div", null,
							h("div", { className: "pk-line err" }, fill(copy.infoVerifyFail, { n: failures.length })),
							h("ul", { className: "pk-filelist" }, ...failures.slice(0, 10).map((item, index) => h("li", { key: "vf" + index },
								h("span", { className: "pk-path" }, moduleLabel(item && item.module) + " / " + (item && item.rel ? item.rel : copy.empty)),
								h("span", { className: "pk-size" }, item && item.error ? String(item.error) : copy.unknown)))));
					})(),
					info.files.length === 0 ? h("div", { className: "pk-msg" }, copy.noModules) : h("ul", { className: "pk-filelist" },
						...info.files.slice(0, 200).map((file, index) => h("li", { key: "fl" + index },
							h("span", { className: "pk-path" }, moduleLabel(file && file.module) + " / " + (file && file.rel ? file.rel : copy.empty)),
							h("span", { className: "pk-size" }, formatBytes(file && file.size)))),
						info.files.length > 200 ? h("li", { key: "flmore" }, fill(copy.more, { n: info.files.length - 200 })) : null)) : null);
			const passwordNode = pwDialog === null ? null : h(Modal, {
				title: copy.passwordDialogTitle,
				busy: pwDialog.busy,
				onClose: () => setPwDialog(null),
				footer: [
					h("button", { key: "cancel", type: "button", className: "pk-btn", disabled: pwDialog.busy, onClick: () => setPwDialog(null) }, copy.cancel),
					h("button", { key: "ok", type: "button", className: "pk-btn primary", disabled: pwDialog.busy, onClick: submitPassword }, pwDialog.busy ? copy.working : copy.passwordSubmit)
				]
			},
				h("div", { className: "pk-hint" }, copy.passwordDialogHint),
				h("div", { className: "pk-field" },
					h("label", { htmlFor: "pk-password" }, copy.optPassword),
					h("input", {
						id: "pk-password",
						className: "pk-input",
						type: "password",
						value: pwDialog.value,
						autoFocus: true,
						autoComplete: "current-password",
						placeholder: copy.passwordPlaceholder,
						onChange: (event) => setPwDialog({ ...pwDialog, value: event.target.value, error: null }),
						onKeyDown: (event) => {
							if (event.key === "Enter") submitPassword();
						}
					})),
				pwDialog.error ? h("div", { className: "pk-msg err" }, pwDialog.error) : null);
			const renameNode = renameDialog === null ? null : h(Modal, {
				title: copy.renameTitle,
				busy: renameDialog.busy,
				onClose: () => setRenameDialog(null),
				footer: [
					h("button", { key: "cancel", type: "button", className: "pk-btn", disabled: renameDialog.busy, onClick: () => setRenameDialog(null) }, copy.cancel),
					h("button", { key: "ok", type: "button", className: "pk-btn primary", disabled: renameDialog.busy, onClick: submitRename }, copy.save)
				]
			},
				h("div", { className: "pk-field" },
					h("label", { htmlFor: "pk-rename-input" }, copy.renameLabel),
					h("input", {
						id: "pk-rename-input",
						className: "pk-input",
						value: renameDialog.value,
						autoFocus: true,
						onChange: (event) => setRenameDialog({ ...renameDialog, value: event.target.value, error: null }),
						onKeyDown: (event) => {
							if (event.key === "Enter") submitRename();
						}
					})),
				h("div", { className: "pk-hint" }, renameDialog.from),
				renameDialog.error ? h("div", { className: "pk-msg err" }, renameDialog.error) : null);
			const confirmNode = confirmDialog === null ? null : h(Modal, {
				title: confirmDialog.title,
				busy: confirmDialog.busy,
				onClose: () => setConfirmDialog(null),
				footer: [
					h("button", { key: "cancel", type: "button", className: "pk-btn", disabled: confirmDialog.busy, onClick: () => setConfirmDialog(null) }, copy.cancel),
					h("button", { key: "ok", type: "button", className: "pk-btn " + (confirmDialog.danger ? "danger" : "primary"), disabled: confirmDialog.busy, onClick: submitConfirm }, confirmDialog.busy ? copy.working : confirmDialog.confirmLabel)
				]
			},
				h("div", null, confirmDialog.message),
				confirmDialog.error ? h("div", { className: "pk-msg err" }, confirmDialog.errorPrefix ? withDetail(confirmDialog.errorPrefix, confirmDialog.error) : confirmDialog.error) : null);
			const body = status.kind === "loading"
				? h("div", { className: "pk-section" }, h("div", { className: "pk-empty" }, h("span", { className: "pk-spin" }), copy.loading))
				: status.kind === "error"
					? h("div", { className: "pk-section" }, h("div", { className: "pk-empty" },
						h("strong", null, copy.unavailable),
						status.message ? errText(status) : copy.empty,
						h("div", { className: "pk-actions", style: { justifyContent: "center", marginTop: "var(--pk-s3)" } },
							h("button", { type: "button", className: "pk-btn primary", onClick: () => loadStatus() }, copy.retry))))
					: h("div", { className: "pk-body" }, packsSection, contentsSection, optionsSection, restoreSection);
			return h("div", { className: "pk-page", "data-dsh-theme": dark ? "dark" : "light" },
				h("style", null, styles),
				h("header", { className: "pk-head" },
					h("div", { className: "pk-head-text" },
						h("h3", { className: "pk-title" }, copy.title),
						h("p", { className: "pk-sub" }, copy.subtitle)),
					statusLine),
				notify === null ? null : h("div", { className: "pk-msg " + (notify.kind === "ok" ? "ok" : notify.kind === "warn" ? "warn" : "err") }, notify.text),
				body,
				infoNode,
				passwordNode,
				renameNode,
				confirmNode);
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "packer-settings",
				order: 60,
				label: () => text().title
			}, PackerSettingsPage)), "packer: settings");
		}
		//#endregion
		exports.PackerSettingsPage = PackerSettingsPage;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
