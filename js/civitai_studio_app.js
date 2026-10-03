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
// 画廊快捷栏(E2E 6):images API 无 Highest Rated,高分用 Most Collected 近似
const GAL_PRESETS = [
    ["new-day", "Day", "Newest"],
    ["hot-day", "Day", "Most Reactions"],
    ["hot-week", "Week", "Most Reactions"],
    ["best-week", "Week", "Most Collected"],
    ["hot-month", "Month", "Most Reactions"],
    ["best-month", "Month", "Most Collected"],
];
// 文件格式推导(E2E 7/e):jpg 提示无内嵌工作流;视频看 url 扩展名
function fmtOf(it) {
    const u = String((it && it.url) || "");
    if (isVideoItem(it) || /\.(mp4|webm|mov)$/i.test(u)) return "video";
    const m = u.match(/\.(jpe?g|png|webp|gif)$/i);
    if (!m) return "";
    return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
}

function fmtBadgeHtml(it) {
    const f = fmtOf(it);
    if (!f) return "";
    let label = f.toUpperCase();
    if (f === "video") {
        const vm = String(it.url || "").match(/\.(mp4|webm|mov)$/i);
        label = vm ? vm[1].toUpperCase() : "MP4"; // 扩展名可辨时如实显示(审计二 F-5)
    }
    return `<span class="cs-fmt">${label}</span>`;
}

// 媒体类型筛选(批11.5):不再按具体文件格式(jpg/png/mp4…),只分 图像/视频——
// 服务端 /images?type= 过滤(分页口径正确);客户端仍按 isVideoItem 兜底过滤混装条目
function fmtSelHtml(cur) {
    return [["all", t("mtAll")], ["image", t("fmtImage")], ["video", t("fmtVideo")]].map(([f, lb]) =>
        `<option value="${f}" ${(cur || "all") === f ? "selected" : ""}>${esc(lb)}</option>`).join("");
}

// 模型页卡片尺寸档(批11.5):[卡宽, 封面最长边(=宽130%)];含更小档供密集浏览
const BROWSE_CARD_SIZES = [[110, 143], [150, 195], [200, 260], [260, 338]];
const JS_VERSION = "0.8.0";

// ---------- i18n ----------
const STR = {
    zh: {
        tabBrowse: "🌐 模型", tabLocal: "📁 本地库", tabDownloads: "⬇ 下载", settings: "设置",
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
        tagClickable: "点击:复制 / 搜索",
        baseFilterHint: "未选底模(下拉多选,任一命中)", tagFilterHint: "未选标签(下拉多选)",
        modeOR: "OR(任一)", modeAND: "AND(全部·实验)",
        hidePaidLabel: "隐藏需付费(未购)", hidePaidBought: "隐藏需付费(含已购)", showAllLabel: "含需付费",
        tagCapNote: "tag 一次最多搜 3 个,已取前 3 个",
        menuCopy: "复制", menuBrowseSearch: "在模型页搜索", menuGallerySearch: "在画廊搜索",
        resetFilters: "重置筛选",
        gmSystem: "系统集合(站方托管)",
        gmSystemTip: "成员由 Civitai ❤ 托管,不可在此删除;网站上取消 ❤ 即自动退出",
        nodePrev: "上一页", nodeNext: "下一页", nodeRefresh: "刷新",
        blurTitle: "NSFW 模糊遮罩", blurTip: "勾选要打码的分级;悬停图片可临时查看。保存即时生效。",
        sortMostDownloaded: "最多下载", sortHighestRated: "最高评分", sortNewest: "最新发布",
        periodAllTime: "全部时间", periodMonth: "本月", periodWeek: "本周", periodDay: "今天",
        nsfw0: "隐藏 NSFW", nsfw1: "包含部分 NSFW", nsfw2: "包含全部 NSFW",
        statusLoading: "加载中…", statusLoaded: "已加载 {n} 个", statusMore: " — 向下滚动加载更多",
        retry: "重试", noModels: "没有找到模型,换个关键词试试。",
        loadFailed: "加载失败: ", detailLoadFailed: "详情加载失败: ",
        openOnCivitai: "在 Civitai 打开 ↗",
        by: "by", unknown: "未知", unknownCreator: "未知作者", versionLabel: "版本",
        installed: "已安装", installedMark: " ✔已装", modelDesc: "模型说明",
        verDescTitle: "关于这个版本", paidReq: "需付费", paidFree: "无需付费", paidActive: "已购授权",
        commercial: "商用:", none: "无", derivNo: "禁衍生", derivYes: "允许衍生", relic: "可换许可",
        nsfwLevelLabel: "NSFW:",
        triggerWords: "触发词", copyAll: "复制全部", files: "文件",
        noFiles: "该版本没有文件", previews: "预览图 ({n}) — 点击查看生成参数",
        genParams: "生成参数",
        positivePrompt: "正面提示词", negativePrompt: "负面提示词", copy: "复制",
        copied: "已复制", copyFail: "复制失败",
        kvSampler: "采样器", kvSteps: "步数", kvSize: "尺寸",
        download: "⬇ 下载", startDownload: "开始下载", submitting: "提交中…",
        dlDialogTitle: "下载 — {name}", fileLabel: "文件", targetFolder: "目标目录", modelTypeLabel: "模型类型(可改)",
        subfolder: "子文件夹(可选,自动创建)", subfolderPh: "例如: NSFW/角色",
        saveName: "保存文件名",
        dlHint: "下载完成后关联自动存入本地数据库{hash};说明/标签/封面可在设置开启导出为 .civitai.json",
        dlHintHash: "并校验 SHA256", cancel: "取消", ok: "确定", save: "保存",
        cantDownload: "无法下载", versionNotFound: "未找到该版本,请重新检查更新后再试",
        destFetchFailed: "获取目录失败: ", noRegFolders: "未找到已注册的模型文件夹",
        openDownloadFailed: "无法打开下载", queuedToast: "已加入下载队列",
        queueFailed: "下载任务创建失败",
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
        reAssociate: "重新关联", refreshMeta: "刷新元数据",
        refreshing: "刷新中…", metaRefreshed: "元数据已刷新", metaRefreshFailed: "刷新元数据失败",
        renameTitle: "重命名 — {name}", newFileName: "新文件名(含扩展名)",
        renameMsg: "仅重命名模型文件,数据库关联与 .civitai.json(如有)同步平移;工作流中引用的旧文件名将失效。",
        renamed: "已重命名", renameFailed: "重命名失败",
        assocTitle: "关联 Civitai 模型", searchByFile: "按文件名搜索(已自动预填,可修改)",
        searchBtn: "搜索", searching: "搜索中…", emptyQuery: "请输入搜索词,或直接粘贴页面链接 / 模型 ID",
        noResults: "没有找到,试试更短的关键词", searchFailed: "搜索失败: ",
        pasteRef: "或直接粘贴页面链接 / 模型 ID",
        pasteRefPh: "https://civitai.com/models/12345 或 12345",
        assocMsg: "点选搜索结果(或粘贴链接)后点「关联」,关联存入本地数据库;开启「导出 .civitai.json」后额外写盘。可用「网页确认 ↗」在 Civitai 核对。",
        webConfirm: "网页确认 ↗", versionLoading: "版本加载中…",
        pickFirst: "请先从搜索结果选择,或粘贴链接", associated: "已关联",
        assocFailed: "关联失败",
        updateCheckDone: "更新检查完成", updateCheckFailed: "更新检查失败",
        updatesFound: "发现可更新的模型 — ", checkedAB: "已检查 {a}/{b} 个(单次上限 30,可对单个模型点「查更新」)",
        checkedN: "已检查 {n} 个", failNote: ",{n} 个查询失败(多为模型已在站方删除)",
        fetchingNewVersion: "获取新版本失败",
        dlTabHint: "下载到 ComfyUI 模型目录,支持断点续传", clearFinished: "清除已完成",
        noJobs: "暂无下载任务。去「浏览」页面挑个模型吧。",
        pollFailBanner: "下载状态刷新失败(已连续多次),请检查 ComfyUI 后端;恢复后此提示会自动消失。",
        stQueued: "排队中…", stDownloading: "下载中 {pct}% {speed}", stVerifying: "校验 SHA256…",
        stDone: "完成 ✔", stCancelled: "已取消", stError: "失败: ",
        cancelBtn: "取消" + "", cancelFailed: "取消失败", clearFailed: "清除失败",
        retryResume: "重试(续传)", retryTip: "从已传输的字节处继续下载(.part 断点)", retryFailed: "重试失败",
        scopeLabel: "实例", scopeAll: "所有实例",
        favOnlyTitle: "只看收藏", favBtnTitle: "收藏", favFailed: "收藏失败",
        browseBtn: "浏览…", subdirPickTitle: "选择子文件夹", subdirRoot: "(目标目录根)", browseFailed: "打开失败",
        revealFile: "查看本地文件", toLocal: "本地库", moveBtn: "移动",
        moveTitle: "移动 — {name}", movedToast: "已移动", moveFailed: "移动失败",
        settingsTitle: "⚙ Civitai Studio 设置",
        setGrpAccount: "🔑 账户与连接", setGrpDownload: "⬇ 下载", setGrpSearch: "🖼 图片与搜索",
        setGrpStorage: "💾 存储与缓存", setGrpSync: "🔄 收藏同步",
        testKeyBtn: "测试连接", testKeying: "测试中…",
        probeOk: "Key 有效", probeNoSocial: "缺 Social→Write 权限，收藏上推不可用",
        probeSocialUnknown: "写权限探测未完成（网络波动？可重试）",
        probeNoKey: "未配置 API Key", probeInvalid: "Key 无效或已被吊销",
        probeTimeout: "连接超时（检查网络/代理）", probeFailUnknown: "测试失败",
        expBadge: "实验",
        keyLabel: "Civitai API Key（可选）",
        keyFunc: "功能：下载受限模型/提高下载限额/提取tag/同步收藏夹（需 Collections Write 和 Social Write 权限）",
        keyFuncEx: "额外功能: 同步收藏夹（需 Collections Write 和 Social Write 权限）",
        keySetPh: "已设置(尾号 {tail}),留空保持不变", keyPh: "粘贴 API Key",
        keyHowTo: "获取方式：登录 Civitai → 右上角头像 → Account Settings → Security & Apps → API Keys → Add API Key，勾选所需权限后 Save，把生成的 Key 粘贴到上面。",
        keyLink: "打开 Civitai 安全设置页 ↗",
        proxyLabel: "网络代理",
        proxyPh: "http://127.0.0.1:10808 或 socks5://127.0.0.1:10808,留空 = 直连",
        mirrorLabel: "API 站点", mirrorTip: "默认 civitai.com;直连不稳定时可切换镜像站",
        siteCustom: "自定义",
        concLabel: "下载并发数", concTip: "1-4;并发越高同时下载越多,过大易触发 Civitai 限速",
        cacheMaxLabel: "磁盘缓存上限 MB", cacheMaxTip: "50-2000;超出按最近最少使用(LRU)淘汰",
        cacheUsageFmt: "缓存占用:{mb} MB / 上限 {max} MB", cacheUsageLoading: "缓存占用:统计中…",
        clearCacheBtn: "清空缓存", deepScanBtn: "深度重扫",
        cacheCleared: "缓存已清空,索引已重建",
        deepScanDone: "重扫完成:共 {total} 项,复用 {reused},重读 {read},耗时 {dur}s",
        deepScanFailed: "深度重扫失败",
        favTabTitle: "收藏夹", favKindAsset: "资产", favKindModel: "模型",
        favTab: "★ 收藏", favSyncLine: "上次同步 {time} · 上推 {up} · 下拉 {down}",
        onboardTitle: "👋 三步开始", onboard1: "设置页填入 Civitai API Key（可选，解锁受限模型与收藏同步）",
        onboard2: "「浏览」搜索 / 「本地库」管理已装模型", onboard3: "画廊 ⬇ 存图、★ 收藏可双向同步 Civitai 账号",
        onboardGo: "去设置", onboardDismiss: "不再提示",
        favSyncBusy: "同步正在进行中…", syncFailShort: "同步失败",
        gmTitle: "管理收藏夹", gmDelete: "删除", gmRemoteDel: "同时删除 Civitai 端集合",
        gmConfirm: "确认删除分组「{name}」？{remote}此操作不可恢复。",
        gmRemoteNote: "将同时删除 Civitai 端集合「{name}」及其全部条目！",
        gmEmpty: "暂无分组", gmBound: "绑定集合 #{cid}", gmLocalOnly: "仅本地",
        gmDone: "分组「{name}」已删除{note}", resetTitle: "重置收藏同步",
        resetWarn: "将清空本地全部收藏数据（含 ★ 与分组，共 {n} 条）+ 同步缓存，下次同步从 Civitai 全量重新下拉。\n\n建议先点「导出」备份！确认重置？",
        resetDone: "收藏库已重置,点「同步 Civitai」重新下拉", resetBtn: "重置", manageBtn: "管理",
        newColPh: "新收藏夹名称", pickerNew: "＋ 新收藏", groupCreated: "收藏夹「{name}」已创建",
        ffoldTitle: "折叠/展开筛选区",
        favGroupAll: "全部分组", favGroupNone: "未分组",
        favSync: "同步 Civitai", favSyncing: "同步中…",
        favSyncDone: "同步完成:新增模型 +{models_down} · 新增图片 +{images_down} · 分组 +{groups_down} · 挂载 +{mounts} · 上推 {items_up} · 远端移除 {items_rm} · ★上推 {upsynced}(失败 {upsync_failed})",
        favSyncTrunc: "(集合较多,本次仅同步前一部分)",
        pushPending: "↑ 待上行", pushDone: "✓ 已上行", pushLocalOnly: "仅本地",
        groupPickTitle: "选择收藏夹(可多选)", groupPickNone: "不选 = 未分组",
        favImport: "导入", favExport: "导出", favImported: "已导入 {items} 条 / {groups} 个分组",
        favImportFailed: "导入失败", favEmpty: "还没有收藏 — 在画廊、节点缩略图或大图浮层里点 ★",
        favAutoSync: "收藏自动同步",
        favAutoSyncTip: "打开收藏夹时自动与 Civitai 同步,冲突按最新修改时间覆盖;模型上推需 key 勾选 Social Write",
        setGrpThumbs: "缩略图分辨率",
        pxCoverLabel: "模型卡片封面",
        pxCoverTip: "模型页卡片封面缩略档位。站方 CDN 按档取图(96/320/450/512,请求值向上取档)。默认 320px=清晰与流量的平衡点;96px 最省但卡面(约150-280px)会发糊。",
        pxMediaLabel: "轮播与详情展示图",
        pxMediaTip: "卡片悬停轮播与模型详情页展示图的缩略档位(同 96/320/450)。轮播占卡面(约150-280px),详情展示图约105-140px,默认 320px 两者兼顾;96px 仅适合纯省流量。",
        setGrpLogs: "日志",
        logTsLabel: "时间戳前缀",
        logTsTip: "日志行首附加 [年-月-日 时:分:秒]。默认关;保存即时生效。",
        logDebugLabel: "调试日志(DEBUG)",
        logDebugTip: "控制台输出全部出站请求与响应、同步逐条决策(等效 ComfyUI --verbose 但只对本插件生效)。保存即时生效,排障后建议关闭。",
        favRemoveTitle: "取消收藏", favSearchPh: "在收藏里搜索…",
        favSortTitle: "排序", favSortUpdated: "最近更新", favSortAdded: "最近收藏", favSortName: "按名称",
        importAsset: "导入为资产", importAssetDone: "已导入 input/civitai_import/{name}", importAssetExists: "已存在,跳过重复导入: {name}",
        importFailed: "导入失败",
        extractWf: "提取工作流", extractDone: "已存为工作流模板: {name}", extractNone: "该文件未内嵌 ComfyUI 工作流", extractFail: "提取失败",
        extractMgr: "提取管理", extractMgrTitle: "提取的工作流(civitai_studio/)", extractEmpty: "还没有提取过工作流",
        extractDelete: "删除", extractDeleted: "已删除", extractCapWarn: "提取文件已达 {n} 个,建议清理",
        pimgLabel: "预览图经ComfyUI服务端中转", pimgTip: "直连打不开图片时开启",
        hashLabel: "下载完成后校验 SHA256",
        pdescLabel: "导出 .civitai.json 伴生文件(默认关)",
        pdescTip: "关联元数据始终存本地数据库;开启后额外把说明/标签/封面导出为模型旁的 .civitai.json(供外部工具)",
        settingsMsg: "API Key 在 Civitai 账户设置页生成,仅保存在本机 ComfyUI user 目录;Key 只会下发给官方站点,不会发给镜像。",
        settingsSaved: "设置已保存", saveFailed: "保存失败",
        readCfgFailed: "读取配置失败",
        route405: "服务端尚未加载该功能 — 请重启一次 ComfyUI 后重试",
        presetHotWeek: "🔥 本周热门", presetHotMonth: "📈 本月热门", presetBestMonth: "⭐ 本月高分",
        saveBtn: "存图", saveBtnTitle: "保存到 ComfyUI output 目录",
        saveOk: "已保存到 output: {name}",
        applyBtn: "应用到工作流", applyNoKs: "未找到 KSampler 节点", applyFail: "应用失败",
        applyDone: "已应用:提示词 ✓{lora}", applyLoraPart: ",LoRA ×{n}", loraMissing: "本地未找到: {names}",
        galleryTab: "🖼 画廊", gallerySortNewest: "最新发布", gallerySortReactions: "最多互动", gallerySortComments: "最多评论",
        gallerySortCollected: "最多收藏", gallerySortOldest: "最早发布", gallerySortRandom: "随机",
        galPresetNewDay: "🌅 今日最新", galPresetHotDay: "🔥 今日热门", galPresetHotWeek: "🔥 本周热门",
        galPresetBestWeek: "⭐ 本周高分", galPresetHotMonth: "📈 本月热门", galPresetBestMonth: "⭐ 本月高分",
        fmtAll: "全部格式", fmtVideo: "视频", fmtImage: "图像", fmtTip: "客户端筛选,只作用于已加载条目",
        mtAll: "全部", mtTip: "按媒体类型筛选(图像/视频,服务端过滤)",
        lvLabel: "分级", msAll: "全部", msCount: "{n} 项",
        typeLabel: "类型", refreshTitle: "按当前筛选重拉第 1 页",
        thumbSizeTitle: "卡片封面最长边", thumbSizeGalTitle: "缩略图最长边",
        imgidPh: "图片 ID 精确搜索(回车)", favOnlyEmpty: "已加载条目里没有收藏,可滚动或点刷新继续拉取",
        loadMore: "加载更多", useAsOutput: "选为输出", selectedAsOutput: "已选为输出",
        sfwLabel: "全年龄", nsfwLabel: "包含 NSFW",
        noTags: "无标签", tagsPaused: "标签抓取已暂停({sec} 秒后恢复)", noSelectionHint: "未选择(点击缩略图选择)",
        tagScrapeLabel: "读取图片分类标签", tagScrapeTip: "读取非公开 API 获取图片分类标签，需要 Civitai API Key", tagsLoading: "标签加载中…",
        tagAndLabel: "多标签 AND 语义", tagAndTip: "实验:逐标签查询求交集,请求量更大", clearTags: "清空",
        noTagsSel: "未选标签(下拉多选)",
        addTagOpt: "+ 添加标签…", addBaseOpt: "+ 添加底模…",
        tagsOff: "标签抓取已在设置中关闭",
        galleryEmpty: "没有图片。", galleryAuthor: "作者",
    },
    en: {
        tabBrowse: "🌐 Models", tabLocal: "📁 Library", tabDownloads: "⬇ Downloads", settings: "Settings",
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
        tagClickable: "Click: copy / search",
        baseFilterHint: "No base models selected (pick from dropdown)", tagFilterHint: "No tags selected (pick from dropdown)",
        modeOR: "OR (any)", modeAND: "AND (all, exp.)",
        hidePaidLabel: "Hide unpaid paid-content", hidePaidBought: "Hide paid (incl. purchased)", showAllLabel: "Include paid",
        tagCapNote: "Max 3 tags per search, using the first 3",
        menuCopy: "Copy", menuBrowseSearch: "Search in Models", menuGallerySearch: "Search in Gallery",
        resetFilters: "Reset filters",
        gmSystem: "System collection (site-managed)",
        gmSystemTip: "Membership is owned by Civitai hearts; un-like on the site to leave",
        nodePrev: "Prev", nodeNext: "Next", nodeRefresh: "Refresh",
        blurTitle: "NSFW blur mask", blurTip: "Check levels to blur; hover an image to peek. Applies on save.",
        sortMostDownloaded: "Most downloaded", sortHighestRated: "Highest rated", sortNewest: "Newest",
        periodAllTime: "All time", periodMonth: "This month", periodWeek: "This week", periodDay: "Today",
        nsfw0: "Hide NSFW", nsfw1: "Some NSFW", nsfw2: "All NSFW",
        statusLoading: "Loading…", statusLoaded: "{n} loaded", statusMore: " — scroll down for more",
        retry: "Retry", noModels: "No models found — try different keywords.",
        loadFailed: "Load failed: ", detailLoadFailed: "Failed to load details: ",
        openOnCivitai: "Open on Civitai ↗",
        by: "by", unknown: "unknown", unknownCreator: "unknown creator", versionLabel: "Version",
        installed: "Installed", installedMark: " ✔ installed", modelDesc: "Model description",
        verDescTitle: "About this version", paidReq: "Paid required", paidFree: "No payment required", paidActive: "Paid access",
        commercial: "Commercial:", none: "none", derivNo: "No derivatives", derivYes: "Derivatives OK", relic: "Relicensable",
        nsfwLevelLabel: "NSFW:",
        triggerWords: "Trigger words", copyAll: "Copy all", files: "Files",
        noFiles: "No files for this version", previews: "Previews ({n}) — click for generation params",
        genParams: "Generation params",
        positivePrompt: "Positive prompt", negativePrompt: "Negative prompt", copy: "Copy",
        copied: "Copied", copyFail: "Copy failed",
        kvSampler: "Sampler", kvSteps: "Steps", kvSize: "Size",
        download: "⬇ Download", startDownload: "Start download", submitting: "Submitting…",
        dlDialogTitle: "Download — {name}", fileLabel: "File", targetFolder: "Target folder", modelTypeLabel: "Model type (override)",
        subfolder: "Subfolder (optional, created automatically)", subfolderPh: "e.g. NSFW/character",
        saveName: "Filename",
        dlHint: "Associations are stored in the local DB on completion{hash}; enable export in settings for .civitai.json",
        dlHintHash: " with SHA256 verification", cancel: "Cancel", ok: "OK", save: "Save",
        cantDownload: "Cannot download", versionNotFound: "Version not found — check for updates again",
        destFetchFailed: "Failed to list folders: ", noRegFolders: "No registered model folders found",
        openDownloadFailed: "Cannot open download", queuedToast: "Added to download queue",
        queueFailed: "Failed to queue download",
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
        reAssociate: "Re-associate", refreshMeta: "Refresh metadata",
        refreshing: "Refreshing…", metaRefreshed: "Metadata refreshed", metaRefreshFailed: "Refresh failed",
        renameTitle: "Rename — {name}", newFileName: "New filename (with extension)",
        renameMsg: "Renames the model file; the DB association and any .civitai.json move with it. Workflow references to the old filename will break.",
        renamed: "Renamed", renameFailed: "Rename failed",
        assocTitle: "Associate a Civitai model", searchByFile: "Search by filename (prefilled, editable)",
        searchBtn: "Search", searching: "Searching…", emptyQuery: "Type a search term, or paste a page link / model ID",
        noResults: "Nothing found — try shorter keywords", searchFailed: "Search failed: ",
        pasteRef: "Or paste a page link / model ID",
        pasteRefPh: "https://civitai.com/models/12345 or 12345",
        assocMsg: "Pick a search result (or paste a link) and press「Associate」— stored in the local DB; enable「Export .civitai.json」to also write the sidecar. Use「Verify on web ↗」to check on Civitai.",
        webConfirm: "Verify on web ↗", versionLoading: "Loading versions…",
        pickFirst: "Pick a search result first, or paste a link", associated: "Associated",
        assocFailed: "Association failed",
        updateCheckDone: "Update check finished", updateCheckFailed: "Update check failed",
        updatesFound: "Models with updates — ", checkedAB: "checked {a}/{b} (cap 30 per run; use per-item Check for the rest)",
        checkedN: "checked {n}", failNote: ", {n} lookups failed (usually models deleted upstream)",
        fetchingNewVersion: "Failed to fetch the new version",
        dlTabHint: "Downloads go to your ComfyUI model folders, resumable", clearFinished: "Clear finished",
        noJobs: "No downloads yet — pick a model in Browse.",
        pollFailBanner: "Refreshing download states failed repeatedly — check the ComfyUI backend; this notice clears itself on recovery.",
        stQueued: "Queued…", stDownloading: "Downloading {pct}% {speed}", stVerifying: "Verifying SHA256…",
        stDone: "Done ✔", stCancelled: "Cancelled", stError: "Failed: ",
        cancelBtn: "Cancel", cancelFailed: "Cancel failed", clearFailed: "Clear failed",
        retryResume: "Retry (resume)", retryTip: "Resume from the transferred bytes (.part breakpoint)", retryFailed: "Retry failed",
        scopeLabel: "Instance", scopeAll: "All instances",
        favOnlyTitle: "Favorites only", favBtnTitle: "Favorite", favFailed: "Favorite failed",
        browseBtn: "Browse…", subdirPickTitle: "Pick subfolder", subdirRoot: "(root)", browseFailed: "Open failed",
        revealFile: "Show in folder", toLocal: "Local library", moveBtn: "Move",
        moveTitle: "Move — {name}", movedToast: "Moved", moveFailed: "Move failed",
        settingsTitle: "⚙ Civitai Studio settings",
        setGrpAccount: "🔑 Account & connection", setGrpDownload: "⬇ Download", setGrpSearch: "🖼 Images & search",
        setGrpStorage: "💾 Storage & cache", setGrpSync: "🔄 Favorites sync",
        testKeyBtn: "Test connection", testKeying: "Testing…",
        probeOk: "Key is valid", probeNoSocial: "Missing Social→Write scope — favorites upsync unavailable",
        probeSocialUnknown: "Write-scope probe inconclusive (network? try again)",
        probeNoKey: "No API key configured", probeInvalid: "Key invalid or revoked",
        probeTimeout: "Connection timeout (check network/proxy)", probeFailUnknown: "Test failed",
        expBadge: "Experimental",
        keyLabel: "Civitai API key (optional)",
        keyFunc: "Feature: Unlocks gated models / higher rate limits / tag scraping",
        keyFuncEx: "Extra feature: Sync Favorites with Civitai (needs Collections Write + Social Write scopes)",
        keySetPh: "Set (ends with {tail}) — leave empty to keep", keyPh: "Paste API key",
        keyHowTo: "How to get one: Civitai avatar menu → Account Settings → Security & Apps → API Keys → Add API Key, pick the scopes, Save, then paste the key above.",
        keyLink: "Open Civitai security settings ↗",
        proxyLabel: "Network proxy",
        proxyPh: "http://127.0.0.1:10808 or socks5://127.0.0.1:10808, empty = direct",
        mirrorLabel: "API site", mirrorTip: "Default civitai.com; switch to a mirror if the connection is unstable", siteCustom: "Custom",
        concLabel: "Download concurrency", concTip: "1-4; more parallel downloads, higher rate-limit risk",
        cacheMaxLabel: "Disk cache limit MB", cacheMaxTip: "50-2000; least-recently-used eviction beyond the limit",
        cacheUsageFmt: "Cache usage: {mb} MB / limit {max} MB", cacheUsageLoading: "Cache usage: calculating…",
        clearCacheBtn: "Clear cache", deepScanBtn: "Deep rescan",
        cacheCleared: "Cache cleared, index rebuilt",
        deepScanDone: "Rescan done: {total} items, {reused} reused, {read} re-read, {dur}s",
        deepScanFailed: "Deep rescan failed",
        favTabTitle: "Favorites", favKindAsset: "Assets", favKindModel: "Models",
        favTab: "★ Favorites", favSyncLine: "Last sync {time} · up {up} · down {down}",
        onboardTitle: "👋 Start in 3 steps", onboard1: "Paste your Civitai API Key in Settings (optional; unlocks restricted models & favorites sync)",
        onboard2: "「Browse」to search / 「Library」to manage installed models", onboard3: "Save gallery images ⬇ and ★ favorites can sync with your Civitai account",
        onboardGo: "Open settings", onboardDismiss: "Don't show again",
        favSyncBusy: "Sync in progress…", syncFailShort: "Sync failed",
        gmTitle: "Manage collections", gmDelete: "Delete", gmRemoteDel: "Also delete the Civitai collection",
        gmConfirm: "Delete collection \"{name}\"? {remote}This cannot be undone.",
        gmRemoteNote: "The Civitai collection \"{name}\" and all its items will be deleted!",
        gmEmpty: "No collections", gmBound: "Bound to collection #{cid}", gmLocalOnly: "Local only",
        gmDone: "Collection \"{name}\" deleted{note}", resetTitle: "Reset favorites sync",
        resetWarn: "This wipes ALL local favorite data ({n} items, stars & groups) + sync caches; the next sync re-pulls everything from Civitai.\n\nExport a backup first! Confirm reset?",
        resetDone: "Favorites reset — press Sync Civitai to re-pull", resetBtn: "Reset", manageBtn: "Manage",
        newColPh: "New collection name", pickerNew: "+ New collection", groupCreated: "Collection \"{name}\" created",
        ffoldTitle: "Collapse/expand filters",
        favGroupAll: "All groups", favGroupNone: "Ungrouped",
        favSync: "Sync Civitai", favSyncing: "Syncing…",
        favSyncDone: "Synced: new models +{models_down} · new images +{images_down} · groups +{groups_down} · mounts +{mounts} · pushed {items_up} · removed {items_rm} · ★ {upsynced} (failed {upsync_failed})",
        favSyncTrunc: "(many collections, only part synced this round)",
        pushPending: "↑ pending", pushDone: "✓ synced", pushLocalOnly: "local only",
        groupPickTitle: "Pick collections (multi)", groupPickNone: "none = ungrouped",
        favImport: "Import", favExport: "Export", favImported: "Imported {items} items / {groups} groups",
        favImportFailed: "Import failed", favEmpty: "No favorites yet — tap ★ in the gallery, node thumbnails or the image overlay",
        favAutoSync: "Auto-sync favorites",
        setGrpThumbs: "Thumbnail resolution",
        pxCoverLabel: "Model card cover",
        pxCoverTip: "Cover thumbnail tier on the Models grid. The CDN serves fixed tiers (96/320/450/512, requests round up). Default 320px balances clarity and bandwidth; 96px is smallest but looks soft at 150-280px card size.",
        pxMediaLabel: "Carousel & detail previews",
        pxMediaTip: "Thumbnail tier for card hover-carousel and model detail previews (same 96/320/450). Carousel fills the card (150-280px), detail previews are 105-140px; 320px covers both. 96px only for pure bandwidth saving.",
        setGrpLogs: "Logging",
        logTsLabel: "Timestamp prefix",
        logTsTip: "Prefix log lines with [YYYY-MM-DD HH:MM:SS]. Off by default; applies on save.",
        logDebugLabel: "Debug logging",
        logDebugTip: "Log all outbound requests/responses and per-item sync decisions to the console (equivalent to ComfyUI --verbose, scoped to this plugin). Takes effect on save; turn off after troubleshooting.",
        favAutoSyncTip: "Sync on Favorites tab open; conflicts resolved by newest timestamp; model push requires the SocialWrite key scope",
        favRemoveTitle: "Unfavorite", favSearchPh: "Search favorites…",
        favSortTitle: "Sort", favSortUpdated: "Recently updated", favSortAdded: "Recently added", favSortName: "By name",
        importAsset: "Import as asset", importAssetDone: "Imported to input/civitai_import/{name}", importAssetExists: "Already imported, skipped: {name}",
        importFailed: "Import failed",
        extractWf: "Extract workflow", extractDone: "Saved as workflow: {name}", extractNone: "No embedded ComfyUI workflow in this file", extractFail: "Extract failed",
        extractMgr: "Extracts", extractMgrTitle: "Extracted workflows (civitai_studio/)", extractEmpty: "No extracted workflows yet",
        extractDelete: "Delete", extractDeleted: "Deleted", extractCapWarn: "{n} extracts — consider cleaning up",
        pimgLabel: "Route preview images through the backend ComfyUI", pimgTip: "Enable if direct loading fails",
        hashLabel: "Verify SHA256 after download",
        pdescLabel: "Export .civitai.json sidecar (default off)",
        pdescTip: "Association metadata always lives in the local DB; when on, also export description/tags/cover next to the model file for external tools",
        settingsMsg: "Generate the key on the Civitai account page; it is stored locally in the ComfyUI user directory and only ever sent to official hosts.",
        settingsSaved: "Settings saved", saveFailed: "Save failed",
        readCfgFailed: "Failed to read settings",
        route405: "The server has not loaded this feature — restart ComfyUI once and retry",
        presetHotWeek: "🔥 Hot this week", presetHotMonth: "📈 Hot this month", presetBestMonth: "⭐ Top rated this month",
        saveBtn: "⬇ Save", saveBtnTitle: "Save to the ComfyUI output folder",
        saveOk: "Saved to output: {name}",
        applyBtn: "Apply to workflow", applyNoKs: "No KSampler node found", applyFail: "Apply failed",
        applyDone: "Applied: prompts ✓{lora}", applyLoraPart: ", {n} LoRA(s)", loraMissing: "Local LoRAs not found: {names}",
        galleryTab: "🖼 Gallery", gallerySortNewest: "Newest", gallerySortReactions: "Most reactions", gallerySortComments: "Most comments",
        gallerySortCollected: "Most collected", gallerySortOldest: "Oldest", gallerySortRandom: "Random",
        galPresetNewDay: "🌅 New today", galPresetHotDay: "🔥 Hot today", galPresetHotWeek: "🔥 Hot this week",
        galPresetBestWeek: "⭐ Top this week", galPresetHotMonth: "📈 Hot this month", galPresetBestMonth: "⭐ Top this month",
        fmtAll: "All formats", fmtVideo: "Video", fmtImage: "Image", fmtTip: "Client-side filter, applies to loaded items only",
        mtAll: "All", mtTip: "Media type filter (image/video, server-side)",
        lvLabel: "Level", msAll: "All", msCount: "{n} items",
        typeLabel: "Type", refreshTitle: "Refetch page 1 with current filters",
        thumbSizeTitle: "Card cover longest edge", thumbSizeGalTitle: "Thumbnail longest edge",
        imgidPh: "Image ID exact search (Enter)", favOnlyEmpty: "No favorites among loaded items — scroll or refresh to fetch more",
        loadMore: "Load more", useAsOutput: "Use as output", selectedAsOutput: "Selected as output",
        sfwLabel: "SFW only", nsfwLabel: "Include NSFW",
        noTags: "No tags", tagsPaused: "Tag fetch paused ({sec}s), retrying later", noSelectionHint: "Nothing selected (click a thumbnail)",
        tagScrapeLabel: "Fetch image category tags", tagScrapeTip: "Uses the unofficial API; requires a Civitai API key", tagsLoading: "Loading tags…", tagsOff: "Tag scraping disabled in settings",
        tagAndLabel: "Multi-tag AND", tagAndTip: "Experimental: per-tag queries + intersection, more requests", clearTags: "Clear",
        noTagsSel: "No tags (pick from dropdown)",
        addTagOpt: "+ Add tag…", addBaseOpt: "+ Add base model…",
        galleryEmpty: "No images.", galleryAuthor: "Author",
    },
};

let S = {
    lang: "zh",
    cfg: { proxy_images: false, nsfw: 1, verify_hash: true },
    browse: {
        query: "", type: "", base: "", tag: "", baseMode: "OR", tagMode: "OR", hidePaid: "0", nsfwLv: new Set(),
        cardW: 150, favOnly: false, favMore: 0,
        sort: "Most Downloaded", period: "AllTime",
        nsfw: 1, items: [], nextCursor: "", loading: false, dirty: true, pendingReset: false,
    },
    local: { models: [], search: "", type: "", loading: false, updates: {}, truncated: false, detailCache: {} },
    dl: { jobs: [], lastSig: "", failStreak: 0 },
    gal: { items: [], next: [], sort: "Newest", period: "AllTime", base: "", tag: "", tagMode: "OR", tagAnd: null, imageId: "", nsfwLevel: 0, thumbSize: 256, loading: false, error: "", favOnly: false, nsfwLv: new Set() },
    ui: { tab: "browse", root: null, backendStale: false },
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

// 底模联想输入:可自由输入 + 自动补全弹层;弹层视觉对齐 ComfyUI 原生 combo 下拉
// (深色圆角面板/悬停高亮,走 ComfyUI 主题变量),替代浏览器 datalist 私样式。
// input:文本框;getCands():候选数组(枚举刷新后整体替换);onCommit(val):回车/点选提交
const _comboPickers = new Set();
function destroyComboPickers(container) {
    // 只销毁"输入框已断连"或"输入框在 container 内"的补全层;
    // 避免侧栏重建误杀画布节点侧(不在侧栏内且仍连着)的补全弹层
    for (const api of [..._comboPickers]) {
        const el = api.input;
        const owned = !el || !el.isConnected || (container ? container.contains(el) : false);
        if (owned) api.destroy?.();
    }
}
function attachComboComplete(input, getCands, onCommit) {
    const pop = document.createElement("div");
    pop.style.cssText = "position:fixed;z-index:10000;display:none;max-height:240px;overflow-y:auto;"
        + "background:var(--comfy-input-bg,var(--bg-color,#2b2b30));color:var(--fg-color,#ddd);"
        + "border:1px solid var(--border-color,#3a3a40);border-radius:6px;"
        + "box-shadow:0 6px 18px rgba(0,0,0,.45);padding:4px;font-size:12px;cursor:default;";
    let items = [], hi = -1;
    const close = () => { pop.style.display = "none"; hi = -1; };
    const hiApply = () => [...pop.children].forEach((el, i) => {
        el.style.background = i === hi ? "var(--border-color,#3f3f46)" : "transparent";
    });
    const renderPop = () => {
        const q = input.value.trim().toLowerCase();
        items = (getCands() || []).filter((c) => !q || c.toLowerCase().includes(q)).slice(0, 80);
        hi = -1;
        if (!items.length) { close(); return; }
        pop.innerHTML = items.map((c) => `<div class="cs-combo-item" style="padding:5px 10px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c)}</div>`).join("");
        const r = input.getBoundingClientRect();
        pop.style.left = r.left + "px";
        pop.style.top = r.bottom + 2 + "px";
        pop.style.width = Math.max(r.width, 180) + "px";
        pop.style.display = "block";
    };
    const pick = (i) => {
        if (i < 0 || i >= items.length) return;
        input.value = items[i];
        close();
        onCommit(items[i]);
    };
    pop.addEventListener("pointerdown", (e) => { // pointerdown 先于 input 失焦,点选必生效
        const it = e.target.closest(".cs-combo-item");
        if (it) { e.preventDefault(); pick([...pop.children].indexOf(it)); }
    });
    pop.addEventListener("mouseover", (e) => {
        const it = e.target.closest(".cs-combo-item");
        hi = it ? [...pop.children].indexOf(it) : -1;
        hiApply();
    });
    input.addEventListener("focus", renderPop);
    input.addEventListener("input", renderPop);
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (pop.style.display !== "block") { if (e.key === "Enter") { close(); onCommit(input.value.trim()); } return; }
        if (e.key === "ArrowDown") { hi = Math.min(items.length - 1, hi + 1); hiApply(); e.preventDefault(); }
        else if (e.key === "ArrowUp") { hi = Math.max(-1, hi - 1); hiApply(); e.preventDefault(); }
        else if (e.key === "Enter") { e.preventDefault(); if (hi >= 0) pick(hi); else { close(); onCommit(input.value.trim()); } }
        else if (e.key === "Escape") close();
    });
    // 页面滚动即收起;但弹层自身滚动(滚候选列表)不算——排除 pop 内部滚动事件
    const onScroll = (e) => {
        if (pop.style.display === "block" && !pop.contains(e.target)) close();
    };
    window.addEventListener("scroll", onScroll, { capture: true });
    if (!pop.isConnected) document.body.appendChild(pop);
    const api = {
        input, // 供 destroyComboPickers(container) 判定归属:只清断连/容器内的
        destroy() { // 节点删除/视图重建时调用,防 scroll 监听与弹层 DOM 泄漏
            window.removeEventListener("scroll", onScroll, { capture: true });
            pop.remove();
            _comboPickers.delete(api);
        },
    };
    _comboPickers.add(api);
    return api;
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

function humanizeErr(msg) {
    // 高频原始错误 → 人话(中文界面才映射,英文保持原样)
    const s = String(msg || "");
    if (S.lang !== "zh") return s;
    if (/-32003|required scope|缺少所需作用域/.test(s)) return "API Key 缺少所需权限：到 Civitai 账户设置重建 Key 并勾选相应权限";
    if (/\b401\b|Unauthorized/i.test(s)) return "认证失败：检查 API Key 是否有效";
    if (/\b403\b/i.test(s)) return "无权访问（资源私有或权限不足）";
    if (/\b404\b/i.test(s)) return "资源不存在（可能已被删除）";
    if (/\b429\b/i.test(s)) return "请求过于频繁，稍后再试";
    if (/\b502\b|\b503\b|proxy error/i.test(s)) return "网络/代理异常";
    if (/timed?_?out|timeout/i.test(s)) return "连接超时（检查网络/代理）";
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|network/i.test(s)) return "网络连接失败";
    return s;
}

function sanitizeHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = String(html || "");
    // template 的子节点不在 querySelectorAll 范围内,会整体绕过净化:直接移除
    $$("script,style,iframe,object,embed,link,meta,form,base,svg,math,template,noscript,noembed,noframes,xmp,plaintext,textarea,title", div).forEach((n) => n.remove()); // 后 7 个=原始文本元素,mXSS 双语境解析面(评审R1 D4-1)
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
    // 批2:UI 弹窗同步落后端日志(success→info,failure/error→error,warn→warn),
    // 排障时 ComfyUI 日志里能看到 UI 发生了什么。fire-and-forget,失败静默防递归。
    try {
        const logSev = sev === "error" || sev === "failure" ? "error" : sev === "warn" ? "warn" : "info";
        api.fetchApi("/civitai_studio/ui_log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sev: logSev, msg: `${summary}${detail ? " | " + detail : ""}` }),
        }).catch(() => { });
    } catch (e2) { /* 日志通道永不反噬 UI */ }
}

// 批5.1:请求错误落日志(同 path+status 10s 限频,防画廊连败刷屏);控制台 + 服务端 [UI] 双写
const _netErrAt = {};
function logNetError(url, status, msg) {
    const path = String(url || "").split("?")[0];
    const key = status + "|" + path;
    const now = Date.now();
    if (_netErrAt[key] && now - _netErrAt[key] < 10000) return;
    _netErrAt[key] = now;
    const line = `[HTTP ${status}] ${path} ${String(msg || "").slice(0, 200)}`;
    console.error("[Civitai-Studio][net] " + line);
    try {
        api.fetchApi("/civitai_studio/ui_log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sev: "error", msg: line }),
        }).catch(() => { });
    } catch (e) { /* 日志通道永不反噬 UI */ }
}

async function apiJson(url, opts) {
    // ComfyUI API 响应无缓存头,webview 启发式缓存会把旧响应(例如服务端重启前
    // 的默认热榜)冒充新结果;no-store + 时间戳双保险绕开
    let fullUrl = url;
    if ((!opts || !opts.method) && url.startsWith("/civitai_studio/")) {
        fullUrl += (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    }
    let resp;
    try {
        resp = await api.fetchApi(fullUrl, { ...(opts || {}), cache: "no-store" });
    } catch (e) {
        logNetError(url, 0, (e && e.message) || "网络异常"); // 批5.1:网络层失败(断网/代理挂)也落日志
        throw e;
    }
    let data = null;
    try { data = await resp.json(); } catch (e) { /* empty body */ }
    if (!resp.ok) {
        const msg = (data && data.error) || `HTTP ${resp.status}`;
        logNetError(url, resp.status, msg); // 批5.1:请求错误信息写入日志
        if (resp.status === 405 && url.startsWith("/civitai_studio/")) {
            // POST 落到了静态文件处理器 = 服务端还没有这条新路由
            throw new Error(t("route405"));
        }
        throw new Error(msg);
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

// 批4 E2E 12-14:mini 菜单里的[复制]无按钮上下文,必须 toast 反馈,否则"点了没反应"
function copyWithToast(text) {
    copyTextSafe(text, (ok) => {
        console.log("[Civitai-Studio][menu] copy done:", ok); // 批6:复制无 toast 之谜判据(onDone 是否回调/结果)
        toast(ok ? "success" : "error", ok ? t("copied") : t("copyFail"), "");
    });
}

// ---------- 通用模态框(悬浮元素:无遮罩、可拖动;✕/Esc/点画布关闭) ----------
function showModal(innerHTML, cls, keepNav) {
    if (!keepNav) closeAllFloats(); // 单实例:同一时间只显示一个悬浮元素(导航跳转时由 navPush 接管)
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
    // Esc 走 ✕ 的现行 onclick(导航浮层被 navPush 覆写为整链关闭);只让最顶层
    // modal 响应(子选择器打开时按一次 Esc 只关最上层);隐藏保活页不响应
    const escHandler = (e) => {
        if (e.key !== "Escape" || panel.style.display === "none") return;
        const ms = S.ui.floatModals || [];
        if (ms.length && ms[ms.length - 1] !== api) return;
        panel.querySelector(".cs-float-close").click();
    };
    document.addEventListener("keydown", escHandler);
    panel.querySelector(".cs-float-close").onclick = close;
    // 所有悬浮窗统一左上角"返回":无导航上下文时等价关闭;导航浮层由 navPush 改绑
    const head0 = panel.querySelector(".cs-float-head");
    if (head0) {
        const bk = document.createElement("button");
        bk.className = "cs-float-back";
        bk.textContent = S.lang === "zh" ? "← 返回" : "← Back";
        bk.onclick = close;
        head0.insertBefore(bk, head0.firstChild);
    }
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
    if (S.browse.tag) p.set("tag", S.browse.tag);
    p.set("sort", S.browse.sort);
    p.set("period", S.browse.period);
    p.set("nsfw", S.browse.nsfw > 0 ? "true" : "false");
    p.set("limit", "24");
    if (cursor) p.set("cursor", cursor);
    return p; // 批4 E2E 9:返回对象,OR 合并/AND 首 tag 分支还要 q.set 加工(此前返回串导致 q.set is not a function)
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
        const tagNames = String(st.tag || "").split(",").map((x) => x.trim()).filter(Boolean);
        let data;
        if (tagNames.length > 1 && st.tagMode === "OR") {
            // 批C:多 tag OR = 逐 tag 查询合并(≤3,每 tag 100/页);
            // 批4 E2E B4:per-tag 游标 — 续拉时各 tag 推进自己的下一页再合并去重(此前只拉首页)
            const use = tagNames.slice(0, 3);
            if (tagNames.length > 3) toast("warn", t("tagCapNote"), "");
            const sig = use.join("|");
            if (reset || !st.tagOr || st.tagOr.sig !== sig) {
                st.tagOr = { sig, cursors: use.map((tn) => ({ name: tn, next: null, done: false })) };
            }
            const merged = [];
            const seenIds = new Set((reset ? [] : st.items).map((x) => x.id));
            for (const c of st.tagOr.cursors) {
                if (c.done) continue;
                const q = browseParams(""); // per-tag 查询各自带游标,不用总 cursor
                q.set("tag", c.name);
                q.set("limit", "100");
                if (!reset && c.next) for (const [k, v] of c.next) q.append(k, v);
                try {
                    const d1 = await apiGet("/civitai_studio/search?" + q.toString());
                    for (const it of (d1.items || [])) {
                        if (!seenIds.has(it.id)) { seenIds.add(it.id); merged.push(it); }
                    }
                    const nc = (d1.metadata || {}).nextCursor || "";
                    c.next = nc ? [["cursor", nc]] : [];
                    c.done = !nc;
                } catch (e2) { c.done = true; /* 单 tag 失败跳过,不拖垮合并 */ }
                await new Promise((r2) => setTimeout(r2, 350)); // 轮间 delay(E2E e)
            }
            _sortMergedBrowse(merged); // 批5 E2E 4:逐 tag 各自有序,拼接会按 tag 分组——按当前排序混排
            data = { items: merged, metadata: { nextCursor: st.tagOr.cursors.some((c) => !c.done) ? "tag-or" : "" } };
        } else {
            const q = browseParams(cursor);
            if (tagNames.length && st.tagMode === "AND") q.set("tag", tagNames[0]); // AND:首 tag 走 API,其余客户端交集
            data = await apiGet("/civitai_studio/search?" + q.toString());
            if (tagNames.length > 1 && st.tagMode === "AND") {
                const rest = tagNames.slice(1).map((x) => x.toLowerCase());
                data.items = (data.items || []).filter((m) => rest.every((tn) =>
                    (m.tags || []).some((x) => String(x).toLowerCase() === tn)));
            }
        }
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

// 批5 E2E 4:多 tag OR 合并结果按当前排序键混排
function _sortMergedBrowse(items) {
    const k = S.browse.sort;
    const stat = k === "Most Downloaded" ? "downloadCount" : k === "Most Favorited" ? "favoriteCount"
        : k === "Most Commented" ? "commentCount" : "thumbsUpCount"; // Highest Rated 与默认档按点赞
    items.sort((a, b) => k === "Newest"
        ? String(b.lastVersionAt || b.createdAt || "").localeCompare(String(a.lastVersionAt || a.createdAt || ""))
        : (Number((b.stats || {})[stat]) || 0) - (Number((a.stats || {})[stat]) || 0));
}

// ---------- 在线浏览:渲染 ----------
function applyBrowseCardSize() {
    const grid = $("#cs-grid");
    if (!grid) return;
    const w = parseInt(S.browse.cardW, 10) || 150;
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${w}px, 1fr))`; // 批11.5:卡宽可调(含更小档)
}

function renderResults(reset) {
    const grid = $("#cs-grid");
    if (!grid) return;
    applyBrowseCardSize();
    $$(".cs-error, .cs-empty", grid).forEach((n) => n.remove());
    if (reset) {
        grid.innerHTML = "";
        for (const m of S.browse.items) m.__rendered = false;
    }
    const frag = document.createDocumentFragment();
    const baseSelB = String(S.browse.base || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const baseAndB = S.browse.baseMode === "AND" && baseSelB.length > 1;
    for (const model of S.browse.items) {
        if (!model.__rendered) {
            // 批9:本地分级多选(模型级 nsfwLevel=数字位掩码;无标记的条目被滤掉)
            if (S.browse.nsfwLv.size) {
                const nl = nsfwBitsOf(model);
                if (!nl || ![...S.browse.nsfwLv].some((b) => nl & b)) continue;
            }
            if (S.browse.favOnly && !(S.favModelIds && S.favModelIds.has(String(model.id)))) continue; // ★只看收藏(本地,批11.5)
            if (baseAndB) {
                // AND(实验):模型全部版本的 baseModel 并集 ⊇ 所选;不满足不标记 rendered(解除筛选即回来)
                const bmSet = new Set((model.modelVersions || [])
                    .flatMap((v) => [v.baseModel, ...(v.baseModels || [])])
                    .filter(Boolean).map((x) => String(x).toLowerCase()));
                if (!baseSelB.every((b) => bmSet.has(b))) continue;
            }
            // 批D E2E:隐藏需付费且未购的内容(列表接口有 hasActivePaidAccess,实测同源)
            {
                // 批D + 批4 E2E 16:1=藏未购;2=含已购(958009 实测站方给未购账号 hasActivePaidAccess=true,靠此档硬藏)
                const hp = String(S.browse.hidePaid || "0");
                if (hp === "1" && model.allowNoCredit === false && !model.hasActivePaidAccess) continue;
                if (hp === "2" && model.allowNoCredit === false) continue;
            }
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
    } else if (S.browse.favOnly && !grid.querySelector(".cs-card") && !S.browse.loading) {
        const empty = document.createElement("div");
        empty.className = "cs-empty";
        empty.textContent = t("favOnlyEmpty");
        grid.appendChild(empty);
    }
    // ★只看收藏:可见卡片太少就自动续拉(照抄画廊 autoMore,≤5 轮防失控)
    if (S.browse.favOnly && !S.browse.loading && S.browse.nextCursor
        && grid.querySelectorAll(".cs-card").length < 12) {
        if ((S.browse.favMore || 0) < 5) {
            S.browse.favMore = (S.browse.favMore || 0) + 1;
            setTimeout(() => fetchBrowse(false), 300);
        }
    } else {
        S.browse.favMore = 0;
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
        let el = document.createElement(isVideo ? "video" : "img"); // 批10:轮播要重指,必须 let(批9 const 是卡死根因)
        el.className = "cs-card-img";
        el.dataset.direct = url;
        // 批9:卡片封面接模糊层(模型级 nsfwLevel=数字位掩码,实测列表接口直接给)
        el.classList.add("cs-nsfw-blurable");
        el.dataset.nsfwLevel = nsfwBitsOf(cover.media.nsfwLevel != null ? cover.media : model);
        el.style.filter = nsfwBlurCss(cover.media.nsfwLevel != null ? cover.media : model);
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
            card.addEventListener("mouseenter", () => el.play().catch(() => { }));
            card.addEventListener("mouseleave", () => el.pause());
        } else {
            el.loading = "lazy";
            el.alt = model.name;
            el.addEventListener("load", show);
        }
        attachCoverErrorHandler(el, url);
        // 卡片封面只需要小图:图片走 px_cover 缩略变体(批10),视频走 cdnVideo 降码率(批11)
        el.src = imgSrc(isVideo ? cdnVideo(url) : cdnThumb(url, S.cfg.px_cover || 320)) + (isVideo ? "#t=0.001" : "");
        $(".cs-card-cover", card).prepend(el);
        // 批9:悬停轮播 — 仅悬停中的卡片按 3s 轮换版本图(≤8 张;视频悬停即播),
        // 非悬停零定时器零解码。定时全卡轮播被否:24-100 卡×定时器+预载+视频解码,
        // 单模型图实测可达 23 张,ComfyUI webview 承受不了(用户点名要反对意见)
        const media = (model.modelVersions || []).flatMap((v) => v.images || [])
            .filter((i) => i && i.url).slice(0, 8);
        if (media.length > 1) {
            const cnt = document.createElement("span");
            cnt.className = "cs-card-cyc";
            cnt.textContent = "1/" + media.length;
            $(".cs-card-cover", card).appendChild(cnt);
            let idx = 0, timer = null, preloaded = false;
            // 批11 E2E 1:开轮播时一次性预载本轮 ≤8 张(切图已就绪,不再边切边等网络);
            // 视频不预载整文件(体积大),仍按时切片 #t 首帧按需取
            const preload = () => {
                if (preloaded) return;
                preloaded = true;
                for (const m of media) {
                    if (isVideoItem(m)) continue; // 含 type 字段缺失但 URL 为 mp4/webm/mov 的情况
                    const im = new Image();
                    im.src = imgSrc(cdnThumb(m.url, S.cfg.px_media || 320)); // 与 swap 同 URL,命中缓存
                }
            };
            const swap = () => {
                if (!card.isConnected) { clearInterval(timer); return; } // 卡片被重渲染:自清
                idx = (idx + 1) % media.length;
                const m = media[idx];
                const nv = document.createElement(m.type === "video" ? "video" : "img");
                nv.className = "cs-card-img is-loaded";
                nv.dataset.direct = m.url;
                nv.classList.add("cs-nsfw-blurable");
                nv.dataset.nsfwLevel = nsfwBitsOf(m.nsfwLevel != null ? { nsfwLevel: m.nsfwLevel } : model);
                nv.style.filter = nsfwBlurCss(m.nsfwLevel != null ? { nsfwLevel: m.nsfwLevel } : model);
                if (m.type === "video") {
                    nv.muted = true; nv.loop = true; nv.playsInline = true; nv.preload = "metadata";
                    nv.src = imgSrc(cdnVideo(m.url)) + "#t=0.001"; // 批11 E2E 4:视频不再 original=true
                    nv.play().catch(() => { });
                } else {
                    nv.loading = "eager";
                    nv.alt = model.name;
                    nv.src = imgSrc(cdnThumb(m.url, S.cfg.px_media || 320)); // 批10:轮播低分辨率减负载
                }
                el.replaceWith(nv);
                el = nv;
                cnt.textContent = (idx + 1) + "/" + media.length;
            };
            card.addEventListener("mouseenter", () => {
                if (timer) return;
                preload(); // 批11 E2E 1:开播即预载全部 8 张
                timer = setInterval(swap, 3000); // 批11 E2E 1:3s/张(用户拍板;批10 的 1s 停留偏短)
            });
            card.addEventListener("mouseleave", () => {
                clearInterval(timer); timer = null;
                idx = 0; cnt.textContent = "1/" + media.length;
                // 复位到首图(与 pickCover 口径一致:第一张静态图)
                const first = media.find((m) => m.type !== "video") || media[0];
                if (el.dataset.direct !== first.url) {
                    const fv = document.createElement(first.type === "video" ? "video" : "img");
                    fv.className = "cs-card-img is-loaded";
                    fv.dataset.direct = first.url;
                    fv.classList.add("cs-nsfw-blurable");
                    fv.dataset.nsfwLevel = nsfwBitsOf(first.nsfwLevel != null ? { nsfwLevel: first.nsfwLevel } : model);
                    fv.style.filter = nsfwBlurCss(first.nsfwLevel != null ? { nsfwLevel: first.nsfwLevel } : model);
                    if (first.type === "video") {
                        fv.muted = true; fv.loop = true; fv.playsInline = true; fv.preload = "metadata";
                        fv.src = imgSrc(cdnVideo(first.url)) + "#t=0.001";
                    } else fv.src = imgSrc(cdnThumb(first.url, S.cfg.px_media || 320));
                    el.replaceWith(fv);
                    el = fv;
                } else if (el.tagName === "VIDEO") el.pause();
            });
        }
    }
    // E2E a-2:缩略图左下角收藏星标;新增时弹收藏夹选择器(默认未分组)
    const mid2 = String(model.id ?? "");
    if (mid2) {
        const favOn = S.favModelIds?.has(mid2) || (S.favs && S.favs.has(mid2));
        const fb = document.createElement("button");
        fb.className = "cs-save-btn";
        fb.style.cssText = "right:auto;left:4px;" + (favOn ? "color:#ffd75e;" : "");
        fb.title = t("favBtnTitle");
        fb.textContent = "★";
        $(".cs-card-cover", card).appendChild(fb); // E2E 15:封面左下角(挡不住信息区)
        fb.onclick = async (ev) => {
            ev.stopPropagation();
            try {
                const adding = !(S.favModelIds?.has(mid2) || (S.favs && S.favs.has(mid2)));
                const cover2 = version.images?.[0]?.url || null;
                await toggleFav("model", mid2, { name: model.name, cover: cover2 });
                fb.style.color = adding ? "#ffd75e" : "";
                if (adding) {
                    const cur = ((S.favData?.items || []).find((x) => x.kind === "model" && String(x.oid) === mid2) || {}).group_ids || [];
                    openGroupPicker(ev, "model", cur, async (gids) => {
                        try { await apiPost("/civitai_studio/favorites/assign", { kind: "model", oid: mid2, group_ids: gids }); }
                        catch (e2) { toast("error", t("favFailed"), e2.message); }
                    });
                }
            } catch (e) { toast("error", t("favFailed"), e.message); }
        };
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

function openFloatDetail(keepNav) {
    if (!keepNav) closeAllFloats(); // 单实例:开新的浮层前关掉旧浮层(导航跳转由 navPush 接管)
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
    // 导航栈整链销毁(含隐藏保活的祖先信息页),再兜底清残留
    (S.ui.navStack || []).splice(0).forEach((r) => { const p = r.prev; r.prev = null; r.closeSingle(); });
    closeFloatDetail();
    (S.ui.floatModals || []).slice().forEach((m) => m.close());
}

// ---------- 浮层导航:大图/模型页互跳 ----------
// 同一时刻只显示栈顶;跳转时来源页隐藏保活压栈,头部"返回"优先回上一页,
// 无来路=关闭。✕/Esc/程序性 m.close()/另开无关浮层均整链销毁(不留隐藏僵尸)
function navPush(panel, modalApi, prev) {
    const st = S.ui.navStack || (S.ui.navStack = []);
    if (prev && st.includes(prev)) {
        // 保留 prev 及其祖先链,销毁其余不可达记录;来源页隐藏保活
        const keep = new Set();
        let r = prev;
        while (r) { keep.add(r); r = r.prev; }
        st.filter((x) => !keep.has(x)).forEach((x) => { const p = x.prev; x.prev = null; x.closeSingle(); });
        S.ui.navStack = st.filter((x) => keep.has(x));
        prev.panel.style.display = "none";
    } else {
        st.splice(0).forEach((x) => { const p = x.prev; x.prev = null; x.closeSingle(); });
    }
    const rec = { panel, modalApi, prev: prev && S.ui.navStack.includes(prev) ? prev : null };
    const baseClose = modalApi
        ? modalApi.close
        : () => { panel.remove(); if (S.ui.float === panel) S.ui.float = null; };
    rec.closeSingle = () => { // 单页销毁("返回"回退一步用;用原始 close,不触发整链)
        const i = S.ui.navStack.indexOf(rec);
        if (i >= 0) S.ui.navStack.splice(i, 1);
        baseClose();
    };
    rec.closeChain = () => { // 整链销毁(✕/Esc/m.close()/另开无关浮层)
        let r = rec;
        while (r) { const p = r.prev; r.prev = null; r.closeSingle(); r = p; }
    };
    if (modalApi) modalApi.close = rec.closeChain; // m.close()(选为输出等)也收链
    const x = panel.querySelector(".cs-float-close");
    if (x) x.onclick = rec.closeChain;
    S.ui.navStack.push(rec);
    navAddBackButton(rec);
    return rec;
}

function navBack(rec) {
    // "返回":有来路回退一步(当前页销毁、来源页还原);无来路=整链关闭
    if (!rec.prev) { rec.closeChain(); return; }
    const prev = rec.prev;
    rec.prev = null;
    rec.closeSingle();
    prev.panel.style.display = "";
}

function navAddBackButton(rec) {
    const head = rec.panel.querySelector(".cs-float-head");
    if (!head) return;
    let btn = head.querySelector(".cs-float-back");
    if (!btn) { // showModal 已为所有浮层建默认"返回",这里改绑;防御性兜底创建
        btn = document.createElement("button");
        btn.className = "cs-float-back";
        btn.textContent = S.lang === "zh" ? "← 返回" : "← Back";
        head.insertBefore(btn, head.firstChild);
    }
    btn.title = rec.prev ? (S.lang === "zh" ? "返回上一信息页" : "Back to previous page") : (S.lang === "zh" ? "关闭" : "Close");
    btn.onclick = () => navBack(rec);
}

async function openBrowseFloat(modelId, opts = {}) {
    const body = openFloatDetail(!!opts._navFrom);
    const panel = S.ui.float; // openFloatDetail 刚创建的本页面板
    body.innerHTML = `<div class="cs-expand-loading">${esc(t("statusLoading"))}</div>`;
    try {
        const model = await apiGet(`/civitai_studio/model/${encodeURIComponent(String(modelId))}`);
        // 等待期间浮层被手动关闭或被新卡片替换:丢弃旧响应,防空面板入栈/抢占新面板
        if (!panel || !panel.isConnected || S.ui.float !== panel) return;
        const rec = navPush(panel, null, opts._navFrom || null); // 本页入导航栈(来源页隐藏保活)
        renderDetail(model, body, { ...opts, _navBack: () => rec.closeChain(), _navRec: rec });
        const title = $(".cs-float-head .cs-float-title");
        if (title) title.textContent = model.name || "";
    } catch (e) {
        if (panel && panel.isConnected && S.ui.float === panel) {
            body.innerHTML = `<div class="cs-empty">${esc(t("detailLoadFailed") + e.message)}</div>`;
        }
    }
}

// ---------- 详情页 ----------
// 许可/NSFW/底模徽章(E2E a)。nsfwLevel 位值取自 civitai 源码 enums.ts:
// PG=1 PG-13=2 R=4 X=8 XXX=16 Blocked=32(位掩码,显示解码后的等级标签)
const NSFW_LEVEL_LABELS = { 1: "PG", 2: "PG-13", 4: "R", 8: "X", 16: "XXX", 32: "Blocked" };

// 批F:NSFW 模糊遮罩 — 命中勾选分级位的图片加 blur;悬停临时清晰(CSS :hover)
S.cfg.nsfwBlurBits = S.cfg.nsfwBlurBits || [4, 8, 16]; // 批5 E2E 14:默认启用模糊(R/X/XXX;PG/PG-13 不模糊,👁 可勾)
const _NSFW_NAME_BITS = { pg: 1, "pg-13": 2, pg13: 2, mature: 4, r: 4, x: 8, xxx: 16, blocked: 32 };
function nsfwBitsOf(item) {
    // 批6(用户建议+实测):模糊判定优先 browsingLevel(数字位掩码,精确到 XXX——
    // 实测 browsingLevel=16 的条目 nsfwLevel 显示 "X",字符串枚举把 XXX 并进 X 会错档);
    // nsfwLevel 作回退(数字位掩码或 None/Soft/Mature/X 字符串枚举)
    const v = item && (item.browsingLevel ?? item.nsfwLevel);
    if (typeof v === "number") return v;
    const sv = String(v || "").trim();
    if (/^\d+$/.test(sv)) return parseInt(sv, 10); // 批7 3:dataset 值是数字字符串,👁 重算全灭根因
    return _NSFW_NAME_BITS[sv.toLowerCase()] || 0;
}
function nsfwBlurOn(item) {
    const lv = nsfwBitsOf(item);
    if (!lv) return false;
    return (S.cfg.nsfwBlurBits || []).some((b) => lv & b);
}
function nsfwBlurCss(item) {
    // 赋 el.style.filter 只吃值("blur(18px)"):塞完整声明"filter:blur(18px);"会被静默丢弃
    // (批11 E2E 2 卡片封面从不模糊的根因);HTML style 属性拼接用 nsfwBlurStyle
    return nsfwBlurOn(item) ? "blur(18px)" : "";
}
function nsfwBlurStyle(item) {
    const v = nsfwBlurCss(item);
    return v ? "filter:" + v + ";" : "";
}
function openNsfwBlurPicker(ev) {
    document.querySelectorAll(".cs-mini-menu").forEach((n) => n.remove());
    const pop = document.createElement("div");
    pop.className = "cs-mini-menu";
    pop.style.cssText = "position:fixed;z-index:60002;min-width:200px;"
        + "background:var(--comfy-input-bg,var(--bg-color,#2b2b30));color:var(--fg-color,#ddd);"
        + "border:1px solid var(--border-color,#3a3a40);border-radius:8px;"
        + "box-shadow:0 8px 24px rgba(0,0,0,.5);padding:8px;font-size:12px;cursor:default;";
    const head = document.createElement("div");
    head.style.cssText = "font-weight:600;margin-bottom:4px;";
    head.textContent = t("blurTitle");
    const hint = document.createElement("div");
    hint.style.cssText = "color:#999;font-size:10px;margin-bottom:6px;";
    hint.textContent = t("blurTip");
    pop.appendChild(head);
    pop.appendChild(hint);
    const bits = new Set(S.cfg.nsfwBlurBits || []);
    for (const [bit, lb] of Object.entries(NSFW_LEVEL_LABELS)) {
        if (Number(bit) >= 32) continue; // Blocked 站方屏蔽位,不参与遮罩
        const lb2 = document.createElement("label");
        lb2.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 2px;cursor:pointer;";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = bits.has(Number(bit));
        cb.onchange = () => {
            if (cb.checked) bits.add(Number(bit)); else bits.delete(Number(bit));
            S.cfg.nsfwBlurBits = [...bits].sort((a, b2) => a - b2);
            apiPost("/civitai_studio/config", { nsfw_blur: S.cfg.nsfwBlurBits }).catch(() => { });
            document.querySelectorAll("[data-nsfw-level]").forEach((el) => {
                el.style.filter = nsfwBlurCss({ nsfwLevel: el.dataset.nsfwLevel }); // 批6:全量重算(归一化字符串枚举)
            });
        };
        lb2.appendChild(cb);
        lb2.appendChild(document.createTextNode(`${lb}`));
        pop.appendChild(lb2);
    }
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    console.log("[Civitai-Studio][menu] blur picker shown");
    pop.style.left = Math.min(ev.clientX ?? 0, window.innerWidth - r.width - 8) + "px";
    pop.style.top = Math.min(ev.clientY ?? 0, window.innerHeight - r.height - 8) + "px";
    // 批5:window 捕获隔离 — 先于宿主 document handler 执行;弹层内部阻断传播
    // (防宿主对 pointerdown preventDefault 按规范抑制后续 click — "菜单项点了没反应"根因),
    // 弹层外部按下即关
    const h = (e2) => {
        if (pop.contains(e2.target)) { e2.stopPropagation(); return; }
        window.removeEventListener("pointerdown", h, true);
        pop.remove();
    };
    window.addEventListener("pointerdown", h, true);
}
function modelBadgesHtml(model) {
    const chips = [];
    if (model.allowNoCredit === false) chips.push([t("paidReq"), "warn"]);
    else if (model.allowNoCredit === true) chips.push([t("paidFree"), "ok"]);
    if (model.hasActivePaidAccess) chips.push([t("paidActive"), "ok"]);
    const cu = Array.isArray(model.allowCommercialUse) ? model.allowCommercialUse : [];
    chips.push([t("commercial") + " " + (cu.length ? cu.join("/") : t("none")), cu.length ? "ok" : "warn"]);
    if (model.allowDerivatives === false) chips.push([t("derivNo"), "warn"]);
    else if (model.allowDerivatives === true) chips.push([t("derivYes"), "ok"]);
    if (model.allowDifferentLicenses) chips.push([t("relic"), "ok"]);
    if (typeof model.nsfwLevel === "number" && model.nsfwLevel > 0) {
        const labels = Object.entries(NSFW_LEVEL_LABELS).filter(([bit]) => model.nsfwLevel & Number(bit)).map(([, lb]) => lb);
        if (labels.length) chips.push([t("nsfwLevelLabel") + " " + labels.join("/"), /X|Blocked/.test(labels.join("/")) ? "warn" : "ok"]);
    }
    const bases = [...new Set((model.modelVersions || []).map((v) => v.baseModel).filter(Boolean))];
    const html = chips.map(([txt, cls]) => `<span class="cs-badge2 cs-badge2-${cls}">${esc(txt)}</span>`).join("");
    // baseModel chips 单独一行 + "Base model" 前缀(E2E r3-19):与许可徽章混排时淹没
    const basesHtml = bases.length
        ? `<div class="cs-detail-badges" style="margin-top:4px"><span class="cs-badge2 cs-badge2-base">Base model</span>`
        + bases.map((b) => `<span class="cs-badge2 cs-badge2-base" data-base="${esc(b)}" title="${esc(t("tagClickable"))}" style="cursor:pointer;">${esc(b)}</span>`).join("") + `</div>`
        : "";
    return (html ? `<div class="cs-detail-badges">${html}</div>` : "") + basesHtml;
}

function renderDetail(model, container, opts = {}) {
    const box = container;
    if (!box) return;
    const versions = (model.modelVersions || []).filter((v) => v.id);
    const desc = sanitizeHtml(model.description);
    box.innerHTML = `
        ${opts.offline ? `<div class="cs-banner">${esc(t("offlineBanner"))}</div>` : ""}
        <div class="cs-detail-head">
            <button class="cs-btn" id="cs-detail-fav" title="${esc(t("favBtnTitle"))}">★ ${esc(t("favBtnTitle"))}</button>
            <a class="cs-btn" href="${esc(civitaiPage())}/models/${esc(String(model.id))}" target="_blank" rel="noopener noreferrer">${esc(t("openOnCivitai"))}</a>
        </div>
        <h3 class="cs-detail-title" title="${esc(model.name)}">${esc(model.name)}</h3>
        <div class="cs-detail-meta">
            ${esc(t("by"))} ${esc(model.creator?.username || t("unknown"))} · ${esc(typeLabel(model.type))}
            · ⬇ ${fmtNum(model.stats?.downloadCount)} · 👍 ${fmtNum(model.stats?.thumbsUpCount)}
        </div>
        ${modelBadgesHtml(model)}
        ${model.tags?.length ? `<div class="cs-tags">${model.tags.slice(0, 10).map((tg) => `<span class="cs-tag" data-tag="${esc(tg)}" title="${esc(t("tagClickable"))}" style="cursor:pointer;">${esc(tg)}</span>`).join("")}</div>` : ""}
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
    rewriteDescImages(box);
    // E2E h:详情页 tag 点击 → 浏览 tab 按该 tag 新搜索
    $$(".cs-badge2[data-base]", box).forEach((el) => {
        el.onclick = (ev) => {
            ev.stopPropagation();
            const bm = el.dataset.base;
            openMiniMenu(ev, [
                { label: t("menuCopy"), cb: () => copyWithToast(bm) },
                { label: t("menuBrowseSearch"), cb: () => searchBrowseByBase(bm) },
            ]);
        };
    });
    $$(".cs-tag[data-tag]", box).forEach((el) => {
        el.onclick = (ev) => {
            ev.stopPropagation();
            const tg = el.dataset.tag;
            // 批C E2E-19:a.复制 b.鼠标位置菜单选[在浏览搜索](加入已选列表)
            openMiniMenu(ev, [
                { label: t("menuCopy"), cb: () => copyWithToast(tg) },
                { label: t("menuBrowseSearch"), cb: () => searchBrowseByTag(tg) },
            ]);
        };
    });
    // 模型页收藏入口(E2E r3-a):★落本地收藏,经同步上推 user.toggleFavorite
    const favB = $("#cs-detail-fav", box);
    if (favB && model.id != null) {
        const mid = String(model.id);
        const paint = (on) => { favB.style.color = on ? "#ffd75e" : ""; };
        paint(S.favModelIds?.has(mid) || (S.favs && S.favs.has(mid)));
        favB.onclick = async (ev) => {
            try {
                const adding = !(S.favModelIds?.has(mid) || (S.favs && S.favs.has(mid)));
                const cover = ((((model.modelVersions || [])[0] || {}).images || [{}])[0] || {}).url || null;
                paint(await toggleFav("model", mid, { name: model.name, cover }));
                // E2E #8:新增收藏弹收藏夹选择器(默认未分组)
                if (adding) {
                    const cur = ((S.favData?.items || []).find((x) => x.kind === "model" && String(x.oid) === mid) || {}).group_ids || [];
                    openGroupPicker(ev, "model", cur, async (gids) => {
                        try { await apiPost("/civitai_studio/favorites/assign", { kind: "model", oid: mid, group_ids: gids }); }
                        catch (e2) { toast("error", t("favFailed"), e2.message); }
                    });
                }
            } catch (e) { toast("error", t("favFailed"), e.message); }
        };
    }
    const sel = $("#cs-version-sel", box);
    const renderVer = () => {
        const idx = parseInt(sel.selectedOptions[0]?.dataset.idx || "0", 10);
        renderVersion(versions[idx] || versions[0], model, box, { _navRec: opts._navRec });
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
    $$(".cs-desc-body img", root).forEach((img) => {
        const orig = img.getAttribute("src") || "";
        if (!orig) return;
        img.dataset.direct = orig;
        img.setAttribute("referrerpolicy", "no-referrer");
        img.loading = "lazy";
        img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
        img.src = imgSrc(orig);
    });
}

function galleryItemHtml(img, px) {
    // 预览条目可能是视频(mp4 封面):静音循环,进视口才加载;右上角可存图到 output
    // px:图片缩略档位(批10;批11.3 起为真实 CDN 档位,详情页传 px_media,缺省 320=画廊网格口径);
    // 视频不受 px 控制,固定走 cdnVideo(320 档;档位表见该函数注释,批11.2)
    const direct = esc(img.url);
    const save = `<button class="cs-save-btn" title="${esc(t("saveBtnTitle"))}" data-save-url="${direct}">⬇</button>`;
    const blur = nsfwBlurStyle(img); // 批F:NSFW 模糊遮罩(hover 临时清晰)
    // 批6:无条件带 data(nsfwBits 归一),勾选变更即时重算
    const battr = ` data-nsfw-level="${nsfwBitsOf(img)}"`;
    if (isVideoItem(img)) { // 与全局口径一致:webm/mov 也走 video 分支(复审R2-4)
        return `<div class="cs-gallery-item">${save}<video muted loop playsinline preload="metadata"${battr} class="cs-nsfw-blurable" style="${blur}"
                    src="${esc(imgSrc(cdnVideo(img.url)))}#t=0.001" data-direct="${direct}"
                    onerror="this.style.display='none'"></video></div>`;
    }
    return `<div class="cs-gallery-item">${save}<img loading="lazy" class="cs-nsfw-blurable"${battr} style="${blur}" src="${esc(imgSrc(cdnThumb(img.url, px || 320)))}" data-direct="${esc(img.url)}"
                onerror="this.style.display='none'"/></div>`;
}

async function saveImageToOutput(url, btn, item) {
    if (btn) btn.disabled = true;
    try {
        const res = await apiPost("/civitai_studio/save_image", { url });
        if (item && res.filename) item.saved_filename = res.filename; // 供浮层内嵌参数回读
        toast("success", t("saveOk", { name: res.filename }), "");
    } catch (e) {
        toast("error", t("saveFailed"), e.message);
        if (btn) btn.disabled = false;
    }
}

let csVersionSeq = 0;
async function renderVersion(version, model, box, opts = {}) {
    const seq = ++csVersionSeq; // 乱序保护:慢响应不得覆盖新版本内容
    const body = box ? $("#cs-version-body", box) : null;
    if (!body || !version) return;
    const triggers = version.trainedWords || [];
    let images = version.images || [];
    // /models、/model-versions 端点的 images 不含图片 id("选为输出"需要 id):
    // 优先改从 /images?modelVersionId= 拉取(items 带 id 与生成参数),失败回退现有数据
    try {
        if (version.id) {
            const fd = await apiGet(`/civitai_studio/images?modelVersionId=${encodeURIComponent(String(version.id))}&limit=30`);
            if (Array.isArray(fd.items) && fd.items.length) images = fd.items;
        }
    } catch (e) { /* 拉取失败回退现有数据 */ }
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
        ${version.description ? `
        <div class="cs-section">
            <div class="cs-section-title">${esc(t("verDescTitle"))}</div>
            <div class="cs-ver-desc-box"><div class="cs-desc-body">${sanitizeHtml(version.description)}</div></div>
        </div>` : ""}
        <div class="cs-section">
            <div class="cs-section-title">${esc(t("files"))}</div>
            <div class="cs-files">${(version.files || []).map((f, i) => `
                <div class="cs-file">
                    <div class="cs-file-info">
                        <div class="cs-file-name" title="${esc(f.name)}">${esc(fileDisplayName(f))}</div>
                        <div class="cs-file-meta">${esc([fileMetaBits(f), fmtSize((f.sizeKB || 0) * 1024)].filter(Boolean).join(" · "))}</div>
                    </div>
                    <button class="cs-btn cs-btn-primary" data-file-idx="${i}">${esc(t("download"))}</button>
                </div>`).join("") || `<div class="cs-empty">${esc(t("noFiles"))}</div>`}
            </div>
        </div>
        ${images.length ? `
        <div class="cs-section">
            <div class="cs-section-title">${esc(t("previews", { n: images.length }))}</div>
            <div class="cs-gallery">${images.map((g) => galleryItemHtml(g, S.cfg.px_media || 320)).join("")}
            </div>
        </div>` : ""}
    `;
    rewriteDescImages(body); // 版本说明里的外链图走代理开关(模型说明同款处理)
    $("#cs-copy-triggers", body)?.addEventListener("click", (e) => copyText(triggers.join(", "), e.target));
    $$(".cs-trigger", body).forEach((el) => { el.onclick = () => copyText(el.textContent, el); });
    $$("[data-file-idx]", body).forEach((btn) => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.fileIdx, 10);
            openDownloadDialog({ model, version, fileIndex: idx, _navFrom: opts._navRec });
        };
    });
    $$(".cs-gallery-item img", body).forEach((img) => {
        img.onclick = () => {
            const direct = img.dataset.direct || "";
            const image = images.find((i) => i.url === direct) || images[0];
            showImageMeta(image, { fromModelId: model.id, fromVersionId: version.id, _navFrom: opts._navRec });
        };
    });
    $$("[data-save-url]", body).forEach((btn) => {
        btn.onclick = (ev) => {
            ev.stopPropagation();
            const direct = btn.dataset.saveUrl || "";
            saveImageToOutput(direct, btn, images.find((i) => i.url === direct));
        };
    });
}

// 大图资源列表:把 meta.resources/civitaiResources/modelVersionIds 解析为可操作 chips。
// 每个 chip:模型名+权重+[已装|未装] 标记;>4 条折叠;未装 LoRA 可一键批量下载。
async function renderResourceList(box, item, rawRes, civRes, vids, imgHashes, navRec) {
    const listEl = box.querySelector("[data-res-list]");
    const summaryEl = box.querySelector("[data-res-summary]");
    if (!listEl) return;
    const merged = new Map(); // vid → {name, weight, type}
    const noVid = [];
    for (const r of rawRes) {
        if (r.modelVersionId) merged.set(String(r.modelVersionId), { name: r.name, weight: r.weight, type: r.type });
        else noVid.push(r);
    }
    for (const r of civRes) {
        const vid = String(r.modelVersionId);
        if (!merged.has(vid)) merged.set(vid, { name: null, weight: r.weight, type: r.type });
    }
    // modelVersionIds 始终并入:它们是图片资源的可靠锚点(站内图 civitaiResources 会对齐,
    // 外部图即使 resources 无 vid 也能解析出名称供比对)
    for (const vid of vids) merged.set(String(vid), merged.get(String(vid)) || { name: null, weight: null, type: "" });
    if (!merged.size && !noVid.length) {
        const blk = box.querySelector("[data-res-block]");
        if (blk) blk.style.display = "none";
        return;
    }
    const isLora = (t, nm) => String(t || "").toLowerCase() === "lora" || /lora/i.test(String(nm || ""));
    let localIndex = null;
    const getLocal = async () => {
        if (localIndex) return localIndex;
        try {
            const d = await apiGet("/civitai_studio/local");
            localIndex = { byName: {}, byVersion: {}, models: d.models || [] };
            for (const m2 of d.models || []) {
                localIndex.byName[String(m2.name || "").toLowerCase()] = m2;
                const cv = m2.civitai || {};
                if (cv.version_id) localIndex.byVersion[String(cv.version_id)] = m2;
                if (cv.model_id) {
                    // 同模型多版本:任一版本命中即视为已装(展示用)
                    if (!localIndex.byName[String(cv.model_name || "").toLowerCase()]) {
                        localIndex.byName[String(cv.model_name || "").toLowerCase()] = m2;
                    }
                }
            }
        } catch (e) { localIndex = { byName: {}, byVersion: {}, models: [] }; }
        return localIndex;
    };
    const local = await getLocal();
    let versions = {};
    const vidKeys = [...merged.keys()];
    if (vidKeys.length) {
        try {
            const d = await apiGet("/civitai_studio/resolve_versions?ids=" + encodeURIComponent(vidKeys.join(",")));
            versions = d.versions || {};
            window.__csVerCache = Object.assign(window.__csVerCache || {}, versions);
        } catch (e) { /* 解析失败降级名字展示 */ }
    }
    const hashPrefix = imgHashes || {};
    const hashMatch = (vid) => {
        const a3 = String((versions[vid] || {}).AutoV3 || "").toUpperCase();
        if (!a3) return false;
        return Object.values(hashPrefix).some((h) => String(h).toUpperCase() === a3.slice(0, String(h).length) && String(h).length >= 6);
    };
    const renderChips = (expanded) => {
        listEl.innerHTML = "";
        const makeChip = (label, vid, weight, lora, installed) => {
            const chip = document.createElement("span");
            const ok = !!installed;
            chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;border-radius:10px;padding:0 7px;"
                + "font-size:11px;white-space:nowrap;cursor:pointer;"
                + (ok ? "background:rgba(76,175,80,.16);border:1px solid #4caf5088;color:var(--fg-color,#eee);"
                    : "background:rgba(226,162,63,.12);border:1px solid #e2a23f66;color:var(--fg-color,#eee);");
            chip.title = ok
                ? (S.lang === "zh" ? "已安装:" : "Installed: ") + (installed.rel || installed.name || "")
                : (ok ? "" : (S.lang === "zh" ? "未安装,点击查看模型" : "Not installed, click to view"));
            chip.innerHTML = "<span>" + esc((ok ? "✔ " : "✖ ") + label + (weight != null ? " × " + weight : "")) + "</span>";
            chip.dataset.vid = vid || "";
            chip.dataset.lora = lora ? "1" : "0";
            chip.dataset.installed = ok ? (installed.name || "1") : "";
            chip.onclick = () => {
                // 必须用 modelId(/models/{id});vid 传给 models API 会 404
                const mid = versions[vid]?.modelId;
                if (mid && /^\d+$/.test(String(mid))) openBrowseFloat(mid, { _navFrom: navRec });
            };
            return chip;
        };
        const chips = [];
        const resolvedLabels = [];
        for (const [vid, r] of merged) {
            const vinfo = versions[vid] || {};
            // chip 显示:模型名 +(版本号);两者皆缺才回退 版本 {id}
            const verPart = vinfo.versionName && vinfo.modelName && vinfo.versionName !== vinfo.modelName ? ` (${vinfo.versionName})` : "";
            const label = vinfo.modelName
                ? vinfo.modelName + verPart
                : (vinfo.versionName || r.name || (S.lang === "zh" ? "版本 " + vid : "Version " + vid));
            resolvedLabels.push(String(label).toLowerCase());
            const lora = isLora(r.type, r.name) || isLora("", vinfo.modelName);
            // 匹配优先级:version_id 精确 > 模型名 > AutoV3 hash 前缀
            const installed = local.byVersion[vid]
                || local.byName[String(vinfo.modelName || "").toLowerCase()]
                || null;
            chips.push(makeChip(label, vid, r.weight, lora, installed));
        }
        for (const r of noVid) {
            const lname = String(r.name || "").toLowerCase();
            // 去重:该名字已被某个已解析 vid 覆盖(名字互相包含)→ 跳过,避免同一资源显示两枚 chip
            if (resolvedLabels.some((rl) => rl && (rl.includes(lname) || lname.includes(rl)))) continue;
            chips.push(makeChip(r.name || "?", "", r.weight, isLora(r.type, r.name), local.byName[lname] || null));
        }
        const show = expanded ? chips : chips.slice(0, 4);
        show.forEach((c) => listEl.appendChild(c));
        if (chips.length > 4) {
            const toggle = document.createElement("span");
            toggle.textContent = expanded ? "▲" : "▼ +" + (chips.length - 4);
            toggle.style.cssText = "cursor:pointer;font-size:11px;color:var(--accent-color,#4a90e2);align-self:center;";
            toggle.onclick = () => renderChips(!expanded);
            listEl.appendChild(toggle);
        }
        const missing = chips.filter((c) => c.dataset.installed === "" && c.dataset.lora === "1" && c.dataset.vid);
        if (missing.length) {
            const btn = document.createElement("button");
            btn.className = "cs-btn cs-btn-mini";
            btn.style.marginTop = "4px";
            btn.textContent = S.lang === "zh" ? "一键补齐缺失 LoRA(" + missing.length + ")" : "Fetch missing LoRAs (" + missing.length + ")";
            btn.onclick = async () => {
                btn.disabled = true;
                btn.textContent = S.lang === "zh" ? "提交中…" : "Submitting…";
                let root = null;
                try {
                    const d = await apiGet("/civitai_studio/destinations?type=LoRA");
                    if ((d.destinations || []).length) root = d.destinations[0].root;
                } catch (e) { }
                if (!root) {
                    toast("error", S.lang === "zh" ? "未找到 LoRA 目录" : "No LoRA dir", S.lang === "zh" ? "请检查模型目录配置" : "Check model paths");
                    btn.disabled = false;
                    return;
                }
                let done = 0, fail = 0;
                for (const c of missing) {
                    const vid = c.dataset.vid;
                    try {
                        const vinfo = (window.__csVerCache || {})[vid] || {};
                        await apiPost("/civitai_studio/download", {
                            version_id: vid, file_index: 0,
                            model_id: vinfo.modelId, model_name: vinfo.modelName || vid,
                            version_name: vinfo.versionName || "", type: "LoRA",
                            root, filename: "",
                        });
                        done++;
                    } catch (e) { fail++; toast("error", S.lang === "zh" ? "下载失败" : "Download failed", String(e.message || e).slice(0, 70)); }
                }
                toast(done ? "success" : "error", S.lang === "zh" ? "已加入下载队列 " + done + " 项" : "Queued " + done, fail ? S.lang === "zh" ? fail + " 项失败" : fail + " failed" : "");
                btn.textContent = S.lang === "zh" ? "已排队 " + done : "Queued " + done;
                switchTab("downloads");
            };
            listEl.appendChild(btn);
        }
        if (summaryEl) summaryEl.textContent = S.lang === "zh"
            ? "(" + chips.filter((c) => c.dataset.installed !== "").length + "/" + chips.length + " 已安装)"
            : "";
    };
    renderChips(false);
}

// 统一大图详情浮层:画廊与图像搜索节点共用同一模板。
// 按钮组:[保存图片](下载到 output)+ [选为输出](把 ID 写进图像搜索的 image_id)
//        + [应用到工作流](仅当图片带生成参数时有)
function openImageDetail(item, opts = {}) {
    let meta = item.meta || {};
    meta = unwrapMeta(meta);
    const hasMeta = !!(meta && (meta.prompt || meta.seed != null));
    // 内嵌参数回读(接线 embedded_meta):存图到本地后的大图浮层,首次无 meta 时
    // 后台读 output 文件的内嵌生成数据,命中则带 meta 重开浮层(单实例自动替换)
    if (!hasMeta && item.saved_filename && !opts.__embedRetry) {
        apiPost("/civitai_studio/embedded_meta", {
            filename: item.saved_filename,
            subfolder: item.saved_subfolder || "",
        }).then((r) => {
            if (r && r.meta && (r.meta.prompt || r.meta.parameters || r.meta.workflow)) {
                openImageDetail({ ...item, meta: r.meta }, { ...opts, __embedRetry: true });
            }
        }).catch(() => { });
    }
    const kv = hasMeta
        ? [["Checkpoint", meta["Model"] || (meta.hashes || {}).model], ["Base Model", item.baseModel], [t("kvSampler"), meta.sampler], [t("kvSteps"), meta.steps],
        ["CFG", meta.cfgScale], ["Seed", meta.seed], [t("kvSize"), (meta.width || "") + (meta.width ? "×" + meta.height : "")]]
        : [[t("galleryAuthor"), item.username], ["❤", fmtNum(item.stats?.heartCount ?? item.stats?.likeCount)],
        // 批4 D1:无 meta 图(如 17391786)此前整块 kv 都不显示,底模走 REST 顶层 baseModel 字段
        ["Base Model", item.baseModel]];
    const kvHtml = kv.filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(String(v))}</span></div>`).join("");
    // 资源条目统一收集:resources(外部图,含权重)+ civitaiResources(站内图,带 modelVersionId)
    // + modelVersionIds(锚点);去重后交给异步解析渲染
    const metaHashes = meta.hashes || {};
    const rawRes = (meta.resources || []).map((r) => ({
        name: r.name || r.modelName || "?", weight: r.weight, type: r.type || "",
        modelId: r.modelId || null, modelVersionId: r.modelVersionId || null,
    }));
    const civRes = (meta.civitaiResources || []).filter((r) => r.modelVersionId);
    const vidSet = new Set([
        ...rawRes.map((r) => r.modelVersionId).filter(Boolean),
        ...civRes.map((r) => r.modelVersionId).filter(Boolean),
        ...(item.modelVersionIds || []),
    ]);
    // 资源模型的 modelId(meta.resources[].modelId / modelVersionId 也可反查,此处用已知字段)
    const resModelIds = (meta.resources || [])
        .map((r2) => r2.modelId || r2.model_id).filter(Boolean);
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
        <div class="cs-meta-block" data-res-block style="${rawRes.length || vidSet.size ? "" : "display:none"}">
            <div class="cs-section-title">${esc(S.lang === "zh" ? "相关资源" : "Related resources")} <span class="cs-form-hint" data-res-summary></span></div>
            <div data-res-list style="display:flex;flex-wrap:wrap;gap:4px;"></div>
        </div>
        <div class="cs-modal-actions">
            <button class="cs-btn" data-fav-big title="${esc(t("favBtnTitle"))}">★ ${esc(t("favBtnTitle"))}</button>
            <button class="cs-btn" data-save-img>${esc(t("saveBtn"))}</button>
            ${item.id != null ? `<button class="cs-btn" data-import-asset>${esc(t("importAsset"))}</button>
            <button class="cs-btn" data-extract-wf>${esc(t("extractWf"))}</button>` : ""}
            <button class="cs-btn cs-btn-primary" data-use-as-output>${esc(t("useAsOutput"))}</button>
            ${hasMeta ? `<button class="cs-btn" data-apply-workflow>${esc(t("applyBtn"))}</button>` : ""}
            ${(opts.fromModelId || item.modelId) ? `<button class="cs-btn" data-view-model>${esc(S.lang === "zh" ? "查看模型" : "View Model")}</button>` : ""}
        </div>`, null, !!opts._navFrom);
    // 本页入导航栈(来源信息页隐藏保活;✕/Esc/m.close() 整链关闭)
    const rec = navPush(m.overlay, m, opts._navFrom || null);
    // 大图浮层收藏入口
    const favBig = $("[data-fav-big]", m.box);
    if (favBig && item.id != null) {
        const oid = String(item.id);
        const syncFav = (on) => { favBig.style.color = on ? "#ffd75e" : ""; };
        syncFav(S.favs?.has(oid));
        favBig.onclick = async (ev) => {
            try {
                const on = await toggleFav("asset", oid, { name: item.username || "", cover: item.url, extra: { nsfwLevel: nsfwBitsOf(item) } });
                syncFav(on);
                // 批8.2:新增收藏弹收藏夹选择器(与其余★入口同款)
                if (on) {
                    const cur = ((S.favData?.items || []).find((x) => x.kind === "asset" && String(x.oid) === oid) || {}).group_ids || [];
                    openGroupPicker(ev, "asset", cur, async (gids) => {
                        try { await apiPost("/civitai_studio/favorites/assign", { kind: "asset", oid, group_ids: gids }); }
                        catch (e2) { toast("error", t("favFailed"), e2.message); }
                    });
                }
            } catch (e) { toast("error", t("favFailed"), e.message); }
        };
    }
    // 导入为资产 / 提取工作流(都从原始文件取数据)
    const importBtn = $("[data-import-asset]", m.box);
    if (importBtn) importBtn.onclick = async () => {
        importBtn.disabled = true;
        try {
            const r = await apiPost("/civitai_studio/import_asset", { url: item.url, image_id: String(item.id) });
            toast("success", t(r.existed ? "importAssetExists" : "importAssetDone", { name: r.name }), r.dir || "");
        } catch (e) { toast("error", t("importFailed"), e.message); }
        finally { importBtn.disabled = false; }
    };
    const extractBtn = $("[data-extract-wf]", m.box);
    if (extractBtn) extractBtn.onclick = async () => {
        extractBtn.disabled = true;
        try {
            const r = await apiPost("/civitai_studio/extract_workflow", { url: item.url, image_id: String(item.id) });
            toast("success", t("extractDone", { name: r.name }), r.warn ? t("extractCapWarn", { n: r.count }) : "");
        } catch (e) {
            const noWf = /未内嵌/.test(e.message || "");
            toast("error", t(noWf ? "extractNone" : "extractFail"), e.message);
        }
        finally { extractBtn.disabled = false; }
    };
    const vmBtn = $("[data-view-model]", m.box);
    if (vmBtn) vmBtn.onclick = () => {
        const mid = item.modelId || opts.fromModelId;
        openBrowseFloat(mid, { _navFrom: rec }); // 跳模型页:本页隐藏保活,顶部"返回"可回
    };
    attachIdAndTags(m.box, item); // ID 行 + 标签行(插在 kv 网格之前)
    // 资源流水线:解析(vid→模型信息) → 与 meta.hashes 前缀比对 → 本地索引匹配 → chips 渲染
    renderResourceList(m.box, item, rawRes, civRes, [...vidSet], meta.hashes || {}, rec);
    // 非公开 API 生成数据回退(E2E d + r3-21):meta 缺失,或 meta 有但 resources/
    // civitaiResources 全空(实测图 144033695/143463647:gen_data 顶层才有 resources)
    // 时探 tRPC image.getGenerationData;命中 meta 且本地缺失 → 带参重开浮层;
    // 否则至少把 resources(底模/LoRA)+ tools/techniques 补进本浮层
    const noRes = !rawRes.length && !civRes.length && !vidSet.size;
    if (item.id != null && !opts.__genRetry && (!hasMeta || noRes)) {
        apiGet(`/civitai_studio/image_gen_data/${encodeURIComponent(String(item.id))}`).then((gd) => {
            if (!m.box.isConnected) return; // 浮层已被关闭
            if (!hasMeta && gd && gd.meta && (gd.meta.prompt || gd.meta.seed != null)) {
                openImageDetail({ ...item, meta: gd.meta }, { ...opts, __genRetry: true });
                return;
            }
            const res = ((gd && gd.resources) || []).filter((r) => r.modelVersionId || r.modelName);
            if (res.length && noRes) { // 首条流水线无输入才补渲染,防并发覆盖(审计二 F-4)
                const block = $("[data-res-block]", m.box);
                if (block) block.style.display = "";
                const conv = res.map((r) => ({
                    name: r.modelName || "?", weight: r.strength, type: r.modelType || "",
                    modelId: r.modelId || null, modelVersionId: r.versionId || r.modelVersionId || null,
                }));
                renderResourceList(m.box, item, conv, [], conv.map((r) => r.modelVersionId).filter(Boolean), {}, rec);
            }
            if (gd && gd.paused) {  // 熔断期:纯静默降级会让用户以为功能坏了(评审R2),kv 区灰字说明
                const kv0 = $(".cs-kv-grid", m.box);
                if (kv0) kv0.insertAdjacentHTML("afterbegin",
                    `<div style="grid-column:1/-1;color:var(--desc-text-color,#999);font-size:11px;">${esc(S.lang === "zh" ? "生成参数暂不可获取(接口限流," + (gd.retryAfterSec || 600) + "s 后恢复)" : "Gen data unavailable (rate-limited, retry in " + (gd.retryAfterSec || 600) + "s)")}</div>`);
            }
            const tools = ((gd && gd.tools) || []).map((x) => x.name).filter(Boolean);
            const techs = ((gd && gd.techniques) || []).map((x) => x.name).filter(Boolean);
            const kvGrid = $(".cs-kv-grid", m.box);
            if (kvGrid && (tools.length || techs.length)) {
                kvGrid.insertAdjacentHTML("beforeend",
                    (tools.length ? `<div><b>${esc(S.lang === "zh" ? "工具" : "Tools")}</b><span>${esc(tools.join(", "))}</span></div>` : "")
                    + (techs.length ? `<div><b>${esc(S.lang === "zh" ? "技法" : "Techniques")}</b><span>${esc(techs.join(", "))}</span></div>` : ""));
            }
        }).catch(() => { });
    }

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
            } catch (e2) { }
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

// 画廊等无节点上下文的入口;opts.fromModelId/fromVersionId 用于"返回模型页"按钮
async function showImageMeta(image, opts = {}) {
    openImageDetail(image, opts);
}

// image_id 记忆:成功记录(点选/输入回车且 API 拉取成功)才入列表并持久化;
// 404 的 ID 不保留。前端列表存 localStorage,补全弹层(attachComboComplete)实时读取
function rememberImage(id) {
    if (!id || !/^\d+$/.test(String(id))) return;
    try {
        const key = "cs_recent_image_ids";
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        const i = list.indexOf(String(id));
        if (i >= 0) list.splice(i, 1);
        list.unshift(String(id));
        localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
    } catch (e) { /* 隐私模式等场景忽略 */ }
    apiPost(`/civitai_studio/remember_image/${encodeURIComponent(String(id))}`).catch(() => { });
}

// 收藏切换(全入口统一走这里;本地 Set 同步维护,供画廊/节点★即时回显)
async function toggleFav(kind, oid, fields) {
    const r = await apiPost("/civitai_studio/favorites/toggle", { kind, oid: String(oid), ...(fields || {}) });
    const setKey = kind === "model" ? "favModelIds" : "favs";
    S[setKey] = S[setKey] || new Set();
    if (r.fav) S[setKey].add(String(oid)); else S[setKey].delete(String(oid));
    // 16:收藏 tab 正开着就即时重拉+重渲染,免"切一次 tab 才能看到"
    if (S.ui.tab === "favorites" && S.favData) loadFavDataOnly().catch(() => { });
    return !!r.fav;
}

// E2E #8:收藏时在鼠标位置弹出收藏夹多选浮层(默认未分组);checkbox 即点即生效,
// 点浮层外关闭。done(gids) 每次勾选变化回调当前全量选择。取消收藏不弹浮层。
async function openGroupPicker(ev, kind, selectedGids, onDone) {
    // 收藏 tab 从未打开过时 S.favData 为空:先拉一次分组,防误显"还没有收藏夹"
    if (!S.favData) {
        try {
            const d = await apiGet("/civitai_studio/favorites");
            S.favData = { items: d.items || [], groups: d.groups || [] };
        } catch (e) { /* 拉不到就按空渲染,浮层仍可用(未分组收藏) */ }
    }
    const groups = groupsForKind(S.favData?.groups, kind).filter((g) => g.ctype !== "Legacy");
    const sel = new Set((selectedGids || []).slice());
    const pop = document.createElement("div");
    pop.className = "cs-group-picker";
    pop.style.cssText = "position:fixed;z-index:60001;min-width:190px;max-height:300px;overflow-y:auto;"
        + "background:var(--comfy-input-bg,var(--bg-color,#2b2b30));color:var(--fg-color,#ddd);"
        + "border:1px solid var(--border-color,#3a3a40);border-radius:8px;"
        + "box-shadow:0 8px 24px rgba(0,0,0,.5);padding:8px;font-size:12px;cursor:default;";
    const head = document.createElement("div");
    head.style.cssText = "font-weight:600;margin-bottom:2px;";
    head.textContent = t("groupPickTitle");
    const hint = document.createElement("div");
    hint.style.cssText = "color:#999;font-size:10px;margin-bottom:6px;";
    hint.textContent = t("groupPickNone");
    pop.appendChild(head);
    pop.appendChild(hint);
    const rowOf = (g) => {
        const lb = document.createElement("label");
        lb.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 2px;cursor:pointer;white-space:nowrap;";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = sel.has(g.gid);
        cb.onchange = () => {
            if (cb.checked) sel.add(g.gid); else sel.delete(g.gid);
            onDone([...sel]);
        };
        lb.appendChild(cb);
        lb.appendChild(document.createTextNode(g.name));
        return lb;
    };
    if (!groups.length) {
        const none = document.createElement("div");
        none.style.cssText = "color:#777;font-size:11px;padding:2px 0 4px;";
        none.textContent = S.lang === "zh" ? "还没有收藏夹 — 收藏页可新建" : "No collections yet — create one in Favorites";
        pop.appendChild(none);
    }
    for (const g of groups) pop.appendChild(rowOf(g));
    // 批A:＋ 新收藏 — 输入名称即建组(本地 dirty=1,上行走惰性建集)并勾选挂载
    const newRow = document.createElement("div");
    newRow.style.cssText = "border-top:1px solid var(--border-color,#3a3a40);margin-top:6px;padding-top:6px;";
    const addBtn = document.createElement("span");
    addBtn.style.cssText = "cursor:pointer;color:var(--accent-color,#4a90e2);font-size:11px;";
    addBtn.textContent = t("pickerNew");
    addBtn.onclick = (e2) => {
        e2.stopPropagation();
        newRow.innerHTML = "";
        const inp = document.createElement("input");
        inp.type = "text";
        inp.placeholder = t("newColPh");
        inp.style.cssText = "width:100%;font-size:11px;padding:2px 4px;";
        newRow.appendChild(inp);
        inp.focus();
        const commit = async () => {
            const name = inp.value.trim();
            if (!name) { newRow.innerHTML = ""; newRow.appendChild(addBtn); return; }
            try {
                const r = await apiPost("/civitai_studio/favorites/groups", { name });
                if (r.group?.gid) {
                    sel.add(r.group.gid);
                    if (!S.favData) S.favData = { items: [], groups: [] };
                    if (!(S.favData.groups || []).some((g2) => g2.gid === r.group.gid)) {
                        S.favData.groups = [{ gid: r.group.gid, name, ctype: null }, ...(S.favData.groups || [])];
                    }
                    toast("success", t("groupCreated", { name }), "");
                    try { refreshFavGroupSel(S.ui.root); } catch (_) { } // 批4 E2E 5a:收藏 tab 已打开时新组即时进筛选下拉
                    onDone([...sel]);
                }
                close();
            } catch (err) { toast("error", t("favFailed"), err.message); }
        };
        inp.onkeydown = (e3) => {
            if (e3.key === "Enter") commit();
            if (e3.key === "Escape") { newRow.innerHTML = ""; newRow.appendChild(addBtn); }
            e3.stopPropagation();
        };
        inp.onblur = commit;
    };
    newRow.appendChild(addBtn);
    pop.appendChild(newRow);
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(ev.clientX ?? 0, window.innerWidth - r.width - 8) + "px";
    pop.style.top = Math.min(ev.clientY ?? 0, window.innerHeight - r.height - 8) + "px";
    const close = () => { window.removeEventListener("pointerdown", h, true); pop.remove(); };
    // 批5:同 mini 菜单的 window 捕获隔离(内部阻断宿主 pointer 干预,外部即关)
    const h = (e2) => {
        if (pop.contains(e2.target)) { e2.stopPropagation(); return; }
        close();
    };
    window.addEventListener("pointerdown", h, true);
}

// 批C:通用鼠标位置小菜单(标签/底模点击的 复制/搜索 二选一)
function openMiniMenu(ev, options) {
    document.querySelectorAll(".cs-mini-menu").forEach((n) => n.remove());
    const pop = document.createElement("div");
    pop.className = "cs-mini-menu";
    pop.style.cssText = "position:fixed;z-index:60002;min-width:140px;"
        + "background:var(--comfy-input-bg,var(--bg-color,#2b2b30));color:var(--fg-color,#ddd);"
        + "border:1px solid var(--border-color,#3a3a40);border-radius:8px;"
        + "box-shadow:0 8px 24px rgba(0,0,0,.5);padding:4px;font-size:12px;cursor:default;";
    let fired = "";
    const fire = (op) => {
        if (fired) return; // click/pointerup 双通道只执行一次
        fired = op.label;
        console.log("[Civitai-Studio][menu] item:", op.label);
        close();
        try { op.cb(); } catch (err) {
            console.error("[Civitai-Studio][menu] cb failed:", err);
            toast("error", t("loadFailedTitle"), String((err && err.message) || err));
        }
    };
    for (const op of options) {
        const row = document.createElement("div");
        row.style.cssText = "padding:6px 10px;border-radius:5px;cursor:pointer;white-space:nowrap;";
        row.textContent = op.label;
        row.onmouseenter = () => { row.style.background = "var(--border-color,#3f3f46)"; };
        row.onmouseleave = () => { row.style.background = "transparent"; };
        row.dataset.csMi = op.label;
        row.__csCb = op;
        pop.appendChild(row);
    }
    // 批5:委托式双通道激活 — click 被宿主抑制时 pointerup 仍可达
    const activate = (e) => {
        const row = e.target.closest("[data-cs-mi]");
        if (row) fire(row.__csCb);
    };
    pop.addEventListener("click", activate);
    pop.addEventListener("pointerup", activate);
    console.log("[Civitai-Studio][menu] open:", options.map((o) => o.label).join("/"));
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(ev.clientX ?? 0, window.innerWidth - r.width - 8) + "px";
    pop.style.top = Math.min(ev.clientY ?? 0, window.innerHeight - r.height - 8) + "px";
    // 批5:window 捕获隔离 — 先于宿主 document handler 执行;弹层内部阻断传播
    // (防宿主对 pointerdown preventDefault 按规范抑制后续 click — "菜单项点了没反应"根因),
    // 弹层外部按下即关
    const h = (e2) => {
        if (pop.contains(e2.target)) { e2.stopPropagation(); return; }
        window.removeEventListener("pointerdown", h, true);
        pop.remove();
    };
    window.addEventListener("pointerdown", h, true);
}

// 批C:跳浏览按 tag/底模搜索(加入已选列表,不覆盖)
function searchBrowseByTag(tg) {
    const names = String(S.browse.tag || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.some((n) => n.toLowerCase() === String(tg).toLowerCase())) names.push(String(tg));
    S.browse.tag = names.join(",");
    if (S.ui.__browseTagPicker) S.ui.__browseTagPicker.set(names);
    switchTab("browse");
    triggerBrowseRefresh();
}

function searchGalleryByTag(name) {
    const names = String(S.gal.tag || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.some((n) => n.toLowerCase() === String(name).toLowerCase())) names.push(String(name));
    S.gal.tag = names.join(",");
    if (S.ui.__galTagPicker) S.ui.__galTagPicker.set(names);
    switchTab("gallery");
    fetchGallery(true);
}

function searchBrowseByBase(bm) {
    const names = String(S.browse.base || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.some((n) => n.toLowerCase() === String(bm).toLowerCase())) names.push(String(bm));
    S.browse.base = names.join(",");
    if (S.ui.__browseBasePicker) S.ui.__browseBasePicker.set(names);
    switchTab("browse");
    triggerBrowseRefresh();
}

// 把图片 ID 写进图像搜索节点的 image_id(优先显式指定,其次画布选中,最后第一个)
function selectAsOutput(item, preferred) {
    const all = (app.graph?._nodes || []).filter((n) => n.type === "CivitaiStudio_ImageSearch");
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
        if (idw.inputEl) idw.inputEl.value = idw.value; // STRING widget 双写防重绘清空
        rememberImage(idw.value);
    }
    // 缓存选中图:它可能不在该节点的搜索结果里(csResults),信息面板刷新时兜底展示
    node.csInfoCache = item;
    renderNodeThumbs(node);
    try { app.canvas.setDirty(true, true); } catch (e) { }
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
async function openDownloadDialog({ model, version, fileIndex = null, defaultRoot = "", defaultSub = "", _navFrom = null }) {
    if (!version) {
        toast("error", t("cantDownload"), t("versionNotFound"));
        return;
    }
    let destinations = [];
    let destError = "";
    let allDests = [], typeMap = {}, destScopes = [];
    try {
        const data = await apiGet(`/civitai_studio/destinations?type=${encodeURIComponent(model.type || "Other")}`);
        destinations = data.destinations || [];
    } catch (e) {
        destError = e.message;
    }
    // 手动改类型/实例用:全量目录 + 类型→目录映射 + 实例清单(拉取失败仅退回原类型)
    try {
        const all = await apiGet("/civitai_studio/destinations?type=all");
        allDests = all.destinations || [];
        typeMap = all.type_map || {};
        destScopes = all.scopes || [];
    } catch (e) { /* 忽略 */ }
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
    const curType = model.type || "Other";
    const typeKeys = [...new Set([curType, ...Object.keys(typeMap)])];
    // [实例]下拉:后端按注册根实际归类下发(共享目录/本实例…),末项"所有实例"
    const scopeOpts = [...destScopes.map((s) => [s.id, s.label]), ["all", t("scopeAll")]];
    // 过滤:shared=共享目录/install=本实例;all = 全部
    const destsFor = (tp, scope) => {
        const keys = typeMap[tp];
        let list = tp === curType && destinations.length
            ? destinations
            : (keys ? allDests.filter((d) => keys.includes(d.key)) : allDests);
        if (scope !== "all") list = list.filter((d) => d.scope === scope);
        return list;
    };
    // 默认实例取当前目标目录所在 scope
    const preScope = (destinations.find((d) => d.root === preRoot) || allDests.find((d) => d.root === preRoot) || {}).scope
        || (destScopes[0] || {}).id || "all";
    const m = showModal(`
        <h3 class="cs-modal-title">${esc(t("dlDialogTitle", { name: version.name || model.name }))}</h3>
        <div class="cs-form">
            ${files.length > 1 ? `
            <label>${esc(t("fileLabel"))}
                <select id="cs-dl-file">${files.map((f, i) => {
        const bits = fileMetaBits(f);
        return `<option value="${i}" ${i === selIdx ? "selected" : ""}>${esc(fileDisplayName(f))}${bits ? " · " + esc(bits) : ""} (${fmtSize((f.sizeKB || 0) * 1024)})</option>`;
    }).join("")}
                </select>
            </label>` : ""}
            ${typeKeys.length > 1 ? `
            <label>${esc(t("modelTypeLabel"))}
                <select id="cs-dl-type">${typeKeys.map((tp) => `<option value="${esc(tp)}" ${tp === curType ? "selected" : ""}>${esc(tp)}</option>`).join("")}</select>
            </label>` : ""}
            <label>${esc(t("scopeLabel"))}
                <select id="cs-dl-scope">${scopeOpts.map(([v, label]) => `<option value="${v}" ${v === preScope ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
            </label>
            <label>${esc(t("targetFolder"))}
                <select id="cs-dl-root"></select>
            </label>
            <label>${esc(t("subfolder"))}
                <div style="display:flex;gap:4px;align-items:center;">
                    <input id="cs-dl-sub" type="text" placeholder="${esc(t("subfolderPh"))}" value="${esc(defaultSub)}" style="flex:1;min-width:0;"/>
                    <button class="cs-btn" id="cs-dl-sub-browse" type="button">${esc(t("browseBtn"))}</button>
                </div>
            </label>
            <label>${esc(t("saveName"))}
                <input id="cs-dl-name" type="text" value="${esc(fileDisplayName(files[selIdx]) || (version.name + ".safetensors"))}"/>
            </label>
            <div class="cs-modal-msg cs-dl-hint">${esc(t("dlHint", { hash: S.cfg.verify_hash ? t("dlHintHash") : "" }))}</div>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
                <button class="cs-btn cs-btn-primary" data-act="ok">${esc(t("startDownload"))}</button>
            </div>
        </div>`, null, !!_navFrom);
    const rec = navPush(m.overlay, m, _navFrom || null); // 入导航栈:开始下载/取消后"返回"回来源页
    $("[data-act=cancel]", m.box).onclick = () => navBack(rec);
    const fileSel = $("#cs-dl-file", m.box);
    if (fileSel) {
        fileSel.onchange = () => {
            const f = files[parseInt(fileSel.value, 10)];
            if (f) $("#cs-dl-name", m.box).value = fileDisplayName(f);
        };
    }
    // 切类型/范围 → 重建目标目录;原目录仍在清单中则保持选中(初始以 preRoot 为准)
    const typeSel = $("#cs-dl-type", m.box);
    const scopeSel = $("#cs-dl-scope", m.box);
    const rootSel = $("#cs-dl-root", m.box);
    const rebuildRoots = (seedCur) => {
        const cur = seedCur !== undefined ? seedCur : rootSel.value;
        const list = destsFor(typeSel ? typeSel.value : curType, scopeSel ? scopeSel.value : "all");
        rootSel.innerHTML = list.length
            ? list.map((d) => `<option value="${esc(d.root)}" ${d.root === cur ? "selected" : ""}>${esc(d.label)}</option>`).join("")
            : `<option value="">${esc(S.lang === "zh" ? "(此范围无可用目录)" : "(no folders in this scope)")}</option>`;
    };
    rebuildRoots(preRoot);
    if (typeSel) typeSel.onchange = () => rebuildRoots();
    if (scopeSel) scopeSel.onchange = () => rebuildRoots();
    $("#cs-dl-sub-browse", m.box).onclick = () => openSubdirPicker(() => rootSel.value, (p) => {
        $("#cs-dl-sub", m.box).value = p;
    });
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
                type: typeSel ? typeSel.value : model.type,
                base_model: version.baseModel,
                root: $("#cs-dl-root", m.box).value,
                subfolder: $("#cs-dl-sub", m.box).value.trim(),
                filename: $("#cs-dl-name", m.box).value.trim(),
            };
            const res = await apiPost("/civitai_studio/download", body);
            toast("success", t("queuedToast"), `${model.name} — ${version.name}`);
            if (res.job) S.dl.jobs.unshift(res.job); // 立即入列,不等下一次轮询
            lastPollTs = 0;
            pollDownloads(); // 只刷新队列角标,不跳下载页
            navBack(rec); // 触发"返回":关窗回到来源页(一般是模型页)
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
                <button class="cs-btn cs-btn-mini" data-move="${esc(m.id)}">${esc(t("moveBtn"))}</button>
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
    $$("[data-move]", list).forEach((btn) => {
        btn.onclick = () => {
            const m = findLocalModel(btn.dataset.move);
            if (m) openMoveDialog(m);
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
                body = {
                    category: m.category, rel: m.rel, model_id: selected.model_id,
                    version_id: versionWrap.style.display !== "none" && versionSel.value ? versionSel.value : undefined
                };
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

// ---------- IndexedDB(画廊快照 + 缩略图 blob — 页面重载/重启后秒开;存储系统阶段3 L1) ----------
let _idbPromise = null;
function idb() {
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise((res) => {
        try {
            const rq = indexedDB.open("civitai-studio", 2);
            rq.onupgradeneeded = () => {
                const db = rq.result;
                if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
                if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs");
            };
            rq.onsuccess = () => {
                const db = rq.result;
                db.onversionchange = () => { try { db.close(); } catch { } }; // 让位未来版本升级
                res(db);
            };
            rq.onerror = () => res(null); // 无 IDB(隐私模式等):降级为无快照/无 blob 缓存
            rq.onblocked = () => res(null);
        } catch { res(null); }
    });
    return _idbPromise;
}
async function idbGet(store, key) {
    const db = await idb();
    if (!db) return undefined;
    return new Promise((res) => {
        try {
            const rq = db.transaction(store).objectStore(store).get(key);
            rq.onsuccess = () => res(rq.result);
            rq.onerror = () => res(undefined);
        } catch { res(undefined); }
    });
}
async function idbSet(store, key, val) {
    const db = await idb();
    if (!db) return;
    try {
        db.transaction(store, "readwrite").objectStore(store).put(val, key);
    } catch { }
}

// 缩略图 blob 缓存:命中免 CDN;objectURL 按 url 复用防会话内泄漏;容量上限按键序近似裁剪
const THUMB_CAP = 800;
const THUMB_BLOB_TTL = 7 * 86400 * 1000; // 站方可能替换原图:blob 一周后重拉
const _thumbObjUrls = new Map();          // url -> objectURL(会话级复用)
const _thumbPending = new Map();          // url -> Promise(并发同 url 去重)
let _thumbPuts = 0;
async function attachThumbBlob(imgEl, url) {
    if (!url) return;
    const cached = _thumbObjUrls.get(url);
    if (cached) { imgEl.src = cached; imgEl.style.display = ""; return; }
    let inflight = _thumbPending.get(url);
    if (inflight) { await inflight.catch(() => { }); if (_thumbObjUrls.has(url)) { imgEl.src = _thumbObjUrls.get(url); imgEl.style.display = ""; } return; }
    inflight = (async () => {
        let blob = null;
        try {
            const rec = await idbGet("thumbs", url);
            if (rec?.blob && Date.now() - (rec.ts || 0) < THUMB_BLOB_TTL) blob = rec.blob;
        } catch { }
        if (!blob) {
            try {
                const resp = await fetch(url);
                if (!resp.ok) return; // 拉取失败:保持原 src(HTTP 缓存兜底)
                blob = await resp.blob();
            } catch { return; }
            idbSet("thumbs", url, { blob, ts: Date.now() }).then(() => {
                if (++_thumbPuts % 25 === 0) idbTrimThumbs(THUMB_CAP);
            }).catch(() => { });
        }
        const obj = URL.createObjectURL(blob);
        _thumbObjUrls.set(url, obj);
        imgEl.src = obj;
        imgEl.style.display = ""; // 原 CDN src 失败时 onerror 会隐藏,换 blob 成功要复位
        if (_thumbObjUrls.size > 600) { // 会话内存上限:最旧先 revoke
            for (const [k, v] of _thumbObjUrls) {
                if (_thumbObjUrls.size <= 500) break;
                try { URL.revokeObjectURL(v); } catch { }
                _thumbObjUrls.delete(k);
            }
        }
    })();
    _thumbPending.set(url, inflight);
    try { await inflight; } finally { _thumbPending.delete(url); }
}
async function idbTrimThumbs(cap) {
    // 淘汰顺序为键序近似(非严格 LRU),只控容量;被裁掉的缩略图会按需重新缓存
    const db = await idb();
    if (!db) return;
    await new Promise((res) => {
        try {
            const tx = db.transaction("thumbs", "readwrite");
            const st = tx.objectStore("thumbs");
            const cntReq = st.count();
            cntReq.onsuccess = () => {
                let over = cntReq.result - cap;
                if (over <= 0) { res(); return; }
                const cur = st.openCursor();
                cur.onsuccess = () => {
                    const c = cur.result;
                    if (!c || over <= 0) { res(); return; }
                    over -= 1;
                    c.delete();
                    c.continue();
                };
                cur.onerror = () => res();
            };
            cntReq.onerror = () => res();
        } catch { res(); }
    });
}

const GAL_SNAPSHOT_KEY = "gal_snapshot";
function galleryFilters(st) {
    return {
        sort: st.sort, period: st.period, nsfwLevel: st.nsfwLevel, base: st.base, tag: st.tag,
        imageId: st.imageId || "", fmt: st.fmt || "all",
        nsfwLv: [...(st.nsfwLv || [])], thumbSize: st.thumbSize || 256, favOnly: !!st.favOnly, // 批11.5
    };
}
async function saveGallerySnapshot() {
    const st = S.gal;
    if (!st.items.length) return;
    const truncated = st.items.length > 240; // 截断时丢弃游标:防恢复后滚动加载跳过中段
    await idbSet("kv", GAL_SNAPSHOT_KEY, {
        items: st.items.slice(0, 240), // 上限防快照无限膨胀
        next: truncated ? [] : (st.next || []),
        filters: galleryFilters(st),
        ts: Date.now(),
    });
}
async function restoreGallerySnapshot(view) {
    const st = S.gal;
    if (st.items.length || st.loading) return;
    const snap = await idbGet("kv", GAL_SNAPSHOT_KEY);
    if (!view.isConnected || st.items.length || st.loading) return; // 等待期间用户已手动刷新
    if (!snap || !Array.isArray(snap.items) || !snap.items.length) return;
    if (snap.ts && Date.now() - snap.ts > 30 * 86400 * 1000) return; // 快照超龄作废
    const f = snap.filters || {};
    st.sort = f.sort || st.sort;
    st.period = f.period || st.period;
    st.nsfwLevel = typeof f.nsfwLevel === "number" ? f.nsfwLevel : st.nsfwLevel;
    st.base = f.base || "";
    st.tag = f.tag || "";
    st.imageId = f.imageId || "";
    st.fmt = f.fmt || "all";
    st.items = snap.items.map((x) => { const c = { ...x }; delete c.__rendered; return c; });
    st.next = Array.isArray(snap.next) ? snap.next : [];
    st.__restored = true; // 首次切到画廊页时渲染 + 静默刷新(隐藏态不渲染,clientWidth 为 0)
    // 同步筛选控件回显
    const setVal = (sel, v) => { const el = $(sel, view); if (el) el.value = v; };
    setVal("#cs-gal-sort", st.sort);
    setVal("#cs-gal-period", st.period);
    setVal("#cs-gal-nsfw", String(st.nsfwLevel));
    if (view.__galBasePicker) view.__galBasePicker.set(String(st.base || "").split(",").map((x) => x.trim()).filter(Boolean));
    setVal("#cs-gal-imgid", st.imageId);
    setVal("#cs-gal-fmt", st.fmt);
    // 批11.5:分级多选/尺寸/只看收藏一并回显
    st.nsfwLv = new Set(Array.isArray(f.nsfwLv) ? f.nsfwLv : []);
    if (view.__galLv) view.__galLv.set([...st.nsfwLv]);
    if (typeof f.thumbSize === "number") st.thumbSize = f.thumbSize;
    setVal("#cs-gal-size", String(st.thumbSize));
    st.favOnly = !!f.favOnly;
    {
        const fb = $("#cs-gal-fav", view);
        if (fb) { fb.style.background = st.favOnly ? "var(--accent-color,#4a90e2)" : ""; fb.style.color = st.favOnly ? "#fff" : ""; }
    }
    if (view.__galTagPicker) view.__galTagPicker.set(String(st.tag || "").split(",").map((s) => s.trim()).filter(Boolean));
}

// ---------- 社区画廊(images API) ----------
let _galLastReq = 0; // 批5 a:画廊请求最小间隔节流

function _galTagIds(st) {
    // 纯数字直接用;名称经本地映射(名称→ID)转换,查不到的跳过
    if (!String(st.tag || "").trim()) return [];
    return st.tag.replace("，", ",").split(",").map((x) => x.trim()).filter(Boolean)
        .map((x) => (/^\d+$/.test(x) ? x : (S.tagMap && S.tagMap[x]) || null))
        .filter(Boolean);
}

// 批5 E2E 7:多 tag AND = 漏斗式逐 tag 查询+游标,按第一 tag 顺序求交
// (/images 的 tags 多值为 OR 原生语义,AND 只能自行求交;复用浏览 OR 的 per-tag 游标方案)
async function _galleryAndPage(st, reset, ids) {
    const sig = ids.join("|");
    if (reset || !st.tagAnd || st.tagAnd.sig !== sig) {
        st.tagAnd = { sig, cursors: ids.map((id) => ({ id, next: null, done: false, items: [] })) };
    }
    for (const c of st.tagAnd.cursors) {
        if (c.done) continue;
        const p = new URLSearchParams({ limit: "100", sort: st.sort, period: st.period });
        p.set("nsfw", st.nsfwLevel > 0 ? "true" : "false");
        if (String(st.imageId || "").trim()) p.set("imageId", String(st.imageId).trim());
        if (st.base) p.set("baseModels", st.base);
        if (st.fmt === "image" || st.fmt === "video") p.set("type", st.fmt); // 批11.5:媒体类型服务端过滤
        p.set("tags", c.id);
        if (!reset && c.next) for (const [k, v] of c.next) p.append(k, v);
        const gap = Date.now() - _galLastReq;
        if (gap < 900) await new Promise((r2) => setTimeout(r2, 900 - gap));
        _galLastReq = Date.now();
        const d = await apiGet("/civitai_studio/images?" + p.toString());
        c.items = c.items.concat(d.items || []);
        c.next = d.next_query || [];
        c.done = !(c.next || []).length;
    }
    const rest = st.tagAnd.cursors.slice(1).map((c) => new Set(c.items.map((x) => String(x.id))));
    const merged = [];
    const seen = new Set();
    for (const x of st.tagAnd.cursors[0].items) {
        const id = String(x.id);
        if (seen.has(id)) continue;
        seen.add(id);
        if (rest.every((s) => s.has(id))) merged.push(x);
    }
    const more = st.tagAnd.cursors.some((c) => !c.done);
    return { items: merged, next: more ? [["__and__", "1"]] : [] };
}

async function fetchGallery(reset, opts = {}) {
    const st = S.gal;
    const silent = !!opts.silent; // 快照恢复后的后台刷新:不动 UI,数据变了才重排
    if (st.loading) { if (reset) st.pending = true; return; } // 批4:只有 reset 排队补发;滚动续拉在途时放弃(防误发 reset 清屏回顶)
    if (!reset && !(st.next && st.next.length)) return; // 没有下一页
    const sig0 = st.items.map((x) => x.id).join(",");
    st.loading = true; // 静默同样置位:滚动加载/筛选刷新的互斥只认这一个判据
    if (!silent) renderGallery();
    try {
        const andIds = _galTagIds(st);
        if (st.tag.trim() && !andIds.length) {
            // 静默刷新时 tagMap 可能还没异步就绪:保住现有画面,等下次刷新
            if (silent) { st.loading = false; return; }
            // 填了 tag 但一个有效 ID 都解析不出来:直接显示空结果
            st.items = []; st.next = []; st.error = "";
            st.loading = false;
            renderGallery(true);
            return;
        }
        let items, next;
        if (st.tagMode === "AND" && andIds.length > 1) {
            ({ items, next } = await _galleryAndPage(st, reset, andIds)); // 批5 E2E 7:漏斗式逐 tag 求交
        } else {
            const p = new URLSearchParams({ limit: "24", sort: st.sort, period: st.period });
            p.set("nsfw", st.nsfwLevel > 0 ? "true" : "false");
            // 图片 ID 精确搜索:后端 /images 支持 imageId 单图直查(带 meta)
            if (String(st.imageId || "").trim()) p.set("imageId", String(st.imageId).trim());
            if (st.base) p.set("baseModels", st.base);
            if (andIds.length) p.set("tags", andIds.join(","));
            if (st.fmt === "image" || st.fmt === "video") p.set("type", st.fmt); // 批11.5:媒体类型服务端过滤
            if (!reset && st.next) for (const [k, v] of st.next) p.append(k, v);
            const gap = Date.now() - _galLastReq;
            if (gap < 900) await new Promise((r2) => setTimeout(r2, 900 - gap)); // 批5 a:最小间隔防连发 503
            _galLastReq = Date.now();
            const data = await apiGet("/civitai_studio/images?" + p.toString());
            items = data.items || [];
            next = data.next_query || [];
        }
        if (reset) {
            st.items = items;
        } else {
            const seen = new Set(st.items.map((x) => x.id));
            st.items = st.items.concat(items.filter((x) => !seen.has(x.id)));
        }
        st.next = next || [];
        st.error = "";
    } catch (e) {
        if (!silent || !st.items.length) st.error = t("loadFailed") + e.message; // 静默失败保住快照画面
    } finally {
        st.loading = false;
        const sig1 = st.items.map((x) => x.id).join(",");
        if (!silent || sig0 !== sig1 || st.error) renderGallery(reset);
        saveGallerySnapshot();
        if (st.pending) { st.pending = false; fetchGallery(true); }
    }
}

function renderGallery(reset) {
    const grid = $("#cs-gal-grid");
    if (!grid) return;
    if (!grid.clientWidth) { // 隐藏态(非激活 tab):宽度未知,排了也会滞留成窄列,交给切 tab 时渲染
        S.gal.__needsRender = true;
        return;
    }
    S.gal.__needsRender = false;
    const st = S.gal;
    $$(".cs-gal-more, .cs-gal-err", grid).forEach((n) => n.remove()); // 手动续拉按钮/错误横幅每次重渲染先清,防增殖
    if (st.error && !st.items.length) {
        grid.innerHTML = `<div class="cs-empty">${esc(st.error)}</div>`;
        return;
    }
    // 批5 c:连续失败不再清屏——有缓存时保住已渲染缩略图,错误条以追加形式提示
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
    const mtWant = st.fmt && st.fmt !== "all" ? st.fmt : null; // image|video(服务端已过滤,这里兜底混装/旧快照)
    for (const img of st.items) {
        if (mtWant && (mtWant === "video") !== isVideoItem(img)) continue;
        if (st.favOnly && !(S.favs && S.favs.has(String(img.id)))) continue; // ★只看收藏(评审R2:此前无消费点,功能整体失效)
        if (st.nsfwLv.size) { // 本地分级多选(r3-f):命中任一选中位才显示;无标记位条目被滤掉
            const nl = Number(img.nsfwLevel || 0);
            if (!nl || ![...st.nsfwLv].some((b) => nl & b)) continue;
        }
        if (img.__rendered) continue;
        img.__rendered = true;
        const item = document.createElement("div");
        item.className = "cs-gal-item";
        const favOn = !!(S.favs && S.favs.has(String(img.id)));
        const save = `<button class="cs-save-btn" title="${esc(t("saveBtnTitle"))}" data-save-url="${esc(img.url)}">⬇</button>`
            + `<button class="cs-save-btn" style="right:auto;left:4px;${favOn ? "color:#ffd75e;" : ""}" title="${esc(t("favBtnTitle"))}" data-fav="${esc(img.id)}">★</button>`;
        if (isVideoItem(img)) {
            // 视频条目:静音取首帧作封面,点击悬浮层播放
            // 批6:无条件带类+data(nsfwBits 归一),勾选变更可即时重算;filter 按命中内联
            item.innerHTML = `${save}${fmtBadgeHtml(img)}<video muted loop playsinline preload="metadata"`
                + ` class="cs-nsfw-blurable" data-nsfw-level="${nsfwBitsOf(img)}" style="${nsfwBlurStyle(img)}"`
                + ` src="${esc(imgSrc(cdnVideo(img.url)))}#t=0.001" data-direct="${esc(img.url)}"
                    onerror="this.style.display='none'"></video>`;
        } else {
            item.innerHTML = `${save}${fmtBadgeHtml(img)}<img loading="lazy"`
                + ` class="cs-nsfw-blurable" data-nsfw-level="${nsfwBitsOf(img)}" style="${nsfwBlurStyle(img)}"`
                + ` src="${esc(imgSrc(cdnThumb(img.url)))}" data-direct="${esc(img.url)}"
                    onerror="this.style.display='none'"/>`;
        }
        const mediaEl = item.querySelector("img,video");
        if (mediaEl && mediaEl.tagName === "IMG") attachThumbBlob(mediaEl, mediaEl.src); // blob 命中免 CDN
        if (mediaEl) mediaEl.onclick = () => showImageMeta(img);
        if (isVideoItem(img)) appendPlayBadge(item); // 半透明播放三角标
        appendMissingMarks(item, img); // 缺失生成参数的三色感叹号(与节点条共用)
        item.querySelector(".cs-save-btn").onclick = (ev) => {
            ev.stopPropagation();
            saveImageToOutput(img.url, ev.target, img);
        };
        item.querySelector("[data-fav]").onclick = async (ev) => {
            ev.stopPropagation();
            S.favs = S.favs || new Set();
            try {
                const adding = !S.favs.has(String(img.id)); // 调用前判定(与旧行为等价)
                const on = await toggleFav("asset", String(img.id), { name: img.username || "", cover: img.url, extra: { nsfwLevel: nsfwBitsOf(img) } });
                ev.target.style.color = on ? "#ffd75e" : "";
                // E2E #8:新增收藏弹收藏夹选择器(默认未分组);取消收藏不弹
                if (on && adding) {
                    const cur = ((S.favData?.items || []).find((x) => x.kind === "asset" && String(x.oid) === String(img.id)) || {}).group_ids || [];
                    openGroupPicker(ev, "asset", cur, async (gids) => {
                        try { await apiPost("/civitai_studio/favorites/assign", { kind: "asset", oid: String(img.id), group_ids: gids }); }
                        catch (e2) { toast("error", t("favFailed"), e2.message); }
                    });
                }
                if (st.favOnly && !on) {  // 只看收藏下取消→即时移除(评审R2)
                    st.items.forEach((i2) => { delete i2.__rendered; });
                    renderGallery(true);
                }
            } catch (e) { toast("error", t("favFailed"), e.message); }
        };
        const ar = img.width && img.height ? img.width / img.height : 0.75;
        st.jrow.push({ el: item, ar }); st.jrowAr = (st.jrowAr || 0) + ar;
        if (st.jrowAr * targetH + (st.jrow.length - 1) * gap >= W) flushRow();
    }
    flushRow();
    if (st.error && st.items.length) {
        const err = document.createElement("div");
        err.className = "cs-gal-err";
        err.style.cssText = "flex:0 0 100%;text-align:center;color:#e2a23f;font-size:12px;padding:6px;cursor:pointer;";
        err.textContent = st.error + (st.next.length ? " — " + t("retry") : "");
        err.onclick = () => { st.error = ""; fetchGallery(false); };
        grid.appendChild(err);
    }
    if (!st.items.length && !st.loading) {
        grid.innerHTML = `<div class="cs-empty">${esc(t("galleryEmpty"))}</div>`;
    }
    // E2E r3-d:媒体类型/只看收藏是纯客户端过滤,筛选后可见数可能骤减。可见不足一页
    // 且还有下一页时自动续拉(最多 3 轮防失控);仍不足则给手动按钮兜底
    const vis = st.items.filter((x) => (!mtWant || (mtWant === "video") === isVideoItem(x))
        && (!st.favOnly || (S.favs && S.favs.has(String(x.id))))).length;
    if (reset) st.autoMore = 0;
    // E2E 20:【尝试加载更多】按钮删除(每渲染一次增殖一个 + 与滚动加载重叠);
    // 改为内容不满一屏就自动续拉到满屏(5 轮上限防失控);
    // 批4 E2E 17b:轮数用尽仍不满一屏(内容不足一屏时永远无法滚动触发)→ 手动续拉按钮兜底
    if (!st.loading && st.next.length && vis < 24) {
        if ((st.autoMore || 0) < 5) {
            st.autoMore = (st.autoMore || 0) + 1;
            setTimeout(() => fetchGallery(false), 350); // 轮间 delay,防密集请求
        } else {
            const more = document.createElement("button");
            more.className = "cs-gal-more cs-btn";
            more.style.cssText = "flex:0 0 100%;margin:6px auto;";
            more.textContent = t("loadMore");
            more.onclick = () => { st.autoMore = 0; fetchGallery(false); };
            grid.appendChild(more);
        }
    } else if (vis >= 24) st.autoMore = 0;
}

function buildGalleryView(root) {
    const st = S.gal;
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "gallery";
    view.innerHTML = `
        <div class="cs-toolbar">
            <input id="cs-gal-imgid" type="search" placeholder="${esc(t("imgidPh"))}" value="${esc(st.imageId || "")}" autocomplete="off"/>
            <button class="cs-btn cs-btn-mini" id="cs-gal-refresh" title="${esc(t("refreshTitle"))}">⟳</button>
            <button class="cs-btn cs-btn-mini" id="cs-gal-reset" title="${esc(t("resetFilters"))}">⟲</button>
        </div>
        <div class="cs-fwrap">
            <div class="cs-presets">
                ${GAL_PRESETS.map(([k]) => `<button class="cs-chip" data-gpreset="${k}">${esc(t("galPreset" + k.replace(/(^|-)([a-z])/g, (_, _s, c) => c.toUpperCase())))}</button>`).join("")}
            </div>
            <div class="cs-filters cs-filters-gal">
                <div id="cs-gal-base-picker" class="cs-span-full"></div>
                <div id="cs-gal-tag-picker" class="cs-span-full"></div>
                <select id="cs-gal-period">${PERIODS.map((p) => `<option value="${p}" ${st.period === p ? "selected" : ""}>${esc(periodLabel(p))}</option>`).join("")}</select>
                <select id="cs-gal-sort">
                    <option value="Newest">${esc(t("gallerySortNewest"))}</option>
                    <option value="Oldest">${esc(t("gallerySortOldest"))}</option>
                    <option value="Most Reactions">${esc(t("gallerySortReactions"))}</option>
                    <option value="Most Comments">${esc(t("gallerySortComments"))}</option>
                    <option value="Most Collected">${esc(t("gallerySortCollected"))}</option>
                    <option value="Random">${esc(t("gallerySortRandom"))}</option>
                </select>
                <select id="cs-gal-nsfw"><option value="0" ${!st.nsfwLevel ? "selected" : ""}>${esc(t("sfwLabel"))}</option><option value="1" ${st.nsfwLevel ? "selected" : ""}>${esc(t("nsfwLabel"))}</option></select>
                <div id="cs-gal-lv" title="${esc(S.lang === "zh" ? "本地分级过滤(多选,作用于已加载条目)" : "Local nsfw-level filter (multi-select, loaded items)")}"></div>
                <select id="cs-gal-fmt" class="cs-span-4" title="${esc(t("mtTip"))}">${fmtSelHtml(st.fmt)}</select>
                <select id="cs-gal-size" class="cs-span-4" title="${esc(t("thumbSizeGalTitle"))}">${[96, 128, 256, 512].map((px) => `<option value="${px}" ${st.thumbSize === px ? "selected" : ""}>${px}px</option>`).join("")}</select>
                <button class="cs-btn cs-span-4" id="cs-gal-fav" title="${esc(t("favOnlyTitle"))}" style="${st.favOnly ? "background:var(--accent-color,#4a90e2);color:#fff;border-color:transparent;" : ""}">★ ${esc(t("favOnlyTitle"))}</button>
            </div>
            <button class="cs-ffold" id="cs-gal-ffold" title="${esc(t("ffoldTitle"))}">▾</button>
        </div>
        <div id="cs-gal-content" class="cs-scroll">
            <div id="cs-gal-grid" class="cs-gal-grid"></div>
        </div>`;
    root.appendChild(view);
    // 画廊筛选折叠:与浏览 tab 同构,独立记住偏好
    const galFwrap = $(".cs-fwrap", view);
    try { if (localStorage.getItem("cs_gal_fold") === "1") galFwrap.classList.add("folded"); } catch (_) { }
    syncFoldBtn($("#cs-gal-ffold", view), galFwrap.classList.contains("folded"));
    $("#cs-gal-ffold", view).onclick = () => {
        galFwrap.classList.toggle("folded");
        syncFoldBtn($("#cs-gal-ffold", view), galFwrap.classList.contains("folded"));
        try { localStorage.setItem("cs_gal_fold", galFwrap.classList.contains("folded") ? "1" : "0"); } catch (_) { }
    };
    const setValGal = (sel2, v2) => { const el2 = $(sel2, view); if (el2) el2.value = v2; };
    $("#cs-gal-sort", view).value = st.sort;
    { // 视图重建时回显预设选中态(复审R2-1)
        const hit = GAL_PRESETS.find(([, pd, so]) => pd === st.period && so === st.sort);
        if (hit) { const c = $(".cs-presets [data-gpreset=\"" + hit[0] + "\"]", view); if (c) c.classList.add("active"); }
    }
    $("#cs-gal-sort", view).addEventListener("change", (e) => {
        st.sort = e.target.value;
        $$(".cs-presets .cs-chip", view).forEach((c) => c.classList.remove("active")); // 同上
        fetchGallery(true);
    });
    $("#cs-gal-period", view).addEventListener("change", (e) => {
        st.period = e.target.value;
        $$(".cs-presets .cs-chip", view).forEach((c) => c.classList.remove("active")); // 手改下拉清预设高亮(复审R2-1)
        fetchGallery(true);
    });
    $("#cs-gal-nsfw", view).addEventListener("change", (e) => { st.nsfwLevel = parseInt(e.target.value, 10); fetchGallery(true); });
    // 媒体类型筛选(批11.5):服务端 type=image|video,重拉第 1 页(分页口径正确);
    // 渲染层仍按 isVideoItem 兜底过滤混装/旧快照条目
    $("#cs-gal-fmt", view).addEventListener("change", (e) => {
        st.fmt = e.target.value;
        st.items.forEach((i) => { delete i.__rendered; });
        fetchGallery(true);
    });
    // 本地 NSFW 分级筛选(批11.5 由 chips 改多选下拉):纯客户端按 nsfwLevel 位掩码过滤已加载条目
    const galLv = makeMultiSelect($("#cs-gal-lv", view), {
        label: t("lvLabel"),
        options: Object.entries(NSFW_LEVEL_LABELS).filter(([b]) => Number(b) < 32).map(([b, lb]) => [Number(b), lb]),
        selected: [...st.nsfwLv],
        onChange: (vals) => {
            st.nsfwLv = new Set(vals);
            st.items.forEach((i) => { delete i.__rendered; });
            renderGallery(true);
        },
    });
    view.__galLv = galLv; // 快照恢复回显用
    // 快捷栏(E2E 6):映射 period+sort,回写 select 后重拉
    $$(".cs-presets [data-gpreset]", view).forEach((chip) => {
        chip.onclick = () => {
            const preset = GAL_PRESETS.find(([k]) => k === chip.dataset.gpreset);
            if (!preset) return;
            st.period = preset[1]; st.sort = preset[2];
            $("#cs-gal-period", view).value = st.period;
            $("#cs-gal-sort", view).value = st.sort;
            $$(".cs-presets .cs-chip", view).forEach((c) => c.classList.toggle("active", c === chip)); // 选中态(评审R2)
            fetchGallery(true);
        };
    });
    // 缩略图大小:不重新拉取,清渲染标记后整版重排
    $("#cs-gal-size", view).addEventListener("change", (e) => {
        st.thumbSize = parseInt(e.target.value, 10);
        st.items.forEach((i) => { delete i.__rendered; });
        renderGallery(true);
    });
    // 只看收藏:客户端过滤已加载条目(收藏集合从后端 favorites.json 载入)
    $("#cs-gal-fav", view).onclick = () => {
        st.favOnly = !st.favOnly;
        const b = $("#cs-gal-fav", view);
        b.style.background = st.favOnly ? "var(--accent-color,#4a90e2)" : "";
        b.style.color = st.favOnly ? "#fff" : "";
        st.items.forEach((i2) => { delete i2.__rendered; });
        renderGallery(true);
    };
    $("#cs-gal-refresh", view).onclick = () => fetchGallery(true); // 显式刷新(E2E r3-c)
    // 批11.5:重置筛选(与模型页同款)——清内容域筛选与★只看收藏,保留尺寸档与折叠态
    $("#cs-gal-reset", view).onclick = () => {
        st.period = "AllTime"; st.sort = "Newest"; st.base = ""; st.tag = ""; st.imageId = "";
        st.nsfwLevel = 0; st.fmt = "all"; st.favOnly = false; st.nsfwLv = new Set();
        setValGal("#cs-gal-period", st.period); setValGal("#cs-gal-sort", st.sort);
        setValGal("#cs-gal-nsfw", "0"); setValGal("#cs-gal-fmt", "all");
        setValGal("#cs-gal-imgid", "");
        $$(".cs-presets .cs-chip", view).forEach((c) => c.classList.remove("active"));
        if (view.__galBasePicker) view.__galBasePicker.set([]);
        if (view.__galTagPicker) view.__galTagPicker.set([]);
        if (view.__galLv) view.__galLv.set([]);
        {
            const fb = $("#cs-gal-fav", view);
            if (fb) { fb.style.background = ""; fb.style.color = ""; }
        }
        fetchGallery(true);
    };
    apiGet("/civitai_studio/favorites").then((d) => {
        S.favs = new Set((d.ids || []).map(String));
        if (st.favOnly) renderGallery(true);
    }).catch(() => { });
    const debouncedFetch = () => {
        clearTimeout(buildGalleryView._deb);
        buildGalleryView._deb = setTimeout(() => fetchGallery(true), 600);
    };
    // 图片 ID 精确搜索:回车/清空即刷新;与其它筛选互斥性弱(后端 imageId 优先)
    $("#cs-gal-imgid", view).addEventListener("keydown", (e) => {
        if (e.key === "Enter") { st.imageId = e.target.value.trim(); fetchGallery(true); }
        e.stopPropagation();
    });
    $("#cs-gal-imgid", view).addEventListener("input", (e) => {
        if (!e.target.value.trim() && st.imageId) { st.imageId = ""; fetchGallery(true); } // 清空即恢复
    });
    // tag 选择器(与节点共用 createTagPicker 组件):chips + 下拉添加器 + 自由输入
    {
        const tagNames = () => String(st.tag || "").split(",").map((s) => s.trim()).filter(Boolean);
        // 批5 E2E 7:tag AND/OR 选择框加回(仅 tag;底模单值无 AND 语义),经 rowExtra 进 picker 行
        const galTagMode = document.createElement("select");
        galTagMode.title = t("modeOR") + " / " + t("modeAND");
        galTagMode.style.cssText = "flex:0 0 112px;font-size:11px;padding:2px;";
        galTagMode.innerHTML = `<option value="OR">${esc(t("modeOR"))}</option><option value="AND">${esc(t("modeAND"))}</option>`;
        try { st.tagMode = localStorage.getItem("cs_gal_tag_mode") || "OR"; } catch (_) { }
        galTagMode.value = st.tagMode;
        galTagMode.onchange = () => { st.tagMode = galTagMode.value; try { localStorage.setItem("cs_gal_tag_mode", st.tagMode); } catch (_) { } fetchGallery(true); };
        const tp = createTagPicker($("#cs-gal-tag-picker", view), {
            names: tagNames(),
            allowInput: false,
            rowExtra: galTagMode,
            candidates: () => Object.keys(S.tagMap || {}),
            onChange: (names) => {
                st.tag = names.join(",");
                debouncedFetch();
            },
        });
        csTagPickers.add(tp);
        view.__galTagPicker = tp; // 快照恢复用:set() 回填 chips 不触发 onChange
    }
    // 底模:多选 chips(与浏览页同形式,E2E g);逗号串存 st.base
    const galBaseCands = { list: BASE_MODELS };
    const galBaseNames = () => String(st.base || "").split(",").map((x) => x.trim()).filter(Boolean);
    const galBasePicker = createTagPicker($("#cs-gal-base-picker", view), {
        names: galBaseNames(),
        prefix: "",
        addLabel: t("addBaseOpt"),
        emptyHint: t("baseFilterHint"),
        allowInput: false,
        candidates: () => galBaseCands.list,
        onChange: (names) => { st.base = names.join(","); fetchGallery(true); },
    });
    csTagPickers.add(galBasePicker);
    view.__galBasePicker = galBasePicker; // 快照恢复用:set() 回填 chips 不触发 onChange
    S.ui.__galTagPicker = view.__galTagPicker; // 批C:大图 tag 跳画廊搜索用
    S.ui.__galBasePicker = galBasePicker;
    // tag 名称映射(详情浮层抓取后由 refreshTagCombos 一并维护 S.tagMap)
    apiGet("/civitai_studio/tag_mapping").then((d) => {
        S.tagMap = S.tagMap || {};
        (d.tags || []).forEach((t2) => { S.tagMap[t2.name] = t2.id; });
    }).catch(() => { });
    // 底模候选:内置种子 + 站方枚举补全(与浏览页一致)
    apiGet("/civitai_studio/enums").then((d) => {
        const list = (d.ActiveBaseModel || d.BaseModel || []);
        if (list.length) galBaseCands.list = sortEnumNames(list);
    }).catch(() => { });
    const galScrollCheck = (el) => {
        if (!view.classList.contains("active")) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400 && !st.loading && st.next.length) fetchGallery(false);
    };
    $("#cs-gal-content", view).addEventListener("scroll", (e) => galScrollCheck(e.target));
    // 批5 E2E 11:pinSidebarHeight 失败时滚动发生在外层容器——双挂载兜底
    const galOuter = view.closest(".sidebar-content-container");
    if (galOuter) galOuter.addEventListener("scroll", (e) => galScrollCheck(e.target), { passive: true });
    restoreGallerySnapshot(view); // 异步:面板重开后恢复上次画廊(状态先行,渲染延迟到切 tab)
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
            error: t("stError") + humanizeErr(j.error || ""),
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
            ${active ? `<button class="cs-btn cs-btn-mini cs-btn-danger" data-cancel="${esc(j.id)}">${esc(t("cancelBtn"))}</button>`
                : (j.status === "error" || j.status === "cancelled") ? `<button class="cs-btn cs-btn-mini" data-retry="${esc(j.id)}" title="${esc(t("retryTip"))}">${esc(t("retryResume"))}</button>`
                    : j.status === "done" && j.dest ? `<button class="cs-btn cs-btn-mini" data-reveal-dl="${esc(j.id)}">${esc(t("revealFile"))}</button>
                <button class="cs-btn cs-btn-mini" data-tolocal="${esc(j.id)}">${esc(t("toLocal"))}</button>` : ""}
        </div>`;
    }).join("");
    $$("[data-cancel]", list).forEach((btn) => {
        btn.onclick = async () => {
            try { await apiPost("/civitai_studio/downloads/cancel", { id: btn.dataset.cancel }); }
            catch (e) { toast("error", t("cancelFailed"), e.message); }
        };
    });
    // 失败/取消任务重试:后端以保存的载荷重新入队,.part 断点仍在则自动续传
    $$("[data-retry]", list).forEach((btn) => {
        btn.onclick = async () => {
            btn.disabled = true;
            try {
                const res = await apiPost("/civitai_studio/downloads/retry", { id: btn.dataset.retry });
                if (res.job) { S.dl.jobs.unshift(res.job); lastPollTs = 0; }
                pollDownloads();
            } catch (e) { toast("error", t("retryFailed"), e.message); btn.disabled = false; }
        };
    });
    // 完成任务:打开所在文件夹并选中文件
    $$("[data-reveal-dl]", list).forEach((btn) => {
        btn.onclick = async () => {
            const j = S.dl.jobs.find((x) => x.id === btn.dataset.revealDl);
            if (!j?.dest) return;
            try { await apiPost("/civitai_studio/local/reveal", { path: j.dest }); }
            catch (e) { toast("error", t("revealFailed"), e.message); }
        };
    });
    // 完成任务:切到本地库并按版本名预填搜索
    $$("[data-tolocal]", list).forEach((btn) => {
        btn.onclick = async () => {
            const j = S.dl.jobs.find((x) => x.id === btn.dataset.tolocal);
            switchTab("local");
            S.local.search = j?.version_name || j?.model_name || "";
            const inp = $("#cs-local-search");
            if (inp) inp.value = S.local.search;
            await loadLocal(true);
            renderLocalList();
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
// 设置页说明改 ⓘ 悬浮(E2E 1):标题从简,完整解释进 title tooltip
function infoIco(tip) {
    return `<span class="cs-info" title="${esc(tip)}">ⓘ</span>`;
}

async function openSettings() {
    let cfg;
    try { cfg = await apiGet("/civitai_studio/config"); }
    catch (e) { toast("error", t("readCfgFailed"), e.message); return; }
    const oldProxyImages = !!cfg.proxy_images;
    let fold = {};
    try { fold = JSON.parse(localStorage.getItem("cs_set_fold") || "{}") || {}; } catch (_) { }
    const m = showModal(`
        <h3 class="cs-modal-title">${esc(t("settingsTitle"))}</h3>
        <div class="cs-set-body cs-form">
            <div class="cs-set-group${fold.account ? " closed" : ""}" data-fold="account">
                <div class="cs-set-group-head">${esc(t("setGrpAccount"))}<span class="cs-set-caret">▾</span></div>
                <div class="cs-set-group-body">
                    <label>${esc(t("keyLabel"))}
                        <input id="cs-set-key" type="password" placeholder="${cfg.api_key_set ? esc(t("keySetPh", { tail: cfg.api_key_tail || "" })) : esc(t("keyPh"))}"/>
                        <span class="cs-form-hint">${esc(t("keyFunc"))}</span>
                        <span class="cs-form-hint">${esc(t("keyFuncEx"))}</span>
                        <span class="cs-form-hint">${esc(t("keyHowTo"))}</span>
                        <a href="https://civitai.com/user/account/security" target="_blank" rel="noopener noreferrer"
                           style="color:var(--accent-color,#4a90e2);">${esc(t("keyLink"))}</a>
                    </label>
                    <div class="cs-set-keyrow">
                        <button class="cs-btn" id="cs-set-test" type="button">${esc(t("testKeyBtn"))}</button>
                        <span id="cs-set-keybadge" class="cs-set-badge" style="display:none"></span>
                    </div>
                    <label><span class="cs-lab">${esc(t("mirrorLabel"))} ${infoIco(t("mirrorTip"))}</span>
                        <select id="cs-set-site">
                            <option value="https://civitai.com">civitai.com</option>
                            <option value="https://civitai.red">civitai.red [NSFW]</option>
                            <option value="__custom__">${esc(t("siteCustom"))}</option>
                        </select>
                        <input id="cs-set-mirror" type="text" value="${esc(cfg.mirror || "")}" placeholder="https://…" style="display:none;margin-top:4px"/>
                    </label>
                    <label>${esc(t("proxyLabel"))}
                        <input id="cs-set-proxy" type="text" value="${esc(cfg.proxy || "")}" placeholder="${esc(t("proxyPh"))}"/>
                    </label>
                </div>
            </div>
            <div class="cs-set-group${fold.download ? " closed" : ""}" data-fold="download">
                <div class="cs-set-group-head">${esc(t("setGrpDownload"))}<span class="cs-set-caret">▾</span></div>
                <div class="cs-set-group-body">
                    <label><span class="cs-lab">${esc(t("concLabel"))} ${infoIco(t("concTip"))}</span>
                        <input id="cs-set-conc" type="number" min="1" max="4" value="${cfg.max_concurrent || 1}"/>
                    </label>
                    <label class="cs-check"><input id="cs-set-hash" type="checkbox" ${cfg.verify_hash ? "checked" : ""}/> ${esc(t("hashLabel"))}</label>
                    <label class="cs-check"><input id="cs-set-pdesc" type="checkbox" ${cfg.persist_description ? "checked" : ""}/> ${esc(t("pdescLabel"))} ${infoIco(t("pdescTip"))}</label>
                </div>
            </div>
            <div class="cs-set-group${fold.search ? " closed" : ""}" data-fold="search">
                <div class="cs-set-group-head">${esc(t("setGrpSearch"))}<span class="cs-set-caret">▾</span></div>
                <div class="cs-set-group-body">
                    <label class="cs-check"><input id="cs-set-pimg" type="checkbox" ${cfg.proxy_images ? "checked" : ""}/> ${esc(t("pimgLabel"))} ${infoIco(t("pimgTip"))}</label>
                    <label class="cs-check"><input id="cs-set-tscrape" type="checkbox" ${cfg.tag_scrape !== false ? "checked" : ""}/> ${esc(t("tagScrapeLabel"))} ${infoIco(t("tagScrapeTip"))}</label>
                    <label class="cs-check"><input id="cs-set-andmode" type="checkbox" ${cfg.tag_and_mode ? "checked" : ""}/> ${esc(t("tagAndLabel"))} ${infoIco(t("tagAndTip"))}<span class="cs-set-exp">${esc(t("expBadge"))}</span></label>
                </div>
            </div>
            <div class="cs-set-group${fold.storage ? " closed" : ""}" data-fold="storage">
                <div class="cs-set-group-head">${esc(t("setGrpStorage"))}<span class="cs-set-caret">▾</span></div>
                <div class="cs-set-group-body">
                    <label><span class="cs-lab">${esc(t("cacheMaxLabel"))} ${infoIco(t("cacheMaxTip"))}</span>
                        <div class="cs-set-sliderrow">
                            <input id="cs-set-cachemb-range" type="range" min="50" max="2000" step="10" value="${cfg.cache_max_mb || 500}"/>
                            <input id="cs-set-cachemb" type="number" min="50" max="2000" value="${cfg.cache_max_mb || 500}"/>
                        </div>
                        <div class="cs-set-progress"><div id="cs-cache-fill" class="cs-set-progress-fill"></div></div>
                        <span class="cs-form-hint" id="cs-cache-usage">${esc(t("cacheUsageLoading"))}</span>
                    </label>
                    <div class="cs-set-btnrow">
                        <button class="cs-btn" id="cs-set-clearcache" type="button">${esc(t("clearCacheBtn"))}</button>
                        <button class="cs-btn" id="cs-set-deepscan" type="button">${esc(t("deepScanBtn"))}</button>
                        <span id="cs-set-maint-msg"></span>
                    </div>
                </div>
            </div>
            <div class="cs-set-group${fold.sync ? " closed" : ""}" data-fold="sync">
                <div class="cs-set-group-head">${esc(t("setGrpSync"))}<span class="cs-set-caret">▾</span></div>
                <div class="cs-set-group-body">
                    <label class="cs-check"><input id="cs-set-autosync" type="checkbox" ${cfg.fav_autosync ? "checked" : ""}/> ${esc(t("favAutoSync"))} ${infoIco(t("favAutoSyncTip"))}</label>
                </div>
            </div>
            <div class="cs-set-group" data-fold="thumbs">
                <div class="cs-set-group-head">${esc(t("setGrpThumbs"))}<span class="cs-set-caret">▾</span></div>
                <div class="cs-set-group-body">
                    <label class="cs-check">${esc(t("pxCoverLabel"))}
                        <select id="cs-set-pxcover">${[96, 320, 450].map((px) => `<option value="${px}" ${(cfg.px_cover || 320) === px ? "selected" : ""}>${px}px</option>`).join("")}</select>
                        ${infoIco(t("pxCoverTip"))}</label>
                    <label class="cs-check">${esc(t("pxMediaLabel"))}
                        <select id="cs-set-pxmedia">${[96, 320, 450].map((px) => `<option value="${px}" ${(cfg.px_media || 320) === px ? "selected" : ""}>${px}px</option>`).join("")}</select>
                        ${infoIco(t("pxMediaTip"))}</label>
                </div>
            </div>
            <div class="cs-set-group" data-fold="logs">
                <div class="cs-set-group-head">${esc(t("setGrpLogs"))}<span class="cs-set-caret">▾</span></div>
                <div class="cs-set-group-body">
                    <label class="cs-check"><input id="cs-set-logdebug" type="checkbox" ${cfg.log_debug ? "checked" : ""}/> ${esc(t("logDebugLabel"))} ${infoIco(t("logDebugTip"))}</label>
                    <label class="cs-check"><input id="cs-set-logts" type="checkbox" ${cfg.log_timestamp ? "checked" : ""}/> ${esc(t("logTsLabel"))} ${infoIco(t("logTsTip"))}</label>
                </div>
            </div>
        </div>
        <div class="cs-modal-msg">${esc(t("settingsMsg"))}</div>
        <div class="cs-modal-actions cs-set-actions">
            <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
            <button class="cs-btn cs-btn-primary" data-act="ok">${esc(t("save"))}</button>
        </div>`, "cs-settings-modal");
    $("[data-act=cancel]", m.box).onclick = m.close;
    // 分组折叠:点击小节头切换,状态记 localStorage(下次打开还原)
    let foldState = fold;
    $$(".cs-set-group-head", m.box).forEach((h) => {
        h.onclick = () => {
            const g = h.parentElement;
            g.classList.toggle("closed");
            foldState[g.dataset.fold] = g.classList.contains("closed");
            try { localStorage.setItem("cs_set_fold", JSON.stringify(foldState)); } catch (_) { }
        };
    });
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
    // 缓存占用进度条 + slider/数值双向联动
    const applyUsage = (d) => {
        const el = $("#cs-cache-usage", m.box);
        if (el) el.textContent = usageFmt(d);
        const fill = $("#cs-cache-fill", m.box);
        if (fill) {
            const max = Math.max(1, d.max_mb || 500);
            const pct = Math.min(100, Math.round((d.used_bytes || 0) / 1048576 / max * 100));
            fill.style.width = pct + "%";
            fill.classList.toggle("warn", pct >= 70 && pct < 90);
            fill.classList.toggle("bad", pct >= 90);
        }
    };
    const usageFmt = (d) => t("cacheUsageFmt", { mb: ((d.used_bytes || 0) / 1048576).toFixed(1), max: d.max_mb || 500 });
    apiGet("/civitai_studio/cache_usage").then(applyUsage).catch((e) => {
        const el = $("#cs-cache-usage", m.box);
        if (el) el.textContent = t("readCfgFailed") + ": " + e.message;
    });
    const range = $("#cs-set-cachemb-range", m.box);
    const numIn = $("#cs-set-cachemb", m.box);
    range.addEventListener("input", () => { numIn.value = range.value; });
    numIn.addEventListener("input", () => {
        const v = parseInt(numIn.value, 10);
        if (v >= 50 && v <= 2000) range.value = String(v);
    });
    const maintMsg = $("#cs-set-maint-msg", m.box);
    $("#cs-set-clearcache", m.box).onclick = async () => {
        try {
            const d = await apiPost("/civitai_studio/cache_clear");
            applyUsage(d);
            maintMsg.textContent = t("cacheCleared");
        } catch (e) {
            maintMsg.textContent = t("saveFailed") + ": " + e.message;
        }
    };
    $("#cs-set-deepscan", m.box).onclick = async () => {
        try {
            const d = await apiPost("/civitai_studio/local/deep_rescan");
            maintMsg.textContent = t("deepScanDone", (d && d.scan_stats) || {});
        } catch (e) {
            maintMsg.textContent = t("deepScanFailed") + ": " + e.message;
        }
    };
    // 测试连接:输入框的候选 key 随探测请求传参(只探测不落库,保存仍由「保存」负责);
    // 缺省探测已保存 key。social_write 三态:true 有效/false 缺权限/null 未知
    const badge = $("#cs-set-keybadge", m.box);
    const testBtn = $("#cs-set-test", m.box);
    testBtn.onclick = async () => {
        const newKey = $("#cs-set-key", m.box).value.trim();
        testBtn.disabled = true;
        testBtn.textContent = t("testKeying");
        badge.style.display = "none";
        try {
            const r = await apiPost("/civitai_studio/key_probe", newKey ? { api_key: newKey } : {});
            const reasons = {
                no_key: t("probeNoKey"), invalid: t("probeInvalid"), timeout: t("probeTimeout"),
            };
            if (r.ok) {
                badge.textContent = t("probeOk") + (r.username ? ` (${r.username})` : "")
                    + (r.social_write === false ? " " + t("probeNoSocial")
                        : r.social_write == null ? " " + t("probeSocialUnknown") : "");
            } else {
                badge.textContent = reasons[r.reason]
                    || (r.reason && r.reason.startsWith("http_") ? "HTTP " + r.reason.slice(5) : null)
                    || r.message || t("probeFailUnknown");
            }
            badge.className = "cs-set-badge show " + (r.ok ? (r.social_write === true ? "ok" : "warn") : "bad");
            badge.style.display = "inline-block"; // className 加 show 不会清内联 display:none
        } catch (e) {
            badge.textContent = t("probeFailUnknown") + ": " + humanizeErr(e.message);
            badge.className = "cs-set-badge show bad";
            badge.style.display = "inline-block";
        }
        testBtn.disabled = false;
        testBtn.textContent = t("testKeyBtn");
    };
    $("[data-act=ok]", m.box).onclick = async () => {
        const mirror = siteSel.value === "__custom__" ? mirrorInput.value.trim()
            : (siteSel.value === "https://civitai.com" ? "" : siteSel.value); // 留空 = 默认 civitai.com
        const body = {
            proxy: $("#cs-set-proxy", m.box).value.trim(),
            mirror,
            max_concurrent: parseInt($("#cs-set-conc", m.box).value, 10) || 1,
            cache_max_mb: parseInt($("#cs-set-cachemb", m.box).value, 10) || 500,
            proxy_images: $("#cs-set-pimg", m.box).checked,
            verify_hash: $("#cs-set-hash", m.box).checked,
            persist_description: $("#cs-set-pdesc", m.box).checked,
            tag_scrape: $("#cs-set-tscrape", m.box).checked,
            tag_and_mode: $("#cs-set-andmode", m.box).checked,
            fav_autosync: $("#cs-set-autosync", m.box).checked,
            log_debug: $("#cs-set-logdebug", m.box).checked,
            log_timestamp: $("#cs-set-logts", m.box).checked,
            px_cover: parseInt($("#cs-set-pxcover", m.box).value, 10) || 320,
            px_media: parseInt($("#cs-set-pxmedia", m.box).value, 10) || 320,
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
                }).catch(() => { });
            }
            m.close();
            toast("success", t("settingsSaved"), "");
            const ob = S.ui.root && S.ui.root.querySelector("#cs-onboard");
            if (ob && body.api_key) ob.remove(); // 引导卡:配好 key 即使命自动消失
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
    if (tab === "favorites") loadFavView();
    if (tab === "gallery") {
        const grid = $("#cs-gal-grid", S.ui.root);
        if (!S.gal.items.length) {
            if (!S.gal.loading) fetchGallery(true);
        } else if (grid && (!grid.childElementCount || S.gal.__needsRender)) {
            // 快照恢复或隐藏期数据变更过:首次切入渲染一次,再静默刷新
            S.gal.items.forEach((i) => { delete i.__rendered; });
            renderGallery(true);
            if (S.gal.__restored) { S.gal.__restored = false; fetchGallery(true, { silent: true }); }
        }
    }
}

function buildBrowseView(root) {
    const st = S.browse;
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "browse";
    view.innerHTML = `
        <div class="cs-toolbar">
            <input id="cs-search" type="search" placeholder="${esc(t("searchPlaceholder"))}"/>
            <select id="cs-f-type" title="${esc(t("typeLabel"))}"><option value="">${esc(t("allTypes"))}</option>${TYPE_OPTIONS.map((tp) => `<option value="${tp}" ${st.type === tp ? "selected" : ""}>${esc(tp)}</option>`).join("")}</select>
            <button class="cs-btn cs-btn-mini" id="cs-browse-refresh" title="${esc(t("refreshTitle"))}">⟳</button>
            <button class="cs-btn cs-btn-mini" id="cs-browse-reset" title="${esc(t("resetFilters"))}">⟲</button>
        </div>
        <div class="cs-fwrap">
            <div class="cs-presets">
                <button class="cs-chip" data-preset="hot-week">${esc(t("presetHotWeek"))}</button>
                <button class="cs-chip" data-preset="hot-month">${esc(t("presetHotMonth"))}</button>
                <button class="cs-chip" data-preset="best-month">${esc(t("presetBestMonth"))}</button>
            </div>
            <div class="cs-filters cs-filters-gal">
                <div id="cs-f-base-picker" class="cs-span-full"></div>
                <div id="cs-f-tag-picker" class="cs-span-full"></div>
                <select id="cs-f-period">${PERIODS.map((p) => `<option value="${p}" ${st.period === p ? "selected" : ""}>${esc(periodLabel(p))}</option>`).join("")}</select>
                <select id="cs-f-sort">${SORTS.map((s) => `<option value="${s}" ${st.sort === s ? "selected" : ""}>${esc(sortLabel(s))}</option>`).join("")}</select>
                <select id="cs-f-nsfw"><option value="0" ${!st.nsfw ? "selected" : ""}>${esc(t("sfwLabel"))}</option><option value="1" ${st.nsfw ? "selected" : ""}>${esc(t("nsfwLabel"))}</option></select>
                <div id="cs-f-lv" title="${esc(S.lang === "zh" ? "本地分级筛选(多选,作用于已加载条目)" : "Local nsfw-level filter (multi-select, loaded items)")}"></div>
                <select id="cs-f-hidepaid" class="cs-span-4" title="${esc(t("hidePaidLabel"))}">
                    <option value="0">${esc(t("showAllLabel"))}</option>
                    <option value="1" ${String(st.hidePaid) === "1" ? "selected" : ""}>${esc(t("hidePaidLabel"))}</option>
                    <option value="2" ${String(st.hidePaid) === "2" ? "selected" : ""}>${esc(t("hidePaidBought"))}</option>
                </select>
                <select id="cs-f-size" class="cs-span-4" title="${esc(t("thumbSizeTitle"))}">${BROWSE_CARD_SIZES.map(([w, h]) => `<option value="${w}" ${(st.cardW || 150) === w ? "selected" : ""} title="卡宽 ${w}px">${h}px</option>`).join("")}</select>
                <button class="cs-btn cs-span-4" id="cs-f-fav" title="${esc(t("favOnlyTitle"))}" style="${st.favOnly ? "background:var(--accent-color,#4a90e2);color:#fff;border-color:transparent;" : ""}">★ ${esc(t("favOnlyTitle"))}</button>
            </div>
            <button class="cs-ffold" id="cs-browse-ffold" title="${esc(t("ffoldTitle"))}">▾</button>
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
    const setValB = (sel2, v2) => { const el2 = $(sel2, view); if (el2) el2.value = v2; };
    // 本地分级筛选(批11.5 由 chips 改多选下拉;纯客户端过滤已加载条目)
    const browseLv = makeMultiSelect($("#cs-f-lv", view), {
        label: t("lvLabel"),
        options: Object.entries(NSFW_LEVEL_LABELS).filter(([b]) => Number(b) < 32).map(([b, lb]) => [Number(b), lb]),
        selected: [...st.nsfwLv],
        onChange: (vals) => {
            st.nsfwLv = new Set(vals);
            st.items.forEach((m) => { delete m.__rendered; });
            renderResults(true);
        },
    });
    view.__browseLv = browseLv;
    // 卡片尺寸(批11.5):纯布局,不重拉;改列宽后整版重排(偏好记 localStorage)
    {
        const saved = (() => { try { return parseInt(localStorage.getItem("cs_browse_cardw") || "", 10) || 0; } catch (_) { return 0; } })();
        if (saved && BROWSE_CARD_SIZES.some(([w]) => w === saved)) st.cardW = saved;
        setValB("#cs-f-size", String(st.cardW || 150));
        $("#cs-f-size", view).addEventListener("change", (e) => {
            st.cardW = parseInt(e.target.value, 10) || 150;
            try { localStorage.setItem("cs_browse_cardw", String(st.cardW)); } catch (_) { }
            st.items.forEach((m) => { delete m.__rendered; });
            renderResults(true);
        });
    }
    // ★只看收藏(批11.5):客户端过滤已加载模型;可见太少自动续拉(见 renderResults)
    $("#cs-f-fav", view).onclick = () => {
        st.favOnly = !st.favOnly;
        st.favMore = 0;
        const b = $("#cs-f-fav", view);
        b.style.background = st.favOnly ? "var(--accent-color,#4a90e2)" : "";
        b.style.color = st.favOnly ? "#fff" : "";
        st.items.forEach((m) => { delete m.__rendered; });
        renderResults(true);
    };
    // ⟳刷新:按当前筛选重拉第 1 页
    $("#cs-browse-refresh", view).onclick = () => triggerBrowseRefresh();
    // 批4 E2E B2:一键清空全部筛选(关键词/类型/底模/tag/AND-OR/付费/分级/★只看收藏),排序/NSFW/尺寸档保留
    $("#cs-browse-reset", view).onclick = () => {
        st.query = ""; st.type = ""; st.base = ""; st.tag = "";
        st.baseMode = "OR"; st.tagMode = "OR"; st.hidePaid = "0";
        st.nsfwLv = new Set(); st.favOnly = false; st.favMore = 0; // 批11.5:分级/只看收藏一并清(尺寸档保留)
        {
            const fb = $("#cs-f-fav", view);
            if (fb) { fb.style.background = ""; fb.style.color = ""; }
        }
        if (view.__browseLv) view.__browseLv.set([]);
        $("#cs-search", view).value = "";
        $("#cs-f-type", view).value = "";
        $("#cs-f-hidepaid", view).value = "0";
        try { ["cs_browse_base_mode", "cs_browse_tag_mode", "cs_browse_hidepaid"].forEach((k) => localStorage.removeItem(k)); } catch (_) { }
        browseBasePicker.set([]);
        browseTagPicker.set([]);
        triggerBrowseRefresh();
    };
    try { st.hidePaid = localStorage.getItem("cs_browse_hidepaid") || "0"; } catch (_) { }
    $("#cs-f-hidepaid", view).value = String(st.hidePaid);
    $("#cs-f-hidepaid", view).addEventListener("change", (e) => {
        st.hidePaid = e.target.value;
        try { localStorage.setItem("cs_browse_hidepaid", st.hidePaid); } catch (_) { }
        triggerBrowseRefresh();
    });
    for (const [sel, key] of [["#cs-f-type", "type"], ["#cs-f-sort", "sort"], ["#cs-f-period", "period"], ["#cs-f-nsfw", "nsfw"]]) {
        $(sel, view).addEventListener("change", (e) => {
            st[key] = key === "nsfw" ? parseInt(e.target.value, 10) : e.target.value;
            triggerBrowseRefresh();
            if (key === "nsfw") apiPost("/civitai_studio/config", { nsfw: st[key] }).catch(() => { }); // 偏好持久化
        });
    }
    // 榜单预设:一键设置 排序+时间范围
    $$(".cs-presets .cs-chip", view).forEach((chip) => {
        chip.onclick = () => {
            const preset = chip.dataset.preset;
            if (preset === "hot-week") { st.sort = "Most Downloaded"; st.period = "Week"; }
            else if (preset === "hot-month") { st.sort = "Most Downloaded"; st.period = "Month"; }
            else { st.sort = "Highest Rated"; st.period = "Month"; }
            // 预设只改状态不刷 DOM 会让下拉显示与实际查询不一致:回写两个 select
            $("#cs-f-sort", view).value = st.sort;
            $("#cs-f-period", view).value = st.period;
            triggerBrowseRefresh();
        };
    });
    // 筛选区折叠:右下角 chevron,小尺寸 UI 下把 presets+filters 收起,搜索框常驻;记住偏好
    const fwrap = $(".cs-fwrap", view);
    try { if (localStorage.getItem("cs_browse_fold") === "1") fwrap.classList.add("folded"); } catch (_) { }
    syncFoldBtn($("#cs-browse-ffold", view), fwrap.classList.contains("folded"));
    $("#cs-browse-ffold", view).onclick = () => {
        fwrap.classList.toggle("folded");
        syncFoldBtn($("#cs-browse-ffold", view), fwrap.classList.contains("folded"));
        try { localStorage.setItem("cs_browse_fold", fwrap.classList.contains("folded") ? "1" : "0"); } catch (_) { }
    };
    // 底模:多选 chips(参考 tag 筛选形式,E2E g);逗号串存 st.base,后端拆重复键
    // 批4 E2E 8b:AND/OR 选择框移入 picker 添加行(替代删除的手输框)
    try {
        st.baseMode = localStorage.getItem("cs_browse_base_mode") || "OR";
        st.tagMode = localStorage.getItem("cs_browse_tag_mode") || "OR";
    } catch (_) { }
    const mkModeSel = (lsKey, key) => {
        const sel = document.createElement("select");
        sel.title = t("modeOR") + " / " + t("modeAND");
        sel.style.cssText = "flex:0 0 112px;font-size:11px;padding:2px;";
        sel.innerHTML = `<option value="OR">${esc(t("modeOR"))}</option><option value="AND">${esc(t("modeAND"))}</option>`;
        sel.value = st[key];
        sel.onchange = () => { st[key] = sel.value; try { localStorage.setItem(lsKey, sel.value); } catch (_) { } triggerBrowseRefresh(); };
        return sel;
    };
    const baseCands = { list: BASE_MODELS };
    const baseNames = () => String(st.base || "").split(",").map((x) => x.trim()).filter(Boolean);
    const browseBasePicker = createTagPicker($("#cs-f-base-picker", view), {
        names: baseNames(),
        prefix: "",
        addLabel: t("addBaseOpt"),
        emptyHint: t("baseFilterHint"),
        candidates: () => baseCands.list,
        allowInput: false,
        rowExtra: mkModeSel("cs_browse_base_mode", "baseMode"),
        onChange: (names) => {
            st.base = names.join(",");
            triggerBrowseRefresh();
        },
    });
    csTagPickers.add(browseBasePicker);
    // 批C:tag 换画廊同款 chips 多选;AND/OR 持久化
    const tagNamesOf = () => String(st.tag || "").split(",").map((x) => x.trim()).filter(Boolean);
    const browseTagPicker = createTagPicker($("#cs-f-tag-picker", view), {
        names: tagNamesOf(), prefix: "",
        candidates: () => Object.keys(S.tagMap || {}),
        emptyHint: t("tagFilterHint"),
        allowInput: false,
        rowExtra: mkModeSel("cs_browse_tag_mode", "tagMode"),
        onChange: (names) => { st.tag = names.join(","); triggerBrowseRefresh(); },
    });
    csTagPickers.add(browseTagPicker);
    S.ui.__browseTagPicker = browseTagPicker;
    S.ui.__browseBasePicker = browseBasePicker;
    // 打开面板即拉取站方枚举,动态补全底模候选与类型下拉(失败保留内置种子)
    apiGet("/civitai_studio/enums").then((d) => {
        const list = (d.ActiveBaseModel || d.BaseModel || []);
        if (list.length) baseCands.list = sortEnumNames(list);
        const typeSel = $("#cs-f-type", view);
        if (typeSel && Array.isArray(d.ModelType) && d.ModelType.length) {
            const cur = st.type;
            typeSel.innerHTML = [`<option value="">${esc(t("allTypes"))}</option>`]
                .concat(sortEnumNames(d.ModelType)
                    .map((tp) => `<option value="${esc(String(tp))}" ${String(tp) === cur ? "selected" : ""}>${esc(String(tp))}</option>`))
                .join("");
        }
    }).catch(() => { });
    // 无限滚动(页码推进在 fetchBrowse 成功后提交,失败自动重试同一页)
    $("#cs-browse-content", view).addEventListener("scroll", (e) => {
        const el = e.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
            if (!st.loading && st.nextCursor && !st.dirty) fetchBrowse(false);
        }
    });
}

// 子文件夹浏览:列出目标根下已存在的子目录(深度≤3),点选回填输入框(可手输多级叠加)
async function openSubdirPicker(getRoot, onPick) {
    const root = getRoot();
    if (!root) { toast("error", t("browseFailed"), t("noRegFolders")); return; }
    let dirs = [];
    try {
        const d = await apiGet(`/civitai_studio/local/subdirs?root=${encodeURIComponent(root)}`);
        dirs = d.subdirs || [];
    } catch (e) { toast("error", t("browseFailed"), e.message); return; }
    const m2 = showModal(`
        <h3 class="cs-modal-title">${esc(t("subdirPickTitle"))}</h3>
        <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;">
            <button class="cs-btn" data-p="">${esc(t("subdirRoot"))}</button>
            ${dirs.map((d2) => `<button class="cs-btn" data-p="${esc(d2)}">${esc(d2)}</button>`).join("")}
        </div>`, null, true); // keepNav:这是父对话框(下载/移动)之上的子选择器,绝不能清掉父层
    $$("[data-p]", m2.box).forEach((b) => {
        b.onclick = () => { onPick(b.dataset.p); m2.close(); };
    });
}

// 移动模型到其它已注册目录:类型/实例/目标目录(根+子文件夹),文件与 .civitai.json 一并迁移
async function openMoveDialog(m) {
    let allDests = [], typeMap = {}, destScopes = [];
    try {
        const data = await apiGet("/civitai_studio/destinations?type=all");
        allDests = data.destinations || [];
        typeMap = data.type_map || {};
        destScopes = data.scopes || [];
    } catch (e) { /* 空 → 下方报错返回 */ }
    if (!allDests.length) { toast("error", t("moveFailed"), t("noRegFolders")); return; }
    // 按文件当前目录反推默认类型(typeMap 中第一个包含该目录 key 的类型)
    const preType = Object.keys(typeMap).find((tp) => typeMap[tp].includes(m.category)) || "";
    const typeKeys = [...new Set([...(preType ? [preType] : []), ...Object.keys(typeMap)])];
    const scopeOpts = [...destScopes.map((s) => [s.id, s.label]), ["all", t("scopeAll")]];
    const curScope = (allDests.find((d) => d.root === m.root) || {}).scope || (destScopes[0] || {}).id || "all";
    const destsFor = (tp, scope) => {
        const keys = typeMap[tp];
        let list = keys ? allDests.filter((d) => keys.includes(d.key)) : allDests;
        if (scope !== "all") list = list.filter((d) => d.scope === scope);
        // E2E 13:当前注册根不再排除——"移动到同目录子文件夹"需要它;置顶+标记
        const cur = list.filter((d) => d.root === m.root)
            .map((d) => ({ ...d, _cur: true, label: (S.lang === "zh" ? "▶ 当前目录 · " : "▶ Current folder · ") + d.label }));
        return [...cur, ...list.filter((d) => d.root !== m.root)];
    };
    const m2 = showModal(`
        <h3 class="cs-modal-title">${esc(t("moveTitle", { name: m.name }))}</h3>
        <div class="cs-form">
            ${typeKeys.length > 1 ? `
            <label>${esc(t("modelTypeLabel"))}
                <select id="cs-mv-type">${typeKeys.map((tp) => `<option value="${esc(tp)}" ${tp === preType ? "selected" : ""}>${esc(tp)}</option>`).join("")}</select>
            </label>` : ""}
            <label>${esc(t("scopeLabel"))}
                <select id="cs-mv-scope">${scopeOpts.map(([v, label]) => `<option value="${v}" ${v === curScope ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
            </label>
            <label>${esc(t("targetFolder"))}
                <select id="cs-mv-root"></select>
            </label>
            <label>${esc(t("subfolder"))}
                <div style="display:flex;gap:4px;align-items:center;">
                    <input id="cs-mv-sub" type="text" placeholder="${esc(t("subfolderPh"))}" value="${esc((m.rel || "").includes("/") ? m.rel.slice(0, m.rel.lastIndexOf("/")) : "")}" style="flex:1;min-width:0;"/>
                    <button class="cs-btn" id="cs-mv-sub-browse" type="button">${esc(t("browseBtn"))}</button>
                </div>
            </label>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">${esc(t("cancel"))}</button>
                <button class="cs-btn cs-btn-primary" data-act="ok">${esc(t("moveBtn"))}</button>
            </div>
        </div>`);
    const typeSel = $("#cs-mv-type", m2.box);
    const scopeSel = $("#cs-mv-scope", m2.box);
    const rootSel = $("#cs-mv-root", m2.box);
    let lastList = [];
    const rebuildRoots = () => {
        const tp = typeSel ? typeSel.value : preType;
        const scope = scopeSel ? scopeSel.value : "all";
        lastList = destsFor(tp, scope);
        rootSel.innerHTML = lastList.length
            ? lastList.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join("")
            : `<option value="">${esc(S.lang === "zh" ? "(此范围无可用目录)" : "(no folders in this scope)")}</option>`;
        const ci = lastList.findIndex((d) => d._cur);
        if (ci >= 0) rootSel.value = String(ci); // 默认选中当前目录,配合子文件夹输入直移
    };
    rebuildRoots();
    if (typeSel) typeSel.onchange = rebuildRoots;
    if (scopeSel) scopeSel.onchange = rebuildRoots;
    $("#cs-mv-sub-browse", m2.box).onclick = () => openSubdirPicker(() => (lastList[parseInt(rootSel.value, 10)] || {}).root || "", (p) => {
        $("#cs-mv-sub", m2.box).value = p;
    });
    $("[data-act=cancel]", m2.box).onclick = m2.close;
    $("[data-act=ok]", m2.box).onclick = async () => {
        const btn = $("[data-act=ok]", m2.box);
        const d = lastList[parseInt(rootSel.value, 10)];
        if (!d) { toast("error", t("moveFailed"), t("noRegFolders")); return; }
        if (d.root === m.root && !$("#cs-mv-sub", m2.box).value.trim()) {
            toast("warn", S.lang === "zh" ? "目标与当前位置相同(需填写子文件夹)" : "Target equals current folder (enter a subfolder)", "");
            return;
        }
        btn.disabled = true;
        try {
            await apiPost("/civitai_studio/local/move", {
                category: m.category, rel: m.rel,
                root: d.root, subfolder: $("#cs-mv-sub", m2.box).value.trim(),
            });
            m2.close();
            toast("success", t("movedToast"), m.name);
            S.local.updates = {};
            loadLocal(true);
        } catch (e) {
            toast("error", t("moveFailed"), e.message);
            btn.disabled = false;
        }
    };
}

function buildLocalView(root) {
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "local";
    view.innerHTML = `
        <div class="cs-toolbar">
            <input id="cs-local-search" type="search" placeholder="${esc(t("localSearchPh"))}"/>
            <!-- E2E 12:批量【检查更新】暂隐藏——比对逻辑待真机验证后再恢复(按钮+下方 onclick 两处);单模型详情里的检查不受影响 -->
            <button class="cs-btn" id="cs-local-refresh" title="${esc(t("rescanTitle"))}">🔄</button>
        </div>
        <div id="cs-local-chips" class="cs-chips"></div>
        <div id="cs-local-list" class="cs-scroll"></div>`;
    root.appendChild(view);
    $("#cs-local-refresh", view).onclick = () => { S.local.updates = {}; loadLocal(true); };
    // $("#cs-check-updates", view).onclick = () => runUpdateCheck([]); // E2E 12 暂隐藏,恢复时连同上面按钮一起放开
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
    $("#cs-dl-clear", view).onclick = async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        b.innerHTML = `<span class="cs-spin" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:-2px;"></span>`; // 清除需遍历删除,点击即转圈(E2E r3-b)
        try { await apiPost("/civitai_studio/downloads/clear", {}); pollDownloads(); }
        catch (e) { toast("error", t("clearFailed"), e.message); }
        finally { b.disabled = false; b.textContent = t("clearFinished"); }
    };
}

// ---------- 收藏夹 tab(模型/资产两类 + 分组 + 同步/导入导出) ----------
// 11.3:集合分 Model/Image 两类不能混放 → 分组下拉按当前 kind 过滤
// (ctype 缺省=本地老组,两类都显示;Legacy 哨兵组只在资产下显示)
function groupsForKind(groups, kind) {
    const want = kind === "model" ? "Model" : "Image";
    return (groups || []).filter((g) => !g.ctype || g.ctype === want);
}

// 批A:组管理(删除;绑定组可连远端 collection.delete,必须确认弹窗)
async function openGroupManager() {
    const d = await apiGet("/civitai_studio/favorites");
    const groups = d.groups || [];
    const items = d.items || [];
    const md = showModal(`
        <h3 class="cs-modal-title">${esc(t("gmTitle"))}</h3>
        <div class="cs-form" id="cs-gm-list"></div>
        <div class="cs-modal-actions"><button class="cs-btn" data-act="close">${esc(t("cancel"))}</button></div>`);
    $("[data-act=close]", md.box).onclick = md.close;
    const list = $("#cs-gm-list", md.box);
    if (!groups.length) { list.innerHTML = `<div class="cs-dim">${esc(t("gmEmpty"))}</div>`; return; }
    for (const g of groups) {
        const n = items.filter((it) => (it.group_ids || []).includes(g.gid)).length;
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;flex-direction:row;flex-wrap:wrap;";
        const del = document.createElement("button");
        del.className = "cs-btn";
        del.style.cssText = "color:#e2543f;";
        del.textContent = t("gmDelete");
        del.onclick = async () => {
            let remote = false, remoteNote = "";
            if (g.civitai_id) {
                remote = confirm(t("gmRemoteNote", { name: g.name }) + "\n\n" + t("gmRemoteDel") + "?\n\nOK = 是 / Cancel = 否(仅删本地)");
                remoteNote = remote ? " (+Civitai)" : "";
            }
            if (!confirm(t("gmConfirm", { name: g.name, remote: remote ? t("gmRemoteNote", { name: g.name }) : "" }))) return;
            try {
                const r = await apiPost("/civitai_studio/favorites/groups", { gid: g.gid, delete: true, remote });
                if (r.remote_error) { toast("error", t("favFailed"), r.remote_error); return; }
                toast("success", t("gmDone", { name: g.name, note: remoteNote }), "");
                md.close();
                S.favData = null; // 强制重拉
                loadFavDataOnly().catch(() => { });
            } catch (e) { toast("error", t("favFailed"), e.message); }
        };
        const info = document.createElement("span");
        info.style.cssText = "flex:1;min-width:0;font-size:12px;";
        info.textContent = `${g.name} (${n})`;
        info.title = g.civitai_id ? t("gmBound", { cid: g.civitai_id }) : t("gmLocalOnly");
        const bound = document.createElement("span");
        bound.className = "cs-dim";
        bound.style.cssText = "font-size:10px;";
        bound.textContent = g.civitai_id ? `#${g.civitai_id}` : t("gmLocalOnly");
        if (g.ctype === "Bookmark") { // 批4 F1:站方系统集合(Liked Models)只读,不可删(删了下轮同步也会回来)
            bound.textContent = t("gmSystem");
            bound.title = t("gmSystemTip");
            del.disabled = true;
            del.style.opacity = ".45";
            del.title = t("gmSystemTip");
        }
        row.appendChild(info);
        row.appendChild(bound);
        row.appendChild(del);
        list.appendChild(row);
    }
}

// 批A:收藏库全量重置(全清,弹窗强制确认)
function openFavReset() {
    const n = (S.favData?.items || []).length;
    if (!confirm(t("resetWarn", { n }))) return;
    apiPost("/civitai_studio/favorites/reset", {}).then(() => {
        toast("success", t("resetDone"), "");
        S.favData = null;
        loadFavDataOnly().catch(() => { });
    }).catch((e) => toast("error", t("favFailed"), e.message));
}

function refreshFavGroupSel(view) {
    const sel = $("#cs-fav-group", view);
    if (!sel) return;
    const groups = groupsForKind(S.favData?.groups, S.favUi.kind);
    sel.innerHTML = `<option value="all">${esc(t("favGroupAll"))}</option>`
        + `<option value="_">${esc(t("favGroupNone"))}</option>`
        + groups.map((g) => `<option value="${esc(g.gid)}">${esc(g.name)}</option>`).join("");
    sel.value = S.favUi.group;
    if (!Array.from(sel.options).some((o) => o.selected)) { sel.value = "all"; S.favUi.group = "all"; }
}

function renderFavGrid(view) {
    const grid = $("#cs-fav-grid", view);
    if (!grid) return;
    grid.innerHTML = "";
    const q = String($("#cs-fav-search", view)?.value || "").toLowerCase();
    const items = (S.favData?.items || [])
        .filter((it) => it.kind === S.favUi.kind)
        .filter((it) => S.favUi.group === "all"
            || (S.favUi.group === "_" ? !(it.group_ids || []).length : (it.group_ids || []).includes(S.favUi.group)))
        .filter((it) => !q || String(it.name || it.oid).toLowerCase().includes(q))
        .sort((a, b) => { // 详细筛选 v1(E2E f):排序维度
            if (S.favUi.sort === "name") {
                // E2E #9:civitai images 无名称域,资产该档实为按 ID(数值降序)
                if (S.favUi.kind === "asset") return (parseInt(b.oid, 10) || 0) - (parseInt(a.oid, 10) || 0);
                return String(a.name || a.oid).localeCompare(String(b.name || b.oid));
            }
            if (S.favUi.sort === "added") return (b.added_at || 0) - (a.added_at || 0);
            return (b.updated_at || 0) - (a.updated_at || 0);
        });
    if (!items.length) {
        grid.innerHTML = `<div class="cs-empty">${esc(t("favEmpty"))}</div>`;
        return;
    }
    const groups = S.favData?.groups || [];
    const h = 180;
    const PAGE = 60; // 网格分页:首屏 60,「加载更多」每次 +60(1000 条不再一次性入 DOM)
    if (S.favUi.page < 1) S.favUi.page = 1;
    const shown = items.slice(0, S.favUi.page * PAGE);
    for (const it of shown) {
        const cell = document.createElement("div");
        cell.className = "cs-thumb";
        cell.style.cssText = `width:135px;height:${h}px;position:relative;`;
        const cover = it.cover;
        if (cover && isVideoItem({ url: cover })) {
            const v = document.createElement("video");
            v.classList.add("cs-nsfw-blurable"); // 批8:视频分支此前漏接遮罩(实测 144144231/143543456 恰好都是视频)
            v.dataset.nsfwLevel = nsfwBitsOf(it.extra || {});
            v.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;" + nsfwBlurStyle(it.extra || {});
            v.muted = true; v.loop = true; v.playsInline = true; v.preload = "metadata";
            v.src = imgSrc(cdnVideo(cover)) + "#t=0.001"; // 批11:视频缩略走 cdnVideo(320 档)
            cell.appendChild(v);
        } else if (cover) {
            const im = document.createElement("img");
            im.loading = "lazy";
            im.classList.add("cs-nsfw-blurable"); // 批6:无条件带,勾选变更即时重算
            im.dataset.nsfwLevel = nsfwBitsOf(it.extra || {});
            im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;" + nsfwBlurStyle(it.extra || {});
            im.src = imgSrc(cdnThumb(cover));
            im.onerror = () => { if (!im.dataset.retried) { im.dataset.retried = "1"; im.src = altSrc(cover); } else im.style.display = "none"; };
            cell.appendChild(im);
        }
        // 名称条
        const cap = document.createElement("div");
        cap.style.cssText = "position:absolute;left:0;right:0;bottom:0;padding:2px 4px;font-size:10px;"
            + "background:rgba(0,0,0,.55);color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        cap.textContent = it.name || it.oid;
        cap.title = it.name || it.oid;
        cell.appendChild(cap);
        // ★取消收藏
        const rm = document.createElement("button");
        rm.className = "cs-save-btn";
        rm.style.cssText = "right:auto;left:4px;color:#ffd75e;";
        rm.title = t("favRemoveTitle");
        rm.textContent = "★";
        rm.onclick = async (ev) => {
            ev.stopPropagation();
            try {
                await toggleFav(it.kind, it.oid);
                S.favData.items = (S.favData.items || []).filter((x) => !(x.kind === it.kind && x.oid === it.oid));
                renderFavGrid(view);
            } catch (e) { toast("error", t("favFailed"), e.message); }
        };
        cell.appendChild(rm);
        // 分组按钮(E2E #8):点开弹收藏夹多选浮层;按钮文案=当前组名(跨集合多挂逗号连接)
        const gnames = (it.group_ids || [])
            .map((gid) => (groups.find((g) => g.gid === gid) || {}).name)
            .filter(Boolean).join(",") || t("favGroupNone");
        const gb = document.createElement("button");
        gb.style.cssText = "position:absolute;right:2px;top:2px;width:78px;font-size:10px;padding:1px 3px;"
            + "background:rgba(20,20,24,.85);color:#eee;border:1px solid #555;border-radius:4px;"
            + "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;text-align:left;";
        gb.title = t("groupPickTitle") + " · " + gnames;
        gb.textContent = gnames;
        gb.onclick = async (ev) => {
            ev.stopPropagation();
            openGroupPicker(ev, it.kind, it.group_ids || [], async (gids) => {
                try {
                    await apiPost("/civitai_studio/favorites/assign", { kind: it.kind, oid: it.oid, group_ids: gids });
                    it.group_ids = gids;
                    it.mem_pushed = it.mem_pushed || {};
                    for (const gid of gids) if (!(gid in it.mem_pushed)) it.mem_pushed[gid] = 0;
                    renderFavGrid(view);
                } catch (e) { toast("error", t("favFailed"), e.message); }
            });
        };
        cell.appendChild(gb);
        // 上推角标(E2E #10):有组全推=✓ 已上行;有待推=↑ 待上行;无组=仅本地
        {
            const mp = it.mem_pushed || {};
            const gids = it.group_ids || [];
            const pending = gids.filter((gid) => !mp[gid]).length;
            const bd = document.createElement("div");
            bd.style.cssText = "position:absolute;right:2px;top:22px;font-size:9px;padding:0 4px;"
                + "border-radius:6px;pointer-events:none;" + (pending
                    ? "background:rgba(212,150,40,.85);color:#fff;" : gids.length
                        ? "background:rgba(60,160,90,.8);color:#fff;" : "background:rgba(0,0,0,.55);color:#bbb;");
            bd.textContent = pending ? t("pushPending") : gids.length ? t("pushDone") : t("pushLocalOnly");
            cell.appendChild(bd);
        }
        cell.onclick = () => {
            if (it.kind === "asset") openImageDetail({ id: it.oid, url: it.cover, meta: (it.extra || {}).meta, modelVersionIds: (it.extra || {}).modelVersionIds, baseModel: (it.extra || {}).baseModel, nsfwLevel: (it.extra || {}).nsfwLevel, type: (it.extra || {}).type });
            else openBrowseFloat(parseInt(it.oid, 10)); // 批A:收藏夹模型可点开详情
        };
        grid.appendChild(cell);
    }
    if (items.length > shown.length) {
        const more = document.createElement("button");
        more.className = "cs-btn";
        more.style.cssText = "flex:0 0 100%;margin:6px auto;";
        more.textContent = t("loadMore") + ` (+${items.length - shown.length})`;
        more.onclick = () => { S.favUi.page += 1; renderFavGrid(view); };
        grid.appendChild(more);
    }
}

async function loadFavView() {
    try {
        const d = await apiGet("/civitai_studio/favorites");
        S.favData = { items: d.items || [], groups: d.groups || [] };
        S.favs = new Set(d.ids || []);
        S.favModelIds = new Set(d.model_ids || []);
        refreshFavGroupSel(S.ui.root);
        renderFavGrid(S.ui.root);
    } catch (e) { toast("error", t("loadFailed"), e.message); return; }
    // 批8:缺分级条目后台补拉(逐张限速),完成后刷新收藏行遮罩;remaining>0 时下次开页继续
    if ((S.favData?.items || []).some((x) => !((x.extra || {}).nsfwLevel))) {
        apiPost("/civitai_studio/favorites/backfill_levels", {}).then((r2) => {
            if (r2.updated > 0) loadFavDataOnly().catch(() => { });
        }).catch(() => { });
    }
    // 自动同步:开夹时静默触发,30 分钟节流
    if (S.cfg?.fav_autosync && Date.now() - (S.favLastSync || 0) > 30 * 60 * 1000) favDoSync(true);
}

function setFavSyncLine(text, cls) {
    // U3:收藏 tab 顶部的同步状态条——自动同步静默跑,结果必须可见
    const el = $("#cs-fav-syncline", S.ui.root);
    if (!el) return;
    if (!text) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.className = "cs-fav-syncline " + (cls || "");
    el.textContent = text;
}

function favSyncLineText(r) {
    const rec = {
        ts: Date.now(),
        up: (r.items_up || 0) + (r.items_rm || 0) + (r.upsynced || 0),
        down: (r.models_down || 0) + (r.images_down || 0)
    };
    try { localStorage.setItem("cs_fav_lastsync", JSON.stringify(rec)); } catch (_) { }
    let txt = t("favSyncLine", { time: new Date(rec.ts).toLocaleString(), up: rec.up, down: rec.down });
    if (r.scope_hint) txt += " · " + r.scope_hint;
    if (r.errors && r.errors.length) txt += " · " + t("syncFailShort") + ": " + humanizeErr(String(r.errors[0]));
    return txt;
}

async function favDoSync(silent) {
    const btn = $("#cs-fav-sync", S.ui.root);
    if (btn) { btn.disabled = true; btn.textContent = t("favSyncing"); }
    try {
        const r = await apiPost("/civitai_studio/favorites/sync");
        S.favLastSync = Date.now();
        if (r.status === "busy") {
            setFavSyncLine(t("favSyncBusy"), "warn");
            toast("warn", S.lang === "zh" ? "同步已在进行中" : "Sync already running", "");
        } else {
            setFavSyncLine(favSyncLineText(r), (r.scope_hint || (r.errors && r.errors.length)) ? "warn" : "");
            if (r.scope_hint) toast("warn", r.scope_hint, "");
            else if (!silent) {
                toast("success", t("favSyncDone", r) + (r.truncated ? " " + t("favSyncTrunc") : ""), "");
            }
            else if (r.upsync_failed) toast("warn", t("favFailed"), String(r.errors?.[0] || ""));
        }
        await loadFavDataOnly();
    } catch (e) {
        setFavSyncLine(t("syncFailShort") + ": " + humanizeErr(e.message), "bad");
        if (!silent) toast("error", t("favFailed"), humanizeErr(e.message));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = t("favSync"); }
    }
}

async function loadFavDataOnly() {
    const d = await apiGet("/civitai_studio/favorites");
    S.favData = { items: d.items || [], groups: d.groups || [] };
    S.favs = new Set(d.ids || []);
    S.favModelIds = new Set(d.model_ids || []);
    refreshFavGroupSel(S.ui.root);
    renderFavGrid(S.ui.root);
}

function buildFavoritesView(root) {
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "favorites";
    S.favUi = S.favUi || { kind: "asset", group: "all", page: 1 };
    view.innerHTML = `
        <div class="cs-filters">
            <select id="cs-fav-kind">
                <option value="asset">${esc(t("favKindAsset"))}</option>
                <option value="model">${esc(t("favKindModel"))}</option>
            </select>
            <select id="cs-fav-group"></select>
            <select id="cs-fav-sort" title="${esc(t("favSortTitle"))}">
                <option value="updated">${esc(t("favSortUpdated"))}</option>
                <option value="added">${esc(t("favSortAdded"))}</option>
                <option value="name">${esc(t("favSortName"))}</option>
            </select>
            <input id="cs-fav-search" type="text" placeholder="${esc(t("favSearchPh"))}" style="flex:1;min-width:90px"/>
            <button class="cs-btn" id="cs-fav-sync">${esc(t("favSync"))}</button>
            <button class="cs-btn" id="cs-fav-manage" title="${esc(t("gmTitle"))}">${esc(t("manageBtn"))}</button>
            <button class="cs-btn" id="cs-fav-reset" title="${esc(t("resetTitle"))}" style="color:#e2543f;">${esc(t("resetBtn"))}</button>
            <button class="cs-btn" id="cs-fav-import">${esc(t("favImport"))}</button>
            <button class="cs-btn" id="cs-fav-export">${esc(t("favExport"))}</button>
            <button class="cs-btn" id="cs-fav-extracts">${esc(t("extractMgr"))}</button>
            <input type="file" id="cs-fav-file" accept=".json,application/json" style="display:none"/>
        </div>
        <div id="cs-fav-syncline" class="cs-fav-syncline" style="display:none"></div>
        <div class="cs-scroll"><div id="cs-fav-grid" class="cs-gal-grid"></div></div>`;
    root.appendChild(view);
    // 上次同步摘要(localStorage):自动同步静默跑,打开 tab 也能看到结果
    try {
        const rec = JSON.parse(localStorage.getItem("cs_fav_lastsync") || "null");
        if (rec && rec.ts) setFavSyncLine(t("favSyncLine", { time: new Date(rec.ts).toLocaleString(), up: rec.up || 0, down: rec.down || 0 }), "");
    } catch (_) { }
    const favRescroll = () => { const sc = $(".cs-scroll", view); if (sc) sc.scrollTop = 0; };
    // E2E 12:名称档标签随类别 — 资产=按 ID,模型=按模型名(构建时即渲染)
    const syncNameOpt = () => {
        const nameOpt = $(`#cs-fav-sort option[value="name"]`, view);
        if (nameOpt) nameOpt.textContent = S.favUi.kind === "asset"
            ? (S.lang === "zh" ? "按 ID" : "By ID") : (S.lang === "zh" ? "按模型名" : "By model name");
    };
    syncNameOpt();
    $("#cs-fav-sort", view).value = S.favUi.sort || "updated";
    $("#cs-fav-sort", view).onchange = (e) => { S.favUi.sort = e.target.value; S.favUi.page = 1; renderFavGrid(view); favRescroll(); }; // 评审R2:换序后回顶,防停在旧序第N页尾部
    $("#cs-fav-kind", view).onchange = (e) => {
        S.favUi.kind = e.target.value; S.favUi.page = 1; refreshFavGroupSel(view); renderFavGrid(view); favRescroll();
        syncNameOpt();
    };
    $("#cs-fav-group", view).onchange = (e) => { S.favUi.group = e.target.value; S.favUi.page = 1; renderFavGrid(view); favRescroll(); };
    let debSearch;
    $("#cs-fav-search", view).addEventListener("input", (e) => {
        e.stopPropagation();
        clearTimeout(debSearch);
        debSearch = setTimeout(() => { S.favUi.page = 1; renderFavGrid(view); const sc = $(".cs-scroll", view); if (sc) sc.scrollTop = 0; }, 250);
    });
    $("#cs-fav-sync", view).onclick = () => favDoSync(false);
    $("#cs-fav-manage", view).onclick = () => openGroupManager().catch((e) => toast("error", t("favFailed"), e.message));
    $("#cs-fav-reset", view).onclick = openFavReset;
    $("#cs-fav-import", view).onclick = () => $("#cs-fav-file", view).click();
    $("#cs-fav-file", view).onchange = async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        try {
            const r = await apiPost("/civitai_studio/favorites/import", { payload: JSON.parse(await f.text()) });
            toast("success", t("favImported", { items: r.imported?.items ?? 0, groups: r.imported?.groups ?? 0 }), "");
            loadFavView();
        } catch (err) { toast("error", t("favImportFailed"), err.message); }
    };
    $("#cs-fav-export", view).onclick = () => window.open("/civitai_studio/favorites/export", "_blank");
    $("#cs-fav-extracts", view).onclick = openExtractMgr;
    loadFavView();
}

// 提取工作流管理:列表 + 删除(防"塞满模板"的管理手段之一)
async function openExtractMgr() {
    let items = [];
    try {
        items = (await apiGet("/civitai_studio/workflow_extracts")).items || [];
    } catch (e) { toast("error", t("favFailed"), e.message); return; }
    const m = showModal(`<h3 class="cs-modal-title">${esc(t("extractMgrTitle"))}</h3>
        <div class="cs-scroll" style="max-height:50vh">
            ${items.length ? items.map((it) => `<div style="display:flex;gap:6px;align-items:center;padding:3px 0;">
                <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.name)}</span>
                <span class="cs-form-hint">${(it.size / 1024).toFixed(1)} KB</span>
                <button class="cs-btn cs-btn-mini" data-del="${esc(it.name)}">${esc(t("extractDelete"))}</button></div>`).join("")
            : `<div class="cs-empty">${esc(t("extractEmpty"))}</div>`}
        </div>
        <div class="cs-modal-actions"><button class="cs-btn" data-close>${esc(t("cancel"))}</button></div>`);
    $("[data-close]", m.box).onclick = m.close;
    m.box.addEventListener("click", async (e) => {
        const b = e.target.closest?.("[data-del]");
        if (!b) return;
        try {
            await apiPost("/civitai_studio/workflow_extracts/delete", { name: b.dataset.del });
            b.closest("div").remove();
            toast("success", t("extractDeleted"), "");
        } catch (err) { toast("error", t("favFailed"), err.message); }
    });
}

function buildRoot(el) {
    destroyComboPickers(el); // 侧栏重建:旧的补全弹层与 scroll 监听一并清理(节点侧不受影响)
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
            <button class="cs-tab-btn" data-tab="favorites" title="${esc(t("favTabTitle"))}">${esc(t("favTab"))}</button>
            <span class="cs-topbar-spacer"></span>
            <button class="cs-tab-btn" id="cs-blur-btn" title="${esc(t("blurTitle"))}">👁</button>
            <button class="cs-tab-btn" id="cs-settings-btn" title="${esc(t("settings"))}">⚙</button>
        </div>
        <div class="cs-body"></div>`;
    el.appendChild(root);
    S.ui.root = root;
    buildBrowseView($(".cs-body", root));
    buildLocalView($(".cs-body", root));
    buildDownloadsView($(".cs-body", root));
    buildGalleryView($(".cs-body", root));
    buildFavoritesView($(".cs-body", root));
    $$(".cs-tab-btn[data-tab]", root).forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
    $("#cs-settings-btn", root).onclick = openSettings;
    const blurBtn = $("#cs-blur-btn", root); // 批5 E2E 3:scoped 到本 root,防重复容器取错节点
    if (blurBtn) {
        let lastFired = 0;
        const open = (e) => {
            const now = Date.now();
            if (now - lastFired < 400) return; // click/pointerup 双通道防抖
            lastFired = now;
            console.log("[Civitai-Studio][menu] blur btn click");
            try { openNsfwBlurPicker(e); } catch (err) {
                console.error("[Civitai-Studio] blur picker failed:", err);
                toast("error", t("loadFailedTitle"), String((err && err.message) || err));
            }
        };
        blurBtn.addEventListener("click", open);
        blurBtn.addEventListener("pointerup", open); // 批5:click 被宿主抑制时的备用通道
    } else {
        console.error("[Civitai-Studio] #cs-blur-btn missing in topbar");
    }
    pinSidebarHeight(root);
    switchTab("browse");
    maybeOnboard(root);
}

function maybeOnboard(root) {
    // U1 首次引导:未配置 key 且用户没关过引导 → 浏览 tab 顶部三步卡;保存 key 自动消失
    let dismissed = false;
    try { dismissed = !!localStorage.getItem("cs_onboard_done"); } catch (_) { }
    if (S.cfg?.api_key_set || dismissed) return;
    const view = root.querySelector(".cs-view[data-view=browse]");
    if (!view || root.querySelector("#cs-onboard")) return;
    const card = document.createElement("div");
    card.className = "cs-banner cs-onboard";
    card.id = "cs-onboard";
    card.innerHTML = `
        <div style="font-weight:600;margin-bottom:2px;">${esc(t("onboardTitle"))}</div>
        <ol style="margin:0 0 6px 18px;padding:0;font-size:11px;line-height:1.6;">
            <li>${esc(t("onboard1"))}</li><li>${esc(t("onboard2"))}</li><li>${esc(t("onboard3"))}</li>
        </ol>
        <div style="display:flex;gap:6px;">
            <button class="cs-btn cs-btn-mini cs-btn-primary" data-go>${esc(t("onboardGo"))}</button>
            <button class="cs-btn cs-btn-mini" data-x>${esc(t("onboardDismiss"))}</button>
        </div>`;
    view.prepend(card);
    card.querySelector("[data-go]").onclick = () => { card.remove(); openSettings(); };
    card.querySelector("[data-x]").onclick = () => {
        card.remove();
        try { localStorage.setItem("cs_onboard_done", "1"); } catch (_) { }
    };
}

// 折叠态按钮:E2E 15 — 原单字符 chevron 折叠后不显眼,改为拉宽的 »»»
function syncFoldBtn(btn, folded) {
    if (btn) btn.textContent = folded ? "»»»" : "▾";
}

let _sidebarRO = null;
let _sidebarPinTimer = null;

function pinSidebarHeight(root) {
    // ComfyUI 侧边栏 tab 的挂载容器高度是 auto,height:100% 解析不出 → 面板被内容撑高
    // (实测 1000 收藏时 root 4136px),滚动交给外层 .sidebar-content-container,
    // tab 栏与各视图筛选区随之滚走。这里把 root 钉到滚动容器的实测高度,
    // 让滚动回到面板内部的 .cs-scroll;ResizeObserver 跟随分栏拖动/窗口缩放。
    // 强刷后首开会落空:此刻 root 可能尚未挂进 ComfyUI 的容器树(closest 找不到),
    // 旧实现直接放弃 → 全部筛选区跟着网格滚、切 tab 重建后才"自愈"。现改为重试。
    const find = () => (root.parentElement ? root.parentElement.closest(".sidebar-content-container") : null);
    if (_sidebarRO) { _sidebarRO.disconnect(); _sidebarRO = null; } // 面板重建:先放上一棵树的资源
    if (_sidebarPinTimer) { clearInterval(_sidebarPinTimer); _sidebarPinTimer = null; }
    if (!find()) {
        const t0 = Date.now();
        _sidebarPinTimer = setInterval(() => {
            if (!root.isConnected || Date.now() - t0 > 20000) { clearInterval(_sidebarPinTimer); _sidebarPinTimer = null; return; }
            if (find()) { clearInterval(_sidebarPinTimer); _sidebarPinTimer = null; pinSidebarHeight(root); }
        }, 250);
        return; // 找到容器前保持原 100% 布局,topbar 的 sticky 兜底
    }
    const scroller = find();
    const pin = () => {
        if (!root.isConnected) return;
        const h = scroller.clientHeight;
        if (h < 80) return; // 容器还没完成首次布局:等 ResizeObserver 回调
        root.style.height = h + "px";
        root.style.overflow = "hidden";
    };
    pin();
    _sidebarRO = new ResizeObserver(() => {
        if (!root.isConnected) { _sidebarRO.disconnect(); _sidebarRO = null; return; }
        pin();
    });
    _sidebarRO.observe(scroller);
}

// ---------- 样式 ----------
function injectStyles() {
    if (document.getElementById("civitai-studio-styles")) return;
    const style = document.createElement("style");
    style.id = "civitai-studio-styles";
    style.textContent = `
.cs-root { display:flex; flex-direction:column; height:100%; color:var(--fg-color,#eee); font-size:13px; }
.cs-topbar { display:flex; flex-wrap:wrap; gap:4px; align-items:center; padding:6px; border-bottom:1px solid var(--border-color,#444); flex-shrink:0; position:sticky; top:0; z-index:30; background:var(--comfy-menu-bg,#1f1f1f); }
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
.cs-filters > .cs-span-4 { grid-column:span 4; }   /* 批11.5:两页末行三等分 */
.cs-toolbar select { max-width:132px; font-size:12px; padding:2px; }
.cs-toolbar .cs-btn-mini { flex:0 0 auto; }
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
.cs-detail-badges { display:flex; flex-wrap:wrap; gap:4px; margin:6px 0; }
.cs-badge2 { font-size:10px; padding:1px 6px; border-radius:8px; border:1px solid var(--border-color,#444); color:var(--desc-text-color,#bbb); white-space:nowrap; }
.cs-badge2-ok { color:#9fdca0; border-color:rgba(140,200,140,.45); }
.cs-badge2-warn { color:#f0c67e; border-color:rgba(240,198,126,.45); }
.cs-badge2-base { background:var(--comfy-input-bg,#333); }
.cs-ver-desc-box { border:1px solid var(--border-color,#444); border-radius:6px; padding:8px; background:rgba(255,255,255,.03); max-height:320px; overflow-y:auto; }
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
.cs-card-cyc { position:absolute; right:4px; top:4px; z-index:2; background:rgba(0,0,0,.65); color:#fff; border-radius:4px; font-size:9px; line-height:1; padding:2px 4px; pointer-events:none; }
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
.cs-expand-actions { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
.cs-expand-loading { padding:10px; color:var(--desc-text-color,#999); font-size:12px; text-align:center; }
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
.cs-local-update { font-size:11px; margin-top:4px; color:#e2a23f; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.cs-local-update.cs-ok { color:#4caf50; }
.cs-gal-grid { display:flex; flex-wrap:wrap; gap:6px; padding-bottom:20px; align-content:flex-start; }
.cs-gal-item { position:relative; border-radius:6px; overflow:hidden; background:#222; box-sizing:border-box; }
.cs-gal-item img, .cs-gal-item video { width:100%; height:100%; object-fit:cover; display:block; cursor:pointer; }
/* 文件格式角标(E2E 7):★ 在左下,左上空置,角标占左上(评审R2 修正注释错位) */
.cs-fmt { position:absolute; left:4px; top:4px; background:rgba(0,0,0,.7); color:#cfe3ff; font-size:9px; line-height:1; padding:2px 4px; border-radius:3px; z-index:2; pointer-events:none; }
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
.cs-info { cursor:help; opacity:.75; font-size:11px; flex:0 0 auto; }
.cs-info:hover { opacity:1; color:var(--accent-color,#4a90e2); }
/* 标题行 label 是 column flex,文本与 ⓘ 会各占一行(E2E r3-1):包 cs-lab 让其同行 */
.cs-form label .cs-lab { display:flex; align-items:center; gap:6px; }
/* ---- 设置页:分组卡片 + sticky 底栏 ---- */
.cs-settings-modal .cs-float-body { display:flex; flex-direction:column; overflow:hidden; }
.cs-set-body { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:10px; }
.cs-set-group { border:1px solid var(--border-color,#444); border-radius:8px; flex-shrink:0; }
.cs-set-group-head { display:flex; justify-content:space-between; align-items:center; padding:7px 10px; font-size:12px; font-weight:600; cursor:pointer; user-select:none; }
.cs-set-group-head:hover { background:var(--comfy-input-bg,#333); border-radius:8px; }
.cs-set-group-body { display:flex; flex-direction:column; gap:10px; padding:8px 10px 10px; border-top:1px solid var(--border-color,#444); }
.cs-set-group.closed .cs-set-group-body { display:none; }
.cs-set-caret { transition:transform .15s; opacity:.7; }
.cs-set-group.closed .cs-set-caret { transform:rotate(-90deg); }
.cs-set-keyrow { display:flex; gap:8px; align-items:center; min-height:22px; flex-wrap:wrap; }
.cs-set-badge { font-size:11px; border-radius:4px; padding:2px 8px; white-space:normal; }
.cs-set-badge.ok { background:rgba(76,175,80,.15); color:#4caf50; }
.cs-set-badge.warn { background:rgba(255,152,0,.15); color:#ffb74d; }
.cs-set-badge.bad { background:rgba(226,84,63,.15); color:#e2543f; }
.cs-set-exp { font-size:10px; color:#ffb74d; border:1px solid rgba(255,152,0,.5); border-radius:3px; padding:0 4px; margin-left:4px; }
.cs-set-sliderrow { display:flex; gap:8px; align-items:center; }
.cs-set-sliderrow input[type=range] { flex:1; min-width:0; }
.cs-set-sliderrow input[type=number] { width:64px; }
.cs-set-progress { height:6px; border-radius:3px; background:var(--comfy-input-bg,#333); overflow:hidden; }
.cs-set-progress-fill { height:100%; width:0; background:var(--accent-color,#4a90e2); transition:width .3s; }
.cs-set-progress-fill.warn { background:#ffb74d; }
.cs-set-progress-fill.bad { background:#e2543f; }
.cs-set-btnrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.cs-set-actions { flex-shrink:0; border-top:1px solid var(--border-color,#444); margin-top:10px; padding-top:10px; }
/* ---- 筛选区折叠(右下角 chevron)+ 收藏同步状态条 ---- */
.cs-fwrap { position:relative; flex-shrink:0; }
.cs-ffold { position:absolute; right:6px; bottom:4px; background:var(--comfy-menu-bg,#2a2a2a); border:1px solid var(--border-color,#444); border-radius:4px; color:var(--desc-text-color,#999); font-size:9px; line-height:1; padding:3px 6px; cursor:pointer; z-index:2; }
.cs-ffold:hover { color:var(--fg-color,#eee); border-color:var(--accent-color,#4a90e2); }
.cs-fwrap.folded .cs-presets, .cs-fwrap.folded .cs-filters { display:none; }
.cs-fwrap.folded { min-height:20px; } /* 折叠后留一条高度,右下 chevron 不叠搜索框 */
.cs-fwrap.folded .cs-ffold { transform:none; bottom:2px; padding:3px 14px; font-size:10px; font-weight:700; letter-spacing:2px; }
.cs-fav-syncline { padding:2px 8px; font-size:11px; color:var(--desc-text-color,#999); border-bottom:1px solid var(--border-color,#444); flex-shrink:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cs-fav-syncline.warn { color:#e2a23f; }
.cs-fav-syncline.bad { color:#e2543f; }
.cs-dl-hint { background:rgba(0,0,0,.2); border-radius:6px; padding:6px 8px; }
.cs-float { position:fixed; width:460px; max-width:calc(100vw - 20px); max-height:calc(100vh - 24px); background:var(--comfy-menu-bg,#2a2a2a); border:1px solid var(--border-color,#444); border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.55); z-index:60000; display:flex; flex-direction:column; overflow:hidden; }
.cs-float-head { display:flex; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border-color,#444); cursor:move; user-select:none; }
.cs-float-back { flex:0 0 auto; background:transparent; border:1px solid var(--border-color,#444); color:var(--fg-color,#ddd); border-radius:6px; padding:2px 9px; font-size:11px; cursor:pointer; }
.cs-float-back:hover { background:var(--border-color,#3f3f46); }
.cs-float-title { flex:1; min-width:0; font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-float-close { background:transparent; border:none; color:var(--fg-color,#eee); font-size:14px; cursor:pointer; padding:0 2px; }
.cs-float-close:hover { color:#e2543f; }
.cs-float-body { overflow-y:auto; padding:10px 12px; }
.cs-float .cs-detail-row select { width:100%; }
.cs-float-modal { width:480px; }
.cs-float-modal .cs-float-body { max-height:calc(100vh - 120px); }
@keyframes cs-rotate { to { transform: rotate(360deg); } }
.cs-spin { width:14px; height:14px; border:2px solid #555; border-top-color:var(--accent-color,#4a90e2); border-radius:50%; animation:cs-rotate .8s linear infinite; display:inline-block; flex:0 0 auto; }
.cs-media-view img, .cs-media-view video { max-width:100%; max-height:64vh; border-radius:8px; display:block; margin:0 auto; background:rgba(0,0,0,.35); }
.cs-media-view video { height:auto; max-height:64vh; object-fit:contain; } /* E2E c:横屏视频去固定高 */
.cs-thumb video { pointer-events:none; }
.cs-nsfw-blurable { transition:filter .12s; }
.cs-nsfw-blurable:hover { filter:none !important; }
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
    // 与 fmtOf 同口径(E2E 评审R2):webm/mov 也是视频,走 <img> 分支会渲染成隐形黑格
    return (item.type || "") === "video" || /\.(mp4|webm|mov)($|\?)/.test(item.url || "");
}

// meta 剥壳:items[x].meta 可能是 {meta:{...}} 包裹层(imageId 精确查询),
// 也可能直接是参数对象;生成参数(seed/steps/prompt/hashes/resources/civitaiResources)
// 全在内层。全文件统一走这里,勿再手写 meta.meta 判断
function unwrapMeta(rawMeta) {
    let m = rawMeta || {};
    if (m && !m.prompt && m.meta) m = m.meta;
    return m || {};
}

// Civitai CDN 缩放变体:把 original=true 段换成 width=N,体积可降两个数量级
function cdnThumb(url, w = 320) {
    if (!url) return "";
    return url.replace("/original=true/", `/width=${w}/`);
}

// 视频缩略变体:与图片同一 imgix 变换段。站方档位是离散的(实测 704x960 源):
//   请求 64-96 → 96x130 档 | 128-320 → 320x436 档 | 321-450 → 450x614 档 | 512 → 512 档 | 更大 → 原图
// 取 320:这是"不糊"的最小档(96 档在 150-280px 卡面上肉眼可见糊),且与图片缩略同档
// (图片请求 128/256 也落在 320 档),卡内视频/图片观感一致。体积 450 档 2.43MB → 320 档
// 1.43MB(-41%,三样本实测 -41%/-42%/-47%)。大图浮层仍走原链,细节不受影响(批11.2)
function cdnVideo(url, w = 320) {
    if (!url) return "";
    return url.replace("original=true", `width=${w}`); // 不加斜杠:兼容 anim=true,original=true 类多段
}

// 站方部分文件名尾部是"_文件ID"(量化信息只在 metadata.fp,如 Qwen 2.1 官方包)。
// 显示/默认保存名用 fp 还原该段:qwenImage21_v21_txt_3239854.safetensors → …_bf16.safetensors
function fileDisplayName(f) {
    let name = String(f?.name || "");
    const fp = f?.metadata?.fp || f?.fp || "";
    const m = name.match(/^(.*?)[_\- ](\d{5,})(\.[^.]+)$/);
    if (fp && m) name = `${m[1]}_${fp}${m[3]}`;
    return name;
}

// 文件 metadata 摘要(除 format 外):类型 · 精度 · 裁剪 · 主文件
function fileMetaBits(f) {
    const md = f?.metadata || {};
    const bits = [];
    if (f?.type) bits.push(String(f.type));
    if (md.fp || f?.fp) bits.push(String(md.fp || f.fp));
    if (md.size || f?.size) bits.push(String(md.size || f.size));
    if (f?.primary) bits.push(S.lang === "zh" ? "主文件" : "primary");
    return bits.join(" · ");
}

// 缺失生成参数的三色感叹号(prompt红/lora黄/model绿),纵列在缩略图右上角;节点条与画廊共用。
// item.modelVersionIds 非空 = 资源链路可查(lora/底模信息存在),不显示黄/绿感叹号
function appendMissingMarks(cell, item) {
    item = item || {};
    let meta = item.meta || {};
    meta = unwrapMeta(meta);
    const hasVids = Array.isArray(item.modelVersionIds) && item.modelVersionIds.length > 0;
    const miss = [];
    if (!meta.prompt) miss.push("#e2836b");
    if (!hasVids && !(meta.resources || []).some((r) => (r.type || "lora").toLowerCase() === "lora")) miss.push("#e2b96b");
    if (!hasVids && !(meta["Model hash"] || meta["Model"] || (meta.hashes || {}).model)) miss.push("#8fd4a0");
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
    b.title = (S.lang === "zh"
        ? "缺少生成参数(红:提示词 黄:Lora 绿:底模)· 仅检测常见字段,缺失≠真缺"
        : "Missing (red: prompt, yellow: lora, green: model) · common fields only; missing here ≠ truly missing");
    cell.appendChild(b);
}

// 视频条目中央的半透明播放三角标;节点条与画廊共用
function appendPlayBadge(cell) {
    const p = document.createElement("div");
    p.className = "cs-play";
    cell.appendChild(p);
}

// tag 多选 chips 面板:tag widget 的 value(逗号分隔名称串)是唯一真源,面板仅是交互层。
// combo 当"添加器"(选中即追加并复位),chip 上的 ✕ 逐个移除
// 共享 tag 选择器:chips(已选,✕移除) + 下拉添加器(候选=已入库标签,实时刷新)
// + 自由输入框(名称/数字 ID,回车或逗号追加)。节点与画廊共用。
// opts: { names: 初值数组, candidates: ()=>候选名数组, onChange: (names)=>void, compact: 紧凑模式 }
// ---------- 多选下拉(分级筛选):收起态按钮显示"分级: 全部/R+X",点开为复选层 ----------
// 弹层关闭沿用批5/批6 验证过的模式:window 捕获阶段隔离 + 外部按下即关
// (宿主对 pointerdown preventDefault 会按规范抑制后续 click——弹层内必须 stopPropagation)
function makeMultiSelect(el, opts) {
    let sel = new Set(opts.selected || []);
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    const summary = () => {
        const on = (opts.options || []).filter(([v]) => sel.has(v)).map(([, lb]) => lb);
        if (!on.length) return t("msAll");
        return on.length <= 2 ? on.join("+") : t("msCount", { n: on.length });
    };
    const render = () => {
        el.innerHTML = "";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.style.cssText = "width:100%;min-width:0;display:flex;align-items:center;gap:4px;"
            + "background:var(--comfy-input-bg,#333);color:var(--fg-color,#eee);"
            + "border:1px solid var(--border-color,#444);border-radius:4px;padding:3px;"
            + "font-size:12px;cursor:pointer;box-sizing:border-box;overflow:hidden;text-align:left;";
        btn.innerHTML = `<span style="flex:0 0 auto;opacity:.75;">${esc(opts.label)}:</span>`
            + `<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`
            + `color:${sel.size ? "var(--accent-color,#4a90e2)" : "#999"};">${esc(summary())}</span>`
            + `<span style="flex:0 0 auto;opacity:.7;">▾</span>`;
        btn.title = `${opts.label}: ${summary()}`;
        btn.onclick = (ev) => { ev.stopPropagation(); openPop(btn); };
        el.appendChild(btn);
    };
    const openPop = (btn) => {
        document.querySelectorAll(".cs-mselect-pop").forEach((n) => n.remove());
        closePop();
        pop = document.createElement("div");
        pop.className = "cs-mselect-pop";
        pop.style.cssText = "position:fixed;z-index:60002;min-width:150px;padding:6px;font-size:12px;"
            + "background:var(--comfy-input-bg,var(--bg-color,#2b2b30));color:var(--fg-color,#ddd);"
            + "border:1px solid var(--border-color,#3a3a40);border-radius:8px;"
            + "box-shadow:0 8px 24px rgba(0,0,0,.5);cursor:default;";
        for (const [v, lb] of opts.options || []) {
            const row = document.createElement("label");
            row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 2px;cursor:pointer;white-space:nowrap;";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = sel.has(v);
            cb.onchange = () => {
                if (cb.checked) sel.add(v); else sel.delete(v);
                render();
                if (opts.onChange) opts.onChange([...sel]);
            };
            row.appendChild(cb);
            row.appendChild(document.createTextNode(lb));
            pop.appendChild(row);
        }
        document.body.appendChild(pop);
        const r = pop.getBoundingClientRect(), br = btn.getBoundingClientRect();
        pop.style.left = Math.max(4, Math.min(br.left, window.innerWidth - r.width - 8)) + "px";
        pop.style.top = Math.min(br.bottom + 4, window.innerHeight - r.height - 8) + "px";
        const h = (e2) => {
            if (pop && pop.contains(e2.target)) { e2.stopPropagation(); return; }
            closePop();
            window.removeEventListener("pointerdown", h, true);
        };
        window.addEventListener("pointerdown", h, true);
    };
    render();
    return { set(names) { sel = new Set(names || []); render(); }, get: () => [...sel] };
}

function createTagPicker(el, opts) {
    const state = { names: (opts.names || []).slice() };
    const addName = (raw) => {
        for (let part of String(raw).split(/[,，]/).map((s) => s.trim()).filter(Boolean)) {
            // 纯数字 ID 且映射里有名称 → 归一为名称显示;未知 ID 保留数字(查询直接用)
            if (/^\d+$/.test(part) && S.tagMap) {
                const hit = Object.entries(S.tagMap).find(([, id]) => String(id) === part);
                if (hit) part = hit[0];
            }
            if (part && !state.names.includes(part)) state.names.push(part);
        }
        sync();
    };
    const sync = () => { rerender(); if (opts.onChange) opts.onChange(state.names.slice()); };
    const rerender = () => {
        el.innerHTML = "";
        const chips = document.createElement("div");
        chips.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center;width:100%;";
        if (!state.names.length) {
            chips.innerHTML = `<span style="color:#777;font-size:11px;">${esc(opts.emptyHint || t("noTagsSel"))}</span>`;
        }
        for (const name of state.names) {
            const chip = document.createElement("span");
            chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;background:rgba(74,144,226,.16);"
                + "border:1px solid var(--accent-color,#4a90e2);border-radius:10px;padding:0 7px;"
                + "font-size:11px;color:var(--fg-color,#eee);white-space:nowrap;";
            const pre = opts.prefix !== undefined ? opts.prefix : "#";
            chip.innerHTML = `<span>${esc(pre)}${esc(name)}</span>`;
            const x = document.createElement("span");
            x.textContent = "✕";
            x.style.cssText = "cursor:pointer;opacity:.6;";
            x.title = S.lang === "zh" ? "移除" : "Remove";
            x.onclick = () => { const i = state.names.indexOf(name); if (i >= 0) state.names.splice(i, 1); sync(); };
            chip.appendChild(x);
            chips.appendChild(chip);
        }
        if (state.names.length > 1) {
            const clear = document.createElement("span");
            clear.textContent = t("clearTags");
            clear.style.cssText = "cursor:pointer;font-size:11px;color:var(--accent-color,#4a90e2);";
            clear.onclick = () => { state.names = []; sync(); };
            chips.appendChild(clear);
        }
        el.appendChild(chips);
        // 添加行:下拉(已入库标签);批4 E2E 8b:浏览/画廊四处删除手输框(allowInput=false),
        // 浏览的 AND/OR 选择框经 rowExtra 移入本行占其位;无 rowExtra 时下拉独占整行
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:4px;width:100%;margin-top:4px;";
        const sel = document.createElement("select");
        sel.style.cssText = "flex:1;min-width:0;font-size:11px;padding:2px;";
        const cands = (opts.candidates ? opts.candidates() : Object.keys(S.tagMap || {}))
            .filter((c) => !state.names.includes(c));
        // 占位文案按用途给(批11.4:底模复用本组件时曾显示"添加标签…")
        sel.innerHTML = `<option value="">${esc(opts.addLabel || t("addTagOpt"))}</option>`
            + cands.map((c) => `<option>${esc(c)}</option>`).join("");
        sel.onchange = () => { if (sel.value) { const v = sel.value; sel.value = ""; addName(v); } };
        row.appendChild(sel);
        if (opts.rowExtra) row.appendChild(opts.rowExtra); // 节点移入即脱离原位置,模板里无需再占位
        if (opts.allowInput !== false) {
            const inp = document.createElement("input");
            inp.type = "text";
            inp.placeholder = S.lang === "zh" ? "输入名称/ID,回车添加" : "Name or ID, Enter to add";
            inp.style.cssText = "flex:1;min-width:0;font-size:11px;padding:2px;";
            inp.onkeydown = (e) => {
                if (e.key === "Enter" && inp.value.trim()) { addName(inp.value); inp.value = ""; }
                e.stopPropagation(); // 防触发外层快捷键
            };
            row.appendChild(inp);
        }
        el.appendChild(row);
    };
    rerender();
    return {
        set(names) { state.names = (names || []).slice(); rerender(); },
        names: () => state.names.slice(),
        rerender,
    };
}

// 存活 picker 注册表:标签映射更新后统一重渲染(候选实时刷新)
const csTagPickers = new Set();
function rerenderTagPickers() { for (const p of csTagPickers) p.rerender(); }

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
    // 选为输出的图可能不在本节点搜索结果里(如画廊/模型预览来源):用缓存兜底展示
    if (!sel && node.csInfoCache && String(node.csInfoCache.id ?? "") === wanted) {
        sel = node.csInfoCache;
    }
    if (!sel) {
        if (/^\d+$/.test(wanted)) {
            // 输入/粘贴的 ID 不在结果与缓存里:发起 imageId 精确查询拉取(去重/防抖)
            if (node.csInfoFetching !== wanted) {
                node.csInfoFetching = wanted;
                el.innerHTML = `<span style="color:#888;font-size:11px;">${esc(S.lang === "zh" ? "正在拉取图片 " + wanted + " …" : "Fetching image " + wanted + " …")}</span>`;
                apiGet(`/civitai_studio/images?imageId=${encodeURIComponent(wanted)}&limit=1`)
                    .then((d) => {
                        const it = (d.items || []).find((x) => String(x.id) === wanted);
                        if (it) {
                            node.csInfoCache = it;
                            if (node.csResults && !node.csResults.some((x) => String(x.id) === wanted)) node.csResults.unshift(it);
                            rememberImage(wanted); // 拉取成功才入记忆(404/无权限不保留)
                        } else {
                            node.csInfoCache = { id: wanted, notFound: true };
                        }
                        node.csInfoFetching = null;
                        renderSelInfo(node);
                    })
                    .catch(() => { node.csInfoFetching = null; renderSelInfo(node); });
            } else {
                el.innerHTML = `<span style="color:#888;font-size:11px;">${esc(S.lang === "zh" ? "正在拉取图片 " + wanted + " …" : "Fetching image " + wanted + " …")}</span>`;
            }
        } else {
            el.innerHTML = `<span style="color:#888;font-size:11px;">${esc(t("noSelectionHint"))}</span>`;
        }
        nodeThumbsResize(node); // 面板高度变了,同步节点尺寸防下方 widget 被裁
        return;
    }
    if (sel.notFound) {
        el.innerHTML = `<span style="color:#e2a23f;font-size:11px;">${esc(S.lang === "zh" ? "图片 " + sel.id + " 未找到(已删除/无权限/ID 有误)" : "Image " + sel.id + " not found")}</span>`;
        nodeThumbsResize(node);
        return;
    }
    let meta = sel.meta || {};
    meta = unwrapMeta(meta);
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
    pic.style.cssText = "flex:0 0 64px;height:100px;background:#2e2e33;border-radius:4px;overflow:hidden;cursor:pointer;";
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
        + "display:flex;flex-direction:column;justify-content:space-between;height:100px;";
    lines.appendChild(row("Image ID", sel.id, "#fff", true));
    lines.appendChild(row("Pos", meta.prompt, "#e2836b"));
    lines.appendChild(row("Neg", meta.negativePrompt, "#6ba1e2"));
    lines.appendChild(row("Lora", loras, "#e2b96b"));
    lines.appendChild(row("Base", sel.baseModel, "#8fd4a0"));       // baseModel 基座
    lines.appendChild(row("Ckpt", meta["Model"] || (meta.hashes || {}).model, "#8fd4a0")); // checkpoint
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
        $$("[data-tagid]", tagRow).forEach((el) => {
            const tagObj = tags.find((x) => String(x.id) === el.dataset.tagid);
            const tname = (tagObj && tagObj.name) || `#${el.dataset.tagid}`;
            el.onclick = (ev) => openMiniMenu(ev, [
                { label: t("menuCopy"), cb: () => copyWithToast(tname) },
                { label: t("menuGallerySearch"), cb: () => searchGalleryByTag(tname) },
            ]);
        });
        refreshTagCombos(); // 新标签入库,刷新图像搜索节点的 tag 下拉选项
    }).catch((e) => {
        // 不再静默隐藏:把服务端解读过的原因(缺 API Key/限速/代理超时)直接展示给用户
        if (!tagRow.isConnected) return;
        const msg = String((e && e.message) || e).slice(0, 110);
        tagRow.firstElementChild.textContent = (S.lang === "zh" ? "标签加载失败: " : "Tags failed: ") + msg;
    });
}

// 把本地标签映射刷进所有图像搜索节点的 tag combo 选项((none) 首项 + 名称排序)
function refreshTagCombos() {
    apiGet("/civitai_studio/tag_mapping").then((d) => {
        const names = (d.tags || []).map((t) => t.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        S.tagMap = {};
        (d.tags || []).forEach((t) => { S.tagMap[t.name] = t.id; });
        (app.graph?._nodes || []).forEach((n) => {
            if (n.type !== "CivitaiStudio_ImageSearch") return;
            const tw = (n.widgets || []).find((w) => w.name === "tag");
            if (!tw || !tw.options) return;
            const cur = tw.value;
            tw.options.values = ["(none)"].concat(names);
            if (cur && !tw.options.values.includes(cur)) tw.options.values.unshift(cur);
        });
        rerenderTagPickers(); // 候选更新,所有 picker 重渲染(实时出新标签)
    }).catch(() => { });
}

// 悬浮层大图/播放器(图片与视频通用)
function mediaViewerHtml(item) {
    const src = esc(item.url || "");
    if (isVideoItem(item)) {
        // 高度随宽高比自适应(E2E c:固定 64vh 让横屏视频上下长黑边);
        // aspect-ratio 用接口给到的 width/height 预置,元数据加载前后盒子尺寸不变(防抖动);
        // 依赖接口带 width/height,缺失时退化为浏览器默认尺寸(评审R1 F-4);数值经 Number 收敛防注入
        const vw = Number(item.width), vh = Number(item.height);
        const ar = vw > 0 && vh > 0 ? `aspect-ratio:${vw} / ${vh};` : "";
        const blurV = nsfwBlurStyle(item); // 批4 E2E 20:大图浮层视频也打码
        return `<video src="${esc(imgSrc(item.url || ""))}" controls autoplay loop muted playsinline`
            + (blurV ? ` class="cs-nsfw-blurable" data-nsfw-level="${Number(item.nsfwLevel) || 0}"` : "")
            + ` style="height:auto;width:auto;max-width:100%;max-height:64vh;${ar}${blurV}border-radius:8px;display:block;margin:0 auto;background:#000"></video>`;
    }
    const blur = nsfwBlurStyle(item); // 批4 E2E 20:大图浮层图片打码,悬停临时清晰
    return `<img${blur ? ` class="cs-nsfw-blurable" data-nsfw-level="${Number(item.nsfwLevel) || 0}"` : ""} src="${esc(imgSrc(item.url || ""))}" data-direct="${src}"`
        + ` style="max-width:100%;max-height:64vh;border-radius:8px;display:block;margin:0 auto;${blur}"`
        + ` onerror="this.style.display='none'"/>`;
}

function renderNodeThumbs(node) {
    const strip = node.csStrip;
    if (!strip) return;
    const keepScroll = strip.scrollTop; // 重建后保持滚动位置(加载更多不跳顶)
    const wv = (name) => { const w = (node.widgets || []).find((x) => x.name === name); return w ? w.value : undefined; };
    // thumbs_height 值即目标行高(px):两端对齐行排版按宽高比成行,行内等高铺满整行宽
    const rowH = Math.max(64, parseInt(wv("thumbs_height"), 10) || 256);
    const panelH = Math.max(160, parseInt(wv("panel_h"), 10) || 420);
    strip.style.maxHeight = panelH + "px";
    strip.querySelectorAll(".cs-thumb,.cs-thumb-msg,.cs-thumb-bar,.cs-thumb-more,.cs-thumb-pager")
        .forEach((el) => el.remove());
    const st = node.csFetch || {};
    const idw = (node.widgets || []).find((w) => w.name === "image_id");
    renderSelInfo(node); // 顶部信息面板(独立 widget,随选择刷新)

    // 状态条:提示 + 计数 + spinner(格式筛选生效时显示可见数,审计二 F-5)
    const fmtWant = node.__fmt && node.__fmt !== "all" ? node.__fmt : null;
    // 批E E2E:本地分页 50/页;批4 E2E 19b:缓存不再设 100 上限,[下一页]越过缓存尾部时回源续拉
    const all = (node.csResults || []).filter((it) => !fmtWant || fmtOf(it) === fmtWant);
    const PAGE_N = 50;
    const paged = all.length > PAGE_N || !!(st.next && st.next.length); // 批7 2.1:服务端还有下一页时首页就出翻页栏
    if (paged) {
        const pagesN = Math.ceil(all.length / PAGE_N);
        // 批6 E2E 9:pending 只在缓存确实增长后才消费——fetch 前的那次渲染(spinner)
        // 会先走到这里,旧实现把它清掉导致"点两次才跳"
        if (node.csPendingPage != null && all.length > (node.csPendingFrom || 0)) {
            if (node.csPendingPage < pagesN) node.csPage = node.csPendingPage;
            node.csPendingPage = null; node.csPendingFrom = 0;
        }
        node.csPage = Math.max(0, Math.min(node.csPage || 0, pagesN - 1));
    } else {
        node.csPage = 0;
    }
    const items = paged ? all.slice((node.csPage || 0) * PAGE_N, (node.csPage || 0) * PAGE_N + PAGE_N) : all;
    const bar = document.createElement("div");
    bar.className = "cs-thumb-bar";
    bar.style.cssText = "position:sticky;top:0;z-index:5;background:var(--comfy-menu-bg,#242428);width:100%;display:flex;align-items:center;gap:8px;font-size:11px;color:#999;flex-wrap:wrap;padding:2px 0;"; // 批5 d:吸顶不随内容滚走(评审R2 原折行保留)
    bar.innerHTML = `<span>${esc(S.lang === "zh"
        ? "点击放大/选择 · tag 仅数字 ID · "
        : "Click to enlarge / select · tag = numeric IDs · ")}${items.length}</span>`;
    if (st.loading) {
        const sp = document.createElement("span");
        sp.className = "cs-spin";
        const lt = document.createElement("span");
        lt.textContent = t("statusLoading");
        bar.appendChild(sp);
        bar.appendChild(lt);
    }
    { // 格式筛选 select(E2E e):运行时状态不入工作流序列化
        const fmtSel = document.createElement("select");
        fmtSel.style.cssText = "font-size:11px;background:var(--comfy-input-bg,#333);color:#eee;border:1px solid #555;border-radius:4px;padding:1px 3px;";
        fmtSel.innerHTML = fmtSelHtml(node.__fmt);
        fmtSel.onchange = () => { node.__fmt = fmtSel.value; renderNodeThumbs(node); };
        bar.appendChild(fmtSel);
    }
    { // 刷新按钮(E2E r3-25):改 sort 后显式重拉,清空已加载条目从第一页开始
        const rb = document.createElement("button");
        rb.className = "cs-btn cs-btn-mini";
        rb.style.cssText = "font-size:11px;padding:1px 6px;";
        rb.textContent = "⟳";
        rb.title = S.lang === "zh" ? "重新拉取缩略图" : "Refetch thumbnails";
        rb.onclick = () => { node.csResults = []; if (node.csLastParams) fetchNodeThumbs(node, node.csLastParams, true); else node.csSchedule?.(); };
        bar.appendChild(rb);
    }
    strip.appendChild(bar);

    if (!items.length && !st.loading) {
        const msg = document.createElement("div");
        msg.className = "cs-thumb-msg";
        msg.style.cssText = "width:100%;font-size:11px;color:#999;";
        msg.textContent = node.csMsg || (S.lang === "zh" ? "没有结果" : "No results");
        strip.appendChild(msg);
    }
    // 缩略图行高恒等于 thumbs_height:尺寸绝不随节点宽度/所在行变化(节点宽度只
    // 决定每行放几张,换行交给 flex-wrap)。原两端对齐的动态行高按需求移除
    for (const it of items) {
        const c = { it, ar: it.width && it.height ? it.width / it.height : 0.75 }; // 缺尺寸按 3:4 竖图处理
        const h = rowH;
        const cell = document.createElement("div");
        cell.className = "cs-thumb";
        cell.style.cssText = `position:relative;flex:0 0 ${(c.ar * h).toFixed(1)}px;width:${(c.ar * h).toFixed(1)}px;`
            + `height:${h.toFixed(1)}px;box-sizing:border-box;background:#2e2e33;border:2px solid #555;`
            + "border-radius:4px;overflow:hidden;cursor:pointer;";
        if (isVideoItem(c.it)) {
            // 静音取首帧作缩略图
            const v = document.createElement("video");
            v.classList.add("cs-nsfw-blurable"); // 批7 3:节点条此前完全没有遮罩
            v.dataset.nsfwLevel = nsfwBitsOf(c.it);
            v.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;" + nsfwBlurStyle(c.it);
            v.muted = true;
            v.loop = true;
            v.playsInline = true;
            v.preload = "metadata";
            v.src = imgSrc(cdnVideo(c.it.url || "")) + "#t=0.001"; // 批11:视频缩略走 cdnVideo(320 档)
            cell.appendChild(v);
            appendPlayBadge(cell);
        } else {
            const im = document.createElement("img");
            im.classList.add("cs-nsfw-blurable"); // 批7 3:节点条此前完全没有遮罩
            im.dataset.nsfwLevel = nsfwBitsOf(c.it);
            im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;" + nsfwBlurStyle(c.it);
            const thumb = cdnThumb(c.it.url || "");
            im.onerror = () => { if (!im.dataset.retried) { im.dataset.retried = "1"; im.src = altSrc(thumb); } };
            im.src = imgSrc(thumb);
            cell.appendChild(im);
            attachThumbBlob(im, im.src); // blob 命中免 CDN
        }
        if (idw?.value && String(idw.value) === String(c.it.id)) cell.style.borderColor = "#4a90e2";
        appendMissingMarks(cell, c.it);
        // 左上角★收藏快捷键(与画廊同款交互)
        const oid = String(c.it.id ?? "");
        const favBtn = document.createElement("button");
        favBtn.className = "cs-save-btn";
        favBtn.style.cssText = "right:auto;left:4px;" + (S.favs?.has(oid) ? "color:#ffd75e;" : "");
        favBtn.title = t("favBtnTitle");
        favBtn.textContent = "★";
        favBtn.onclick = async (ev) => {
            ev.stopPropagation();
            try {
                const on = await toggleFav("asset", oid, { name: c.it.username || "", cover: c.it.url, extra: { nsfwLevel: nsfwBitsOf(c.it) } });
                favBtn.style.color = on ? "#ffd75e" : "";
                // 批8.2:新增收藏弹收藏夹选择器(与其余★入口同款;此前"与画廊同款交互"名不副实)
                if (on) {
                    const cur = ((S.favData?.items || []).find((x) => x.kind === "asset" && String(x.oid) === oid) || {}).group_ids || [];
                    openGroupPicker(ev, "asset", cur, async (gids) => {
                        try { await apiPost("/civitai_studio/favorites/assign", { kind: "asset", oid, group_ids: gids }); }
                        catch (e2) { toast("error", t("favFailed"), e2.message); }
                    });
                }
            } catch (e) { toast("error", t("favFailed"), e.message); }
        };
        cell.appendChild(favBtn);
        cell.insertAdjacentHTML("afterbegin", fmtBadgeHtml(c.it)); // 格式角标(E2E 7)
        cell.onclick = () => showNodeImageFloat(node, c.it);
        strip.appendChild(cell);
    }
    if (!st.loading && st.next && st.next.length && paged) {
        // 批E E2E:本地缓存分页;首页的[上一页]=[刷新](重拉第一页)
        // 批7 2.1/2.2:翻页控件移入吸顶状态栏(常驻可见);翻页后滚回页首
        {
            const pager = document.createElement("div");
            pager.className = "cs-thumb-pager"; // 批4 E2E 19a:翻页栏纳入重渲染清理,不再遗留叠加
            pager.style.cssText = "margin-left:auto;display:flex;gap:6px;align-items:center;";
            const pages = Math.ceil(all.length / PAGE_N);
            const mkBtn = (label, cb, disabled) => {
                const b = document.createElement("button");
                b.className = "cs-btn cs-btn-mini";
                b.style.cssText = "flex:1;" + (disabled ? "opacity:.4;pointer-events:none;" : "");
                b.textContent = label;
                b.onclick = cb;
                return b;
            };
            const refresh = () => { node.csPage = 0; node.csResults = []; if (node.csLastParams) fetchNodeThumbs(node, node.csLastParams, true); else node.csSchedule?.(); };
            pager.appendChild(mkBtn((node.csPage || 0) === 0 ? t("nodeRefresh") : t("nodePrev"),
                () => { if ((node.csPage || 0) === 0) refresh(); else { node.csPage -= 1; renderNodeThumbs(node); strip.scrollTop = 0; } }));
            const idx = document.createElement("span");
            idx.style.cssText = "flex:0 0 auto;font-size:10px;color:#888;";
            idx.textContent = `${(node.csPage || 0) + 1}/${pages}`;
            pager.appendChild(idx);
            pager.appendChild(mkBtn(t("nodeNext"), () => {
                node.csPage = (node.csPage || 0) + 1;
                node.csPendingPage = node.csPage; node.csPendingFrom = all.length; // 批6:记录点击时缓存长度
                // 批4 E2E 19b:越过缓存尾部 → 回源续拉下一批(完成后重渲染,越界页码由头部钳制收敛)
                if ((node.csPage || 0) * PAGE_N >= all.length) node.csLoadMore?.();
                else renderNodeThumbs(node);
                strip.scrollTop = 0; // 批7 2.2:翻页回页首
            }, (node.csPage || 0) >= pages - 1 && !(st.next && st.next.length)));
            bar.appendChild(pager); // 批7:进吸顶栏(原在条目尾部,翻页回顶后不可见)
        }
    }
    strip.scrollTop = keepScroll;
    nodeThumbsResize(node);
}

// 节点缩略图点击 → 统一大图详情浮层(与画廊共用;选为输出默认写入本节点)
function showNodeImageFloat(node, item) {
    openImageDetail(item, { node });
}


// AND 实验模式:多标签漏斗式求交——每个标签独立分页游标,各拉一页后取交集;
// 交集以第一个标签的排序为基准;所有游标耗尽即无更多。"加载更多"推进全部游标
async function fetchNodeThumbsAnd(node, tagIds, reset) {
    const st = node.csFetch || (node.csFetch = { next: [], loading: false });
    if (st.loading) return; // 在途:忽略(下一轮筛选会重置)
    if (reset || !st.and || !st.and.length) {
        const base = new URLSearchParams(node.csLastParams || "");
        base.delete("tags");
        st.and = tagIds.map((id) => {
            const p = new URLSearchParams(base);
            p.set("tags", id);
            return { p: p.toString(), next: null, done: false, items: [] };
        });
        node.csResults = [];
    }
    st.loading = true;
    renderNodeThumbs(node);
    try {
        await Promise.all(st.and.map(async (c) => {
            if (c.done) return;
            const p = new URLSearchParams(c.p);
            if (c.next) for (const [k, v] of c.next) p.append(k, v);
            const d = await api.fetchApi(`/civitai_studio/images?${p.toString()}`, { cache: "no-store" })
                .then((r2) => r2.json());
            c.items = c.items.concat(d.items || []);
            c.next = d.next_query || [];
            c.done = !(c.next || []).length;
        }));
    } catch (e) {
        st.loading = false;
        node.csMsg = S.lang === "zh" ? "标签查询失败" : "Tag query failed";
        renderNodeThumbs(node);
        return;
    }
    // 交集:以第一个标签的顺序为基准,要求同时存在于其余每个标签的结果中
    const rest = st.and.slice(1).map((c) => new Set(c.items.map((x) => String(x.id))));
    const seen = new Set();
    node.csResults = st.and[0].items.filter((x) => {
        const id = String(x.id);
        if (seen.has(id)) return false;
        seen.add(id);
        return rest.every((s) => s.has(id));
    });
    st.loading = false;
    st.next = st.and.every((c) => c.done) ? [] : [["__and__", "1"]];
    renderNodeThumbs(node);
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
    setup() {
        // 保存/草稿序列化清洗:新前端 serialize 按 widgets 数组索引写值,serialize=false
        // 的 DOM 面板(cs_info 占 widgets[0]、cs_tags 在中部)会留下 null 占位 → 加载端
        // 按可序列化顺序消费导致值整体后移。挂在 LGraph 原型上(全实例生效,不怕
        // loadGraphData 替换 graph 实例),写出前剔除全部 null 占位,保持干净的 10 值
        const LG = LiteGraph.LGraph || (LiteGraph.classes && LiteGraph.classes.LGraph);
        if (LG && !LG.prototype.__csSerClean) {
            LG.prototype.__csSerClean = true;
            const origSer = LG.prototype.serialize;
            LG.prototype.serialize = function () {
                const data = origSer.apply(this, arguments);
                for (const nd of data.nodes || []) {
                    if (nd.type === "CivitaiStudio_ImageSearch" && Array.isArray(nd.widgets_values)) {
                        nd.widgets_values = nd.widgets_values.filter((v) => v !== null);
                    }
                }
                return data;
            };
        }
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        const type = nodeData.name;

        // 图片搜索节点:DOM widget 缩略图条,点击放大/选择
        if (type === "CivitaiStudio_ImageSearch") {
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
                // 缩略图面板移到 widgets 末尾:渲染在所有筛选器之下(panel_h 参数之上)
                {
                    const ti = node.widgets.indexOf(thumbsW);
                    if (ti >= 0) node.widgets.splice(ti, 1);
                    node.widgets.push(thumbsW);
                }
                if (this.size[0] < 460) this.size[0] = 460; // 保证默认 3 列以上
                // 新节点默认 256px(COMBO 首选项是 128px;加载旧工作流时 configure 会以存档值覆盖)
                {
                    const thW0 = widget("thumbs_height");
                    if (thW0 && thW0.value === "128px") thW0.value = "256px";
                }
                // 信息面板独立 widget,移到 widgets 首位:渲染在标题/输出端正下方
                const infoEl = document.createElement("div");
                infoEl.style.cssText = "width:100%;display:flex;flex-direction:column;gap:6px;"
                    + "background:rgba(255,255,255,.04);border:1px solid #3a3a40;border-radius:6px;padding:6px;";
                // image_id 自由输入行(面板顶部):粘贴任意 ID 回车/失焦即加载;补全弹层
                // 与底模共用 attachComboComplete(候选=最近成功记忆 cs_recent_image_ids,
                // rememberImage 拉取成功才写入,404 不保留),不用 datalist 私样式
                const idRow = document.createElement("div");
                idRow.style.cssText = "display:flex;gap:4px;align-items:center;width:100%;";
                const idInput = document.createElement("input");
                idInput.type = "text";
                idInput.placeholder = S.lang === "zh" ? "输入/粘贴图片 ID,回车加载" : "Image ID, Enter to load";
                idInput.style.cssText = "flex:1;min-width:0;font-size:11px;padding:3px 6px;";
                idRow.appendChild(idInput);
                infoEl.appendChild(idRow);
                const idCommit = (val) => {
                    val = String(val || "").trim();
                    const idw2 = widget("image_id");
                    if (!idw2 || !val || val === String(idw2.value)) return;
                    idw2.value = val;
                    if (idw2.inputEl) idw2.inputEl.value = val; // 不同步 inputEl 会被重绘反向清空
                    node.csLastId = ""; // poll 兜底会刷;这里直接刷一次,反馈即时
                    renderSelInfo(node);
                };
                node.csSubPicker = attachComboComplete(idInput,
                    () => { try { return JSON.parse(localStorage.getItem("cs_recent_image_ids") || "[]"); } catch (e) { return []; } },
                    idCommit);
                idInput.onblur = () => idCommit(idInput.value);
                const infoBody = document.createElement("div");
                infoBody.style.cssText = "display:flex;gap:8px;align-items:flex-start;width:100%;";
                infoEl.appendChild(infoBody);
                node.csInfo = infoBody;
                const infoW2 = this.addDOMWidget("cs_info", "cs_info", infoEl);
                infoW2.serialize = false;
                const infoW = node.widgets.find((w2) => w2.name === "cs_info");
                if (infoW) {
                    node.widgets.splice(node.widgets.indexOf(infoW), 1);
                    node.widgets.unshift(infoW);
                }
                // tag 多选:chips + 下拉添加器 + 自由输入(createTagPicker 共享组件);
                // 已选集合存于 tags_selected(隐藏 STRING widget);tag combo 行隐藏(保留序列化兼容)
                const tagW = widget("tag"); // 旧工作流遗留 widget 可能存在;新版服务端已删除
                const limW = widget("limit");
                if (limW) limW.value = 50; // 批E:钉值 50(旧工作流载入也收敛)
                const tsW = widget("tags_selected");
                if (tsW) {
                    const chipsEl = document.createElement("div");
                    chipsEl.style.cssText = "display:flex;flex-wrap:wrap;flex-direction:column;gap:4px;align-items:flex-start;width:100%;";
                    const picker = createTagPicker(chipsEl, {
                        names: String(tsW.value || "").split(",").map((s) => s.trim()).filter(Boolean),
                        candidates: () => Object.keys(S.tagMap || {}),
                        onChange: (names) => {
                            const str = names.join(",");
                            tsW.value = str;
                            if (tsW.inputEl) tsW.inputEl.value = str; // 不同步 inputEl 会被前端重绘反向清空
                            node.csSig = "";
                            debounced();
                        },
                    });
                    csTagPickers.add(picker);
                    node.csTagPicker = picker;
                    node.csTags = chipsEl;
                    const tagsDomW = this.addDOMWidget("cs_tags", "cs_tags", chipsEl);
                    tagsDomW.serialize = false;
                    const ci = node.widgets.indexOf(tagsDomW);
                    if (ci >= 0) node.widgets.splice(ci, 1);
                    // 紧贴缩略图面板(thumbsW 之前):chips 是预览的过滤器,故放 panel_h 之后、"点击放大/选择"之上
                    const anchor = node.widgets.indexOf(thumbsW);
                    node.widgets.splice(anchor >= 0 ? anchor : node.widgets.length, 0, tagsDomW);
                }

                const sig = () => ["base_model", "tags_selected", "sort", "period", "nsfw", "limit"]
                    .map((n) => widget(n)?.value ?? "").join("|");
                node.csSchedule = () => {
                    const s2 = sig();
                    if (s2 === node.csSig) return;
                    node.csSig = s2;
                    // 批E:limit 硬限 50,不再是可调节项(widget 隐藏且钉值)
                    const p = new URLSearchParams({ limit: "50", nsfw: widget("nsfw")?.value || "false" });
                    const bm = widget("base_model")?.value;
                    if (bm && bm !== "(any)") p.set("baseModels", bm);
                    // 多选标签(node.csTagSel,逗号串存于 tag widget):名称经本地映射换 ID。
                    // 默认 OR(单请求任一命中);设置开 AND 实验后 ≥2 个标签走漏斗式逐标签求交
                    const sel = String(widget("tags_selected")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
                    // 映射未就绪(页面刚加载,tagMap 异步填充):拉取映射并保留 csSig,下轮轮询重试
                    if (sel.length && !(S.tagMap && Object.keys(S.tagMap).length)) {
                        refreshTagCombos();
                        return;
                    }
                    const ids = sel.map((s) => (/^\d+$/.test(s) ? s : (S.tagMap && S.tagMap[s]) || null)).filter(Boolean);
                    const andOn = !!S.cfg.tag_and_mode && ids.length > 1;
                    if (ids.length && !andOn) p.set("tags", ids.join(","));
                    p.set("sort", widget("sort")?.value || "Newest");
                    p.set("period", widget("period")?.value || "AllTime");
                    node.csLastParams = p.toString();
                    node.csAnd = andOn ? ids : null;
                    if (andOn) fetchNodeThumbsAnd(node, ids, true);
                    else fetchNodeThumbs(node, p.toString(), true);
                };
                node.csLoadMore = () => {
                    if (node.csAnd) { fetchNodeThumbsAnd(node, node.csAnd, false); return; }
                    if (node.csLastParams) fetchNodeThumbs(node, node.csLastParams, false);
                };
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
                    // tag 多选恢复:configure 填值后同步 picker(chips 随之重渲染)
                    if (!node.__csTagInit) {
                        node.__csTagInit = true;
                        const tsW = widget("tags_selected");
                        const tv = String(tsW?.value || "").trim();
                        const names = tv ? tv.split(",").map((s) => s.trim()).filter(Boolean) : [];
                        node.csTagPicker?.set(names);
                        if (tsW && tsW.inputEl) tsW.inputEl.value = tv; // inputEl 与值对齐,防重绘反向清空
                        if (names.length) { node.csSig = ""; node.csSchedule?.(); }
                    }
                    // image_id 手动粘贴/修改也要刷新信息面板(文本输入不触发事件)
                    const cur = widget("image_id")?.value || "";
                    if (cur !== node.csLastId) { node.csLastId = cur; renderSelInfo(node); }
                    // image_id 行不渲染(值由信息面板输入行/[选为输出]维护):画布与右侧
                    // 参数面板都扫(行元素渲染后才存在,dataset 标记防重复设置)
                    for (const rowEl of document.querySelectorAll(".lg-node-widget")) {
                        if (rowEl.dataset.csRowHide) continue;
                        if ((rowEl.textContent || "").trim().startsWith("image_id")) {
                            rowEl.style.display = "none";
                            rowEl.dataset.csRowHide = "1";
                        }
                        // tags_selected 是隐藏存储 widget(值由 chips 条交互维护),不占版面
                        if (rowEl.dataset.csTsHide === undefined && (rowEl.textContent || "").trim().startsWith("tags_selected")) {
                            rowEl.style.display = "none";
                            rowEl.dataset.csTsHide = "1";
                        }
                        // tag combo 行同样隐藏:交互职责由 picker(下拉+输入)接管
                        if (rowEl.dataset.csTagHide === undefined && (rowEl.textContent || "").trim() === "tag") {
                            rowEl.style.display = "none";
                            rowEl.dataset.csTagHide = "1";
                        }
                        // 批E E2E:limit 不再显示、不再可调(固定 50;widget 保留序列化兼容旧工作流)
                        if (rowEl.dataset.csLimitHide === undefined && (rowEl.textContent || "").trim().startsWith("limit")) {
                            rowEl.style.display = "none";
                            rowEl.dataset.csLimitHide = "1";
                        }
                    }
                    // 面板布局参数或节点宽度变化 → 只重排版不重新拉取
                    const ss = node.size[0] + "|" + String(widget("thumbs_height")?.value || "256") + "|" + String(widget("panel_h")?.value || "");
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
                    node.csSubPicker?.destroy?.(); // 补全弹层 + window scroll 监听一并清理
                    origOnRemoved?.apply(this, arguments);
                };
                return r;
            };
            // 旧版工作流兼容:widgets_values 还是旧顺序([base_model,…,image_id,(lora_name),thumbs,panel])
            // 时重排为新顺序([image_id,base_model,…,index,thumbs,panel]),防止值错位。
            // 挂在 prototype 上只包一次(不能放 onNodeCreated,否则每建一个实例嵌套一层)
            // 新前端在填充 widget 时按"可序列化 widget 顺序"消费 widgets_values,而
            // serialize 按 widgets 数组索引写值且跳过 serialize=false 的 DOM 面板(cs_info
            // 占 widgets[0]) → 保存的值首位多一个 null 占位,加载后全体后移一位。
            // 唯一修正点:configure 返回后剔除占位/旧序重排,按序直接给 widget 赋值
            // (设 __csValFixed 防止 poll 自愈二次修正)
            const origNodeConfigure = nodeType.prototype.configure;
            nodeType.prototype.configure = function (info) {
                const r = origNodeConfigure?.apply(this, arguments);
                try {
                    const v0 = info?.widgets_values;
                    if (!Array.isArray(v0)) return r;
                    // 名字驱动赋值:不依赖 widgets 数组顺序/serialize 属性
                    // (configure 可能重建 widget 对象,丢失 DOM 面板的 serialize=false 标记)
                    let v = v0.filter((x) => x !== null); // 剔除 DOM 面板的 null 占位
                    const isNumOrIdx = (x) => /^\d+$/.test(String(x)) || String(x) === "(index)";
                    const have = new Set((this.widgets || []).map((x) => x.name));
                    const order = ["image_id", "base_model", "nsfw", "tag", "tags_selected", "period", "sort", "limit", "index", "thumbs_height", "panel_h"]
                        .filter((n) => have.has(n));
                    const expected = order.length;
                    const startsWithImageId = isNumOrIdx(v[0]);
                    // 锚定:period 词表(AllTime/Month/Week/Day)在值串中的位置。
                    // 新序 period 槽位 = order.indexOf("period");偏移 1 位 = 增删过 tag/tags_selected 槽
                    const PERIODS = new Set(["AllTime", "Month", "Week", "Day"]);
                    const pIdx = v.map((x, i) => (PERIODS.has(String(x)) ? i : -1)).filter((i) => i >= 0);
                    const expP = order.indexOf("period");
                    if (!startsWithImageId) {
                        // 老序(首位 base_model):period 在第 3 位
                        if (v.length === 11 && pIdx[0] === 3) {
                            // 含 lora_name:[base,nsfw,tag,period,sort,limit,index,lora,thumbs,panel]
                            v = [v[7], v[0], v[1], v[2], v[3], v[4], v[5], v[6], "", v[8], v[9]];
                        } else if (v.length === 10 && pIdx[0] === 3) {
                            // 上一代 10 值(无 lora_name):[base,nsfw,tag,period,sort,limit,index,thumbs,panel]
                            if (have.has("tag")) v = [v[7], v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[8], v[9]];
                            else v = [v[7], v[0], v[1], "", v[2], v[3], v[4], v[5], v[6], v[7], v[8]];
                        } else return r; // 未知老序不动
                    } else if (!(v.length === expected && pIdx[0] === expP)) {
                        // image_id 在首位但 period 槽位偏移:增删过 tag 槽
                        if (v.length === expected - 1 && pIdx[0] === expP - 1) {
                            // 旧串带 tag 槽、widgets 无 tag:在 tags_selected 位置补空槽
                            const tsI = order.indexOf("tags_selected");
                            v = v.slice(0, tsI).concat([""], v.slice(tsI));
                        } else if (v.length === expected + 1 && pIdx[0] === expP + 1) {
                            // 新串但 widgets 有 tag(服务端未重启):丢弃 tag 槽值
                            v = v.slice(0, 3).concat(v.slice(4));
                        } else return r; // 未知结构不动
                    }
                    // 重排后的 v 是"全序(含 tag 槽)"语义;order 已按实际存在 widget 过滤,
                    // 赋值时对缺失名跳过 v 槽位(占位丢弃),保证名字↔值一一对应
                    let vi = 0;
                    for (const name of order) {
                        const w = (this.widgets || []).find((x) => x.name === name);
                        let val = vi < v.length ? v[vi] : undefined;
                        vi++;
                        if (!w) continue; // 缺失槽位(如已删的 tag)直接丢弃其值
                        if (val === undefined) break;
                        if (name === "thumbs_height" && /^(small|medium|large)$/.test(String(val))) {
                            val = { small: "128px", medium: "256px", large: "512px" }[String(val)]; // 旧 thumbs_size 语义值迁移
                        }
                        w.value = val;
                        if (w.inputEl) w.inputEl.value = val; // text widget 不同步 inputEl 会被重绘反向清空
                    }
                    this.__csValFixed = true;
                } catch (e) { /* 非常规工作流不动 */ }
                return r;
            };
        }

        // 显示文本节点:执行完成后把收到的字符串渲染在节点内
        if (type === "CivitaiStudio_ShowText") {
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
        if (type === "CivitaiStudio_LoraRecipe") {
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
                        .catch(() => { });
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
            S.cfg.nsfwBlurBits = S.cfg.nsfw_blur || S.cfg.nsfwBlurBits || [4, 8, 16]; // 批F:遮罩分级位
            S.browse.nsfw = Number(S.cfg.nsfw ?? 1); // 恢复持久化的 NSFW 偏好
        } catch (e) {
            console.warn("[Civitai-Studio] 读取配置失败:", e);
        }
        refreshTagCombos(); // 批5 E2E 10:开面板前预载 tag 映射,首开筛选下拉即刻有候选
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
                console.log("[Civitai-Studio] panel open: dirty=" + S.browse.dirty + " items=" + S.browse.items.length);
                if (S.browse.dirty || !S.browse.items.length) {
                    fetchBrowse(true); // 批4 E2E B3:强刷后首开 dirty=false 且无数据 → 空面板,兜底重拉
                    // 批5 E2E 10:防首开竞态——2s 后仍空且无错再补一发
                    setTimeout(() => {
                        if (!S.browse.items.length && !S.browse.loading && !S.browse.error) {
                            console.log("[Civitai-Studio] first-open recheck refetch");
                            fetchBrowse(true);
                        }
                    }, 2000);
                } else {
                    renderResults(true);
                }
                refreshTagCombos(); // 批4 E2E B3:首开 tagMap 未就绪导致筛选下拉空,拉取后重渲染全部 picker
                pollDownloads();
            },
        });
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollDownloads, 2000);
        // 点击画布/页面其他区域时关闭悬浮元素(单实例规则:点空白即全关)
        document.addEventListener("pointerdown", (e) => {
            // 批4:body 级弹层(mini 菜单/收藏夹选择器)不算"点空白",否则点菜单项直接全关模型页
            if (e.target.closest(".cs-float") || e.target.closest(".cs-root") || e.target.closest(".cs-modal")
                || e.target.closest(".cs-mini-menu") || e.target.closest(".cs-group-picker")) return;
            closeAllFloats();
        }, true);
        console.log("[Civitai-Studio] " + t("readyLog"));
    },
});
