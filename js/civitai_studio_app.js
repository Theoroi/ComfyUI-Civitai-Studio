import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// ============================================================
// Civitai Studio — Civitai browser + local model manager
// Sidebar tabs: Browse / Local library / Downloads; ⚙ settings
// UI language follows ComfyUI's Comfy.Locale setting (zh/en).
// ============================================================

const TYPE_OPTIONS = ["Checkpoint", "LORA", "LoCon", "DoRA", "TextualInversion", "VAE", "Controlnet", "Upscaler", "Hypernetwork", "Motion", "Poses", "Wildcards", "Other"];
const TYPE_LABELS = {
    Checkpoint: "大模型", LORA: "LoRA", LoCon: "LoCon", DoRA: "DoRA",
    TextualInversion: "Embedding", VAE: "VAE", Controlnet: "ControlNet",
    Upscaler: "放大模型", Hypernetwork: "超网络", Motion: "动作模块",
    Poses: "姿势", Wildcards: "通配符", Other: "其他",
};
const BASE_MODELS = [
    "SD 1.4", "SD 1.5", "SD 1.5 LCM", "SD 2.0", "SD 2.1", "SD 2.1 Unclip",
    "SDXL 1.0", "SDXL Lightning", "SDXL Hyper", "SD 3", "SD 3.5", "SD 3.5 Medium",
    "SD 3.5 Large", "SD 3.5 Large Turbo", "Pony", "Illustrious", "NoobAI", "Anima",
    "Flux.1 S", "Flux.1 D", "Flux.1 Krea", "Flux.1 Kontext", "Flux.1 Fill",
    "Flux.2 D", "Flux.2 Klein 9B", "Chroma", "HiDream", "Lumina", "Qwen",
    "Krea 2", "ZImageTurbo", "Kolors", "AuraFlow", "PixArt Σ", "Hunyuan 1",
    "Hunyuan Video", "LTXV", "LTXV 2.3", "Mochi", "CogVideoX", "SVD", "ACE Audio",
    "Wan Video 1.3B t2v", "Wan Video 14B t2v", "Wan Video 14B i2v 480p", "Wan Video 14B i2v 720p",
    "Wan Video 2.2 TI2V-5B", "Wan Video 2.2 I2V-A14B", "Wan Video 2.2 T2V-A14B",
    "Wan Video 2.5 T2V", "Wan Video 2.5 I2V", "Other",
];
const SORTS = ["Most Downloaded", "Highest Rated", "Newest"];
const PERIODS = ["AllTime", "Month", "Week", "Day"];
const NSFW_LEVELS = [0, 1, 2];

const JS_VERSION = "0.6.0";

// ---------- i18n ----------
const STR = {
    zh: {
        tabBrowse: "🌐 浏览", tabLocal: "📁 本地库", tabDownloads: "⬇ 下载", settings: "设置",
        staleBanner: "⚠ 后端代码过旧(服务端运行的是重启前加载的版本),新功能不可用 — 请重启一次 ComfyUI。",
        backendOutdatedTitle: "Civitai Studio 后端代码过旧",
        backendOutdatedMsg: "服务端 v{server} < 前端 v{client} — 请重启一次 ComfyUI 加载新功能",
        frontendOutdatedTitle: "Civitai Studio 前端缓存过旧",
        frontendOutdatedMsg: "前端 v{client} < 服务端 v{server} — 请强制刷新本页(Ctrl+F5)加载新功能",
        frontendTooOld: "当前 ComfyUI 前端过旧,不支持侧边栏 API (extensionManager.registerSidebarTab)",
        loadFailedTitle: "Civitai Studio 加载失败",
        frontendUpgradeHint: "前端版本过旧,请升级 ComfyUI",
        readyLog: "已就绪",
        searchPlaceholder: "搜索 Civitai 模型…", allTypes: "全部类型",
        basePlaceholder: "全部底模(可输入新枚举)",
        sortMostDownloaded: "最多下载", sortHighestRated: "最高评分", sortNewest: "最新发布",
        periodAllTime: "全部时间", periodMonth: "本月", periodWeek: "本周", periodDay: "今天",
        nsfw0: "隐藏 NSFW", nsfw1: "包含部分 NSFW", nsfw2: "包含全部 NSFW",
        statusLoading: "加载中…", statusLoaded: "已加载 {n} 个", statusMore: " — 向下滚动加载更多",
        retry: "重试", noModels: "没有找到模型,换个关键词试试。",
        loadFailed: "加载失败: ", detailLoadFailed: "详情加载失败: ",
        back: "← 返回", backList: "返回列表", openOnCivitai: "在 Civitai 打开 ↗",
        by: "by", unknown: "未知", unknownCreator: "未知作者", versionLabel: "版本",
        installed: "已安装", installedMark: " ✔已装", modelDesc: "模型说明",
        triggerWords: "触发词", copyAll: "复制全部", files: "文件", primaryFile: "主文件",
        noFiles: "该版本没有文件", previews: "预览图 ({n}) — 点击查看生成参数",
        genParams: "生成参数", noGenParams: "这张图没有公开生成参数。",
        positivePrompt: "正面提示词", negativePrompt: "负面提示词", copy: "复制",
        copied: "已复制", copyFail: "复制失败", resources: "用到资源",
        kvModel: "模型", kvSampler: "采样器", kvSteps: "步数", kvSize: "尺寸",
        download: "⬇ 下载", startDownload: "开始下载", submitting: "提交中…",
        dlDialogTitle: "下载 — {name}", fileLabel: "文件", targetFolder: "目标目录",
        subfolder: "子文件夹(可选,自动创建)", subfolderPh: "例如: NSFW/角色",
        saveName: "保存文件名",
        dlHint: "下载完成后自动写入 .civitai.json 元数据{hash}",
        dlHintHash: "并校验 SHA256", cancel: "取消", ok: "确定", save: "保存",
        cantDownload: "无法下载", versionNotFound: "未找到该版本,请重新检查更新后再试",
        destFetchFailed: "获取目录失败: ", noRegFolders: "未找到已注册的模型文件夹",
        openDownloadFailed: "无法打开下载", queuedToast: "已加入下载队列",
        queueFailed: "下载任务创建失败", unknownAuthor: "未知作者",
        localSearchPh: "搜索本地模型…", checkUpdates: "检查更新", rescanTitle: "重新扫描",
        scanning: "扫描模型目录中…", rescanning: "正在重新扫描模型目录…",
        noModelFiles: "没有找到模型文件。", truncatedNote: "注意:文件数超过扫描上限。",
        allN: "全部 ({n})", newVersion: "有新版本: ", dlNewVersion: "下载新版本",
        upToDate: "已是最新版本", pageBtn: "页面", detailsBtn: "详情",
        checkBtn: "查更新", associateBtn: "关联", renameBtn: "重命名",
        revealBtn: "定位", deleteBtn: "删除", filePrefix: "文件: ",
        deleteTitle: "删除模型", deleteMsg: "确定要删除「{name}」吗?\n该操作不可恢复。",
        deleted: "已删除", deleteFailed: "删除失败", revealFailed: "打开文件夹失败",
        loadingCivitai: "加载 Civitai 信息…", expandLoadFailed: "详情加载失败: ",
        offlineBanner: "离线:显示本地缓存的说明(可能非最新)",
        civName: "Civitai 名称", statsLabel: "数据", clickCopy: "点击复制",
        dlThisVersion: "下载此版本", reAssociate: "重新关联", refreshMeta: "刷新元数据",
        refreshing: "刷新中…", metaRefreshed: "元数据已刷新", metaRefreshFailed: "刷新元数据失败",
        expandAll: "展开全部", collapse: "收起",
        renameTitle: "重命名 — {name}", newFileName: "新文件名(含扩展名)",
        renameMsg: "仅重命名模型文件并同步 .civitai.json 元数据;工作流中引用的旧文件名将失效。",
        renamed: "已重命名", renameFailed: "重命名失败",
        assocTitle: "关联 Civitai 模型", searchByFile: "按文件名搜索(已自动预填,可修改)",
        searchBtn: "搜索", searching: "搜索中…", emptyQuery: "请输入搜索词,或直接粘贴页面链接 / 模型 ID",
        noResults: "没有找到,试试更短的关键词", searchFailed: "搜索失败: ",
        pasteRef: "或直接粘贴页面链接 / 模型 ID",
        pasteRefPh: "https://civitai.com/models/12345 或 12345",
        assocMsg: "点选搜索结果(或粘贴链接)后点「关联」,将写入 .civitai.json。可用「网页确认 ↗」在 Civitai 打开该版本核对。",
        webConfirm: "网页确认 ↗", versionLoading: "版本加载中…",
        pickFirst: "请先从搜索结果选择,或粘贴链接", associated: "已关联",
        assocFailed: "关联失败",
        updateCheckDone: "更新检查完成", updateCheckFailed: "更新检查失败",
        updatesFound: "发现可更新的模型 — ", checkedAB: "已检查 {a}/{b} 个(单次上限 30,可对单个模型点「查更新」)",
        checkedN: "已检查 {n} 个", failNote: ",{n} 个查询失败(多为模型已在站方删除)",
        fetchingNewVersion: "获取新版本失败", newVersionAvail: "有新版本: ",
        dlTabHint: "下载到 ComfyUI 模型目录,支持断点续传", clearFinished: "清除已完成",
        noJobs: "暂无下载任务。去「浏览」页面挑个模型吧。",
        pollFailBanner: "下载状态刷新失败(已连续多次),请检查 ComfyUI 后端;恢复后此提示会自动消失。",
        stQueued: "排队中…", stDownloading: "下载中 {pct}% {speed}", stVerifying: "校验 SHA256…",
        stDone: "完成 ✔", stCancelled: "已取消", stError: "失败: ",
        cancelBtn: "取消" + "", cancelFailed: "取消失败", clearFailed: "清除失败",
        settingsTitle: "⚙ Civitai Studio 设置",
        keyLabel: "Civitai API Key(可选,下载受限模型/提高限额)",
        keySetPh: "已设置(尾号 {tail}),留空保持不变", keyPh: "粘贴 API Key",
        proxyLabel: "网络代理(HTTP / SOCKS 均可,裸地址自动按 HTTP 处理)",
        proxyPh: "http://127.0.0.1:10808 或 socks5://127.0.0.1:10808,留空 = 直连",
        proxyHint: "填 127.0.0.1 而非 localhost。v2rayN 混合端口 10808:优先填 socks5://127.0.0.1:10808(实测最稳),http://127.0.0.1:10808 亦可;API、下载、图片全部走此代理。",
        mirrorLabel: "API 站点(默认 civitai.com)", siteCustom: "自定义",
        mirrorPh: "留空 = https://civitai.red",
        concLabel: "下载并发数(1-4)",
        pimgLabel: "预览图经服务端中转(直连打不开图片时开启)",
        hashLabel: "下载完成后校验 SHA256",
        pdescLabel: "说明落盘:把 Civitai 说明/标签/封面写进 .civitai.json(离线可看,默认关)",
        settingsMsg: "API Key 在 Civitai 账户设置页生成,仅保存在本机 ComfyUI user 目录;Key 只会下发给官方站点,不会发给镜像。",
        settingsSaved: "设置已保存", saveFailed: "保存失败",
        readCfgFailed: "读取配置失败", clearFailed: "清除失败",
        route405: "服务端尚未加载该功能 — 请重启一次 ComfyUI 后重试",
        presetHotWeek: "🔥 本周热门", presetHotMonth: "📈 本月热门", presetBestMonth: "⭐ 本月高分",
        saveBtn: "存图", saveBtnTitle: "保存到 ComfyUI output 目录",
        saveOk: "已保存到 output: {name}", saveFailed: "保存失败",
        applyBtn: "应用到工作流", applyNoKs: "未找到 KSampler 节点", applyFail: "应用失败",
        applyDone: "已应用:提示词 ✓{lora}", applyLoraPart: ",LoRA ×{n}", loraMissing: "本地未找到: {names}",
        noTextNode: "未找到 CLIPTextEncode 文本节点",
        galleryTab: "🖼 画廊", gallerySortNewest: "最新发布", gallerySortReactions: "最多互动", gallerySortComments: "最多评论",
        galTag: "Tag", galBase: "底模", loadMore: "加载更多", useAsOutput: "选为输出", selectedAsOutput: "已选为输出",
        sfwLabel: "全年龄", nsfwLabel: "包含 NSFW", galTagId: "Tag ID 或名称(逗号分隔)",
        noTags: "无标签", tagsPaused: "标签抓取已暂停({sec} 秒后恢复)", noSelectionHint: "未选择(点击缩略图选择)",
        tagScrapeLabel: "读取非公开 API 获取图片分类标签", tagsLoading: "标签加载中…",
        tagsOff: "标签抓取已在设置中关闭", capHint: "已达显示上限(100)",
        galleryEmpty: "没有图片。", galleryAuthor: "作者",
    },
    en: {
        tabBrowse: "🌐 Browse", tabLocal: "📁 Library", tabDownloads: "⬇ Downloads", settings: "Settings",
        staleBanner: "⚠ Backend code is outdated (the server is still running the version loaded before the last restart) — new features are unavailable. Please restart ComfyUI.",
        backendOutdatedTitle: "Civitai Studio backend is outdated",
        backendOutdatedMsg: "server v{server} < frontend v{client} — restart ComfyUI once to load the new features",
        frontendOutdatedTitle: "Civitai Studio frontend is stale",
        frontendOutdatedMsg: "frontend v{client} < server v{server} — hard-refresh this page (Ctrl+F5) to load the new features",
        frontendTooOld: "This ComfyUI frontend is too old for the sidebar API (extensionManager.registerSidebarTab)",
        loadFailedTitle: "Civitai Studio failed to load",
        frontendUpgradeHint: "Frontend too old — please upgrade ComfyUI",
        readyLog: "ready",
        searchPlaceholder: "Search Civitai models…", allTypes: "All types",
        basePlaceholder: "All base models (type to enter)",
        sortMostDownloaded: "Most downloaded", sortHighestRated: "Highest rated", sortNewest: "Newest",
        periodAllTime: "All time", periodMonth: "This month", periodWeek: "This week", periodDay: "Today",
        nsfw0: "Hide NSFW", nsfw1: "Some NSFW", nsfw2: "All NSFW",
        statusLoading: "Loading…", statusLoaded: "{n} loaded", statusMore: " — scroll down for more",
        retry: "Retry", noModels: "No models found — try different keywords.",
        loadFailed: "Load failed: ", detailLoadFailed: "Failed to load details: ",
        back: "← Back", backList: "Back to list", openOnCivitai: "Open on Civitai ↗",
        by: "by", unknown: "unknown", unknownCreator: "unknown creator", versionLabel: "Version",
        installed: "Installed", installedMark: " ✔ installed", modelDesc: "Model description",
        triggerWords: "Trigger words", copyAll: "Copy all", files: "Files", primaryFile: "primary file",
        noFiles: "No files for this version", previews: "Previews ({n}) — click for generation params",
        genParams: "Generation params", noGenParams: "This image has no public generation params.",
        positivePrompt: "Positive prompt", negativePrompt: "Negative prompt", copy: "Copy",
        copied: "Copied", copyFail: "Copy failed", resources: "Resources used",
        kvModel: "Model", kvSampler: "Sampler", kvSteps: "Steps", kvSize: "Size",
        download: "⬇ Download", startDownload: "Start download", submitting: "Submitting…",
        dlDialogTitle: "Download — {name}", fileLabel: "File", targetFolder: "Target folder",
        subfolder: "Subfolder (optional, created automatically)", subfolderPh: "e.g. NSFW/character",
        saveName: "Filename",
        dlHint: "Writes .civitai.json metadata on completion{hash}",
        dlHintHash: " with SHA256 verification", cancel: "Cancel", ok: "OK", save: "Save",
        cantDownload: "Cannot download", versionNotFound: "Version not found — check for updates again",
        destFetchFailed: "Failed to list folders: ", noRegFolders: "No registered model folders found",
        openDownloadFailed: "Cannot open download", queuedToast: "Added to download queue",
        queueFailed: "Failed to queue download", unknownAuthor: "unknown creator",
        localSearchPh: "Search local models…", checkUpdates: "Check updates", rescanTitle: "Rescan",
        scanning: "Scanning model folders…", rescanning: "Rescanning model folders…",
        noModelFiles: "No model files found.", truncatedNote: "Note: file count exceeds the scan cap.",
        allN: "All ({n})", newVersion: "New version: ", dlNewVersion: "Download new version",
        upToDate: "Up to date", pageBtn: "Page", detailsBtn: "Details",
        checkBtn: "Check", associateBtn: "Associate", renameBtn: "Rename",
        revealBtn: "Reveal", deleteBtn: "Delete", filePrefix: "File: ",
        deleteTitle: "Delete model", deleteMsg: "Delete \"{name}\"?\nThis cannot be undone.",
        deleted: "Deleted", deleteFailed: "Delete failed", revealFailed: "Failed to open folder",
        loadingCivitai: "Loading Civitai info…", expandLoadFailed: "Failed to load details: ",
        offlineBanner: "Offline: showing the locally cached description (may be stale)",
        civName: "Civitai name", statsLabel: "Stats", clickCopy: "Click to copy",
        dlThisVersion: "Download this version", reAssociate: "Re-associate", refreshMeta: "Refresh metadata",
        refreshing: "Refreshing…", metaRefreshed: "Metadata refreshed", metaRefreshFailed: "Refresh failed",
        expandAll: "Expand", collapse: "Collapse",
        renameTitle: "Rename — {name}", newFileName: "New filename (with extension)",
        renameMsg: "Renames the model file and updates its .civitai.json metadata; workflow references to the old filename will break.",
        renamed: "Renamed", renameFailed: "Rename failed",
        assocTitle: "Associate a Civitai model", searchByFile: "Search by filename (prefilled, editable)",
        searchBtn: "Search", searching: "Searching…", emptyQuery: "Type a search term, or paste a page link / model ID",
        noResults: "Nothing found — try shorter keywords", searchFailed: "Search failed: ",
        pasteRef: "Or paste a page link / model ID",
        pasteRefPh: "https://civitai.com/models/12345 or 12345",
        assocMsg: "Pick a search result (or paste a link) and press「Associate」to write .civitai.json. Use「Verify on web ↗」to check the version on Civitai.",
        webConfirm: "Verify on web ↗", versionLoading: "Loading versions…",
        pickFirst: "Pick a search result first, or paste a link", associated: "Associated",
        assocFailed: "Association failed",
        updateCheckDone: "Update check finished", updateCheckFailed: "Update check failed",
        updatesFound: "Models with updates — ", checkedAB: "checked {a}/{b} (cap 30 per run; use per-item Check for the rest)",
        checkedN: "checked {n}", failNote: ", {n} lookups failed (usually models deleted upstream)",
        fetchingNewVersion: "Failed to fetch the new version", newVersionAvail: "New version: ",
        dlTabHint: "Downloads go to your ComfyUI model folders, resumable", clearFinished: "Clear finished",
        noJobs: "No downloads yet — pick a model in Browse.",
        pollFailBanner: "Refreshing download states failed repeatedly — check the ComfyUI backend; this notice clears itself on recovery.",
        stQueued: "Queued…", stDownloading: "Downloading {pct}% {speed}", stVerifying: "Verifying SHA256…",
        stDone: "Done ✔", stCancelled: "Cancelled", stError: "Failed: ",
        cancelBtn: "Cancel", cancelFailed: "Cancel failed", clearFailed: "Clear failed",
        settingsTitle: "⚙ Civitai Studio settings",
        keyLabel: "Civitai API key (optional, for gated models / higher rate limits)",
        keySetPh: "Set (ends with {tail}) — leave empty to keep", keyPh: "Paste API key",
        proxyLabel: "Network proxy (HTTP / SOCKS; bare addresses are treated as HTTP)",
        proxyPh: "http://127.0.0.1:10808 or socks5://127.0.0.1:10808, empty = direct",
        proxyHint: "Use 127.0.0.1 instead of localhost. API, downloads and previews all go through this proxy.",
        mirrorLabel: "API site (default civitai.com)", siteCustom: "Custom",
        mirrorPh: "empty = https://civitai.red",
        concLabel: "Download concurrency (1-4)",
        pimgLabel: "Route preview images through the backend (enable if direct loading fails)",
        hashLabel: "Verify SHA256 after download",
        pdescLabel: "Persist description: write Civitai description/tags/cover into .civitai.json (offline viewing, default off)",
        settingsMsg: "Generate the key on the Civitai account page; it is stored locally in the ComfyUI user directory and only ever sent to official hosts.",
        settingsSaved: "Settings saved", saveFailed: "Save failed",
        readCfgFailed: "Failed to read settings", clearFailed: "Clear failed",
        route405: "The server has not loaded this feature — restart ComfyUI once and retry",
        presetHotWeek: "🔥 Hot this week", presetHotMonth: "📈 Hot this month", presetBestMonth: "⭐ Top rated this month",
        saveBtn: "⬇ Save", saveBtnTitle: "Save to the ComfyUI output folder",
        saveOk: "Saved to output: {name}", saveFailed: "Save failed",
        applyBtn: "Apply to workflow", applyNoKs: "No KSampler node found", applyFail: "Apply failed",
        applyDone: "Applied: prompts ✓{lora}", applyLoraPart: ", {n} LoRA(s)", loraMissing: "Local LoRAs not found: {names}",
        noTextNode: "No CLIPTextEncode text node found",
        galleryTab: "🖼 Gallery", gallerySortNewest: "Newest", gallerySortReactions: "Most reactions", gallerySortComments: "Most comments",
        galTag: "Tag", galBase: "Base model", loadMore: "Load more", useAsOutput: "Use as output", selectedAsOutput: "Selected as output",
        sfwLabel: "SFW only", nsfwLabel: "Include NSFW", galTagId: "Tag ID or name, comma-separated",
        noTags: "No tags", tagsPaused: "Tag fetch paused ({sec}s), retrying later", noSelectionHint: "Nothing selected (click a thumbnail)",
        tagScrapeLabel: "Fetch image category tags (unofficial API)", tagsLoading: "Loading tags…", tagsOff: "Tag scraping disabled in settings", capHint: "Display cap reached (100)",
        galleryEmpty: "No images.", galleryAuthor: "Author",
    },
};

let S = {
    lang: "zh",
    cfg: { proxy_images: false, nsfw: 1, verify_hash: true },
    browse: {
        query: "", type: "", base: "", sort: "Most Downloaded", period: "AllTime",
        nsfw: 1, items: [], nextCursor: "", loading: false, dirty: true, pendingReset: false,
    },
    local: { models: [], search: "", type: "", loading: false, updates: {}, truncated: false, openId: null, detailCache: {} },
    dl: { jobs: [], lastSig: "", failStreak: 0 },
    gal: { items: [], next: [], sort: "Newest", period: "AllTime", base: "", tag: "", nsfwLevel: 0, thumbSize: 256, loading: false, error: "" },
    ui: { tab: "browse", root: null, scrollTop: 0, detailId: null, backendStale: false },
};

function t(key, vars) {
    const table = STR[S.lang] || STR.zh;
    let s = table[key] ?? STR.zh[key] ?? key;
    if (vars) for (const k in vars) s = s.replaceAll("{" + k + "}", String(vars[k]));
    return s;
}

function sortEnumNames(list) {
    // 枚举名去重 + 字母序(此前该函数从未定义,三处枚举下拉因 ReferenceError 被吞掉而一直为空)
    return [...new Set((list || []).map((x) => String(x)))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function detectLang() {
    let loc = "";
    try {
        loc = String(app.ui.settings.getSettingValue?.("Comfy.Locale") || "");
    } catch (e) { /* settings API 不可用 */ }
    if (!loc) {
        try { loc = String(navigator.language || ""); } catch (e) { loc = ""; }
    }
    S.lang = loc.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function typeLabel(type) {
    return S.lang === "zh" ? (TYPE_LABELS[type] || type) : type;
}

function sortLabel(s) {
    return { "Most Downloaded": t("sortMostDownloaded"), "Highest Rated": t("sortHighestRated"), Newest: t("sortNewest") }[s] || s;
}

function periodLabel(p) {
    return { AllTime: t("periodAllTime"), Month: t("periodMonth"), Week: t("periodWeek"), Day: t("periodDay") }[p] || p;
}

function nsfwLabel(v) {
    return { 0: t("nsfw0"), 1: t("nsfw1"), 2: t("nsfw2") }[v] || String(v);
}

// ---------- 小工具 ----------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function sanitizeHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = String(html || "");
    // template 的子节点不在 querySelectorAll 范围内,会整体绕过净化:直接移除
    $$("script,style,iframe,object,embed,link,meta,form,base,svg,math,template", div).forEach((n) => n.remove());
    $$("*", div).forEach((n) => {
        for (const attr of Array.from(n.attributes)) {
            const name = attr.name.toLowerCase();
            const value = String(attr.value).replace(/[\s\x00-\x20]+/g, ""); // 剥空白防 java\tscript: 混淆
            if (name.startsWith("on") || /^(javascript|vbscript|data:text\/html)/i.test(value) || name === "style") {
                n.removeAttribute(attr.name);
            }
        }
    });
    return div.innerHTML;
}

function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + " " + units[i];
}

function fmtSpeed(bps) {
    if (!bps) return "";
    return fmtSize(bps) + "/s";
}

function fmtNum(n) {
    n = n || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
}

function civitaiPage() {
    let base = (S.cfg.mirror || "https://civitai.com").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) base = "https://" + base; // 裸域名兜底,防相对链接
    return base;
}

function imgSrc(url) {
    if (!url) return "";
    if (S.cfg.proxy_images) return "/civitai_studio/image?url=" + encodeURIComponent(url);
    return url;
}

function altSrc(url) {
    // 加载失败换路重试:当前中转 → 直连;当前直连 → 中转
    if (S.cfg.proxy_images) return url;
    return "/civitai_studio/image?url=" + encodeURIComponent(url);
}

function pickCover(model) {
    // 首版本可能没有预览或首个是视频:优先跨版本找图片封面,全站只有视频封面时才回退视频
    let video = null;
    for (const v of model.modelVersions || []) {
        for (const i of v.images || []) {
            if (!i.url) continue;
            if (i.type === "image") return { media: i, kind: "image" };
            if (!video) video = { media: i, kind: "video" };
        }
    }
    return video;
}

function attachCoverErrorHandler(el, url) {
    // 直连/中转各试一次,都失败保留占位符(refreshAllImages 换路后还能再试)
    el.addEventListener("error", () => {
        if (el.dataset.retried) return;
        el.dataset.retried = "1";
        el.src = altSrc(url);
    });
}

function toast(sev, summary, detail) {
    try {
        app.extensionManager.toast.add({ severity: sev, summary, detail, life: 4000 });
    } catch (e) {
        console.log(`[Civitai-Studio][${sev}] ${summary} ${detail || ""}`);
    }
}

async function apiJson(url, opts) {
    // ComfyUI API 响应无缓存头,webview 启发式缓存会把旧响应(例如服务端重启前
    // 的默认热榜)冒充新结果;no-store + 时间戳双保险绕开
    let fullUrl = url;
    if ((!opts || !opts.method) && url.startsWith("/civitai_studio/")) {
        fullUrl += (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    }
    const resp = await api.fetchApi(fullUrl, { ...(opts || {}), cache: "no-store" });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* empty body */ }
    if (!resp.ok) {
        if (resp.status === 405 && url.startsWith("/civitai_studio/")) {
            // POST 落到了静态文件处理器 = 服务端还没有这条新路由
            throw new Error(t("route405"));
        }
        throw new Error((data && data.error) || `HTTP ${resp.status}`);
    }
    return data;
}

const apiGet = (url) => apiJson(url);
const apiPost = (url, body) => apiJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
});

// 复制文本:clipboard API 在部分环境会挂起(never-settled)或静默拒绝,
// 这里带 execCommand 兜底 + 400ms 挂起超时;onDone(ok) 可选,用于自定义反馈
function copyTextSafe(text, onDone) {
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; if (onDone) onDone(ok); } };
    const fallback = () => {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.cssText = "position:fixed;top:-999px;opacity:0;";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            finish(ok);
        } catch (e) { finish(false); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => finish(true), () => fallback());
        setTimeout(() => { if (!settled) fallback(); }, 400); // 挂起兜底(重复写同一文本无害)
    } else {
        fallback();
    }
}

function copyText(text, btn) {
    copyTextSafe(text, (ok) => {
        if (!btn) return;
        const old = btn.textContent;
        btn.textContent = ok ? t("copied") : t("copyFail");
        setTimeout(() => { btn.textContent = old; }, 1200);
    });
}

// ---------- 通用模态框(悬浮元素:无遮罩、可拖动;✕/Esc/点画布关闭) ----------
function showModal(innerHTML, cls) {
    closeAllFloats(); // 单实例:同一时间只显示一个悬浮元素
    const panel = document.createElement("div");
    panel.className = "cs-float cs-float-modal " + (cls || "");
    panel.innerHTML = `
        <div class="cs-float-head">
            <span class="cs-float-title"></span>
            <button class="cs-float-close">✕</button>
        </div>
        <div class="cs-float-body">${innerHTML}</div>`;
    // 内容自带的标题上移到拖动栏
    const innerTitle = panel.querySelector(".cs-modal-title");
    if (innerTitle) {
        panel.querySelector(".cs-float-title").textContent = innerTitle.textContent;
        innerTitle.remove();
    }
    document.body.appendChild(panel);
    // 定位:吸附左侧边栏右缘(随侧边栏宽度变动)
    positionFloat(panel, 480);
    watchSidebarDock();
    dragFloat(panel, panel.querySelector(".cs-float-head"));
    const close = () => {
        document.removeEventListener("keydown", escHandler);
        panel.remove();
        const i = (S.ui.floatModals || []).indexOf(api);
        if (i >= 0) S.ui.floatModals.splice(i, 1);
    };
    const escHandler = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", escHandler);
    panel.querySelector(".cs-float-close").onclick = close;
    const api = { overlay: panel, box: panel.querySelector(".cs-float-body"), close };
    (S.ui.floatModals = S.ui.floatModals || []).push(api);
    return api;
}

function confirmModal(title, message, onOk) {
    const m = showModal(`
        <h3 class="cs-modal-title">${esc(title)}</h3>
        <p class="cs-modal-msg">${esc(message)}</p>
        <div class="cs-modal-actions">
            <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
            <button class="cs-btn cs-btn-danger" data-act="ok">${esc(t("ok"))}</button>
        </div>`);
    $("[data-act=cancel]", m.box).onclick = m.close;
    $("[data-act=ok]", m.box).onclick = () => { m.close(); onOk(); };
}

// ---------- 在线浏览:数据加载 ----------
// 翻页用 cursor(镜像站/官方站统一支持;page 参数在部分镜像上会触发忽略筛选的热榜路径)
// nsfw:Civitai 新 API 是布尔开关(zod 校验只认 true/false 等布尔词,数字字符串 "2" 会 400),
//      UI 三档映射为 false/true 下发
function browseParams(cursor) {
    const p = new URLSearchParams();
    if (S.browse.query) p.set("query", S.browse.query);
    if (S.browse.type) p.set("types", S.browse.type);
    if (S.browse.base) p.set("baseModels", S.browse.base);
    p.set("sort", S.browse.sort);
    p.set("period", S.browse.period);
    p.set("nsfw", S.browse.nsfw > 0 ? "true" : "false");
    p.set("limit", "24");
    if (cursor) p.set("cursor", cursor);
    return p.toString();
}

async function fetchBrowse(reset) {
    const st = S.browse;
    if (st.loading) {
        // 在途请求未完成:记住"必须重发 reset",等它结束后补发,避免新筛选被旧响应覆盖
        if (reset) st.pendingReset = true;
        return;
    }
    const cursor = reset ? "" : st.nextCursor;
    if (!reset && !cursor) return; // 没有下一页了
    st.loading = true;
    updateStatusLine();
    try {
        const data = await apiGet("/civitai_studio/search?" + browseParams(cursor));
        if (reset) {
            st.items = data.items || [];
        } else {
            // cursor 翻页期间上游有增删,同一模型可能重复出现:按 id 去重
            const seen = new Set(st.items.map((x) => x.id));
            st.items = st.items.concat((data.items || []).filter((x) => !seen.has(x.id)));
        }
        st.nextCursor = data.metadata?.nextCursor || "";
        st.dirty = false;
        st.error = "";
    } catch (e) {
        st.error = t("loadFailed") + e.message;
        if (reset) st.dirty = true; // 失败不清空已有结果;标记 dirty 让重开面板时自动重拉
    } finally {
        const needReset = st.pendingReset;
        st.pendingReset = false;
        st.loading = false;
        renderResults(reset);
        updateStatusLine();
        if (needReset) fetchBrowse(true);
    }
}

function triggerBrowseRefresh() {
    fetchBrowse(true); // renderResults(true) 内部会重置 __rendered
}

// ---------- 在线浏览:渲染 ----------
function renderResults(reset) {
    const grid = $("#cs-grid");
    if (!grid) return;
    $$(".cs-error, .cs-empty", grid).forEach((n) => n.remove());
    if (reset) {
        grid.innerHTML = "";
        for (const m of S.browse.items) m.__rendered = false;
    }
    const frag = document.createDocumentFragment();
    for (const model of S.browse.items) {
        if (!model.__rendered) {
            model.__rendered = true;
            const card = makeCard(model);
            if (card) frag.appendChild(card);
        }
    }
    grid.appendChild(frag);
    if (S.browse.error) {
        const err = document.createElement("div");
        err.className = "cs-empty cs-error";
        err.innerHTML = `${esc(S.browse.error)} <button class="cs-btn cs-btn-mini" id="cs-retry-btn">${esc(t("retry"))}</button>`;
        grid.appendChild(err);
        $("#cs-retry-btn", err).onclick = () => triggerBrowseRefresh();
    } else if (!S.browse.items.length && !S.browse.loading) {
        const empty = document.createElement("div");
        empty.className = "cs-empty";
        empty.textContent = t("noModels");
        grid.appendChild(empty);
    }
}

function updateStatusLine() {
    const el = $("#cs-status");
    if (!el) return;
    const st = S.browse;
    if (st.loading) {
        el.textContent = t("statusLoading");
    } else if (st.items.length) {
        el.textContent = t("statusLoaded", { n: st.items.length }) + (st.nextCursor ? t("statusMore") : "");
    } else {
        el.textContent = "";
    }
}

function makeCard(model) {
    const version = model.modelVersions?.[0];
    if (!version) return null;
    const card = document.createElement("div");
    card.className = "cs-card" + (model.installed ? " cs-card-installed" : "");
    const cover = pickCover(model);
    const creator = model.creator?.username || t("unknownCreator");
    const rating = version.stats && typeof version.stats.thumbsUpCount === "number" ? version.stats.thumbsUpCount : (model.stats?.thumbsUpCount || 0);
    card.innerHTML = `
        <div class="cs-card-cover">
            <div class="cs-card-placeholder">🖼</div>
            <div class="cs-card-badges">
                ${model.installed ? `<span class="cs-badge cs-badge-ok">${esc(t("installed"))}</span>` : ""}
                <span class="cs-badge">${esc(typeLabel(model.type))}</span>
            </div>
        </div>
        <div class="cs-card-info">
            <div class="cs-card-name" title="${esc(model.name)}">${esc(model.name)}</div>
            <div class="cs-card-sub">
                <span>${esc(version.baseModel || "")}</span>
                <span>👍 ${fmtNum(rating)} · ⬇ ${fmtNum(model.stats?.downloadCount)}</span>
            </div>
            <div class="cs-card-creator">${esc(t("by"))} ${esc(creator)}</div>
        </div>`;
    if (cover?.media?.url) {
        const url = cover.media.url;
        const isVideo = cover.kind === "video";
        const el = document.createElement(isVideo ? "video" : "img");
        el.className = "cs-card-img";
        el.dataset.direct = url;
        const show = () => {
            const ph = $(".cs-card-placeholder", card);
            if (ph) ph.style.display = "none";
            el.classList.add("is-loaded");
        };
        if (isVideo) {
            // 视频封面:静音循环,悬停播放;#t 片段让浏览器先渲染首帧
            el.muted = true;
            el.loop = true;
            el.playsInline = true;
            el.preload = "metadata";
            el.addEventListener("loadeddata", show);
            card.addEventListener("mouseenter", () => el.play().catch(() => {}));
            card.addEventListener("mouseleave", () => el.pause());
        } else {
            el.loading = "lazy";
            el.alt = model.name;
            el.addEventListener("load", show);
        }
        attachCoverErrorHandler(el, url);
        // 卡片封面只需要小图:走 CDN 缩略变体,视频封面保持原链
        el.src = imgSrc(isVideo ? url : cdnThumb(url)) + (isVideo ? "#t=0.001" : "");
        $(".cs-card-cover", card).prepend(el);
    }
    card.onclick = () => openBrowseFloat(model.id);
    return card;
}

// ---------- 悬浮详情面板(独立于侧边栏,可拖动) ----------
function dragFloat(panel, head) {
    head.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button,a")) return;
        panel.dataset.csDragged = "1";
        const sx = e.clientX - panel.offsetLeft, sy = e.clientY - panel.offsetTop;
        const move = (ev) => {
            panel.style.left = Math.max(0, ev.clientX - sx) + "px";
            panel.style.top = Math.max(0, ev.clientY - sy) + "px";
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    });
}

// 悬浮层锚点:始终以 ComfyUI 主画布区域为基准。
// 页面上有多个 canvas(小地图/预览等),querySelector 会取错,须取 litegraph 主画布;
// 侧边栏切到非 Civitai 标签时 root 处于隐藏态(矩形为 0),按 root 定位会飘到左上角。
function floatAnchor() {
    let el = window.app?.canvas?.canvas;
    if (!el || !el.isConnected) {
        let best = null, bestArea = 0;
        for (const c of document.querySelectorAll("canvas")) {
            const r = c.getBoundingClientRect();
            if (r.width > 50 && r.width * r.height > bestArea) { best = c; bestArea = r.width * r.height; }
        }
        el = best;
    }
    const canvasR = el ? el.getBoundingClientRect() : null;
    if (canvasR && canvasR.width > 50) {
        return { left: canvasR.left, right: canvasR.right, top: canvasR.top };
    }
    const rootR = S.ui.root?.getBoundingClientRect();
    if (rootR && rootR.width > 0) return { left: rootR.left, right: rootR.right, top: rootR.top };
    const w = window.innerWidth;
    return { left: w / 2 - 240, right: w / 2 + 240, top: 60 };
}

function sidebarDockRect() {
    // 左侧边栏面板(排除右侧边栏与收起态)
    const panels = [...document.querySelectorAll(".side-bar-panel")]
        .map((p) => p.getBoundingClientRect())
        .filter((r) => r.width > 60 && r.left < window.innerWidth / 2)
        .sort((a, b) => b.right - a.right);
    if (panels[0]) return panels[0];
    // 侧边栏收起:吸附左侧图标菜单栏
    const rail = document.querySelector(".side-tool-bar-container");
    if (rail) {
        const r = rail.getBoundingClientRect();
        if (r.width > 20 && r.left < window.innerWidth / 2) return r;
    }
    return null;
}

let csDockObserver = null;
function watchSidebarDock() {
    if (!window.ResizeObserver) return;
    if (!csDockObserver) {
        csDockObserver = new ResizeObserver(() => repositionFloats());
        window.addEventListener("resize", repositionFloats);
    }
    document.querySelectorAll(".side-bar-panel").forEach((p) => csDockObserver.observe(p));
}

function repositionFloats() {
    const floats = [];
    if (S.ui.float && !S.ui.float.dataset.csDragged) floats.push([S.ui.float, 440]);
    for (const m of S.ui.floatModals || []) {
        if (m.overlay.dataset.csDragged) continue;
        floats.push([m.overlay, parseFloat(m.overlay.dataset.csW) || 480]);
    }
    for (const [panel, w] of floats) positionFloat(panel, w);
}

// 悬浮层位置:优先吸附左侧边栏右缘并随其宽度变动;侧边栏收起时退回画布中间偏右
function positionFloat(panel, w) {
    panel.dataset.csW = String(w);
    const sb = sidebarDockRect();
    if (sb) {
        panel.style.left = Math.round(sb.right + 8) + "px";
        panel.style.top = Math.max(10, Math.min(sb.top + 8, window.innerHeight - 320)) + "px";
        return;
    }
    const a = floatAnchor();
    let x = Math.round(a.left + (a.right - a.left - w) / 2 + (a.right - a.left) * 0.10);
    x = Math.max(a.left + 10, Math.min(x, a.right - w - 10));
    panel.style.left = x + "px";
    panel.style.top = Math.max(10, Math.min(a.top + 72, window.innerHeight - 320)) + "px";
}

function openFloatDetail() {
    closeAllFloats(); // 单实例:开新的浮层前关掉旧浮层
    const panel = document.createElement("div");
    panel.className = "cs-float";
    panel.innerHTML = `
        <div class="cs-float-head">
            <span class="cs-float-title"></span>
            <button class="cs-float-close">✕</button>
        </div>
        <div class="cs-float-body"></div>`;
    document.body.appendChild(panel);
    positionFloat(panel, 440);
    watchSidebarDock();
    panel.querySelector(".cs-float-close").onclick = closeFloatDetail;
    // 标题栏拖动
    dragFloat(panel, panel.querySelector(".cs-float-head"));
    S.ui.float = panel;
    return panel.querySelector(".cs-float-body");
}

function closeFloatDetail() {
    // 只关详情浮层;弹窗类浮层(cs-float-modal)有自己的生命周期
    document.querySelectorAll(".cs-float:not(.cs-float-modal)").forEach((n) => n.remove());
    S.ui.float = null;
}

function closeAllFloats() {
    closeFloatDetail();
    (S.ui.floatModals || []).slice().forEach((m) => m.close());
}

async function openBrowseFloat(modelId) {
    const body = openFloatDetail();
    body.innerHTML = `<div class="cs-expand-loading">${esc(t("statusLoading"))}</div>`;
    try {
        const model = await apiGet(`/civitai_studio/model/${encodeURIComponent(String(modelId))}`);
        renderDetail(model, body);
        const title = $(".cs-float-head .cs-float-title");
        if (title) title.textContent = model.name || "";
    } catch (e) {
        body.innerHTML = `<div class="cs-empty">${esc(t("detailLoadFailed") + e.message)}</div>`;
    }
}

// ---------- 详情页 ----------
function renderDetail(model, container, opts = {}) {
    const box = container;
    if (!box) return;
    const versions = (model.modelVersions || []).filter((v) => v.id);
    const desc = sanitizeHtml(model.description);
    box.innerHTML = `
        ${opts.offline ? `<div class="cs-banner">${esc(t("offlineBanner"))}</div>` : ""}
        <div class="cs-detail-head">
            <button class="cs-btn" id="cs-detail-back">${esc(t("back"))}</button>
            <a class="cs-btn" href="${esc(civitaiPage())}/models/${esc(String(model.id))}" target="_blank" rel="noopener noreferrer">${esc(t("openOnCivitai"))}</a>
        </div>
        <h3 class="cs-detail-title" title="${esc(model.name)}">${esc(model.name)}</h3>
        <div class="cs-detail-meta">
            ${esc(t("by"))} ${esc(model.creator?.username || t("unknown"))} · ${esc(typeLabel(model.type))}
            · ⬇ ${fmtNum(model.stats?.downloadCount)} · 👍 ${fmtNum(model.stats?.thumbsUpCount)}
        </div>
        ${model.tags?.length ? `<div class="cs-tags">${model.tags.slice(0, 10).map((tg) => `<span class="cs-tag">${esc(tg)}</span>`).join("")}</div>` : ""}
        <div class="cs-detail-row">
            <label>${esc(t("versionLabel"))}</label>
            <select id="cs-version-sel">${versions.map((v, i) => {
                const prefer = opts.preferVersionId && String(v.id) === String(opts.preferVersionId);
                const selAttr = prefer ? " selected" : (i === 0 && !opts.preferVersionId ? " selected" : "");
                return `<option value="${esc(String(v.id))}" data-idx="${i}"${selAttr}>${esc(v.name)} (${esc(v.baseModel || "?")})${v.local ? esc(t("installedMark")) : ""}</option>`;
            }).join("")}
            </select>
        </div>
        <div id="cs-version-body"></div>
        ${desc ? `<details class="cs-desc" open><summary>${esc(t("modelDesc"))}</summary><div class="cs-desc-body">${desc}</div></details>` : ""}
    `;
    $("#cs-detail-back", box).onclick = closeFloatDetail;
    rewriteDescImages(box);
    const sel = $("#cs-version-sel", box);
    const renderVer = () => {
        const idx = parseInt(sel.selectedOptions[0]?.dataset.idx || "0", 10);
        renderVersion(versions[idx] || versions[0], model, box);
    };
    sel.onchange = renderVer;
    renderVer();
    if (opts.local) {
        const m = opts.local;
        const acts = document.createElement("div");
        acts.className = "cs-expand-actions";
        acts.innerHTML = `
            <button class="cs-btn cs-btn-mini" data-fx-reveal>${esc(t("revealBtn"))}</button>
            <button class="cs-btn cs-btn-mini" data-fx-rename>${esc(t("renameBtn"))}</button>
            <button class="cs-btn cs-btn-mini" data-fx-re-associate>${esc(t("reAssociate"))}</button>
            <button class="cs-btn cs-btn-mini" data-fx-refresh>${esc(t("refreshMeta"))}</button>`;
        box.appendChild(acts);
        $("[data-fx-reveal]", acts).onclick = async () => {
            try { await apiPost("/civitai_studio/local/reveal", { category: m.category, rel: m.rel }); }
            catch (e) { toast("error", t("revealFailed"), e.message); }
        };
        $("[data-fx-rename]", acts).onclick = () => renameDialog(m);
        $("[data-fx-re-associate]", acts).onclick = () => associateDialog(m);
        $("[data-fx-refresh]", acts).onclick = async () => {
            const b2 = $("[data-fx-refresh]", acts);
            b2.disabled = true; b2.textContent = t("refreshing");
            try {
                await apiPost("/civitai_studio/local/refresh_meta", { category: m.category, rel: m.rel });
                const fresh = await apiGet(`/civitai_studio/model/${encodeURIComponent(String(m.civitai.model_id))}`);
                S.local.detailCache[m.civitai.model_id] = fresh;
                renderDetail(fresh, box, { preferVersionId: m.civitai.version_id, local: m });
                toast("success", t("metaRefreshed"), "");
            } catch (e2) {
                toast("error", t("metaRefreshFailed"), e2.message);
                b2.disabled = false; b2.textContent = t("refreshMeta");
            }
        };
    }
}

function rewriteDescImages(root) {
    // 模型说明里的外链图也走代理开关,并禁 referrer(防打点/防直连失败);挂图直接隐藏
    $$(".cs-desc-body img, .cs-expand-desc img", root).forEach((img) => {
        const orig = img.getAttribute("src") || "";
        if (!orig) return;
        img.dataset.direct = orig;
        img.setAttribute("referrerpolicy", "no-referrer");
        img.loading = "lazy";
        img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
        img.src = imgSrc(orig);
    });
}

function galleryItemHtml(img) {
    // 预览条目可能是视频(mp4 封面):静音循环,进视口才加载;右上角可存图到 output
    const src = esc(imgSrc(img.url));
    const direct = esc(img.url);
    const save = `<button class="cs-save-btn" title="${esc(t("saveBtnTitle"))}" data-save-url="${direct}">⬇</button>`;
    if (img.type === "video") {
        return `<div class="cs-gallery-item">${save}<video muted loop playsinline preload="metadata"
                    src="${src}#t=0.001" data-direct="${direct}"
                    onerror="this.style.display='none'"></video></div>`;
    }
    return `<div class="cs-gallery-item">${save}<img loading="lazy" src="${esc(imgSrc(cdnThumb(img.url)))}" data-direct="${esc(img.url)}"
                onerror="this.style.display='none'"/></div>`;
}

async function saveImageToOutput(url, btn) {
    if (btn) btn.disabled = true;
    try {
        const res = await apiPost("/civitai_studio/save_image", { url });
        toast("success", t("saveOk", { name: res.filename }), "");
    } catch (e) {
        toast("error", t("saveFailed"), e.message);
        if (btn) btn.disabled = false;
    }
}

let csVersionSeq = 0;
async function renderVersion(version, model, box) {
    const seq = ++csVersionSeq; // 乱序保护:慢响应不得覆盖新版本内容
    const body = box ? $("#cs-version-body", box) : null;
    if (!body || !version) return;
    const triggers = version.trainedWords || [];
    let images = version.images || [];
    // 镜像站的列表响应不含图片 meta:从 /version/{id} 拉全量(含生成参数)
    try {
        if (version.id && !images.some((i) => i.meta)) {
            const vdata = await apiGet(`/civitai_studio/version/${encodeURIComponent(String(version.id))}`);
            if (Array.isArray(vdata.images) && vdata.images.some((i) => i.meta)) {
                images = vdata.images;
            }
        }
    } catch (e) { /* 拉取失败用现有数据 */ }
    if (seq !== csVersionSeq) return; // 期间用户已切到其它版本
    body.innerHTML = `
        ${triggers.length ? `
        <div class="cs-section">
            <div class="cs-section-title">${esc(t("triggerWords"))} <button class="cs-btn cs-btn-mini" id="cs-copy-triggers">${esc(t("copyAll"))}</button></div>
            <div class="cs-tags">${triggers.map((tg) => `<code class="cs-trigger">${esc(tg)}</code>`).join("")}</div>
        </div>` : ""}
        <div class="cs-section">
            <div class="cs-section-title">${esc(t("files"))}</div>
            <div class="cs-files">${(version.files || []).map((f, i) => `
                <div class="cs-file">
                    <div class="cs-file-info">
                        <div class="cs-file-name" title="${esc(f.name)}">${esc(f.name)}</div>
                        <div class="cs-file-meta">${fmtSize((f.sizeKB || 0) * 1024)}${f.primary ? " · " + esc(t("primaryFile")) : ""}</div>
                    </div>
                    <button class="cs-btn cs-btn-primary" data-file-idx="${i}">${esc(t("download"))}</button>
                </div>`).join("") || `<div class="cs-empty">${esc(t("noFiles"))}</div>`}
            </div>
        </div>
        ${images.length ? `
        <div class="cs-section">
            <div class="cs-section-title">${esc(t("previews", { n: images.length }))}</div>
            <div class="cs-gallery">${images.map(galleryItemHtml).join("")}
            </div>
        </div>` : ""}
    `;
    $("#cs-copy-triggers", body)?.addEventListener("click", (e) => copyText(triggers.join(", "), e.target));
    $$(".cs-trigger", body).forEach((el) => { el.onclick = () => copyText(el.textContent, el); });
    $$("[data-file-idx]", body).forEach((btn) => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.fileIdx, 10);
            openDownloadDialog({ model, version, fileIndex: idx });
        };
    });
    $$(".cs-gallery-item img", body).forEach((img) => {
        img.onclick = () => {
            const direct = img.dataset.direct || "";
            const image = images.find((i) => i.url === direct) || images[0];
            showImageMeta(image);
        };
    });
    $$("[data-save-url]", body).forEach((btn) => {
        btn.onclick = (ev) => {
            ev.stopPropagation();
            saveImageToOutput(btn.dataset.saveUrl, btn);
        };
    });
}

// 统一大图详情浮层:画廊与图像搜索节点共用同一模板。
// 按钮组:[保存图片](下载到 output)+ [选为输出](把 ID 写进图像搜索的 image_id)
//        + [应用到工作流](仅当图片带生成参数时有)
function openImageDetail(item, opts = {}) {
    let meta = item.meta || {};
    if (meta && !meta.prompt && meta.meta) meta = meta.meta; // 剥掉 imageId 精确查询的包裹层
    const hasMeta = !!(meta && (meta.prompt || meta.seed != null));
    const kv = hasMeta
        ? [[t("kvModel"), meta.model], [t("kvSampler"), meta.sampler], [t("kvSteps"), meta.steps],
           ["CFG", meta.cfgScale], ["Seed", meta.seed], [t("kvSize"), meta.size]]
        : [[t("galleryAuthor"), item.username], ["❤", fmtNum(item.stats?.heartCount ?? item.stats?.likeCount)]];
    const kvHtml = kv.filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(String(v))}</span></div>`).join("");
    const resources = (meta.resources || []).map((r) =>
        `<code class="cs-trigger">${esc(r.name || r.modelName || "?")}${r.weight != null ? " × " + esc(r.weight) : ""}</code>`).join("");
    const m = showModal(`
        <h3 class="cs-modal-title">${esc(t("genParams"))}</h3>
        <div class="cs-media-view" style="margin-bottom:10px">${mediaViewerHtml(item)}</div>
        ${hasMeta && meta.prompt ? `
        <div class="cs-meta-block">
            <div class="cs-section-title">${esc(t("positivePrompt"))} <button class="cs-btn cs-btn-mini" data-copy="prompt">${esc(t("copy"))}</button></div>
            <textarea readonly rows="5">${esc(meta.prompt || "")}</textarea>
        </div>` : ""}
        ${hasMeta && meta.negativePrompt ? `
        <div class="cs-meta-block">
            <div class="cs-section-title">${esc(t("negativePrompt"))} <button class="cs-btn cs-btn-mini" data-copy="negative">${esc(t("copy"))}</button></div>
            <textarea readonly rows="3">${esc(meta.negativePrompt || "")}</textarea>
        </div>` : ""}
        <div class="cs-kv-grid" style="margin-top:10px">${kvHtml}</div>
        ${resources ? `<div class="cs-meta-block"><div class="cs-section-title">${esc(t("resources"))}</div><div class="cs-tags">${resources}</div></div>` : ""}
        <div class="cs-modal-actions">
            <button class="cs-btn" data-save-img>${esc(t("saveBtn"))}</button>
            <button class="cs-btn cs-btn-primary" data-use-as-output>${esc(t("useAsOutput"))}</button>
            ${hasMeta ? `<button class="cs-btn" data-apply-workflow>${esc(t("applyBtn"))}</button>` : ""}
        </div>`);
    attachIdAndTags(m.box, item); // ID 行 + 标签行(插在 kv 网格之前)
    $$("[data-copy]", m.box).forEach((btn) => {
        btn.onclick = () => {
            const ta = $("textarea", btn.closest(".cs-meta-block"));
            copyText(ta.value, btn);
        };
    });
    const saveBtn = $("[data-save-img]", m.box);
    if (saveBtn) saveBtn.onclick = () => saveImageToOutput(item.url, saveBtn);
    $("[data-use-as-output]", m.box).onclick = () => {
        selectAsOutput(item, opts.node);
        m.close();
    };
    const applyBtn = $("[data-apply-workflow]", m.box);
    if (applyBtn) applyBtn.onclick = () => {
        applyBtn.disabled = true;
        try {
            const result = applyRecipeToWorkflow(meta);
            // 画布上选中并居中到被改动的节点,直观看到应用到了哪里
            const targets = [result.posNode, result.negNode, ...result.loraNodes].filter(Boolean);
            targets.forEach((n) => { n.selected = true; });
            try {
                app.canvas.setDirty(true, true);
                if (targets[0]) app.canvas.centerOnNode(targets[0]);
            } catch (e2) {}
            const where = targets.map((n) => `#${n.id} ${n.title || n.type}`).join(" · ");
            const loraPart = result.loras ? t("applyLoraPart", { n: result.loras }) : "";
            toast("success", t("applyDone", { lora: loraPart }), where + (result.missing.length ? " | " + t("loraMissing", { names: result.missing.join(", ") }) : ""));
            m.close();
        } catch (e) {
            toast("error", t("applyFail"), e.message);
            applyBtn.disabled = false;
        }
    };
}

// 画廊等无节点上下文的入口:详情浮层不指定目标节点
async function showImageMeta(image) {
    openImageDetail(image);
}

// 把图片 ID 写进图像搜索节点的 image_id(优先显式指定,其次画布选中,最后第一个)
function selectAsOutput(item, preferred) {
    const all = (app.graph?._nodes || []).filter((n) => n.type === "CivitaiImageSearch");
    let node = preferred && all.includes(preferred) ? preferred : null;
    if (!node) {
        node = all.find((n) => { try { return app.canvas?.selectedItems?.has?.(n) || n.selected; } catch (e) { return false; } })
            || all[0] || null;
    }
    if (!node) {
        toast("warn", S.lang === "zh" ? "画布上没有图像搜索节点" : "No Image Search node on canvas");
        return;
    }
    const iw = (node.widgets || []).find((w) => w.name === "index");
    const idw = (node.widgets || []).find((w) => w.name === "image_id");
    const i = (node.csResults || []).indexOf(item);
    if (iw && i >= 0) iw.value = i;
    if (idw) {
        idw.value = String(item.id ?? "");
        // 下拉选项即时补入该 ID;并回传后端持久化(校验与下次下拉都用)
        const opts = idw.options?.values;
        if (Array.isArray(opts) && !opts.includes(idw.value)) opts.unshift(idw.value);
        apiPost(`/civitai_studio/remember_image/${encodeURIComponent(idw.value)}`).catch(() => {});
    }
    renderNodeThumbs(node);
    try { app.canvas.setDirty(true, true); } catch (e) {}
    toast("success", t("selectedAsOutput"), "image_id " + (item.id ?? ""));
}

// ---------- 配方应用:把生成参数写入当前工作流 ----------
function applyRecipeToWorkflow(meta) {
    const graph = app.graph;
    const nodes = graph._nodes || [];
    const byId = graph._nodes_by_id || {};
    const ks = nodes.find((n) => n.type === "KSampler") || nodes.find((n) => (n.type || "").includes("KSampler"));
    if (!ks) throw new Error(t("applyNoKs"));
    const inputByName = (name) => (ks.inputs || []).find((i) => (i.name || "").toLowerCase() === name);
    const modelInp = inputByName("model");
    const clipInp = inputByName("clip");
    const posInp = inputByName("positive");
    const negInp = inputByName("negative");
    const linkSrc = (inp) => {
        const link = inp && inp.link != null ? graph.links[inp.link] : null;
        return link ? { node: byId[link.origin_id], slot: link.origin_slot } : null;
    };
    const result = { pos: false, neg: false, loras: 0, missing: [], posNode: null, negNode: null, loraNodes: [] };
    // 1) 提示词:沿 KSampler 的 positive/negative 连线找文本节点;兜底第一个 CLIPTextEncode
    const setText = (inp, text, mark) => {
        const src = linkSrc(inp);
        if (src?.node?.widgets?.length && src.node.widgets[0].name === "text") {
            src.node.widgets[0].value = text;
            result[mark] = src.node;
            return true;
        }
        const te = nodes.find((n) => n.type === "CLIPTextEncode" && n.widgets?.[0]?.name === "text");
        if (te) { te.widgets[0].value = text; result[mark] = te; return true; }
        return false;
    };
    if (meta.prompt) result.pos = setText(posInp, meta.prompt, "posNode");
    if (meta.negativePrompt) result.neg = setText(negInp, meta.negativePrompt, "negNode");
    // 2) LoRA 链:按名称匹配本地库,匹配到就新建 LoraLoader 串进 model/clip 链路
    const libLoras = S.local.models.filter((m) => m.category === "loras");
    let modelSrc = linkSrc(modelInp);
    let clipSrc = linkSrc(clipInp);
    const created = [];
    for (const r of (meta.resources || []).filter((r) => (r.type || "lora").toLowerCase() === "lora")) {
        const nm = String(r.name || r.modelName || "").toLowerCase();
        if (!nm) continue;
        const local = libLoras.find((m) => {
            const a = ((m.civitai || {}).model_name || "").toLowerCase();
            const b = m.name.toLowerCase();
            return (a && a.includes(nm)) || nm.includes(a) || b.includes(nm.split(" ")[0]);
        });
        if (!local) { result.missing.push(nm); continue; }
        const nn = LiteGraph.createNode("LoraLoader");
        if (!nn) continue;
        graph.add(nn);
        nn.widgets[0].value = local.name;
        const w = parseFloat(r.weight);
        if (!isNaN(w)) { nn.widgets[1].value = w; nn.widgets[2].value = w; }
        if (modelSrc) modelSrc.node.connect(modelSrc.slot, nn, 0);
        if (clipSrc) clipSrc.node.connect(clipSrc.slot, nn, 1);
        modelSrc = { node: nn, slot: 0 };
        clipSrc = { node: nn, slot: 1 };
        created.push(nn);
        result.loraNodes.push(nn);
        result.loras += 1;
    }
    // 3) 最后一级接回 KSampler
    const modelIdx = ks.inputs.indexOf(modelInp);
    const clipIdx = ks.inputs.indexOf(clipInp);
    if (created.length) {
        const last = created[created.length - 1];
        if (modelIdx >= 0) last.connect(0, ks, modelIdx);
        if (clipIdx >= 0) last.connect(1, ks, clipIdx);
    }
    return result;
}

// ---------- 下载对话框 ----------
async function openDownloadDialog({ model, version, fileIndex = null, defaultRoot = "", defaultSub = "" }) {
    if (!version) {
        toast("error", t("cantDownload"), t("versionNotFound"));
        return;
    }
    let destinations = [];
    let destError = "";
    try {
        const data = await apiGet(`/civitai_studio/destinations?type=${encodeURIComponent(model.type || "Other")}`);
        destinations = data.destinations || [];
    } catch (e) {
        destError = e.message;
    }
    if (!destinations.length) {
        toast("error", t("openDownloadFailed"), destError ? t("destFetchFailed") + destError : t("noRegFolders"));
        return;
    }
    const files = version.files || [];
    const selIdx = fileIndex !== null ? fileIndex : Math.max(0, files.findIndex((f) => f.primary));
    // 目录归一后比较(斜杠/大小写/尾斜杠),命中时采用 destinations 的原串,保证 option 选中一致
    const normPath = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const matched = defaultRoot && destinations.find((d) => normPath(d.root) === normPath(defaultRoot));
    const preRoot = matched ? matched.root : destinations[0].root;
    const m = showModal(`
        <h3 class="cs-modal-title">${esc(t("dlDialogTitle", { name: version.name || model.name }))}</h3>
        <div class="cs-form">
            ${files.length > 1 ? `
            <label>${esc(t("fileLabel"))}
                <select id="cs-dl-file">${files.map((f, i) =>
                    `<option value="${i}" ${i === selIdx ? "selected" : ""}>${esc(f.name)} (${fmtSize((f.sizeKB || 0) * 1024)})</option>`).join("")}
                </select>
            </label>` : ""}
            <label>${esc(t("targetFolder"))}
                <select id="cs-dl-root">${destinations.map((d) =>
                    `<option value="${esc(d.root)}" ${d.root === preRoot ? "selected" : ""}>${esc(d.label)}</option>`).join("")}
                </select>
            </label>
            <label>${esc(t("subfolder"))}
                <input id="cs-dl-sub" type="text" placeholder="${esc(t("subfolderPh"))}" value="${esc(defaultSub)}"/>
            </label>
            <label>${esc(t("saveName"))}
                <input id="cs-dl-name" type="text" value="${esc(files[selIdx]?.name || (version.name + ".safetensors"))}"/>
            </label>
            <div class="cs-modal-msg cs-dl-hint">${esc(t("dlHint", { hash: S.cfg.verify_hash ? t("dlHintHash") : "" }))}</div>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
                <button class="cs-btn cs-btn-primary" data-act="ok">${esc(t("startDownload"))}</button>
            </div>
        </div>`);
    $("[data-act=cancel]", m.box).onclick = m.close;
    const fileSel = $("#cs-dl-file", m.box);
    if (fileSel) {
        fileSel.onchange = () => {
            const f = files[parseInt(fileSel.value, 10)];
            if (f) $("#cs-dl-name", m.box).value = f.name;
        };
    }
    $("[data-act=ok]", m.box).onclick = async () => {
        const btn = $("[data-act=ok]", m.box);
        btn.disabled = true;
        btn.textContent = t("submitting");
        try {
            const body = {
                version_id: version.id,
                file_index: fileSel ? parseInt(fileSel.value, 10) : selIdx,
                model_id: model.id,
                model_name: model.name,
                version_name: version.name,
                type: model.type,
                base_model: version.baseModel,
                root: $("#cs-dl-root", m.box).value,
                subfolder: $("#cs-dl-sub", m.box).value.trim(),
                filename: $("#cs-dl-name", m.box).value.trim(),
            };
            const res = await apiPost("/civitai_studio/download", body);
            m.close();
            toast("success", t("queuedToast"), `${model.name} — ${version.name}`);
            if (res.job) S.dl.jobs.unshift(res.job); // 立即入列,不等下一次轮询
            lastPollTs = 0;
            switchTab("downloads");
            pollDownloads();
        } catch (e) {
            toast("error", t("queueFailed"), e.message);
            btn.disabled = false;
            btn.textContent = t("startDownload");
        }
    };
}

// ---------- 本地库 ----------
let loadLocalSeq = 0;

async function loadLocal(force) {
    const st = S.local;
    const seq = ++loadLocalSeq;
    st.loading = true;
    renderLocalList();
    try {
        const data = await apiGet("/civitai_studio/local" + (force ? "?force=1" : ""));
        if (seq !== loadLocalSeq) return; // 旧响应丢弃,避免乱序覆盖
        st.models = data.models || [];
        st.truncated = !!data.truncated;
        st.error = "";
    } catch (e) {
        if (seq !== loadLocalSeq) return;
        st.error = t("loadFailed") + e.message;
        st.models = [];
    } finally {
        if (seq === loadLocalSeq) {
            st.loading = false;
            renderLocalList();
        }
    }
}

function renderLocalList() {
    const list = $("#cs-local-list");
    if (!list) return;
    const st = S.local;
    if (st.error) {
        list.innerHTML = `<div class="cs-empty">${esc(st.error)}</div>`;
        return;
    }
    let models = st.models;
    if (st.type) models = models.filter((m) => m.category === st.type);
    if (st.search) {
        const term = st.search.toLowerCase();
        models = models.filter((m) => {
            const civ = m.civitai || {};
            return (m.name + " " + (civ.model_name || "") + " " + (civ.base_model || "")).toLowerCase().includes(term);
        });
    }
    const cats = [...new Set(st.models.map((m) => m.category))].sort();
    const chips = $("#cs-local-chips");
    if (chips) {
        chips.innerHTML = `<button class="cs-chip ${!st.type ? "active" : ""}" data-cat="">${esc(t("allN", { n: st.models.length }))}</button>` +
            cats.map((c) => `<button class="cs-chip ${st.type === c ? "active" : ""}" data-cat="${esc(c)}">${esc(c)} (${st.models.filter((m) => m.category === c).length})</button>`).join("");
        $$(".cs-chip", chips).forEach((chip) => {
            chip.onclick = () => { st.type = chip.dataset.cat; renderLocalList(); };
        });
    }
    if (st.loading && !st.models.length) {
        list.innerHTML = `<div class="cs-empty">${esc(t("scanning"))}</div>`;
        return;
    }
    if (!models.length) {
        list.innerHTML = `<div class="cs-empty">${esc(t("noModelFiles"))}</div>` + (st.truncated ? `<div class="cs-empty">${esc(t("truncatedNote"))}</div>` : "");
        return;
    }
    const scanning = st.loading ? `<div class="cs-banner">${esc(t("rescanning"))}</div>` : "";
    list.innerHTML = scanning + models.map((m) => {
        const civ = m.civitai || {};
        const upd = st.updates[m.id];
        const updHtml = upd && upd.update
            ? `<div class="cs-local-update">${esc(t("newVersion"))} ${esc(upd.update.version_name)} (${esc(upd.update.base_model || "")})
                 <button class="cs-btn cs-btn-mini cs-btn-primary" data-update="${esc(m.id)}">${esc(t("dlNewVersion"))}</button></div>`
            : (upd && !upd.update && !upd.error ? `<div class="cs-local-update cs-ok">${esc(t("upToDate"))}</div>` : "");
        return `
        <div class="cs-local-row" data-id="${esc(m.id)}">
            <div class="cs-local-main">
                <div class="cs-local-name" title="${esc(m.path || m.rel)}">${esc(civ.model_name || m.name)}</div>
                <div class="cs-local-sub">
                    <span class="cs-badge">${esc(m.category)}</span>
                    ${civ.base_model ? `<span class="cs-badge">${esc(civ.base_model)}</span>` : ""}
                    ${civ.version_name ? `<span class="cs-badge cs-badge-dim">v: ${esc(civ.version_name)}</span>` : ""}
                    <span class="cs-dim">${fmtSize(m.size)}</span>
                    ${civ.model_name && civ.model_name !== m.name ? `<span class="cs-dim">${esc(t("filePrefix"))} ${esc(m.name)}</span>` : ""}
                </div>
                <div class="cs-local-path" title="${esc(m.rel)}">${esc(m.rel)}</div>
                ${updHtml}
            </div>
            <div class="cs-local-actions">
                ${civ.model_id ? `<a class="cs-btn cs-btn-mini" href="${esc(civitaiPage())}/models/${esc(String(civ.model_id))}" target="_blank" rel="noopener noreferrer">${esc(t("pageBtn"))}</a>` : ""}
                ${civ.version_id ? `<button class="cs-btn cs-btn-mini" data-detail="${esc(m.id)}">${esc(t("detailsBtn"))}</button>
                <button class="cs-btn cs-btn-mini" data-check="${esc(m.id)}">${esc(t("checkBtn"))}</button>` : `
                <button class="cs-btn cs-btn-mini" data-associate="${esc(m.id)}">${esc(t("associateBtn"))}</button>`}
                <button class="cs-btn cs-btn-mini" data-rename="${esc(m.id)}">${esc(t("renameBtn"))}</button>
                <button class="cs-btn cs-btn-mini" data-reveal="${esc(m.id)}">${esc(t("revealBtn"))}</button>
                <button class="cs-btn cs-btn-mini cs-btn-danger" data-delete="${esc(m.id)}">${esc(t("deleteBtn"))}</button>
            </div>
        </div>`;
    }).join("");

    $$("[data-reveal]", list).forEach((btn) => {
        btn.onclick = async () => {
            const m = findLocalModel(btn.dataset.reveal);
            try { await apiPost("/civitai_studio/local/reveal", { category: m.category, rel: m.rel }); }
            catch (e) { toast("error", t("revealFailed"), e.message); }
        };
    });
    $$("[data-delete]", list).forEach((btn) => {
        btn.onclick = () => {
            const m = findLocalModel(btn.dataset.delete);
            confirmModal(t("deleteTitle"), t("deleteMsg", { name: m.name }), async () => {
                try {
                    await apiPost("/civitai_studio/local/delete", { category: m.category, rel: m.rel });
                    toast("success", t("deleted"), m.name);
                    S.local.updates = {};
                    closeFloatDetail();
                    S.local.detailCache[m.civitai?.model_id] = undefined;
                    loadLocal(true);
                } catch (e) { toast("error", t("deleteFailed"), e.message); }
            });
        };
    });
    $$("[data-check]", list).forEach((btn) => {
        btn.onclick = async () => {
            const m = findLocalModel(btn.dataset.check);
            btn.disabled = true;
            btn.textContent = "…";
            await runUpdateCheck([{ category: m.category, rel: m.rel }]);
            btn.disabled = false;
            btn.textContent = t("checkBtn");
        };
    });
    $$("[data-update]", list).forEach((btn) => {
        btn.onclick = async () => {
            const m = findLocalModel(btn.dataset.update);
            const info = S.local.updates[m.id];
            if (!info?.update) return;
            btn.disabled = true;
            try {
                const model = await apiGet(`/civitai_studio/model/${info.model_id || (m.civitai || {}).model_id}`);
                const ver = (model.modelVersions || []).find((v) => String(v.id) === String(info.update.version_id)) || model.modelVersions?.[0];
                openDownloadDialog({ model, version: ver, defaultRoot: m.root, defaultSub: m.rel.includes("/") ? m.rel.slice(0, m.rel.lastIndexOf("/")) : "" });
            } catch (e) {
                toast("error", t("fetchingNewVersion"), e.message);
            } finally { btn.disabled = false; }
        };
    });
    $$("[data-detail]", list).forEach((btn) => {
        btn.onclick = () => {
            const m = findLocalModel(btn.dataset.detail);
            toggleLocalDetail(m);
        };
    });
    $$("[data-associate]", list).forEach((btn) => {
        btn.onclick = () => associateDialog(findLocalModel(btn.dataset.associate));
    });
    $$("[data-rename]", list).forEach((btn) => {
        btn.onclick = () => renameDialog(findLocalModel(btn.dataset.rename));
    });
}

function findLocalModel(id) {
    return S.local.models.find((m) => m.id === id);
}

// ---------- 本地库:展开详情 / 重命名 / 手动关联 ----------
function toggleLocalDetail(m) {
    // 本地模型详情在悬浮面板展示:再点一次关闭
    if (!m || !m.civitai || !m.civitai.model_id) return;
    if (S.ui.float && S.ui.float.dataset.mid === String(m.civitai.model_id)) {
        closeFloatDetail();
        return;
    }
    const body = openFloatDetail();
    S.ui.float.dataset.mid = String(m.civitai.model_id);
    const title = $(".cs-float-head .cs-float-title");
    if (title) title.textContent = m.civitai.model_name || m.name;
    body.innerHTML = `<div class="cs-expand-loading">${esc(t("loadingCivitai"))}</div>`;
    const mid = m.civitai.model_id;
    const cached = S.local.detailCache[mid];
    if (cached) { renderDetail(cached, body, { preferVersionId: m.civitai.version_id, local: m }); return; }
    apiGet(`/civitai_studio/model/${encodeURIComponent(String(mid))}`).then((data) => {
        S.local.detailCache[mid] = data;
        if (S.ui.float && S.ui.float.dataset.mid === String(m.civitai.model_id)) renderDetail(data, body, { preferVersionId: m.civitai.version_id, local: m });
    }).catch((e) => {
        const civ = m.civitai || {};
        if (civ.description_html) {
            // 离线回退:sidecar 里有落盘的说明
            renderDetail({ name: civ.model_name, description: civ.description_html, stats: {}, modelVersions: [], id: civ.model_id },
                         body, { preferVersionId: civ.version_id, local: m, offline: true });
        } else {
            body.innerHTML = `<div class="cs-expand-loading">${esc(t("expandLoadFailed") + e.message)}</div>`;
        }
    });
}

function renameDialog(m) {
    if (!m) return;
    const md = showModal(`
        <h3 class="cs-modal-title">${esc(t("renameTitle", { name: m.name }))}</h3>
        <div class="cs-form">
            <label>${esc(t("newFileName"))}
                <input id="cs-rn-name" type="text" value="${esc(m.name)}"/>
            </label>
            <div class="cs-modal-msg">${esc(t("renameMsg"))}</div>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
                <button class="cs-btn cs-btn-primary" data-act="ok">${esc(t("ok"))}</button>
            </div>
        </div>`);
    $("[data-act=cancel]", md.box).onclick = md.close;
    $("[data-act=ok]", md.box).onclick = async () => {
        const btn = $("[data-act=ok]", md.box);
        btn.disabled = true;
        try {
            await apiPost("/civitai_studio/local/rename", { category: m.category, rel: m.rel, new_name: $("#cs-rn-name", md.box).value.trim() });
            md.close();
            toast("success", t("renamed"), m.name);
            closeFloatDetail();
            delete S.local.updates[m.id];
            loadLocal(true);
        } catch (e) {
            toast("error", t("renameFailed"), e.message);
            btn.disabled = false;
        }
    };
}

function guessQueryFromFilename(name) {
    // 从文件名猜搜索词:去扩展名,按分隔符拆词,丢掉版本/精度/格式等噪声词
    const base = String(name || "").replace(/\.[a-z0-9]+$/i, "");
    const junk = /^(v\d+([._]\d+)*|final|prd|pruned|f16|f32|fp8|fp16|t5xxl|eps|ema|safetensors|bin|pt|pth|ckpt|lora|locon|dora|checkpoint|model|copy|combo|by|the)$/i;
    const tokens = base.split(/[\s_\-.,()[\]【】·]+/).filter((tg) => tg && !junk.test(tg) && !/^\d+$/.test(tg));
    return tokens.slice(0, 5).join(" ").trim();
}

function associateDialog(m) {
    if (!m) return;
    let searchItems = [];
    let selected = null; // {model_id}
    let detailData = null;
    const md = showModal(`
        <h3 class="cs-modal-title">${esc(t("assocTitle"))}</h3>
        <div class="cs-form">
            <label>${esc(t("searchByFile"))}
                <div class="cs-search-row">
                    <input id="cs-as-query" type="text" value="${esc(guessQueryFromFilename(m.name))}"/>
                    <button class="cs-btn" id="cs-as-search">${esc(t("searchBtn"))}</button>
                </div>
            </label>
            <div id="cs-as-results" class="cs-as-results"><div class="cs-dim">${esc(t("searching"))}</div></div>
            <div id="cs-as-version-wrap" style="display:none">
                <label>${esc(t("versionLabel"))}</label>
                <div class="cs-as-version-row">
                    <select id="cs-as-version" style="flex:1; min-width:0"></select>
                    <img id="cs-as-thumb" class="cs-as-thumb" style="display:none" alt=""/>
                    <a id="cs-as-open" class="cs-btn cs-btn-mini" target="_blank" rel="noopener noreferrer" style="display:none">${esc(t("webConfirm"))}</a>
                </div>
            </div>
            <label>${esc(t("pasteRef"))}
                <input id="cs-as-ref" type="text" placeholder="${esc(t("pasteRefPh"))}"/>
            </label>
            <div class="cs-modal-msg">${esc(t("assocMsg"))}</div>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
                <button class="cs-btn cs-btn-primary" data-act="ok" disabled>${esc(t("associateBtn"))}</button>
            </div>
        </div>`);
    const resultsEl = $("#cs-as-results", md.box);
    const versionWrap = $("#cs-as-version-wrap", md.box);
    const versionSel = $("#cs-as-version", md.box);
    const okBtn = $("[data-act=ok]", md.box);
    const refInput = $("#cs-as-ref", md.box);

    const updateVersionAux = () => {
        if (!selected) return;
        const vid = versionSel.value;
        const v = ((detailData || {}).modelVersions || []).find((x) => String(x.id) === String(vid));
        const thumb = $("#cs-as-thumb", md.box);
        const open = $("#cs-as-open", md.box);
        const firstImg = (v?.images || []).find((i) => i.url);
        if (firstImg) {
            thumb.style.display = "";
            thumb.dataset.direct = firstImg.url;
            thumb.src = imgSrc(cdnThumb(firstImg.url));
        } else {
            thumb.style.display = "none";
        }
        open.style.display = "";
        open.href = `${civitaiPage()}/models/${encodeURIComponent(String(selected.model_id))}?modelVersionId=${encodeURIComponent(String(vid || ""))}`;
    };
    versionSel.addEventListener("change", updateVersionAux);

    const doSearch = async () => {
        const q = $("#cs-as-query", md.box).value.trim();
        if (!q) {
            resultsEl.innerHTML = `<div class="cs-dim">${esc(t("emptyQuery"))}</div>`;
            return;
        }
        resultsEl.innerHTML = `<div class="cs-dim">${esc(t("searching"))}</div>`;
        try {
            const data = await apiGet(`/civitai_studio/search?query=${encodeURIComponent(q)}&limit=8&nsfw=true`);
            searchItems = data.items || [];
            if (!searchItems.length) {
                resultsEl.innerHTML = `<div class="cs-dim">${esc(t("noResults"))}</div>`;
                return;
            }
            resultsEl.innerHTML = searchItems.map((it, i) => `
                <div class="cs-as-item" data-i="${i}">
                    <div class="cs-as-item-main">
                        <div class="cs-as-item-name" title="${esc(it.name)}">${esc(it.name)}</div>
                        <div class="cs-dim">${esc(typeLabel(it.type))} · ${esc((it.modelVersions?.[0] || {}).baseModel || "?")} · ⬇ ${fmtNum(it.stats?.downloadCount)}</div>
                    </div>
                </div>`).join("");
        } catch (e) {
            resultsEl.innerHTML = `<div class="cs-dim">${esc(t("searchFailed") + e.message)}</div>`;
        }
    };
    resultsEl.addEventListener("click", async (e) => {
        const item = e.target.closest(".cs-as-item");
        if (!item) return;
        $$(".cs-as-item", resultsEl).forEach((n) => n.classList.remove("selected"));
        item.classList.add("selected");
        const it = searchItems[parseInt(item.dataset.i, 10)];
        if (!it) return;
        const myId = String(it.id);
        selected = { model_id: myId }; // 统一存字符串,便于 await 后比较
        refInput.value = "";
        okBtn.disabled = true; // 版本加载完成前禁止提交,避免发送垃圾 version_id
        versionSel.innerHTML = "";
        versionWrap.style.display = "";
        versionSel.innerHTML = `<option>${esc(t("versionLoading"))}</option>`;
        try {
            const detail = await apiGet(`/civitai_studio/model/${encodeURIComponent(myId)}`);
            if (selected?.model_id !== myId) return; // 用户已改选其他模型,丢弃本次响应
            detailData = detail;
            const versions = (detail.modelVersions || []).filter((v) => v.id);
            versionSel.innerHTML = versions.map((v, i) =>
                `<option value="${esc(String(v.id))}" ${i === 0 ? "selected" : ""}>${esc(v.name)} (${esc(v.baseModel || "?")})</option>`).join("");
            okBtn.disabled = false;
            updateVersionAux();
        } catch (e2) {
            if (selected?.model_id === myId) versionWrap.style.display = "none";
        }
    });
    $("[data-act=cancel]", md.box).onclick = md.close;
    $("#cs-as-search", md.box).onclick = doSearch;
    $("#cs-as-query", md.box).addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
    okBtn.onclick = async () => {
        okBtn.disabled = true;
        try {
            let body;
            if (selected) {
                body = { category: m.category, rel: m.rel, model_id: selected.model_id,
                         version_id: versionWrap.style.display !== "none" && versionSel.value ? versionSel.value : undefined };
            } else if (refInput.value.trim()) {
                body = { category: m.category, rel: m.rel, ref: refInput.value.trim() };
            } else {
                toast("error", t("pickFirst"), "");
                okBtn.disabled = false;
                return;
            }
            const res = await apiPost("/civitai_studio/local/associate", body);
            md.close();
            delete S.local.updates[m.id];
            toast("success", t("associated"), `${res.associated?.model_name || m.name} — ${res.associated?.version_name || ""}`);
            loadLocal(true);
        } catch (e) {
            toast("error", t("assocFailed"), e.message);
            okBtn.disabled = false;
        }
    };
    doSearch(); // 默认按文件名智能搜索
}

async function runUpdateCheck(items) {
    const st = S.local;
    const btn = $("#cs-check-updates");
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
        const data = await apiPost("/civitai_studio/local/check_updates", { items });
        const batch = !items?.length;
        let failCount = 0;
        for (const r of data.results || []) {
            if (r.error) {
                failCount += 1;
                if (!batch) toast("error", t("updateCheckFailed"), `${r.id}: ${r.error}`);
                continue;
            }
            st.updates[r.id] = r;
        }
        renderLocalList();
        const hasUpdate = (data.results || []).some((r) => r.update);
        const scope = data.total_linked > data.checked
            ? t("checkedAB", { a: data.checked, b: data.total_linked })
            : t("checkedN", { n: data.checked });
        const failNote = failCount ? t("failNote", { n: failCount }) : "";
        toast("info", t("updateCheckDone"), (hasUpdate ? t("updatesFound") : "") + scope + failNote);
    } catch (e) {
        toast("error", t("updateCheckFailed"), e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = t("checkUpdates"); }
    }
}

// ---------- 社区画廊(images API) ----------
async function fetchGallery(reset) {
    const st = S.gal;
    if (st.loading) { st.pending = true; return; }
    if (!reset && !(st.next && st.next.length)) return; // 没有下一页
    st.loading = true;
    renderGallery();
    try {
        const p = new URLSearchParams({ limit: "24", sort: st.sort, period: st.period });
        p.set("nsfw", st.nsfwLevel > 0 ? "true" : "false");
        if (st.base) p.set("baseModels", st.base);
        if (st.tag.trim()) {
            // 纯数字直接用;名称经本地映射(名称→ID)转换,查不到的跳过
            const ids = st.tag.replace("，", ",").split(",").map((x) => x.trim()).filter(Boolean)
                .map((x) => (/^\d+$/.test(x) ? x : (S.tagMap && S.tagMap[x]) || null))
                .filter(Boolean);
            if (!ids.length) {
                // 填了 tag 但一个有效 ID 都解析不出来:直接显示空结果
                st.items = []; st.next = []; st.error = "";
                st.loading = false;
                renderGallery(true);
                return;
            }
            p.set("tags", ids.join(","));
        }
        if (!reset && st.next) for (const [k, v] of st.next) p.append(k, v);
        const data = await apiGet("/civitai_studio/images?" + p.toString());
        const items = data.items || [];
        if (reset) {
            st.items = items;
        } else {
            const seen = new Set(st.items.map((x) => x.id));
            st.items = st.items.concat(items.filter((x) => !seen.has(x.id)));
        }
        st.next = data.next_query || [];
        st.error = "";
    } catch (e) {
        st.error = t("loadFailed") + e.message;
    } finally {
        st.loading = false;
        renderGallery(reset);
        if (st.pending) { st.pending = false; fetchGallery(true); }
    }
}

function renderGallery(reset) {
    const grid = $("#cs-gal-grid");
    if (!grid) return;
    const st = S.gal;
    if (st.error) {
        grid.innerHTML = `<div class="cs-empty">${esc(st.error)}</div>`;
        return;
    }
    if (reset) {
        grid.innerHTML = "";
        st.jrow = []; st.jrowAr = 0; // 两端对齐行排版的在途行(跨"加载更多"批次续行)
    }
    // 两端对齐行排版:按宽高比贪心成行,行内等高铺满整行宽(与节点缩略图同款)
    const gap = 6, targetH = Math.max(64, parseInt(st.thumbSize, 10) || 256);
    const W = Math.max(160, grid.clientWidth - 8);
    const flushRow = () => {
        const r = st.jrow;
        if (!r || !r.length) return;
        const arSum = r.reduce((s, c) => s + c.ar, 0);
        const avail = W - (r.length - 1) * gap;
        let h = Math.min(avail / arSum, targetH * 1.3); // 窄栏末行/独行不超目标太多
        if (arSum * h > avail) h *= avail / (arSum * h); // 舍入超宽回调
        for (const c of r) {
            c.el.style.flex = `0 0 ${(c.ar * h).toFixed(1)}px`;
            c.el.style.width = (c.ar * h).toFixed(1) + "px";
            c.el.style.height = h.toFixed(1) + "px";
            grid.appendChild(c.el);
        }
        st.jrow = []; st.jrowAr = 0;
    };
    for (const img of st.items) {
        if (img.__rendered) continue;
        img.__rendered = true;
        const item = document.createElement("div");
        item.className = "cs-gal-item";
        const save = `<button class="cs-save-btn" title="${esc(t("saveBtnTitle"))}" data-save-url="${esc(img.url)}">⬇</button>`;
        if (isVideoItem(img)) {
            // 视频条目:静音取首帧作封面,点击悬浮层播放
            item.innerHTML = `${save}<video muted loop playsinline preload="metadata"
                    src="${esc(imgSrc(img.url))}#t=0.001" data-direct="${esc(img.url)}"
                    onerror="this.style.display='none'"></video>`;
        } else {
            item.innerHTML = `${save}<img loading="lazy" src="${esc(imgSrc(cdnThumb(img.url)))}" data-direct="${esc(img.url)}"
                    onerror="this.style.display='none'"/>`;
        }
        const mediaEl = item.querySelector("img,video");
        if (mediaEl) mediaEl.onclick = () => showImageMeta(img);
        if (isVideoItem(img)) appendPlayBadge(item); // 半透明播放三角标
        appendMissingMarks(item, img.meta); // 缺失生成参数的三色感叹号(与节点条共用)
        item.querySelector(".cs-save-btn").onclick = (ev) => {
            ev.stopPropagation();
            saveImageToOutput(img.url, ev.target);
        };
        const ar = img.width && img.height ? img.width / img.height : 0.75;
        st.jrow.push({ el: item, ar }); st.jrowAr = (st.jrowAr || 0) + ar;
        if (st.jrowAr * targetH + (st.jrow.length - 1) * gap >= W) flushRow();
    }
    flushRow();
    if (!st.items.length && !st.loading) {
        grid.innerHTML = `<div class="cs-empty">${esc(t("galleryEmpty"))}</div>`;
    }
}

function buildGalleryView(root) {
    const st = S.gal;
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "gallery";
    view.innerHTML = `
        <div class="cs-filters cs-filters-gal">
            <input id="cs-gal-base" class="cs-span-full" list="cs-gal-base-list" type="text" placeholder="${esc(t("basePlaceholder"))}" value="${esc(st.base)}"/>
            <datalist id="cs-gal-base-list">${BASE_MODELS.map((b) => `<option value="${esc(b)}"></option>`).join("")}</datalist>
            <input id="cs-gal-tag" class="cs-span-full" type="text" placeholder="${esc(t("galTagId"))}" value="${esc(st.tag)}" autocomplete="off"/>
            <select id="cs-gal-period">${PERIODS.map((p) => `<option value="${p}" ${st.period === p ? "selected" : ""}>${esc(periodLabel(p))}</option>`).join("")}</select>
            <select id="cs-gal-sort">
                <option value="Newest">${esc(t("gallerySortNewest"))}</option>
                <option value="Most Reactions">${esc(t("gallerySortReactions"))}</option>
                <option value="Most Comments">${esc(t("gallerySortComments"))}</option>
            </select>
            <select id="cs-gal-nsfw"><option value="0" ${!st.nsfwLevel ? "selected" : ""}>${esc(t("sfwLabel"))}</option><option value="1" ${st.nsfwLevel ? "selected" : ""}>${esc(t("nsfwLabel"))}</option></select>
            <select id="cs-gal-size" title="${esc(S.lang === "zh" ? "缩略图大小" : "Thumbnail size")}">${[128, 256, 512].map((px) => `<option value="${px}" ${st.thumbSize === px ? "selected" : ""}>${px}px</option>`).join("")}</select>
        </div>
        <div id="cs-gal-content" class="cs-scroll">
            <div id="cs-gal-grid" class="cs-gal-grid"></div>
        </div>`;
    root.appendChild(view);
    $("#cs-gal-sort", view).value = st.sort;
    $("#cs-gal-sort", view).addEventListener("change", (e) => { st.sort = e.target.value; fetchGallery(true); });
    $("#cs-gal-period", view).addEventListener("change", (e) => { st.period = e.target.value; fetchGallery(true); });
    $("#cs-gal-nsfw", view).addEventListener("change", (e) => { st.nsfwLevel = parseInt(e.target.value, 10); fetchGallery(true); });
    // 缩略图大小:不重新拉取,清渲染标记后整版重排
    $("#cs-gal-size", view).addEventListener("change", (e) => {
        st.thumbSize = parseInt(e.target.value, 10);
        st.items.forEach((i) => { delete i.__rendered; });
        renderGallery(true);
    });
    const debouncedFetch = () => {
        clearTimeout(buildGalleryView._deb);
        buildGalleryView._deb = setTimeout(() => fetchGallery(true), 600);
    };
    // tag 补全:自绘下拉弹层(样式与侧边栏一致;原生 datalist 样式不受控、与其它下拉不一致)。
    // 列出本地已入库标签名称,点击填入;无匹配时仍可自由输入数字 ID
    {
        const tagInput = $("#cs-gal-tag", view);
        let pop = null;
        const closePop = () => { if (pop) { pop.remove(); pop = null; } };
        const showPop = () => {
            closePop();
            const names = Object.keys(S.tagMap || {});
            const q = tagInput.value.trim().toLowerCase();
            const hits = (q ? names.filter((n) => n.toLowerCase().includes(q)) : names).slice(0, 60);
            if (!hits.length) return;
            pop = document.createElement("div");
            pop.style.cssText = "position:fixed;z-index:65000;background:var(--comfy-menu-bg,#2a2a2a);"
                + "border:1px solid var(--border-color,#444);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);"
                + "max-height:220px;overflow-y:auto;min-width:" + tagInput.getBoundingClientRect().width + "px;";
            for (const name of hits) {
                const opt = document.createElement("div");
                opt.textContent = "#" + name;
                opt.style.cssText = "padding:5px 10px;font-size:12px;color:var(--fg-color,#eee);cursor:pointer;";
                opt.onmouseenter = () => { opt.style.background = "var(--accent-color,#4a90e2)"; };
                opt.onmouseleave = () => { opt.style.background = "transparent"; };
                opt.onclick = () => {
                    tagInput.value = name;
                    st.tag = name;
                    closePop();
                    fetchGallery(true);
                };
                pop.appendChild(opt);
            }
            document.body.appendChild(pop);
            const r = tagInput.getBoundingClientRect();
            pop.style.left = r.left + "px";
            pop.style.top = Math.min(r.bottom + 2, window.innerHeight - (pop.offsetHeight || 100) - 8) + "px";
        };
        tagInput.addEventListener("focus", showPop);
        tagInput.addEventListener("input", () => { st.tag = tagInput.value; showPop(); debouncedFetch(); });
        tagInput.addEventListener("blur", () => setTimeout(closePop, 150)); // 延迟让选项点击先于关闭
        document.addEventListener("click", (ev) => { if (pop && !pop.contains(ev.target) && ev.target !== tagInput) closePop(); });
    }
    let debBase;
    $("#cs-gal-base", view).addEventListener("input", (e) => {
        clearTimeout(debBase);
        debBase = setTimeout(() => { st.base = e.target.value.trim(); fetchGallery(true); }, 400);
    });
    // tag 名称映射(详情浮层抓取后由 refreshTagCombos 一并维护 S.tagMap)
    apiGet("/civitai_studio/tag_mapping").then((d) => {
        S.tagMap = S.tagMap || {};
        (d.tags || []).forEach((t2) => { S.tagMap[t2.name] = t2.id; });
    }).catch(() => {});
    // 底模联想列表:内置种子 + 站方枚举补全(与浏览页一致)
    apiGet("/civitai_studio/enums").then((d) => {
        const list = sortEnumNames(d.ActiveBaseModel || d.BaseModel || []);
        const dl = $("#cs-gal-base-list", view);
        if (dl && list.length) dl.innerHTML = list.map((b) => `<option value="${esc(String(b))}"></option>`).join("");
    }).catch(() => {});
    $("#cs-gal-content", view).addEventListener("scroll", (e) => {
        const el = e.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400 && !st.loading && st.next.length) fetchGallery(false);
    });
}

// ---------- 下载队列 ----------
let pollTimer = null;
let lastPollTs = 0;

function renderDownloads(force) {
    const list = $("#cs-dl-list");
    if (!list) return;
    const activeCount = S.dl.jobs.filter((j) => ["queued", "downloading", "verifying"].includes(j.status)).length;
    const sig = JSON.stringify([activeCount, S.dl.failStreak, S.dl.jobs.map((j) => [j.id, j.status, j.progress, j.received, j.speed, j.error, j.warning])]);
    if (!force && sig === S.dl.lastSig) return;
    S.dl.lastSig = sig;
    let head = "";
    if (S.dl.failStreak >= 3) {
        head = `<div class="cs-banner cs-banner-warn">${esc(t("pollFailBanner"))}</div>`;
    }
    if (!S.dl.jobs.length) {
        const clrBtn = $("#cs-dl-clear");
        if (clrBtn) clrBtn.style.display = "none";
        list.innerHTML = head + `<div class="cs-empty">${esc(t("noJobs"))}</div>`;
        return;
    }
    list.innerHTML = head + S.dl.jobs.map((j) => {
        const pct = Math.round((j.progress || 0) * 100);
        const statusText = {
            queued: t("stQueued"),
            downloading: t("stDownloading", { pct, speed: fmtSpeed(j.speed) }),
            verifying: t("stVerifying"),
            done: t("stDone"),
            cancelled: t("stCancelled"),
            error: t("stError") + (j.error || ""),
        }[j.status] || j.status;
        const active = j.status === "downloading" || j.status === "verifying" || j.status === "queued";
        return `
        <div class="cs-dl-row">
            <div class="cs-dl-info">
                <div class="cs-dl-name" title="${esc(j.dest)}">${esc(j.model_name || j.filename)}<span class="cs-dim"> — ${esc(j.version_name || "")}</span></div>
                <div class="cs-dl-bar"><div class="cs-dl-fill ${j.status}" style="width:${pct}%"></div></div>
                <div class="cs-dl-sub">
                    <span class="cs-status-${esc(j.status)}">${esc(statusText)}</span>
                    <span class="cs-dim">${fmtSize(j.received)}${j.total ? " / " + fmtSize(j.total) : ""}</span>
                </div>
                ${j.warning ? `<div class="cs-local-update">${esc(j.warning)}</div>` : ""}
            </div>
            ${active ? `<button class="cs-btn cs-btn-mini cs-btn-danger" data-cancel="${esc(j.id)}">${esc(t("cancelBtn"))}</button>` : ""}
        </div>`;
    }).join("");
    $$("[data-cancel]", list).forEach((btn) => {
        btn.onclick = async () => {
            try { await apiPost("/civitai_studio/downloads/cancel", { id: btn.dataset.cancel }); }
            catch (e) { toast("error", t("cancelFailed"), e.message); }
        };
    });
    const clr = $("#cs-dl-clear");
    if (clr) clr.style.display = S.dl.jobs.some((j) => ["done", "error", "cancelled"].includes(j.status)) ? "" : "none";
}

async function pollDownloads() {
    if (document.hidden && S.dl.failStreak === 0) {
        const anyActive = S.dl.jobs.some((j) => ["queued", "downloading", "verifying"].includes(j.status));
        if (!anyActive) return; // 页面隐藏且无活动任务:不打扰
    }
    const now = Date.now();
    const hasActive = S.dl.jobs.some((j) => ["queued", "downloading", "verifying"].includes(j.status));
    if (now - lastPollTs < (hasActive ? 1500 : 8000)) return; // 空闲时降频
    lastPollTs = now;
    try {
        const data = await apiGet("/civitai_studio/downloads");
        S.dl.jobs = data.jobs || [];
        S.dl.failStreak = 0;
        const active = S.dl.jobs.filter((j) => ["queued", "downloading", "verifying"].includes(j.status)).length;
        const badge = $("#cs-dl-badge");
        if (badge) {
            badge.textContent = active ? String(active) : "";
            badge.style.display = active ? "" : "none";
        }
        if (S.ui.tab === "downloads") renderDownloads();
    } catch (e) {
        S.dl.failStreak += 1;
        if (S.ui.tab === "downloads") renderDownloads(true);
    }
}

// ---------- 设置 ----------
async function openSettings() {
    let cfg;
    try { cfg = await apiGet("/civitai_studio/config"); }
    catch (e) { toast("error", t("readCfgFailed"), e.message); return; }
    const oldProxyImages = !!cfg.proxy_images;
    const m = showModal(`
        <h3 class="cs-modal-title">${esc(t("settingsTitle"))}</h3>
        <div class="cs-form">
            <label>${esc(t("keyLabel"))}
                <input id="cs-set-key" type="password" placeholder="${cfg.api_key_set ? esc(t("keySetPh", { tail: cfg.api_key_tail || "" })) : esc(t("keyPh"))}"/>
            </label>
            <label>${esc(t("proxyLabel"))}
                <input id="cs-set-proxy" type="text" value="${esc(cfg.proxy || "")}" placeholder="${esc(t("proxyPh"))}"/>
                <span class="cs-form-hint">${esc(t("proxyHint"))}</span>
            </label>
            <label>${esc(t("mirrorLabel"))}
                <select id="cs-set-site">
                    <option value="https://civitai.com">civitai.com</option>
                    <option value="https://civitai.green">civitai.green [SFW]</option>
                    <option value="https://civitai.red">civitai.red [NSFW]</option>
                    <option value="__custom__">${esc(t("siteCustom"))}</option>
                </select>
                <input id="cs-set-mirror" type="text" value="${esc(cfg.mirror || "")}" placeholder="https://…" style="display:none;margin-top:4px"/>
            </label>
            <label>${esc(t("concLabel"))}
                <input id="cs-set-conc" type="number" min="1" max="4" value="${cfg.max_concurrent || 1}"/>
            </label>
            <label class="cs-check"><input id="cs-set-pimg" type="checkbox" ${cfg.proxy_images ? "checked" : ""}/> ${esc(t("pimgLabel"))}</label>
            <label class="cs-check"><input id="cs-set-hash" type="checkbox" ${cfg.verify_hash ? "checked" : ""}/> ${esc(t("hashLabel"))}</label>
            <label class="cs-check"><input id="cs-set-pdesc" type="checkbox" ${cfg.persist_description ? "checked" : ""}/> ${esc(t("pdescLabel"))}</label>
            <label class="cs-check"><input id="cs-set-tscrape" type="checkbox" ${cfg.tag_scrape !== false ? "checked" : ""}/> ${esc(t("tagScrapeLabel"))}</label>
            <div class="cs-modal-msg">${esc(t("settingsMsg"))}</div>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
                <button class="cs-btn cs-btn-primary" data-act="ok">${esc(t("save"))}</button>
            </div>
        </div>`);
    $("[data-act=cancel]", m.box).onclick = m.close;
    // API 站点四选一:预设回显;自定义时展开输入框
    const siteSel = $("#cs-set-site", m.box);
    const mirrorInput = $("#cs-set-mirror", m.box);
    const knownSites = ["https://civitai.com", "https://civitai.green", "https://civitai.red"];
    const curMirror = (cfg.mirror || "").trim().replace(/\/+$/, "");
    if (curMirror && !knownSites.includes(curMirror)) siteSel.value = "__custom__";
    else if (!curMirror) siteSel.value = "https://civitai.com";
    else siteSel.value = curMirror;
    mirrorInput.style.display = siteSel.value === "__custom__" ? "block" : "none";
    siteSel.addEventListener("change", () => {
        mirrorInput.style.display = siteSel.value === "__custom__" ? "block" : "none";
    });
    $("[data-act=ok]", m.box).onclick = async () => {
        const mirror = siteSel.value === "__custom__" ? mirrorInput.value.trim()
            : (siteSel.value === "https://civitai.com" ? "" : siteSel.value); // 留空 = 默认 civitai.com
        const body = {
            proxy: $("#cs-set-proxy", m.box).value.trim(),
            mirror,
            max_concurrent: parseInt($("#cs-set-conc", m.box).value, 10) || 1,
            proxy_images: $("#cs-set-pimg", m.box).checked,
            verify_hash: $("#cs-set-hash", m.box).checked,
            persist_description: $("#cs-set-pdesc", m.box).checked,
            tag_scrape: $("#cs-set-tscrape", m.box).checked,
        };
        const key = $("#cs-set-key", m.box).value.trim();
        if (key) body.api_key = key;
        try {
            await apiPost("/civitai_studio/config", body);
            S.cfg = { ...S.cfg, ...body };
            // 标签映射刚可用:预热 S.tagMap 并刷新节点的 tag 下拉选项
            if (!S.tagMap) {
                apiGet("/civitai_studio/tag_mapping").then((d) => {
                    S.tagMap = {};
                    (d.tags || []).forEach((t2) => { S.tagMap[t2.name] = t2.id; });
                    refreshTagCombos();
                }).catch(() => {});
            }
            m.close();
            toast("success", t("settingsSaved"), "");
            if (body.proxy_images !== oldProxyImages) refreshAllImages();
        } catch (e) {
            toast("error", t("saveFailed"), e.message);
        }
    };
}

function refreshAllImages() {
    // 代理图片开关切换后,把已渲染的全部远端图换源,而不是只影响之后的节点
    $$("img[data-direct]", S.ui.root || document).forEach((img) => {
        const direct = img.dataset.direct || "";
        if (direct) img.src = imgSrc(direct);
    });
}

// ---------- 布局 ----------
function switchTab(tab) {
    S.ui.tab = tab;
    $$(".cs-tab-btn", S.ui.root).forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".cs-view", S.ui.root).forEach((v) => v.classList.toggle("active", v.dataset.view === tab));
    if (tab === "local") loadLocal(false); // TTL 在后端,重复加载代价极小,保证不陈旧
    if (tab === "downloads") renderDownloads(true);
    if (tab === "gallery" && !S.gal.items.length && !S.gal.loading) fetchGallery(true);
}

function buildBrowseView(root) {
    const st = S.browse;
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "browse";
    view.innerHTML = `
        <div class="cs-toolbar">
            <input id="cs-search" type="search" placeholder="${esc(t("searchPlaceholder"))}"/>
        </div>
        <div class="cs-presets">
            <button class="cs-chip" data-preset="hot-week">${esc(t("presetHotWeek"))}</button>
            <button class="cs-chip" data-preset="hot-month">${esc(t("presetHotMonth"))}</button>
            <button class="cs-chip" data-preset="best-month">${esc(t("presetBestMonth"))}</button>
        </div>
        <div class="cs-filters">
            <input id="cs-f-base" class="cs-span-full" list="cs-base-list" type="text" placeholder="${esc(t("basePlaceholder"))}" value="${esc(st.base)}"/>
            <datalist id="cs-base-list">${BASE_MODELS.map((b) => `<option value="${esc(b)}"></option>`).join("")}</datalist>
            <select id="cs-f-type" class="cs-span-full"><option value="">${esc(t("allTypes"))}</option>${TYPE_OPTIONS.map((tp) => `<option value="${tp}" ${st.type === tp ? "selected" : ""}>${esc(tp)}</option>`).join("")}</select>
            <select id="cs-f-period">${PERIODS.map((p) => `<option value="${p}" ${st.period === p ? "selected" : ""}>${esc(periodLabel(p))}</option>`).join("")}</select>
            <select id="cs-f-sort">${SORTS.map((s) => `<option value="${s}" ${st.sort === s ? "selected" : ""}>${esc(sortLabel(s))}</option>`).join("")}</select>
            <select id="cs-f-nsfw"><option value="0" ${!st.nsfw ? "selected" : ""}>${esc(t("sfwLabel"))}</option><option value="1" ${st.nsfw ? "selected" : ""}>${esc(t("nsfwLabel"))}</option></select>
        </div>
        <div id="cs-browse-content" class="cs-scroll">
            <div id="cs-grid" class="cs-grid"></div>
        </div>
        <div id="cs-status" class="cs-status"></div>`;
    root.appendChild(view);

    let deb;
    $("#cs-search", view).addEventListener("input", (e) => {
        clearTimeout(deb);
        deb = setTimeout(() => {
            st.query = e.target.value.trim();
            triggerBrowseRefresh();
        }, 500);
    });
    for (const [sel, key] of [["#cs-f-type", "type"], ["#cs-f-sort", "sort"], ["#cs-f-period", "period"], ["#cs-f-nsfw", "nsfw"]]) {
        $(sel, view).addEventListener("change", (e) => {
            st[key] = key === "nsfw" ? parseInt(e.target.value, 10) : e.target.value;
            triggerBrowseRefresh();
            if (key === "nsfw") apiPost("/civitai_studio/config", { nsfw: st[key] }).catch(() => {}); // 偏好持久化
        });
    }
    // 榜单预设:一键设置 排序+时间范围
    $$(".cs-presets .cs-chip", view).forEach((chip) => {
        chip.onclick = () => {
            const preset = chip.dataset.preset;
            if (preset === "hot-week") { st.sort = "Most Downloaded"; st.period = "Week"; }
            else if (preset === "hot-month") { st.sort = "Most Downloaded"; st.period = "Month"; }
            else { st.sort = "Highest Rated"; st.period = "Month"; }
            triggerBrowseRefresh();
        };
    });
    // 底模为可输入枚举(datalist 联想),便于使用站方新增的底模名
    let debBase;
    $("#cs-f-base", view).addEventListener("input", (e) => {
        clearTimeout(debBase);
        debBase = setTimeout(() => {
            st.base = e.target.value.trim();
            triggerBrowseRefresh();
        }, 400);
    });
    // 打开面板即拉取站方枚举,动态补全底模联想列表与类型下拉(失败保留内置种子)
    apiGet("/civitai_studio/enums").then((d) => {
        const list = sortEnumNames(d.ActiveBaseModel || d.BaseModel || []);
        if (list.length) {
            const dl = $("#cs-base-list", view);
            if (dl) dl.innerHTML = list.map((b) => `<option value="${esc(String(b))}"></option>`).join("");
        }
        const typeSel = $("#cs-f-type", view);
        if (typeSel && Array.isArray(d.ModelType) && d.ModelType.length) {
            const cur = st.type;
            typeSel.innerHTML = [`<option value="">${esc(t("allTypes"))}</option>`]
                .concat(sortEnumNames(d.ModelType)
                    .map((tp) => `<option value="${esc(String(tp))}" ${String(tp) === cur ? "selected" : ""}>${esc(String(tp))}</option>`))
                .join("");
        }
    }).catch(() => {});
    // 无限滚动(页码推进在 fetchBrowse 成功后提交,失败自动重试同一页)
    $("#cs-browse-content", view).addEventListener("scroll", (e) => {
        const el = e.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
            if (!st.loading && st.nextCursor && !st.dirty) fetchBrowse(false);
        }
    });
}

function buildLocalView(root) {
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "local";
    view.innerHTML = `
        <div class="cs-toolbar">
            <input id="cs-local-search" type="search" placeholder="${esc(t("localSearchPh"))}"/>
            <button class="cs-btn" id="cs-check-updates">${esc(t("checkUpdates"))}</button>
            <button class="cs-btn" id="cs-local-refresh" title="${esc(t("rescanTitle"))}">🔄</button>
        </div>
        <div id="cs-local-chips" class="cs-chips"></div>
        <div id="cs-local-list" class="cs-scroll"></div>`;
    root.appendChild(view);
    $("#cs-local-refresh", view).onclick = () => { S.local.updates = {}; loadLocal(true); };
    $("#cs-check-updates", view).onclick = () => runUpdateCheck([]);
    let deb;
    $("#cs-local-search", view).addEventListener("input", (e) => {
        clearTimeout(deb);
        deb = setTimeout(() => { S.local.search = e.target.value.trim(); renderLocalList(); }, 250);
    });
}

function buildDownloadsView(root) {
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "downloads";
    view.innerHTML = `
        <div class="cs-toolbar">
            <span class="cs-dim">${esc(t("dlTabHint"))}</span>
            <button class="cs-btn" id="cs-dl-clear" style="display:none">${esc(t("clearFinished"))}</button>
        </div>
        <div id="cs-dl-list" class="cs-scroll"></div>`;
    root.appendChild(view);
    $("#cs-dl-clear", view).onclick = async () => {
        try { await apiPost("/civitai_studio/downloads/clear", {}); pollDownloads(); }
        catch (e) { toast("error", t("clearFailed"), e.message); }
    };
}

function buildRoot(el) {
    el.innerHTML = "";
    const root = document.createElement("div");
    root.className = "cs-root";
    root.innerHTML = `
        ${S.ui.backendStale ? `<div class="cs-banner cs-banner-warn" id="cs-stale-banner">${esc(t("staleBanner"))}</div>` : ""}
        <div class="cs-topbar">
            <button class="cs-tab-btn active" data-tab="browse">${esc(t("tabBrowse"))}</button>
            <button class="cs-tab-btn" data-tab="local">${esc(t("tabLocal"))}</button>
            <button class="cs-tab-btn" data-tab="downloads">${esc(t("tabDownloads"))} <span id="cs-dl-badge" class="cs-dl-badge" style="display:none"></span></button>
            <button class="cs-tab-btn" data-tab="gallery">${esc(t("galleryTab"))}</button>
            <span class="cs-topbar-spacer"></span>
            <button class="cs-tab-btn" id="cs-settings-btn" title="${esc(t("settings"))}">⚙</button>
        </div>
        <div class="cs-body"></div>`;
    el.appendChild(root);
    S.ui.root = root;
    buildBrowseView($(".cs-body", root));
    buildLocalView($(".cs-body", root));
    buildDownloadsView($(".cs-body", root));
    buildGalleryView($(".cs-body", root));
    $$(".cs-tab-btn[data-tab]", root).forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
    $("#cs-settings-btn", root).onclick = openSettings;
    switchTab("browse");
}

function restoreBrowseState() {
    // 重开面板:恢复滚动位置
    const content = $("#cs-browse-content");
    if (content) content.scrollTop = S.ui.scrollTop || 0;
}

// ---------- 样式 ----------
function injectStyles() {
    if (document.getElementById("civitai-studio-styles")) return;
    const style = document.createElement("style");
    style.id = "civitai-studio-styles";
    style.textContent = `
.cs-root { display:flex; flex-direction:column; height:100%; color:var(--fg-color,#eee); font-size:13px; }
.cs-topbar { display:flex; flex-wrap:wrap; gap:4px; align-items:center; padding:6px; border-bottom:1px solid var(--border-color,#444); flex-shrink:0; }
.cs-topbar-spacer { flex:1; min-width:8px; }
.cs-tab-btn { background:transparent; border:1px solid transparent; color:var(--fg-color,#eee); border-radius:6px; padding:3px 8px; cursor:pointer; font-size:12px; }
.cs-tab-btn:hover { border-color:var(--border-color,#444); }
.cs-tab-btn.active { background:var(--comfy-input-bg,#333); border-color:var(--accent-color,#4a90e2); }
.cs-dl-badge { background:#e2543f; color:#fff; border-radius:8px; padding:0 5px; font-size:10px; margin-left:2px; }
.cs-body { flex:1; min-height:0; position:relative; }
.cs-view { display:none; height:100%; flex-direction:column; overflow:hidden; }
.cs-view.active { display:flex; }
.cs-toolbar { display:flex; gap:6px; padding:6px; flex-shrink:0; align-items:center; }
.cs-toolbar input[type=search] { flex:1; min-width:0; }
.cs-filters { display:grid; grid-template-columns:repeat(6,1fr); gap:4px; padding:0 6px 6px; flex-shrink:0; }
.cs-filters > * { width:100%; min-width:0; grid-column:span 2; }
/* 画廊筛选:12 列网格,时间/排序/年龄/缩略图大小四项同行等宽
   (span-full 规则必须写在通配规则之后:同特异性时后者胜) */
.cs-filters.cs-filters-gal { grid-template-columns:repeat(12,1fr); }
.cs-filters.cs-filters-gal > * { grid-column:span 3; }
.cs-filters > .cs-span-full { grid-column:1/-1; }
.cs-presets { display:flex; gap:4px; padding:0 6px 6px; flex-shrink:0; flex-wrap:wrap; }
.cs-filters select, .cs-filters input[type=text] { width:100%; padding:3px; font-size:12px; box-sizing:border-box; }
.cs-scroll { flex:1; min-height:0; overflow-y:auto; padding:0 6px; }
.cs-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px; padding-bottom:20px; }
.cs-card { background:var(--comfy-box-bg, var(--comfy-input-bg,#333)); border:1px solid var(--border-color,#444); border-radius:6px; overflow:hidden; cursor:pointer; transition:transform .15s, border-color .15s; }
.cs-card:hover { border-color:var(--accent-color,#4a90e2); transform:translateY(-2px); }
.cs-card-installed { border-color:#4caf50; }
.cs-card-cover { position:relative; width:100%; padding-top:130%; background:#222; }
.cs-card-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .25s; }
.cs-card-img.is-loaded { opacity:1; }
.cs-card-placeholder { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:28px; opacity:.3; }
.cs-card-badges { position:absolute; top:4px; left:4px; right:4px; display:flex; gap:4px; flex-wrap:wrap; z-index:2; }
.cs-badge { background:rgba(0,0,0,.65); color:#fff; font-size:10px; padding:1px 6px; border-radius:8px; }
.cs-badge-ok { background:rgba(76,175,80,.9); }
.cs-badge-dim { opacity:.7; }
.cs-play { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:26px; height:26px;
  border-radius:50%; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center;
  pointer-events:none; }
.cs-play::after { content:""; margin-left:2px; border-left:9px solid rgba(255,255,255,.85);
  border-top:6px solid transparent; border-bottom:6px solid transparent; }
.cs-card-info { padding:6px; }
.cs-card-name { font-weight:600; font-size:12px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:2.4em; }
.cs-card-sub { display:flex; justify-content:space-between; font-size:10px; color:var(--desc-text-color,#999); margin-top:3px; gap:4px; }
.cs-card-creator { font-size:10px; color:var(--desc-text-color,#999); opacity:.7; margin-top:2px; }
.cs-status { padding:4px 8px; font-size:11px; color:var(--desc-text-color,#999); border-top:1px solid var(--border-color,#444); flex-shrink:0; min-height:22px; }
.cs-empty { text-align:center; color:var(--desc-text-color,#999); padding:30px 10px; grid-column:1/-1; white-space:pre-line; }
.cs-error { color:#e2a23f; }
.cs-banner { background:rgba(74,144,226,.15); border:1px solid var(--accent-color,#4a90e2); color:var(--fg-color,#eee); border-radius:6px; padding:6px 10px; margin-bottom:6px; font-size:12px; }
.cs-banner-warn { border-color:#e2a23f; background:rgba(226,162,63,.12); }
.cs-btn { background:var(--comfy-input-bg,#333); border:1px solid var(--border-color,#444); color:var(--fg-color,#eee); border-radius:5px; padding:4px 10px; cursor:pointer; font-size:12px; text-decoration:none; display:inline-block; white-space:nowrap; }
.cs-btn:hover { border-color:var(--accent-color,#4a90e2); }
.cs-btn:disabled { opacity:.5; cursor:not-allowed; }
.cs-btn-primary { background:var(--accent-color,#4a90e2); color:#fff; border-color:var(--accent-color,#4a90e2); }
.cs-btn-danger { color:#e2543f; border-color:rgba(226,84,63,.5); }
.cs-btn-mini { padding:2px 7px; font-size:11px; }
.cs-detail-head { display:flex; gap:6px; padding:8px 0 4px; }
.cs-detail-title { margin:4px 0; font-size:15px; }
.cs-detail-meta { font-size:11px; color:var(--desc-text-color,#999); margin-bottom:6px; }
.cs-detail-row { display:flex; gap:8px; align-items:center; margin:8px 0; }
.cs-detail-row label { flex-shrink:0; font-size:12px; }
.cs-detail-row select { flex:1; padding:3px; }
.cs-tags { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
.cs-tag { background:var(--comfy-input-bg,#333); border-radius:8px; padding:1px 8px; font-size:10px; }
.cs-trigger { background:var(--comfy-input-bg,#333); border:1px solid var(--border-color,#444); border-radius:4px; padding:2px 7px; font-size:11px; cursor:pointer; }
.cs-trigger:hover { border-color:var(--accent-color,#4a90e2); }
.cs-section { margin:8px 0; }
.cs-section-title { font-weight:600; font-size:12px; margin-bottom:4px; display:flex; align-items:center; gap:8px; }
.cs-files { display:flex; flex-direction:column; gap:6px; }
.cs-file { display:flex; align-items:center; gap:8px; background:var(--comfy-box-bg, rgba(0,0,0,.2)); padding:6px 8px; border-radius:6px; }
.cs-file-info { flex:1; min-width:0; }
.cs-file-name { font-size:12px; word-break:break-all; }
.cs-file-meta { font-size:10px; color:var(--desc-text-color,#999); }
.cs-gallery { display:grid; grid-template-columns:repeat(auto-fill, minmax(105px, 1fr)); gap:6px; }
.cs-gallery-item { position:relative; }
.cs-gallery-item img, .cs-gallery-item video { width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:4px; cursor:pointer; border:2px solid transparent; display:block; }
.cs-gallery-item img:hover { border-color:var(--accent-color,#4a90e2); }
.cs-save-btn { position:absolute; right:4px; bottom:4px; z-index:2; background:rgba(0,0,0,.65); color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px; padding:1px 5px; }
.cs-save-btn:hover { background:var(--accent-color,#4a90e2); }
.cs-gallery-item img:hover { border-color:var(--accent-color,#4a90e2); }
.cs-desc { margin:8px 0; }
.cs-desc summary { cursor:pointer; font-weight:600; font-size:12px; }
.cs-desc-body { font-size:12px; background:rgba(0,0,0,.2); border-radius:6px; padding:8px; margin-top:4px; overflow-wrap:break-word; }
.cs-desc-body img { max-width:100%; height:auto; }
.cs-kv-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin:8px 0; font-size:12px; }
.cs-kv-grid b { color:var(--desc-text-color,#999); display:block; font-size:10px; }
.cs-meta-block { margin:10px 0; }
.cs-meta-block textarea { width:100%; background:var(--comfy-input-bg,#333); color:var(--input-text-color,#ddd); border:1px solid var(--border-color,#444); border-radius:4px; padding:6px; font-size:12px; }
.cs-chips { display:flex; flex-wrap:wrap; gap:4px; padding:0 8px 6px; flex-shrink:0; }
.cs-chip { background:var(--comfy-input-bg,#333); border:1px solid var(--border-color,#444); color:var(--fg-color,#eee); border-radius:10px; padding:2px 10px; font-size:11px; cursor:pointer; }
.cs-chip.active { background:var(--accent-color,#4a90e2); color:#fff; border-color:var(--accent-color,#4a90e2); }
.cs-local-row { display:flex; gap:8px; background:var(--comfy-box-bg, var(--comfy-input-bg,#333)); border:1px solid transparent; border-radius:6px; padding:8px; margin-bottom:6px; align-items:flex-start; }
.cs-local-row:hover { border-color:var(--border-color,#444); }
.cs-local-main { flex:1; min-width:0; }
.cs-local-name { font-weight:600; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-local-sub { display:flex; gap:4px; align-items:center; flex-wrap:wrap; margin:3px 0; }
.cs-local-path { font-size:10px; color:var(--desc-text-color,#999); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-local-actions { display:flex; flex-wrap:wrap; gap:4px; flex-shrink:0; justify-content:flex-end; max-width:230px; }
.cs-expand { margin:-2px 0 8px; background:var(--comfy-box-bg, var(--comfy-input-bg,#333)); border:1px solid var(--border-color,#444); border-radius:6px; padding:8px; }
.cs-expand-body { display:flex; gap:10px; }
.cs-expand-cover { width:110px; aspect-ratio:3/4; object-fit:cover; border-radius:6px; flex-shrink:0; align-self:flex-start; }
.cs-expand-main { flex:1; min-width:0; }
.cs-expand-desc { font-size:12px; background:rgba(0,0,0,.2); border-radius:6px; padding:8px; margin-top:6px; overflow-wrap:break-word; }
.cs-expand-desc.cs-clamped { max-height:180px; overflow:hidden; }
.cs-expand-desc img { max-width:100%; height:auto; }
.cs-expand-actions { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
.cs-expand-loading { padding:10px; color:var(--desc-text-color,#999); font-size:12px; text-align:center; }
.cs-copyable { cursor:pointer; }
.cs-copyable:hover { color:var(--accent-color,#4a90e2); }
.cs-search-row { display:flex; gap:6px; }
.cs-search-row input { flex:1; min-width:0; }
.cs-as-results { max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; }
.cs-as-item { display:flex; padding:6px 8px; border:1px solid var(--border-color,#444); border-radius:6px; cursor:pointer; }
.cs-as-item:hover { border-color:var(--accent-color,#4a90e2); }
.cs-as-item.selected { border-color:var(--accent-color,#4a90e2); background:rgba(74,144,226,.15); }
.cs-as-item-main { flex:1; min-width:0; }
.cs-as-item-name { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-as-version-row { display:flex; gap:8px; align-items:center; }
.cs-as-thumb { width:36px; height:48px; object-fit:cover; border-radius:4px; flex-shrink:0; border:1px solid var(--border-color,#444); }
.cs-local-detail .cs-expand-body { flex-direction:column; }
.cs-local-detail .cs-expand-cover { width:100%; }
.cs-local-row-active { border-color:var(--accent-color,#4a90e2) !important; }
.cs-local-update { font-size:11px; margin-top:4px; color:#e2a23f; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.cs-local-update.cs-ok { color:#4caf50; }
.cs-gal-grid { display:flex; flex-wrap:wrap; gap:6px; padding-bottom:20px; align-content:flex-start; }
.cs-gal-item { position:relative; border-radius:6px; overflow:hidden; background:#222; box-sizing:border-box; }
.cs-gal-item img, .cs-gal-item video { width:100%; height:100%; object-fit:cover; display:block; cursor:pointer; }
.cs-gal-item img:hover, .cs-gal-item video:hover { outline:2px solid var(--accent-color,#4a90e2); }
.cs-dim { color:var(--desc-text-color,#999); font-size:11px; }
.cs-dl-row { background:var(--comfy-box-bg, var(--comfy-input-bg,#333)); border-radius:6px; padding:8px; margin-bottom:6px; display:flex; gap:8px; align-items:center; }
.cs-dl-info { flex:1; min-width:0; }
.cs-dl-name { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-dl-bar { height:6px; background:rgba(0,0,0,.3); border-radius:3px; margin:5px 0; overflow:hidden; }
.cs-dl-fill { height:100%; background:var(--accent-color,#4a90e2); border-radius:3px; transition:width .4s; }
.cs-dl-fill.done { background:#4caf50; }
.cs-dl-fill.error { background:#e2543f; }
.cs-dl-sub { display:flex; justify-content:space-between; gap:6px; font-size:11px; }
.cs-status-done { color:#4caf50; } .cs-status-error { color:#e2543f; } .cs-status-cancelled { color:var(--desc-text-color,#999); }
.cs-modal-title { margin:0 0 10px; font-size:15px; }
.cs-modal-msg { font-size:12px; color:var(--desc-text-color,#999); white-space:pre-line; }
.cs-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
.cs-form { display:flex; flex-direction:column; gap:10px; }
.cs-form label { display:flex; flex-direction:column; gap:4px; font-size:12px; }
.cs-form input[type=text], .cs-form input[type=password], .cs-form input[type=number], .cs-form select { background:var(--comfy-input-bg,#333); color:var(--input-text-color,#ddd); border:1px solid var(--border-color,#444); border-radius:5px; padding:6px; font-size:12px; }
.cs-check { flex-direction:row !important; align-items:center; gap:6px !important; }
.cs-form-hint { font-size:11px; color:var(--desc-text-color,#999); opacity:.8; }
.cs-dl-hint { background:rgba(0,0,0,.2); border-radius:6px; padding:6px 8px; }
.cs-float { position:fixed; width:460px; max-width:calc(100vw - 20px); max-height:calc(100vh - 24px); background:var(--comfy-menu-bg,#2a2a2a); border:1px solid var(--border-color,#444); border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.55); z-index:60000; display:flex; flex-direction:column; overflow:hidden; }
.cs-float-head { display:flex; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border-color,#444); cursor:move; user-select:none; }
.cs-float-title { flex:1; min-width:0; font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-float-close { background:transparent; border:none; color:var(--fg-color,#eee); font-size:14px; cursor:pointer; padding:0 2px; }
.cs-float-close:hover { color:#e2543f; }
.cs-float-body { overflow-y:auto; padding:10px 12px; }
.cs-float .cs-detail-row select { width:100%; }
.cs-float-modal { width:480px; }
.cs-float-modal .cs-float-body { max-height:calc(100vh - 120px); }
@keyframes cs-rotate { to { transform: rotate(360deg); } }
.cs-spin { width:14px; height:14px; border:2px solid #555; border-top-color:var(--accent-color,#4a90e2); border-radius:50%; animation:cs-rotate .8s linear infinite; display:inline-block; flex:0 0 auto; }
.cs-gal-filters { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
.cs-gal-filters > * { width:100%; min-width:0; }
.cs-media-view img, .cs-media-view video { max-width:100%; max-height:64vh; border-radius:8px; display:block; margin:0 auto; background:rgba(0,0,0,.35); }
.cs-thumb video { pointer-events:none; }
`;
    document.head.appendChild(style);
}

// ---------- 节点内缩略图(画布上的三个 Civitai 节点) ----------
// 新版 ComfyUI 前端不再调用 onDrawBackground,节点内图全部走 DOM widget
function nodeThumbsResize(node) {
    // 新前端 computeSize 对 DOM widget 一律按默认 20 高累计,节点高度必算错
    // (下方 widget 被裁在节点矩形外、无法点选)。用节点容器布局像素的同单位
    // 溢出量(scrollHeight-clientHeight)换算增量贴合内容,带迟滞防震荡
    try {
        const root = node.csStrip?.closest(".lg-node");
        if (!root) return;
        const client = root.clientHeight; // 布局像素,不受画布缩放影响
        if (client < 40 || node.size[1] < 40) return;
        const m = client / node.size[1]; // 画布单位 → CSS 像素 的线性映射
        if (m <= 0.2) return;
        const overflow = root.scrollHeight - client; // >0:内容被裁;=0:贴合
        if (overflow > 4) node.setSize([node.size[0], node.size[1] + overflow / m]);
        else if (overflow < -30) node.setSize([node.size[0], Math.max(180, node.size[1] + overflow / m)]);
    } catch (e) { /* 旧版接口缺失时忽略 */ }
}

function isVideoItem(item) {
    return (item.type || "") === "video" || /\.mp4($|\?)/.test(item.url || "");
}

// Civitai CDN 缩放变体:把 original=true 段换成 width=N,体积可降两个数量级
function cdnThumb(url, w = 256) {
    if (!url) return "";
    return url.replace("/original=true/", `/width=${w}/`);
}

// 缺失生成参数的三色感叹号(prompt红/lora黄/model绿),纵列在缩略图右上角;节点条与画廊共用
function appendMissingMarks(cell, rawMeta) {
    let meta = rawMeta || {};
    if (meta && !meta.prompt && meta.meta) meta = meta.meta; // 剥掉 imageId 精确查询的包裹层
    const miss = [];
    if (!meta.prompt) miss.push("#e2836b");
    if (!(meta.resources || []).some((r) => (r.type || "lora").toLowerCase() === "lora")) miss.push("#e2b96b");
    if (!(meta["Model hash"] || meta["Model"])) miss.push("#8fd4a0");
    if (!miss.length) return;
    const b = document.createElement("div");
    b.style.cssText = "position:absolute;top:3px;right:3px;display:flex;flex-direction:column;gap:2px;z-index:2;";
    for (const color of miss) {
        const dot = document.createElement("div");
        dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:rgba(0,0,0,.55);`
            + `color:${color};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;`
            + `border:1px solid ${color}66;`;
        dot.textContent = "!";
        b.appendChild(dot);
    }
    b.title = S.lang === "zh" ? "缺少生成参数(红:提示词 黄:Lora 绿:底模)" : "Missing (red: prompt, yellow: lora, green: model)";
    cell.appendChild(b);
}

// 视频条目中央的半透明播放三角标;节点条与画廊共用
function appendPlayBadge(cell) {
    const p = document.createElement("div");
    p.className = "cs-play";
    cell.appendChild(p);
}

// 顶部信息面板:左侧已选缩略图(点击放大)+ 右侧五行(ID/Pos/Neg/Lora/Model);
// image_id widget 紧跟本面板下方(INPUT_TYPES 首位),此处只负责展示
function renderSelInfo(node) {
    const el = node?.csInfo;
    if (!el) return;
    const idw = (node.widgets || []).find((w) => w.name === "image_id");
    const wanted = String(idw?.value || "").trim();
    let sel = /^\d+$/.test(wanted)
        ? (node.csResults || []).find((it) => String(it.id) === wanted) || null
        : null;
    if (!sel) {
        el.innerHTML = `<span style="color:#888;font-size:11px;">${esc(t("noSelectionHint"))}</span>`;
        nodeThumbsResize(node); // 面板高度变了,同步节点尺寸防下方 widget 被裁
        return;
    }
    let meta = sel.meta || {};
    if (meta && !meta.prompt && meta.meta) meta = meta.meta; // imageId 精确查询的包裹层
    const loras = (meta.resources || [])
        .filter((r) => (r.type || "lora").toLowerCase() === "lora")
        .map((r) => `${r.name || "?"}×${r.weight ?? 1}`).join(", ");
    // 注意:row 内部把 text 参数遮蔽进局部变量 t,翻译函数在此预取,不能在 row 内再调 t()
    const copiedTxt = t("copied"), copyFailTxt = t("copyFail");
    const row = (label, text, color, bold) => {
        const t = text ? String(text) : "-";
        const d = document.createElement("div");
        d.style.cssText = "display:flex;gap:4px;min-width:0;cursor:pointer;" + (bold ? "font-weight:700;" : "");
        d.title = S.lang === "zh" ? "点击复制全文" : "Click to copy";
        // 不走 copyText(btn):它会用 textContent 覆盖整行,毁掉 label 颜色/间距与 title;
        // 这里自管反馈:复制后临时换成"✓ 已复制"(失败红叉),到点原样恢复 innerHTML 与 title。
        // copyTextSafe 的 400ms 兜底保证 clipboard API 挂起时反馈也一定出现
        d.onclick = () => {
            const html = d.innerHTML, tip = d.title;
            copyTextSafe(t, (ok) => {
                d.innerHTML = ok
                    ? `<span style="color:#4caf50;flex:0 0 auto;">✓</span>`
                      + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(copiedTxt)}</span>`
                    : `<span style="color:#e2836b;flex:0 0 auto;">✕</span>`
                      + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(copyFailTxt)}</span>`;
                d.title = ok ? copiedTxt : copyFailTxt;
                setTimeout(() => { d.innerHTML = html; d.title = tip; }, 1200);
            });
        };
        d.innerHTML = `<span style="color:${color};flex:0 0 auto;">${esc(label)}</span>`
            + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.length > 120 ? t.slice(0, 120) + "…" : t)}</span>`;
        return d;
    };
    el.innerHTML = "";
    // 左:缩略图,点击进统一大图详情(可保存/选为输出)
    const pic = document.createElement("div");
    pic.style.cssText = "flex:0 0 64px;height:86px;background:#2e2e33;border-radius:4px;overflow:hidden;cursor:pointer;";
    pic.title = S.lang === "zh" ? "点击放大" : "Click to enlarge";
    const im = document.createElement("img");
    im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    im.src = imgSrc(cdnThumb(sel.url));
    im.onerror = () => { pic.textContent = "!"; };
    pic.appendChild(im);
    pic.onclick = () => openImageDetail(sel, { node });
    el.appendChild(pic);
    // 右:五行信息表(ID 加粗置顶)
    const lines = document.createElement("div");
    lines.style.cssText = "flex:1;min-width:0;font-size:11px;line-height:1.45;overflow:hidden;color:#ccc;"
        + "display:flex;flex-direction:column;justify-content:space-between;height:86px;";
    lines.appendChild(row("Image ID", sel.id, "#fff", true));
    lines.appendChild(row("Pos", meta.prompt, "#e2836b"));
    lines.appendChild(row("Neg", meta.negativePrompt, "#6ba1e2"));
    lines.appendChild(row("Lora", loras, "#e2b96b"));
    lines.appendChild(row("Model", sel.baseModel, "#8fd4a0"));
    el.appendChild(lines);
    nodeThumbsResize(node); // 面板高度变了,同步节点尺寸防下方 widget 被裁
}

// 大图悬浮层附加:ID 独立一行 + 分类标签独立一行(flex-wrap,防挤压重叠);
// 异步抓取网页端分类 tag,点击标签复制其 ID。画廊与节点大图悬浮层共用
function attachIdAndTags(box, image) {
    const id = String(image.id ?? "");
    if (!id) return;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin:8px 0;";
    const idRow = document.createElement("div");
    idRow.className = "cs-form-hint";
    idRow.innerHTML = `${esc(S.lang === "zh" ? "ID(点击复制):" : "ID (click to copy):")} `
        + `<span class="cs-trigger" style="cursor:pointer" data-copy-id="${esc(id)}">${esc(id)}</span>`;
    const tagRow = document.createElement("div");
    tagRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;"
        + "margin-top:6px;font-size:11px;color:var(--desc-text-color,#999);opacity:.8;";
    tagRow.innerHTML = `<span style="flex:0 0 auto">${esc(t("tagsLoading"))}</span>`;
    wrap.appendChild(idRow);
    wrap.appendChild(tagRow);
    const anchor = box.querySelector(".cs-kv-grid") || box.querySelector(".cs-modal-actions");
    box.insertBefore(wrap, anchor);
    $("[data-copy-id]", idRow).onclick = (ev) => copyText(id, ev.target);
    if (S.cfg.tag_scrape === false) {
        tagRow.firstElementChild.textContent = t("tagsOff");
        return;
    }
    apiGet(`/civitai_studio/image_tags/${encodeURIComponent(id)}`).then((d) => {
        if (!tagRow.isConnected) return;
        if (d.paused) { tagRow.firstElementChild.textContent = t("tagsPaused", { sec: d.retryAfterSec }); return; }
        const tags = d.tags || [];
        if (!tags.length) { tagRow.firstElementChild.textContent = t("noTags"); return; }
        tagRow.innerHTML = `<span style="flex:0 0 auto;color:#999">${esc(S.lang === "zh" ? "标签(点击复制 ID):" : "Tags (click to copy ID):")}</span>`
            + tags.map((tg) => `<span class="cs-trigger" style="cursor:pointer;white-space:nowrap" data-tagid="${esc(String(tg.id))}" title="ID ${esc(String(tg.id))}">#${esc(tg.name)}</span>`).join("");
        $$("[data-tagid]", tagRow).forEach((el) => { el.onclick = (ev) => copyText(el.dataset.tagid, ev.target); });
        refreshTagCombos(); // 新标签入库,刷新图像搜索节点的 tag 下拉选项
    }).catch(() => { if (tagRow.isConnected) tagRow.style.display = "none"; });
}

// 把本地标签映射刷进所有图像搜索节点的 tag combo 选项((none) 首项 + 名称排序)
function refreshTagCombos() {
    apiGet("/civitai_studio/tag_mapping").then((d) => {
        const names = (d.tags || []).map((t) => t.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        S.tagMap = {};
        (d.tags || []).forEach((t) => { S.tagMap[t.name] = t.id; });
        (app.graph?._nodes || []).forEach((n) => {
            if (n.type !== "CivitaiImageSearch") return;
            const tw = (n.widgets || []).find((w) => w.name === "tag");
            if (!tw || !tw.options) return;
            const cur = tw.value;
            tw.options.values = ["(none)"].concat(names);
            if (cur && !tw.options.values.includes(cur)) tw.options.values.unshift(cur);
        });
    }).catch(() => {});
}

// 悬浮层大图/播放器(图片与视频通用)
function mediaViewerHtml(item) {
    const src = esc(item.url || "");
    if (isVideoItem(item)) {
        return `<video src="${esc(imgSrc(item.url || ""))}" controls autoplay loop muted playsinline`
            + ` style="max-width:100%;max-height:64vh;border-radius:8px;display:block;margin:0 auto;background:#000"></video>`;
    }
    return `<img src="${esc(imgSrc(item.url || ""))}" data-direct="${src}"`
        + ` style="max-width:100%;max-height:64vh;border-radius:8px;display:block;margin:0 auto"`
        + ` onerror="this.style.display='none'"/>`;
}

function renderNodeThumbs(node) {
    const strip = node.csStrip;
    if (!strip) return;
    const keepScroll = strip.scrollTop; // 重建后保持滚动位置(加载更多不跳顶)
    const wv = (name) => { const w = (node.widgets || []).find((x) => x.name === name); return w ? w.value : undefined; };
    // thumbs_size 映射为"目标行高":两端对齐行排版按宽高比成行,行内等高铺满整行宽
    const rowH = { small: 128, medium: 256, large: 512 }[String(wv("thumbs_size") || "medium")] || 256;
    const panelH = Math.max(160, parseInt(wv("panel_h"), 10) || 420);
    strip.style.maxHeight = panelH + "px";
    strip.querySelectorAll(".cs-thumb,.cs-thumb-msg,.cs-thumb-bar,.cs-thumb-more,.cs-selinfo")
        .forEach((el) => el.remove());
    const st = node.csFetch || {};
    const total = (node.csResults || []).length;
    const idw = (node.widgets || []).find((w) => w.name === "image_id");
    renderSelInfo(node); // 顶部信息面板(独立 widget,随选择刷新)

    // 状态条:提示 + 计数 + spinner
    const bar = document.createElement("div");
    bar.className = "cs-thumb-bar";
    bar.style.cssText = "width:100%;display:flex;align-items:center;gap:8px;font-size:11px;color:#999;";
    bar.innerHTML = `<span>${esc(S.lang === "zh"
        ? "点击放大/选择 · tag 仅数字 ID · "
        : "Click to enlarge / select · tag = numeric IDs · ")}${total}</span>`;
    if (st.loading) {
        const sp = document.createElement("span");
        sp.className = "cs-spin";
        const lt = document.createElement("span");
        lt.textContent = t("statusLoading");
        bar.appendChild(sp);
        bar.appendChild(lt);
    }
    strip.appendChild(bar);

    const items = (node.csResults || []).slice(0, 100);
    if (!items.length && !st.loading) {
        const msg = document.createElement("div");
        msg.className = "cs-thumb-msg";
        msg.style.cssText = "width:100%;font-size:11px;color:#999;";
        msg.textContent = node.csMsg || (S.lang === "zh" ? "没有结果" : "No results");
        strip.appendChild(msg);
    }
    // 两端对齐行排版(相册式):按宽高比贪心成行,行内等高、铺满整行宽;
    // 末行不拉伸保持目标行高。横竖图混排不再出现固定列裁切/大块留白
    const gap = 6;
    const W = Math.max(160, (strip.clientWidth || node.size[0] - 16) - 8); // 减去 strip 自身 padding
    const rows = [];
    let row = [], rowAr = 0;
    for (const it of items) {
        const ar = it.width && it.height ? it.width / it.height : 0.75; // 缺尺寸按 3:4 竖图处理
        row.push({ it, ar });
        rowAr += ar;
        if (rowAr * rowH + (row.length - 1) * gap >= W) { rows.push(row); row = []; rowAr = 0; }
    }
    if (row.length) rows.push(row);
    rows.forEach((r, ri) => {
        const arSum = r.reduce((s, c) => s + c.ar, 0);
        const avail = W - (r.length - 1) * gap;
        let h = avail / arSum;
        if (ri === rows.length - 1 && h > rowH * 1.15) h = rowH; // 末行不过度放大
        h = Math.min(h, rowH * 1.6); // 独行超宽横图的行高上限
        if (arSum * h > avail) h *= avail / (arSum * h); // 舍入超宽回调
        for (const c of r) {
            const cell = document.createElement("div");
            cell.className = "cs-thumb";
            cell.style.cssText = `position:relative;flex:0 0 ${(c.ar * h).toFixed(1)}px;width:${(c.ar * h).toFixed(1)}px;`
                + `height:${h.toFixed(1)}px;box-sizing:border-box;background:#2e2e33;border:2px solid #555;`
                + "border-radius:4px;overflow:hidden;cursor:pointer;";
            if (isVideoItem(c.it)) {
                // 静音取首帧作缩略图
                const v = document.createElement("video");
                v.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
                v.muted = true;
                v.loop = true;
                v.playsInline = true;
                v.preload = "metadata";
                v.src = imgSrc(c.it.url || "") + "#t=0.001";
                cell.appendChild(v);
                appendPlayBadge(cell);
            } else {
                const im = document.createElement("img");
                im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
                const thumb = cdnThumb(c.it.url || "");
                im.onerror = () => { if (!im.dataset.retried) { im.dataset.retried = "1"; im.src = altSrc(thumb); } };
                im.src = imgSrc(thumb);
                cell.appendChild(im);
            }
            if (idw?.value && String(idw.value) === String(c.it.id)) cell.style.borderColor = "#4a90e2";
            appendMissingMarks(cell, c.it.meta);
            cell.onclick = () => showNodeImageFloat(node, c.it);
            strip.appendChild(cell);
        }
    });
    if (!st.loading && st.next && st.next.length) {
        if (items.length >= 100) {
            // 达到显示上限:提示而非继续追加
            const cap = document.createElement("div");
            cap.className = "cs-thumb-more cs-btn cs-btn-mini";
            cap.style.cssText = "width:100%;margin-top:2px;opacity:.7;cursor:default;";
            cap.textContent = t("capHint");
            strip.appendChild(cap);
        } else {
            const more = document.createElement("button");
            more.className = "cs-thumb-more cs-btn cs-btn-mini";
            more.style.cssText = "width:100%;margin-top:2px;";
            more.textContent = t("loadMore");
            more.onclick = () => node.csLoadMore?.();
            strip.appendChild(more);
        }
    }
    strip.scrollTop = keepScroll;
    nodeThumbsResize(node);
}

// 节点缩略图点击 → 统一大图详情浮层(与画廊共用;选为输出默认写入本节点)
function showNodeImageFloat(node, item) {
    openImageDetail(item, { node });
}

function fetchNodeThumbs(node, params, reset) {
    const st = node.csFetch || (node.csFetch = { next: [], loading: false });
    if (st.loading) { st.refetch = true; return; } // 在途:完成后按最新筛选补发
    if (!reset && !(st.next && st.next.length)) return;
    st.loading = true;
    const p = new URLSearchParams(params);
    if (!reset && st.next) for (const [k, v] of st.next) p.append(k, v);
    renderNodeThumbs(node);
    api.fetchApi(`/civitai_studio/images?${p.toString()}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
            const items = d.items || [];
            if (reset) node.csResults = items;
            else {
                const seen = new Set(node.csResults.map((x) => x.id));
                node.csResults = node.csResults.concat(items.filter((x) => !seen.has(x.id)));
            }
            st.next = d.next_query || [];
            st.loading = false;
            renderNodeThumbs(node);
            if (st.refetch) { st.refetch = false; fetchNodeThumbs(node, node.csLastParams, true); }
        })
        .catch(() => {
            st.loading = false;
            st.refetch = false; // 失败不残留补发标记
            node.csResults = node.csResults || [];
            node.csMsg = S.lang === "zh" ? "缩略图拉取失败" : "Failed to load thumbnails";
            renderNodeThumbs(node);
        });
}

app.registerExtension({
    name: "Civitai.Studio.Nodes",
    beforeRegisterNodeDef(nodeType, nodeData) {
        const type = nodeData.name;

        // 图片搜索节点:DOM widget 缩略图条,点击放大/选择
        if (type === "CivitaiImageSearch") {
            const origCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origCreated?.apply(this, arguments);
                this.csSig = "";
                this.csResults = [];
                const node = this;
                const widget = (name) => (node.widgets || []).find((x) => x.name === name);

                const strip = document.createElement("div");
                strip.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;padding:4px;width:100%;"
                    + "align-content:flex-start;max-height:340px;overflow-y:auto;"; // 初始值,之后随节点高度更新
                // 滚轮:挂到 window 捕获阶段(最早触发),命中面板时手动滚动并拦截,
                // 防止 ComfyUI 高层 handler 先行 preventDefault/缩放画布
                const wheelTarget = strip;
                const wheelGuard = (e) => {
                    if (!(e.target instanceof Node) || !wheelTarget.contains(e.target)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    wheelTarget.scrollTop += e.deltaY;
                };
                window.addEventListener("wheel", wheelGuard, { passive: false, capture: true });
                node.csWheelGuard = wheelGuard;
                node.csStrip = strip;
                const thumbsW = this.addDOMWidget("cs_thumbs", "cs_thumbs", strip);
                thumbsW.serialize = false; // DOM 面板不写入工作流,避免 widgets_values 错位
                if (this.size[0] < 460) this.size[0] = 460; // 保证默认 3 列以上
                // 信息面板独立 widget,移到 widgets 首位:渲染在标题/输出端正下方
                const infoEl = document.createElement("div");
                infoEl.style.cssText = "width:100%;display:flex;gap:8px;align-items:flex-start;"
                    + "background:rgba(255,255,255,.04);border:1px solid #3a3a40;border-radius:6px;padding:6px;";
                infoEl.textContent = t("noSelectionHint");
                node.csInfo = infoEl;
                const infoW2 = this.addDOMWidget("cs_info", "cs_info", infoEl);
                infoW2.serialize = false;
                const infoW = node.widgets.find((w2) => w2.name === "cs_info");
                if (infoW) {
                    node.widgets.splice(node.widgets.indexOf(infoW), 1);
                    node.widgets.unshift(infoW);
                }

                const sig = () => ["base_model", "tag", "sort", "period", "nsfw", "limit"]
                    .map((n) => widget(n)?.value ?? "").join("|");
                node.csSchedule = () => {
                    const s2 = sig();
                    if (s2 === node.csSig) return;
                    node.csSig = s2;
                    const p = new URLSearchParams({ limit: String(widget("limit")?.value || 50), nsfw: widget("nsfw")?.value || "false" });
                    const bm = widget("base_model")?.value;
                    const tag = widget("tag")?.value?.trim();
                    if (bm && bm !== "(any)") p.set("baseModels", bm);
                    if (tag && tag !== "(none)") {
                        // 官方 /images 的 tags 只认数字 ID:combo 选中的名称经本地映射换 ID,
                        // 数字 ID(或逗号分隔 ID 串)直接使用
                        const ids = tag.replace("，", ",").split(",").map((s) => s.trim())
                            .map((s) => (/^\d+$/.test(s) ? s : (S.tagMap && S.tagMap[s]) || null))
                            .filter(Boolean).join(",");
                        if (ids) p.set("tags", ids);
                    }
                    p.set("sort", widget("sort")?.value || "Newest");
                    p.set("period", widget("period")?.value || "AllTime");
                    node.csLastParams = p.toString();
                    fetchNodeThumbs(node, p.toString(), true);
                };
                node.csLoadMore = () => { if (node.csLastParams) fetchNodeThumbs(node, node.csLastParams, false); };
                // 筛选变化 → 节流拉缩略图;index 变化 → 刷新选中框
                node.csDeb = null;
                const debounced = () => {
                    clearTimeout(node.csDeb);
                    node.csDeb = setTimeout(() => node.csSchedule?.(), 600);
                };
                (node.widgets || []).forEach((wd) => {
                    if (!["base_model", "tag", "sort", "period", "nsfw", "limit", "index"].includes(wd.name)) return;
                    const oc = wd.callback;
                    wd.callback = function () {
                        const r2 = oc?.apply(this, arguments);
                        if (wd.name === "index") { renderNodeThumbs(node); return r2; }
                        debounced();
                        return r2;
                    };
                    // 新前端对文本输入框可能不触发 widget.callback:直接监听 DOM 输入
                    if (wd.name === "tag" && wd.inputEl) {
                        wd.inputEl.addEventListener("input", debounced);
                    }
                });
                setTimeout(() => node.csSchedule?.(), 200); // 首次拉取
                setTimeout(() => refreshTagCombos(), 600); // 首次拉取本地标签填充 tag 下拉
                // 兜底轮询:部分文本输入在新前端不触发 widget.callback/inputEl 事件,
                // 轮询 sig 变化保证 tag 等改动最终一定触发刷新(csSchedule 内部去重)
                node.csPoll = setInterval(() => {
                    node.csSchedule?.();
                    // image_id 手动粘贴/修改也要刷新信息面板(文本输入不触发事件)
                    const cur = widget("image_id")?.value || "";
                    if (cur !== node.csLastId) { node.csLastId = cur; renderSelInfo(node); }
                    // image_id widget 行加粗+强调色:画布与右侧参数面板都扫(行元素渲染后才存在,
                    // dataset 标记防重复设置;命中一次即止的单次标记会漏掉后渲染的面板)
                    for (const rowEl of document.querySelectorAll(".lg-node-widget")) {
                        if (rowEl.dataset.csBold) continue;
                        if ((rowEl.textContent || "").trim().startsWith("image_id")) {
                            rowEl.style.fontWeight = "700";
                            rowEl.style.color = "var(--accent-color,#4a90e2)";
                            rowEl.dataset.csBold = "1";
                        }
                    }
                    // 面板布局参数或节点宽度变化 → 只重排版不重新拉取
                    const ss = node.size[0] + "|" + String(widget("thumbs_size")?.value || "medium") + "|" + String(widget("panel_h")?.value || "");
                    if (ss !== node.csLastSizeSig) { node.csLastSizeSig = ss; renderNodeThumbs(node); }
                    // 轮询兜底:内容变化后节点高度没跟上时重新贴合(只精确贴合,
                    // 修复矮节点里 image_id 等 widget 被裁在节点外无法点选)
                    nodeThumbsResize(node);
                }, 700);
                // 节点删除时清理定时器与全局 wheel 监听,避免僵尸轮询/监听泄漏
                const origOnRemoved = this.onRemoved;
                this.onRemoved = function () {
                    clearInterval(node.csPoll);
                    if (node.csWheelGuard) window.removeEventListener("wheel", node.csWheelGuard, { capture: true });
                    origOnRemoved?.apply(this, arguments);
                };
                return r;
            };
            // 旧版工作流兼容:widgets_values 还是旧顺序([base_model,…,image_id,(lora_name),thumbs,panel])
            // 时重排为新顺序([image_id,base_model,…,index,thumbs,panel]),防止值错位。
            // 挂在 prototype 上只包一次(不能放 onNodeCreated,否则每建一个实例嵌套一层)
            const origConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                try {
                    const v = this.widgets_values;
                    // 仅当本节点已是新形状(10 个可序列化 widget)才重排旧值;
                    // 服务端未重启时节点还是旧 11 widget,旧序值恰好对齐,不能动
                    const wl = (this.widgets || []).filter((w) => w.serialize !== false).length;
                    const isNumOrIdx = (x) => /^\d+$/.test(String(x)) || String(x) === "(index)";
                    if (Array.isArray(v) && wl === 10 && v.length === 11) {
                        // 11 值:含已移除的 lora_name(v[8]),丢弃
                        this.widgets_values = [v[7], v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[9], v[10]];
                    } else if (Array.isArray(v) && wl === 10 && v.length === 10 && !isNumOrIdx(v[0])) {
                        // 10 值且首位不是 image_id:更老的旧序
                        this.widgets_values = [v[7], v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[8], v[9]];
                    }
                } catch (e) { /* 非常规工作流不动 */ }
                return origConfigure?.apply(this, arguments);
            };
        }

        // 显示文本节点:执行完成后把收到的字符串渲染在节点内
        if (type === "CivitaiShowText") {
            const origCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origCreated?.apply(this, arguments);
                const el = document.createElement("div");
                el.style.cssText = "white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.4;"
                    + "max-height:220px;overflow-y:auto;padding:4px;color:#ddd;min-height:20px;";
                el.textContent = "(未执行)";
                const showW = this.addDOMWidget("cs_show", "cs_show", el);
                showW.serialize = false;
                const node = this;
                const onExecuted = ({ detail }) => {
                    if (String(detail?.node) !== String(node.id)) return;
                    const t = detail?.output?.text;
                    el.textContent = Array.isArray(t) ? t.join("\n") : String(t ?? "");
                };
                app.api.addEventListener("executed", onExecuted);
                const origOnRemoved = this.onRemoved;
                this.onRemoved = function () {
                    app.api.removeEventListener("executed", onExecuted);
                    origOnRemoved?.apply(this, arguments);
                };
                return r;
            };
        }

        // LoRA 配方节点:DOM widget 显示选中 LoRA 的封面
        if (type === "CivitaiLoraRecipe") {
            const origCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origCreated?.apply(this, arguments);
                const node = this;
                const box = document.createElement("div");
                box.style.cssText = "display:flex;justify-content:center;padding:4px;width:100%;";
                const imgEl = document.createElement("img");
                imgEl.style.cssText = "max-width:100%;max-height:190px;border-radius:6px;display:none;";
                imgEl.onerror = () => { imgEl.style.display = "none"; nodeThumbsResize(node); };
                imgEl.onload = () => nodeThumbsResize(node);
                box.appendChild(imgEl);
                node.csCoverEl = imgEl;
                const coverW = this.addDOMWidget("cs_cover", "cs_cover", box);
                coverW.serialize = false;

                const drawCover = () => {
                    const loraW = (node.widgets || []).find((x) => x.name === "lora");
                    const id = loraW?.value;
                    if (!id || id.includes("(")) { imgEl.style.display = "none"; nodeThumbsResize(node); return; }
                    api.fetchApi("/civitai_studio/local", { cache: "no-store" })
                        .then((r2) => r2.json())
                        .then((d) => {
                            const item = (d.models || []).find((m2) => m2.id === id);
                            const mid = item?.civitai?.model_id;
                            if (!mid) return;
                            return api.fetchApi(`/civitai_studio/model/${mid}`, { cache: "no-store" }).then((r3) => r3.json());
                        })
                        .then((m) => {
                            if (!m) return;
                            const imgs = ((m.modelVersions || [])[0] || {}).images || [];
                            const first = imgs.find((i) => i.url && i.type === "image") || imgs.find((i) => i.url);
                            if (first?.url) {
                                imgEl.dataset.retried = "";
                                imgEl.style.display = "block";
                                imgEl.src = imgSrc(cdnThumb(first.url));
                            }
                        })
                        .catch(() => {});
                };
                setTimeout(drawCover, 300);
                (node.widgets || []).forEach((wd) => {
                    if (wd.name !== "lora") return;
                    const oc = wd.callback;
                    wd.callback = function () {
                        const r2 = oc?.apply(this, arguments);
                        setTimeout(drawCover, 100);
                        return r2;
                    };
                });
                return r;
            };
        }
    },
});

// ---------- 入口 ----------
app.registerExtension({
    name: "Civitai.Studio",
    async setup() {
        detectLang();
        injectStyles();
        if (!app.extensionManager?.registerSidebarTab) {
            console.error("[Civitai-Studio] " + t("frontendTooOld"));
            toast("error", t("loadFailedTitle"), t("frontendUpgradeHint"));
            return;
        }
        try {
            S.cfg = { ...S.cfg, ...(await apiGet("/civitai_studio/config")) };
            S.browse.nsfw = Number(S.cfg.nsfw ?? 1); // 恢复持久化的 NSFW 偏好
        } catch (e) {
            console.warn("[Civitai-Studio] 读取配置失败:", e);
        }
        // 前后端版本自检:服务端代码比前端旧 = 重启前的内存态,直接横幅提示
        try {
            const v = await apiGet("/civitai_studio/version");
            const num = (s) => String(s ?? "").split(".").map((x) => parseInt(x, 10) || 0);
            const [a, b] = [num(v.version), num(JS_VERSION)];
            const newer = (x, y) => {
                for (let i = 0; i < Math.max(x.length, y.length); i++) {
                    const xi = x[i] || 0, yi = y[i] || 0;
                    if (xi !== yi) return xi > yi;
                }
                return false;
            };
            if (newer(b, a)) {
                S.ui.backendStale = true;
                toast("warning", t("backendOutdatedTitle"), t("backendOutdatedMsg", { server: v.version, client: JS_VERSION }));
            } else if (newer(a, b)) {
                // 反向:服务端比前端新 = 页面还在跑缓存的旧 JS(用户反复踩的坑)
                toast("warning", t("frontendOutdatedTitle"), t("frontendOutdatedMsg", { server: v.version, client: JS_VERSION }));
            }
        } catch (e) {
            // /version 不存在 = 服务端更旧(无此路由),同样视为过旧
            S.ui.backendStale = true;
        }
        app.extensionManager.registerSidebarTab({
            id: "civitai.studio",
            title: "Civitai",
            icon: "pi pi-images",
            tooltip: "Civitai Studio",
            render(el) {
                detectLang(); // 跟随 ComfyUI 语言设置(切语言后重开面板生效)
                buildRoot(el);
                if (S.browse.dirty) {
                    fetchBrowse(true);
                } else {
                    renderResults(true);
                    restoreBrowseState();
                }
                pollDownloads();
            },
        });
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollDownloads, 2000);
        // 点击画布/页面其他区域时关闭悬浮元素(单实例规则:点空白即全关)
        document.addEventListener("pointerdown", (e) => {
            if (e.target.closest(".cs-float") || e.target.closest(".cs-root") || e.target.closest(".cs-modal")) return;
            closeAllFloats();
        }, true);
        console.log("[Civitai-Studio] " + t("readyLog"));
    },
});
