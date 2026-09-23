import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// ============================================================
// Civitai Studio — Civitai 浏览器 + 本地模型管理器
// 侧边栏三个页签: 在线浏览 / 本地库 / 下载队列; ⚙ 打开设置
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
    "SD 3.5 Large", "SD 3.5 Large Turbo", "Pony", "Illustrious", "NoobAI",
    "Flux.1 S", "Flux.1 D", "Flux.1 Krea", "Flux.1 Kontext", "Flux.1 Fill", "Chroma",
    "HiDream", "Lumina", "Qwen", "Kolors", "AuraFlow", "PixArt Σ", "Hunyuan 1",
    "Hunyuan Video", "LTXV", "Mochi", "CogVideoX", "SVD",
    "Wan Video 1.3B t2v", "Wan Video 14B t2v", "Wan Video 14B i2v 480p", "Wan Video 14B i2v 720p",
    "Wan Video 2.2 TI2V-5B", "Wan Video 2.2 I2V-A14B", "Wan Video 2.2 T2V-A14B",
    "Wan Video 2.5 T2V", "Wan Video 2.5 I2V", "Other",
];
const SORTS = ["Most Downloaded", "Highest Rated", "Newest"];
const SORT_LABELS = { "Most Downloaded": "最多下载", "Highest Rated": "最高评分", Newest: "最新发布" };
const PERIODS = ["AllTime", "Month", "Week", "Day"];
const PERIOD_LABELS = { AllTime: "全部时间", Month: "本月", Week: "本周", Day: "今天" };
const NSFW_LEVELS = [
    { v: 0, label: "隐藏 NSFW" },
    { v: 1, label: "包含部分 NSFW" },
    { v: 2, label: "包含全部 NSFW" },
];

const S = {
    cfg: { proxy_images: false, nsfw: 1, verify_hash: true },
    browse: {
        query: "", type: "", base: "", sort: "Most Downloaded", period: "AllTime",
        nsfw: 1, page: 1, items: [], loading: false, dirty: true, pendingReset: false,
    },
    local: { models: [], search: "", type: "", loading: false, updates: {}, truncated: false },
    dl: { jobs: [], lastSig: "", failStreak: 0 },
    ui: { tab: "browse", root: null, scrollTop: 0, detailId: null },
};

// ---------- 小工具 ----------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function sanitizeHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = String(html || "");
    $$("script,style,iframe,object,embed,link,meta,form,base,svg,math", div).forEach((n) => n.remove());
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
    let base = (S.cfg.mirror || "https://civitai.red").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) base = "https://" + base; // 裸域名兜底,防相对链接
    return base;
}

function imgSrc(url) {
    if (!url) return "";
    if (S.cfg.proxy_images) return "/civitai_studio/image?url=" + encodeURIComponent(url);
    return url;
}

function toast(sev, summary, detail) {
    try {
        app.extensionManager.toast.add({ severity: sev, summary, detail, life: 4000 });
    } catch (e) {
        console.log(`[Civitai-Studio][${sev}] ${summary} ${detail || ""}`);
    }
}

async function apiJson(url, opts) {
    const resp = await api.fetchApi(url, opts);
    let data = null;
    try { data = await resp.json(); } catch (e) { /* empty body */ }
    if (!resp.ok) throw new Error((data && data.error) || `HTTP ${resp.status}`);
    return data;
}

const apiGet = (url) => apiJson(url);
const apiPost = (url, body) => apiJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
});

function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        if (!btn) return;
        const old = btn.textContent;
        btn.textContent = "已复制";
        setTimeout(() => { btn.textContent = old; }, 1200);
    }).catch(() => {});
}

// ---------- 通用模态框 ----------
function showModal(innerHTML, cls) {
    const overlay = document.createElement("div");
    overlay.className = "cs-modal " + (cls || "");
    overlay.innerHTML = `<div class="cs-modal-box">${innerHTML}</div>`;
    document.body.appendChild(overlay);
    // 只有按下和松开都发生在遮罩上才关闭,避免框内选中文本拖出窗外时误关
    let pressedOnOverlay = false;
    const escHandler = (e) => { if (e.key === "Escape") close(); };
    const close = () => {
        document.removeEventListener("keydown", escHandler);
        overlay.remove();
    };
    overlay.addEventListener("mousedown", (e) => { pressedOnOverlay = e.target === overlay; });
    overlay.addEventListener("click", (e) => { if (e.target === overlay && pressedOnOverlay) close(); });
    document.addEventListener("keydown", escHandler);
    return { overlay, box: $(".cs-modal-box", overlay), close };
}

function confirmModal(title, message, onOk) {
    const m = showModal(`
        <h3 class="cs-modal-title">${esc(title)}</h3>
        <p class="cs-modal-msg">${esc(message)}</p>
        <div class="cs-modal-actions">
            <button class="cs-btn" data-act="cancel">取消</button>
            <button class="cs-btn cs-btn-danger" data-act="ok">确定</button>
        </div>`);
    $("[data-act=cancel]", m.box).onclick = m.close;
    $("[data-act=ok]", m.box).onclick = () => { m.close(); onOk(); };
}

// ---------- 在线浏览:数据加载 ----------
// 翻页用 cursor(镜像站/官方站统一支持;page 参数在部分镜像上会触发忽略筛选的热榜路径)
function browseParams(cursor) {
    const p = new URLSearchParams();
    if (S.browse.query) p.set("query", S.browse.query);
    if (S.browse.type) p.set("types", S.browse.type);
    if (S.browse.base) p.set("baseModels", S.browse.base);
    p.set("sort", S.browse.sort);
    p.set("period", S.browse.period);
    p.set("nsfw", String(S.browse.nsfw));
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
        st.items = reset ? (data.items || []) : st.items.concat(data.items || []);
        st.nextCursor = data.metadata?.nextCursor || "";
        st.dirty = false;
        st.error = "";
    } catch (e) {
        st.error = "加载失败: " + e.message;
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
        err.innerHTML = `${esc(S.browse.error)} <button class="cs-btn cs-btn-mini" id="cs-retry-btn">重试</button>`;
        grid.appendChild(err);
        $("#cs-retry-btn", err).onclick = () => triggerBrowseRefresh();
    } else if (!S.browse.items.length && !S.browse.loading) {
        const empty = document.createElement("div");
        empty.className = "cs-empty";
        empty.textContent = "没有找到模型,换个关键词试试。";
        grid.appendChild(empty);
    }
}

function updateStatusLine() {
    const el = $("#cs-status");
    if (!el) return;
    if (S.ui.detailId) { el.textContent = ""; return; }
    const st = S.browse;
    if (st.loading) {
        el.textContent = "加载中…";
    } else if (st.items.length) {
        el.textContent = `已加载 ${st.items.length} 个` + (st.nextCursor ? " — 向下滚动加载更多" : "");
    } else {
        el.textContent = "";
    }
}

function makeCard(model) {
    const version = model.modelVersions?.[0];
    if (!version) return null;
    const card = document.createElement("div");
    card.className = "cs-card" + (model.installed ? " cs-card-installed" : "");
    const cover = version.images?.find((i) => i.url);
    const creator = model.creator?.username || "未知作者";
    const rating = version.stats && typeof version.stats.thumbsUpCount === "number" ? version.stats.thumbsUpCount : (model.stats?.thumbsUpCount || 0);
    card.innerHTML = `
        <div class="cs-card-cover">
            <div class="cs-card-placeholder">🖼</div>
            <div class="cs-card-badges">
                ${model.installed ? '<span class="cs-badge cs-badge-ok">已安装</span>' : ""}
                <span class="cs-badge">${esc(TYPE_LABELS[model.type] || model.type)}</span>
            </div>
        </div>
        <div class="cs-card-info">
            <div class="cs-card-name" title="${esc(model.name)}">${esc(model.name)}</div>
            <div class="cs-card-sub">
                <span>${esc(version.baseModel || "")}</span>
                <span>👍 ${fmtNum(rating)} · ⬇ ${fmtNum(model.stats?.downloadCount)}</span>
            </div>
            <div class="cs-card-creator">by ${esc(creator)}</div>
        </div>`;
    if (cover?.url) {
        const img = document.createElement("img");
        img.className = "cs-card-img";
        img.loading = "lazy";
        img.alt = model.name;
        img.dataset.direct = cover.url;
        // 注意:不能用 display:none 等加载完再显示——display:none 的元素不进入视口交集,
        // lazy 加载永不触发,形成死锁。用 opacity 过渡显示。
        img.onload = () => { $(".cs-card-placeholder", card).style.display = "none"; img.classList.add("is-loaded"); };
        img.onerror = () => img.remove();
        img.src = imgSrc(cover.url);
        $(".cs-card-cover", card).prepend(img);
    }
    card.onclick = () => openDetail(model.id);
    return card;
}

// ---------- 详情页 ----------
async function openDetail(modelId) {
    const listView = $("#cs-list-view");
    const detailView = $("#cs-detail-view");
    if (!detailView) return;
    S.ui.detailId = String(modelId); // 先置,状态行立刻让位
    updateStatusLine();
    listView.style.display = "none";
    detailView.style.display = "block";
    detailView.innerHTML = '<div class="cs-empty">加载详情中…</div>';
    try {
        const model = await apiGet(`/civitai_studio/model/${encodeURIComponent(String(modelId))}`);
        S.browse.detail = model;
        S.ui.detailId = String(model.id);
        renderDetail(model);
    } catch (e) {
        S.ui.detailId = null;
        updateStatusLine();
        detailView.innerHTML = `<div class="cs-empty">详情加载失败: ${esc(e.message)}</div>
            <div style="text-align:center"><button class="cs-btn" id="cs-detail-err-back">返回列表</button></div>`;
        $("#cs-detail-err-back", detailView).onclick = backToList;
    }
}

function backToList() {
    S.browse.detail = null;
    S.ui.detailId = null;
    $("#cs-detail-view").style.display = "none";
    $("#cs-list-view").style.display = "block";
    updateStatusLine();
}

function renderDetail(model) {
    const detailView = $("#cs-detail-view");
    if (!detailView) return;
    const versions = (model.modelVersions || []).filter((v) => v.id);
    const desc = sanitizeHtml(model.description);
    detailView.innerHTML = `
        <div class="cs-detail-head">
            <button class="cs-btn" id="cs-detail-back">← 返回</button>
            <a class="cs-btn" href="${esc(civitaiPage())}/models/${esc(String(model.id))}" target="_blank" rel="noopener noreferrer">在 Civitai 打开 ↗</a>
        </div>
        <h3 class="cs-detail-title" title="${esc(model.name)}">${esc(model.name)}</h3>
        <div class="cs-detail-meta">
            by ${esc(model.creator?.username || "未知")} · ${esc(TYPE_LABELS[model.type] || model.type)}
            · ⬇ ${fmtNum(model.stats?.downloadCount)} · 👍 ${fmtNum(model.stats?.thumbsUpCount)}
        </div>
        ${model.tags?.length ? `<div class="cs-tags">${model.tags.slice(0, 10).map((t) => `<span class="cs-tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="cs-detail-row">
            <label>版本</label>
            <select id="cs-version-sel">${versions.map((v, i) =>
                `<option value="${esc(String(v.id))}" data-idx="${i}">${esc(v.name)} (${esc(v.baseModel || "?")})${v.local ? " ✔已装" : ""}</option>`).join("")}
            </select>
        </div>
        <div id="cs-version-body"></div>
        ${desc ? `<details class="cs-desc"><summary>模型说明</summary><div class="cs-desc-body">${desc}</div></details>` : ""}
    `;
    $("#cs-detail-back", detailView).onclick = backToList;
    rewriteDescImages(detailView);
    const sel = $("#cs-version-sel", detailView);
    const renderVer = () => {
        const idx = parseInt(sel.selectedOptions[0]?.dataset.idx || "0", 10);
        renderVersion(versions[idx] || versions[0], model);
    };
    sel.onchange = renderVer;
    renderVer();
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

function renderVersion(version, model) {
    const body = $("#cs-version-body");
    if (!body || !version) return;
    const triggers = version.trainedWords || [];
    const images = version.images || [];
    body.innerHTML = `
        ${triggers.length ? `
        <div class="cs-section">
            <div class="cs-section-title">触发词 <button class="cs-btn cs-btn-mini" id="cs-copy-triggers">复制全部</button></div>
            <div class="cs-tags">${triggers.map((t) => `<code class="cs-trigger">${esc(t)}</code>`).join("")}</div>
        </div>` : ""}
        <div class="cs-section">
            <div class="cs-section-title">文件</div>
            <div class="cs-files">${(version.files || []).map((f, i) => `
                <div class="cs-file">
                    <div class="cs-file-info">
                        <div class="cs-file-name" title="${esc(f.name)}">${esc(f.name)}</div>
                        <div class="cs-file-meta">${fmtSize((f.sizeKB || 0) * 1024)}${f.primary ? " · 主文件" : ""}</div>
                    </div>
                    <button class="cs-btn cs-btn-primary" data-file-idx="${i}">⬇ 下载</button>
                </div>`).join("") || '<div class="cs-empty">该版本没有文件</div>'}
            </div>
        </div>
        ${images.length ? `
        <div class="cs-section">
            <div class="cs-section-title">预览图 (${images.length}) — 点击查看生成参数</div>
            <div class="cs-gallery">${images.map((img) => `
                <div class="cs-gallery-item">
                    <img loading="lazy" src="${esc(imgSrc(img.url))}" data-direct="${esc(img.url)}"
                         onerror="this.style.display='none'"/>
                </div>`).join("")}
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
}

function showImageMeta(image) {
    const meta = image.meta;
    if (!meta) {
        showModal('<h3 class="cs-modal-title">生成参数</h3><p class="cs-modal-msg">这张图没有公开生成参数。</p>');
        return;
    }
    const kv = [
        ["模型", meta.model], ["采样器", meta.sampler], ["步数", meta.steps],
        ["CFG", meta.cfgScale], ["Seed", meta.seed], ["尺寸", meta.size],
    ].filter(([, v]) => v !== undefined && v !== null && v !== "");
    const resources = (meta.resources || []).map((r) =>
        `<code class="cs-trigger">${esc(r.name || r.modelName || "?")}${r.weight != null ? " × " + esc(r.weight) : ""}</code>`).join("");
    const m = showModal(`
        <h3 class="cs-modal-title">生成参数</h3>
        <div class="cs-meta-block">
            <div class="cs-section-title">正面提示词 <button class="cs-btn cs-btn-mini" data-copy="prompt">复制</button></div>
            <textarea readonly rows="5">${esc(meta.prompt || "")}</textarea>
        </div>
        ${meta.negativePrompt ? `
        <div class="cs-meta-block">
            <div class="cs-section-title">负面提示词 <button class="cs-btn cs-btn-mini" data-copy="negative">复制</button></div>
            <textarea readonly rows="3">${esc(meta.negativePrompt || "")}</textarea>
        </div>` : ""}
        <div class="cs-kv-grid">${kv.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("")}</div>
        ${resources ? `<div class="cs-meta-block"><div class="cs-section-title">用到资源</div><div class="cs-tags">${resources}</div></div>` : ""}`);
    $$("[data-copy]", m.box).forEach((btn) => {
        btn.onclick = () => {
            const ta = $("textarea", btn.closest(".cs-meta-block"));
            copyText(ta.value, btn);
        };
    });
}

// ---------- 下载对话框 ----------
async function openDownloadDialog({ model, version, fileIndex = null, defaultRoot = "", defaultSub = "" }) {
    if (!version) {
        toast("error", "无法下载", "未找到该版本,请重新检查更新后再试");
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
        toast("error", "无法打开下载", destError ? `获取目录失败: ${destError}` : "未找到已注册的模型文件夹");
        return;
    }
    const files = version.files || [];
    const selIdx = fileIndex !== null ? fileIndex : Math.max(0, files.findIndex((f) => f.primary));
    // 目录归一后比较(斜杠/大小写/尾斜杠),命中时采用 destinations 的原串,保证 option 选中一致
    const normPath = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const matched = defaultRoot && destinations.find((d) => normPath(d.root) === normPath(defaultRoot));
    const preRoot = matched ? matched.root : destinations[0].root;
    const m = showModal(`
        <h3 class="cs-modal-title">下载 — ${esc(version.name || model.name)}</h3>
        <div class="cs-form">
            ${files.length > 1 ? `
            <label>文件
                <select id="cs-dl-file">${files.map((f, i) =>
                    `<option value="${i}" ${i === selIdx ? "selected" : ""}>${esc(f.name)} (${fmtSize((f.sizeKB || 0) * 1024)})</option>`).join("")}
                </select>
            </label>` : ""}
            <label>目标目录
                <select id="cs-dl-root">${destinations.map((d) =>
                    `<option value="${esc(d.root)}" ${d.root === preRoot ? "selected" : ""}>${esc(d.label)}</option>`).join("")}
                </select>
            </label>
            <label>子文件夹(可选,自动创建)
                <input id="cs-dl-sub" type="text" placeholder="例如: NSFW/角色" value="${esc(defaultSub)}"/>
            </label>
            <label>保存文件名
                <input id="cs-dl-name" type="text" value="${esc(files[selIdx]?.name || (version.name + ".safetensors"))}"/>
            </label>
            <div class="cs-modal-msg cs-dl-hint">下载完成后自动写入 .civitai.json 元数据${S.cfg.verify_hash ? "并校验 SHA256" : ""}。</div>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">取消</button>
                <button class="cs-btn cs-btn-primary" data-act="ok">开始下载</button>
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
        btn.textContent = "提交中…";
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
            toast("success", "已加入下载队列", `${model.name} — ${version.name}`);
            if (res.job) S.dl.jobs.unshift(res.job); // 立即入列,不等下一次轮询
            lastPollTs = 0;
            switchTab("downloads");
            pollDownloads();
        } catch (e) {
            toast("error", "下载任务创建失败", e.message);
            btn.disabled = false;
            btn.textContent = "开始下载";
        }
    };
}

// ---------- 本地库 ----------
async function loadLocal(force) {
    const st = S.local;
    st.loading = true;
    renderLocalList();
    try {
        const data = await apiGet("/civitai_studio/local" + (force ? "?force=1" : ""));
        st.models = data.models || [];
        st.truncated = !!data.truncated;
        st.error = "";
    } catch (e) {
        st.error = "加载失败: " + e.message;
        st.models = [];
    } finally {
        st.loading = false;
        renderLocalList();
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
        chips.innerHTML = `<button class="cs-chip ${!st.type ? "active" : ""}" data-cat="">全部 (${st.models.length})</button>` +
            cats.map((c) => `<button class="cs-chip ${st.type === c ? "active" : ""}" data-cat="${esc(c)}">${esc(c)} (${st.models.filter((m) => m.category === c).length})</button>`).join("");
        $$(".cs-chip", chips).forEach((chip) => {
            chip.onclick = () => { st.type = chip.dataset.cat; renderLocalList(); };
        });
    }
    if (st.loading && !st.models.length) {
        list.innerHTML = '<div class="cs-empty">扫描模型目录中…</div>';
        return;
    }
    if (!models.length) {
        list.innerHTML = '<div class="cs-empty">没有找到模型文件。</div>' + (st.truncated ? '<div class="cs-empty">注意:文件数超过扫描上限。</div>' : "");
        return;
    }
    const scanning = st.loading ? '<div class="cs-banner">正在重新扫描模型目录…</div>' : "";
    list.innerHTML = scanning + models.map((m) => {
        const civ = m.civitai || {};
        const upd = st.updates[m.id];
        const updHtml = upd && upd.update
            ? `<div class="cs-local-update">有新版本: ${esc(upd.update.version_name)} (${esc(upd.update.base_model || "")})
                 <button class="cs-btn cs-btn-mini cs-btn-primary" data-update="${esc(m.id)}">下载新版本</button></div>`
            : (upd && !upd.update && !upd.error ? '<div class="cs-local-update cs-ok">已是最新版本</div>' : "");
        return `
        <div class="cs-local-row" data-id="${esc(m.id)}">
            <div class="cs-local-main">
                <div class="cs-local-name" title="${esc(m.path || m.rel)}">${esc(civ.model_name || m.name)}</div>
                <div class="cs-local-sub">
                    <span class="cs-badge">${esc(m.category)}</span>
                    ${civ.base_model ? `<span class="cs-badge">${esc(civ.base_model)}</span>` : ""}
                    ${civ.version_name ? `<span class="cs-badge cs-badge-dim">v: ${esc(civ.version_name)}</span>` : ""}
                    <span class="cs-dim">${fmtSize(m.size)}</span>
                    ${civ.model_name && civ.model_name !== m.name ? `<span class="cs-dim">文件: ${esc(m.name)}</span>` : ""}
                </div>
                <div class="cs-local-path" title="${esc(m.rel)}">${esc(m.rel)}</div>
                ${updHtml}
            </div>
            <div class="cs-local-actions">
                ${civ.model_id ? `<a class="cs-btn cs-btn-mini" href="${esc(civitaiPage())}/models/${esc(String(civ.model_id))}" target="_blank" rel="noopener noreferrer">页面</a>` : ""}
                ${civ.version_id ? `<button class="cs-btn cs-btn-mini" data-check="${esc(m.id)}">查更新</button>` : ""}
                <button class="cs-btn cs-btn-mini" data-reveal="${esc(m.id)}">定位</button>
                <button class="cs-btn cs-btn-mini cs-btn-danger" data-delete="${esc(m.id)}">删除</button>
            </div>
        </div>`;
    }).join("");

    $$("[data-reveal]", list).forEach((btn) => {
        btn.onclick = async () => {
            const m = findLocalModel(btn.dataset.reveal);
            try { await apiPost("/civitai_studio/local/reveal", { category: m.category, rel: m.rel }); }
            catch (e) { toast("error", "打开文件夹失败", e.message); }
        };
    });
    $$("[data-delete]", list).forEach((btn) => {
        btn.onclick = () => {
            const m = findLocalModel(btn.dataset.delete);
            confirmModal("删除模型", `确定要删除「${m.name}」吗?\n该操作不可恢复。`, async () => {
                try {
                    await apiPost("/civitai_studio/local/delete", { category: m.category, rel: m.rel });
                    toast("success", "已删除", m.name);
                    S.local.updates = {};
                    loadLocal(true);
                } catch (e) { toast("error", "删除失败", e.message); }
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
            btn.textContent = "查更新";
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
                toast("error", "获取新版本失败", e.message);
            } finally { btn.disabled = false; }
        };
    });
}

function findLocalModel(id) {
    return S.local.models.find((m) => m.id === id);
}

async function runUpdateCheck(items) {
    const st = S.local;
    const btn = $("#cs-check-updates");
    if (btn) { btn.disabled = true; btn.textContent = "检查中…"; }
    try {
        const data = await apiPost("/civitai_studio/local/check_updates", { items });
        const batch = !items?.length;
        let failCount = 0;
        for (const r of data.results || []) {
            if (r.error) {
                failCount += 1;
                if (!batch) toast("error", "更新检查失败", `${r.id}: ${r.error}`);
                continue;
            }
            st.updates[r.id] = r;
        }
        renderLocalList();
        const hasUpdate = (data.results || []).some((r) => r.update);
        const scope = data.total_linked > data.checked
            ? `已检查 ${data.checked}/${data.total_linked} 个(单次上限 30,可对单个模型点"查更新")`
            : `已检查 ${data.checked} 个`;
        const failNote = failCount ? `,${failCount} 个查询失败(多为模型已在站方删除)` : "";
        toast("info", "更新检查完成", (hasUpdate ? "发现可更新的模型 — " : "") + scope + failNote);
    } catch (e) {
        toast("error", "更新检查失败", e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "检查更新"; }
    }
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
        head = '<div class="cs-banner cs-banner-warn">下载状态刷新失败(已连续多次),请检查 ComfyUI 后端;恢复后此提示会自动消失。</div>';
    }
    if (!S.dl.jobs.length) {
        const clrBtn = $("#cs-dl-clear");
        if (clrBtn) clrBtn.style.display = "none";
        list.innerHTML = head + '<div class="cs-empty">暂无下载任务。去「浏览」页面挑个模型吧。</div>';
        return;
    }
    list.innerHTML = head + S.dl.jobs.map((j) => {
        const pct = Math.round((j.progress || 0) * 100);
        const statusText = {
            queued: "排队中…", downloading: `下载中 ${pct}% ${fmtSpeed(j.speed)}`,
            verifying: "校验 SHA256…", done: "完成 ✔", cancelled: "已取消",
            error: "失败: " + (j.error || ""),
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
            ${active ? `<button class="cs-btn cs-btn-mini cs-btn-danger" data-cancel="${esc(j.id)}">取消</button>` : ""}
        </div>`;
    }).join("");
    $$("[data-cancel]", list).forEach((btn) => {
        btn.onclick = async () => {
            try { await apiPost("/civitai_studio/downloads/cancel", { id: btn.dataset.cancel }); }
            catch (e) { toast("error", "取消失败", e.message); }
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
    catch (e) { toast("error", "读取配置失败", e.message); return; }
    const oldProxyImages = !!cfg.proxy_images;
    const m = showModal(`
        <h3 class="cs-modal-title">⚙ Civitai Studio 设置</h3>
        <div class="cs-form">
            <label>Civitai API Key(可选,下载受限模型/提高限额)
                <input id="cs-set-key" type="password" placeholder="${cfg.api_key_set ? "已设置(尾号 " + esc(cfg.api_key_tail) + "),留空保持不变" : "粘贴 API Key"}"/>
            </label>
            <label>网络代理(HTTP / SOCKS 均可,裸地址自动按 HTTP 处理)
                <input id="cs-set-proxy" type="text" value="${esc(cfg.proxy || "")}" placeholder="http://127.0.0.1:10808 或 socks5://127.0.0.1:10808,留空 = 直连"/>
                <span class="cs-form-hint">填 127.0.0.1 而非 localhost。v2rayN 混合端口 10808:优先填 socks5://127.0.0.1:10808(实测最稳),http://127.0.0.1:10808 亦可;API、下载、图片全部走此代理。</span>
            </label>
            <label>API 站点(默认 civitai.red,被拦时可改回 https://civitai.com)
                <input id="cs-set-mirror" type="text" value="${esc(cfg.mirror || "")}" placeholder="留空 = https://civitai.red"/>
            </label>
            <label>下载并发数(1-4)
                <input id="cs-set-conc" type="number" min="1" max="4" value="${cfg.max_concurrent || 1}"/>
            </label>
            <label class="cs-check"><input id="cs-set-pimg" type="checkbox" ${cfg.proxy_images ? "checked" : ""}/> 预览图经服务端中转(直连打不开图片时开启)</label>
            <label class="cs-check"><input id="cs-set-hash" type="checkbox" ${cfg.verify_hash ? "checked" : ""}/> 下载完成后校验 SHA256</label>
            <div class="cs-modal-msg">API Key 在 <a href="https://civitai.com/user/account" target="_blank" rel="noopener noreferrer">Civitai 账户设置</a> 页生成,仅保存在本机 ComfyUI user 目录;Key 只会下发给官方站点,不会发给镜像。</div>
            <div class="cs-modal-actions">
                <button class="cs-btn" data-act="cancel">取消</button>
                <button class="cs-btn cs-btn-primary" data-act="ok">保存</button>
            </div>
        </div>`);
    $("[data-act=cancel]", m.box).onclick = m.close;
    $("[data-act=ok]", m.box).onclick = async () => {
        const body = {
            proxy: $("#cs-set-proxy", m.box).value.trim(),
            mirror: $("#cs-set-mirror", m.box).value.trim(),
            max_concurrent: parseInt($("#cs-set-conc", m.box).value, 10) || 1,
            proxy_images: $("#cs-set-pimg", m.box).checked,
            verify_hash: $("#cs-set-hash", m.box).checked,
        };
        const key = $("#cs-set-key", m.box).value.trim();
        if (key) body.api_key = key;
        try {
            await apiPost("/civitai_studio/config", body);
            S.cfg = { ...S.cfg, ...body };
            m.close();
            toast("success", "设置已保存", "");
            if (body.proxy_images !== oldProxyImages) refreshAllImages();
        } catch (e) {
            toast("error", "保存失败", e.message);
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
}

function buildBrowseView(root) {
    const st = S.browse;
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "browse";
    view.innerHTML = `
        <div class="cs-toolbar">
            <input id="cs-search" type="search" placeholder="搜索 Civitai 模型…"/>
        </div>
        <div class="cs-filters">
            <select id="cs-f-type"><option value="">全部类型</option>${TYPE_OPTIONS.map((t) => `<option value="${t}" ${st.type === t ? "selected" : ""}>${TYPE_LABELS[t]}</option>`).join("")}</select>
            <select id="cs-f-base"><option value="">全部底模</option>${BASE_MODELS.map((b) => `<option value="${esc(b)}" ${st.base === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
            <select id="cs-f-sort">${SORTS.map((s) => `<option value="${s}" ${st.sort === s ? "selected" : ""}>${SORT_LABELS[s]}</option>`).join("")}</select>
            <select id="cs-f-period">${PERIODS.map((p) => `<option value="${p}" ${st.period === p ? "selected" : ""}>${PERIOD_LABELS[p]}</option>`).join("")}</select>
            <select id="cs-f-nsfw">${NSFW_LEVELS.map((n) => `<option value="${n.v}" ${st.nsfw === n.v ? "selected" : ""}>${n.label}</option>`).join("")}</select>
        </div>
        <div id="cs-browse-content" class="cs-scroll">
            <div id="cs-list-view" style="display:block">
                <div id="cs-grid" class="cs-grid"></div>
            </div>
            <div id="cs-detail-view" style="display:none"></div>
        </div>
        <div id="cs-status" class="cs-status"></div>`;
    root.appendChild(view);

    let deb;
    $("#cs-search", view).addEventListener("input", (e) => {
        clearTimeout(deb);
        deb = setTimeout(() => {
            st.query = e.target.value.trim();
            backToListIfOpen();
            triggerBrowseRefresh();
        }, 500);
    });
    for (const [sel, key] of [["#cs-f-type", "type"], ["#cs-f-base", "base"], ["#cs-f-sort", "sort"], ["#cs-f-period", "period"], ["#cs-f-nsfw", "nsfw"]]) {
        $(sel, view).addEventListener("change", (e) => {
            st[key] = key === "nsfw" ? parseInt(e.target.value, 10) : e.target.value;
            backToListIfOpen();
            triggerBrowseRefresh();
            if (key === "nsfw") apiPost("/civitai_studio/config", { nsfw: st[key] }).catch(() => {}); // 偏好持久化
        });
    }
    // 无限滚动(页码推进在 fetchBrowse 成功后提交,失败自动重试同一页)
    $("#cs-browse-content", view).addEventListener("scroll", (e) => {
        const el = e.target;
        S.ui.scrollTop = el.scrollTop;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
            if (!st.loading && st.nextCursor && !st.dirty) fetchBrowse(false);
        }
    });
}

function backToListIfOpen() {
    if (S.ui.detailId) backToList();
}

function buildLocalView(root) {
    const view = document.createElement("div");
    view.className = "cs-view";
    view.dataset.view = "local";
    view.innerHTML = `
        <div class="cs-toolbar">
            <input id="cs-local-search" type="search" placeholder="搜索本地模型…"/>
            <button class="cs-btn" id="cs-check-updates">检查更新</button>
            <button class="cs-btn" id="cs-local-refresh" title="重新扫描">🔄</button>
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
            <span class="cs-dim">下载到 ComfyUI 模型目录,支持断点续传</span>
            <button class="cs-btn" id="cs-dl-clear" style="display:none">清除已完成</button>
        </div>
        <div id="cs-dl-list" class="cs-scroll"></div>`;
    root.appendChild(view);
    $("#cs-dl-clear", view).onclick = async () => {
        try { await apiPost("/civitai_studio/downloads/clear", {}); pollDownloads(); }
        catch (e) { toast("error", "清除失败", e.message); }
    };
}

function buildRoot(el) {
    el.innerHTML = "";
    const root = document.createElement("div");
    root.className = "cs-root";
    root.innerHTML = `
        <div class="cs-topbar">
            <button class="cs-tab-btn active" data-tab="browse">🌐 浏览</button>
            <button class="cs-tab-btn" data-tab="local">📁 本地库</button>
            <button class="cs-tab-btn" data-tab="downloads">⬇ 下载 <span id="cs-dl-badge" class="cs-dl-badge" style="display:none"></span></button>
            <span class="cs-topbar-spacer"></span>
            <button class="cs-tab-btn" id="cs-settings-btn" title="设置">⚙</button>
        </div>
        <div class="cs-body"></div>`;
    el.appendChild(root);
    S.ui.root = root;
    buildBrowseView($(".cs-body", root));
    buildLocalView($(".cs-body", root));
    buildDownloadsView($(".cs-body", root));
    $$(".cs-tab-btn[data-tab]", root).forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
    $("#cs-settings-btn", root).onclick = openSettings;
    switchTab("browse");
}

function restoreBrowseState() {
    // 重开面板:恢复滚动位置与打开中的详情,避免全量重建丢状态
    if (S.ui.detailId && S.browse.detail && !S.browse.dirty) {
        const listView = $("#cs-list-view");
        const detailView = $("#cs-detail-view");
        if (listView && detailView) {
            listView.style.display = "none";
            detailView.style.display = "block";
            renderDetail(S.browse.detail);
            updateStatusLine();
        }
    }
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
.cs-filters { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:0 6px 6px; flex-shrink:0; }
.cs-filters select { width:100%; padding:3px; font-size:12px; }
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
.cs-gallery-item img { width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:4px; cursor:pointer; border:2px solid transparent; }
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
.cs-local-actions { display:flex; flex-direction:column; gap:4px; flex-shrink:0; }
.cs-local-update { font-size:11px; margin-top:4px; color:#e2a23f; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.cs-local-update.cs-ok { color:#4caf50; }
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
.cs-modal { position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:99999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px); }
.cs-modal-box { background:var(--comfy-menu-bg,#2a2a2a); border:1px solid var(--border-color,#444); border-radius:10px; padding:16px; width:min(92vw, 520px); max-height:88vh; overflow-y:auto; box-shadow:0 10px 40px rgba(0,0,0,.5); }
.cs-modal-title { margin:0 0 10px; font-size:15px; }
.cs-modal-msg { font-size:12px; color:var(--desc-text-color,#999); white-space:pre-line; }
.cs-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
.cs-form { display:flex; flex-direction:column; gap:10px; }
.cs-form label { display:flex; flex-direction:column; gap:4px; font-size:12px; }
.cs-form input[type=text], .cs-form input[type=password], .cs-form input[type=number], .cs-form select { background:var(--comfy-input-bg,#333); color:var(--input-text-color,#ddd); border:1px solid var(--border-color,#444); border-radius:5px; padding:6px; font-size:12px; }
.cs-check { flex-direction:row !important; align-items:center; gap:6px !important; }
.cs-form-hint { font-size:11px; color:var(--desc-text-color,#999); opacity:.8; }
.cs-dl-hint { background:rgba(0,0,0,.2); border-radius:6px; padding:6px 8px; }
`;
    document.head.appendChild(style);
}

// ---------- 入口 ----------
app.registerExtension({
    name: "Civitai.Studio",
    async setup() {
        injectStyles();
        if (!app.extensionManager?.registerSidebarTab) {
            console.error("[Civitai-Studio] 当前 ComfyUI 前端过旧,不支持侧边栏 API (extensionManager.registerSidebarTab)");
            toast("error", "Civitai Studio 加载失败", "前端版本过旧,请升级 ComfyUI");
            return;
        }
        try {
            S.cfg = { ...S.cfg, ...(await apiGet("/civitai_studio/config")) };
            S.browse.nsfw = Number(S.cfg.nsfw ?? 1); // 恢复持久化的 NSFW 偏好
        } catch (e) {
            console.warn("[Civitai-Studio] 读取配置失败:", e);
        }
        app.extensionManager.registerSidebarTab({
            id: "civitai.studio",
            title: "Civitai",
            icon: "pi pi-images",
            tooltip: "Civitai 模型浏览器与本地管理器",
            render(el) {
                buildRoot(el);
                if (S.browse.dirty) {
                    // 重拉分支不恢复详情(数据将失效),同步清理残留的详情态
                    S.ui.detailId = null;
                    S.browse.detail = null;
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
        console.log("[Civitai-Studio] 已就绪");
    },
});
