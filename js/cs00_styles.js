// Civitai Studio — 样式层(拆出自主文件;主文件 injectStyles 惰性读 window.CivitaiStudioStyles)
// 加载顺序无关:多扩展并行 import 下主文件运行时才读本全局
// (frontend 1.52.7 源码级确认 await Promise.all(import(...)),全部模块先于 app.setup 执行).
window.CivitaiStudioStyles = `
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
.cs-fwrap.folded .cs-ffold { transform:rotate(180deg); bottom:2px; }
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
.cs-gal-filters { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
.cs-gal-filters > * { width:100%; min-width:0; }
.cs-media-view img, .cs-media-view video { max-width:100%; max-height:64vh; border-radius:8px; display:block; margin:0 auto; background:rgba(0,0,0,.35); }
.cs-media-view video { height:64vh; object-fit:contain; }
.cs-thumb video { pointer-events:none; }
`;
