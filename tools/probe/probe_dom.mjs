// DOM 级探针(B0-2 入库版):用 jsdom 真实构建两个视图,断言控件位置/事件/请求参数
// (覆盖 TDZ、id 拼写、绑定缺失这类只有真 DOM 才能暴露的问题)
// 运行:npm ci --prefix tools/probe && node tools/probe/probe_dom.mjs [自定义 js 路径]
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const SRC = process.argv[2] || fileURLToPath(new URL("../../js/civitai_studio_app.js", import.meta.url));
let src = fs.readFileSync(SRC, "utf8");
src = src.split("\n").filter((l) => !l.includes("scripts/app.js") && !l.includes("scripts/api.js")).join("\n");
src += `
globalThis.__cs_probe = { buildGalleryView, buildBrowseView, S, fmtSelHtml, BROWSE_CARD_SIZES,
  renderGallery, renderResults, fetchGallery, fetchBrowse, t, makeMultiSelect,
  makeBodyPopup, openMiniMenu, mergePage, buildFavoritesView, guardKeys, installUndoGuard };
`;

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const gl = globalThis;
const fetched = [];
gl.window = window; gl.document = window.document;
gl.localStorage = window.localStorage;
Object.defineProperty(gl, "navigator", { value: window.navigator, configurable: true });
gl.HTMLElement = window.HTMLElement; gl.Element = window.Element; gl.Node = window.Node;
gl.CustomEvent = window.CustomEvent; gl.Event = window.Event; gl.getComputedStyle = window.getComputedStyle;
gl.ResizeObserver = class { observe() {} disconnect() {} };
gl.requestAnimationFrame = (f) => setTimeout(f, 0);
gl.setInterval = () => 0; gl.clearInterval = () => {};
gl.LiteGraph = { LGraph: function () {}, classes: {} };
const app = {
  registerExtension: () => {}, registerCustomNode: () => {},
  graph: { _nodes: [] }, canvas: { canvas: null }, csPatchSerialize: () => {},
  extensionManager: { toast: { add: () => {} }, registerSidebarTab: () => {} },
  ui: { settings: { getSettingValue: () => "zh" } },
};
const api = {
  fetchApi: async (url) => {
    fetched.push(String(url));
    if (String(url).includes("/civitai_studio/config")) return { ok: true, status: 200, json: async () => ({}) };
    if (String(url).includes("/favorites")) return { ok: true, status: 200, json: async () => ({ ids: [] }) };
    return { ok: true, status: 200, json: async () => ({ items: [], next_query: [], metadata: { nextCursor: "" } }) };
  },
  addEventListener: () => {},
};
gl.app = app; gl.api = api;

await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));
const P = gl.__cs_probe;
let fail = 0;
const ck = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " " + extra}`);
};
const inFold = (el) => !!el.closest(".cs-fwrap");
const inBar = (el) => !!el.closest(".cs-toolbar");

// ---------- 画廊 ----------
const gRoot = window.document.createElement("div");
window.document.body.appendChild(gRoot);
P.buildGalleryView(gRoot);
const gq = (s) => gRoot.querySelector(s);
ck("画廊 toolbar 存在", !!gq(".cs-toolbar"));
ck("画廊 精确ID 在 toolbar(不折叠)", inBar(gq("#cs-gal-imgid")) && !inFold(gq("#cs-gal-imgid")));
ck("画廊 ⟳/⟲ 在 toolbar", inBar(gq("#cs-gal-refresh")) && inBar(gq("#cs-gal-reset")));
ck("画廊 底模/tags 整行在折叠区", inFold(gq("#cs-gal-base-picker")) && inFold(gq("#cs-gal-tag-picker")));
ck("画廊 12 格制类名", !!gq(".cs-filters.cs-filters-gal"));
const gLv = gq("#cs-gal-lv"), gPeriod = gq("#cs-gal-period"), gSort = gq("#cs-gal-sort"), gNsfw = gq("#cs-gal-nsfw");
ck("画廊 分级为多选下拉(非 chips)", !!gLv && !!gLv.querySelector("button") && !gq("#cs-gal-nsfwlv"));
ck("画廊 第3行四件套同排(period/sort/nsfw/lv)", [gPeriod, gSort, gNsfw, gLv].every((e) => e && e.parentElement === gPeriod.parentElement));
const gFmt = gq("#cs-gal-fmt"), gSize = gq("#cs-gal-size"), gFav = gq("#cs-gal-fav");
ck("画廊 末行三件套同排(类型/尺寸/★)", gFmt && gSize && gFav && gFmt.parentElement === gSize.parentElement && gSize.parentElement === gFav.parentElement);
ck("画廊 媒体类型只有 3 项(全部/图像/视频)", gFmt.options.length === 3 && [...gFmt.options].map((o) => o.value).join(",") === "all,image,video");
ck("画廊 尺寸含更小档 96", [...gSize.options].map((o) => o.value).join(",") === "96,128,256,512");
ck("画廊 分级多选:点开有 5 个复选", (() => { gLv.querySelector("button").click(); const pop = window.document.querySelector(".cs-mselect-pop"); return !!pop && pop.querySelectorAll("input[type=checkbox]").length === 5; })());
ck("画廊 分级多选:勾选 R 后回调生效", (() => {
  const pop = window.document.querySelector(".cs-mselect-pop");
  const cb = [...pop.querySelectorAll("input[type=checkbox]")][2]; // PG,PG-13,R
  cb.checked = true; cb.dispatchEvent(new window.Event("change", { bubbles: true }));
  return P.S.gal.nsfwLv.has(4) && gLv.textContent.includes("R");
})());

// 媒体类型切换 → 服务端 type= 参数
fetched.length = 0;
P.S.gal.items = [];
gFmt.value = "video";
gFmt.dispatchEvent(new window.Event("change", { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
ck("画廊 选视频后请求带 type=video", fetched.some((u) => /[?&]type=video\b/.test(u)), JSON.stringify(fetched));
gFmt.value = "image";
gFmt.dispatchEvent(new window.Event("change", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1200)); // 画廊有 900ms 最小请求间隔节流
ck("画廊 选图像后请求带 type=image", fetched.some((u) => /[?&]type=image\b/.test(u)), JSON.stringify(fetched));

// 重置
P.S.gal.favOnly = true; gFav.style.background = "red";
gq("#cs-gal-reset").click();
ck("画廊 重置清筛选与★", P.S.gal.favOnly === false && P.S.gal.fmt === "all" && P.S.gal.nsfwLv.size === 0
  && P.S.gal.period === "AllTime" && gFav.style.background === "");

// ---------- 模型页 ----------
const bRoot = window.document.createElement("div");
window.document.body.appendChild(bRoot);
P.buildBrowseView(bRoot);
const bq = (s) => bRoot.querySelector(s);
ck("模型页 toolbar 存在", !!bq(".cs-toolbar"));
ck("模型页 类型在 toolbar(不折叠)", inBar(bq("#cs-f-type")) && !inFold(bq("#cs-f-type")));
ck("模型页 ⟳/⟲ 在 toolbar", inBar(bq("#cs-browse-refresh")) && inBar(bq("#cs-browse-reset")));
ck("模型页 12 格制类名", !!bq(".cs-filters.cs-filters-gal"));
ck("模型页 分级为多选下拉(非 chips)", !!bq("#cs-f-lv").querySelector("button") && !bq("#cs-f-nsfwlv"));
ck("模型页 第3行四件套同排", [bq("#cs-f-period"), bq("#cs-f-sort"), bq("#cs-f-nsfw"), bq("#cs-f-lv")]
  .every((e) => e && e.parentElement === bq("#cs-f-period").parentElement));
ck("模型页 末行三件套同排(付费/尺寸/★)", [bq("#cs-f-hidepaid"), bq("#cs-f-size"), bq("#cs-f-fav")]
  .every((e) => e && e.parentElement === bq("#cs-f-hidepaid").parentElement));
const bSize = bq("#cs-f-size");
ck("模型页 卡片尺寸 4 档且最小 110(迷你/小/中/大)", [...bSize.options].map((o) => o.value).join(",") === "110,150,200,260" && bSize.options[0].textContent === P.t("sizeXS") && bSize.options[3].textContent === P.t("sizeL"));
ck("模型页 ★只看收藏按钮存在", /★/.test(bq("#cs-f-fav").textContent));
// 尺寸落地:改档写 grid 列宽 + localStorage
bq("#cs-grid") || (() => { const d = window.document.createElement("div"); d.id = "cs-grid"; bRoot.appendChild(d); })();
bSize.value = "110"; bSize.dispatchEvent(new window.Event("change", { bubbles: true }));
ck("模型页 尺寸切换写入 grid 列宽", bq("#cs-grid").style.gridTemplateColumns.includes("110px"), bq("#cs-grid").style.gridTemplateColumns);
ck("模型页 尺寸偏好已持久化", P.S.browse.cardW === 110 && localStorage.getItem("cs_browse_cardw") === "110");
// ★只看收藏开关
bq("#cs-f-fav").click();
ck("模型页 ★只看收藏可开", P.S.browse.favOnly === true);
bq("#cs-browse-reset").click();
ck("模型页 重置清★与分级且保留尺寸档", P.S.browse.favOnly === false && P.S.browse.nsfwLv.size === 0 && P.S.browse.cardW === 110);
// 批12:画廊状态行 + 尺寸文案
ck("画廊 状态行存在", !!gq("#cs-gal-status"));
ck("画廊 尺寸文案为 迷你/小/中/大", [...gSize.options].map((o) => o.textContent).join(",") === [P.t("sizeXS"), P.t("sizeS"), P.t("sizeM"), P.t("sizeL")].join(","));
ck("分级多选:重置后摘要回全部", gLv.textContent.includes(P.t("msAll")));

// ---------- B0-1a 弹层宿主工厂 ----------
const hostA = P.makeBodyPopup({ cls: "cs-probe-pop", at: { clientX: 50, clientY: 60 } });
hostA.pop.textContent = "x";
hostA.mount();
ck("工厂: mount 挂 body 且鼠标位定位", window.document.body.contains(hostA.pop)
  && parseInt(hostA.pop.style.left) <= 50 && parseInt(hostA.pop.style.top) <= 60,
  hostA.pop.style.left + "," + hostA.pop.style.top);
const hostB = P.makeBodyPopup({ cls: "cs-probe-pop", at: { clientX: 10, clientY: 10 } });
hostB.mount();
ck("工厂: 同类唯一实例", !window.document.body.contains(hostA.pop) && window.document.body.contains(hostB.pop));
window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
ck("工厂: 外部按下捕获即关", !window.document.body.contains(hostB.pop));
const hostC = P.makeBodyPopup({ cls: "cs-probe-pop", at: { clientX: 10, clientY: 10 } });
hostC.mount();
let outerHits = 0;
const probeOuter = () => outerHits++;
window.addEventListener("pointerdown", probeOuter);
hostC.pop.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
ck("工厂: 内部按下阻断传播且不关", outerHits === 0 && window.document.body.contains(hostC.pop));
hostC.close();
ck("工厂: close() 主动收口", !window.document.body.contains(hostC.pop));
window.removeEventListener("pointerdown", probeOuter);
let miniFired = 0;
P.openMiniMenu({ clientX: 30, clientY: 30 }, [{ label: "复制ID", cb: () => { miniFired++; } }]);
const menuEl = window.document.querySelector(".cs-mini-menu");
ck("mini 菜单: 经工厂挂载", !!menuEl);
if (menuEl) {
  menuEl.querySelector("[data-cs-mi]").dispatchEvent(new window.Event("pointerup", { bubbles: true }));
  ck("mini 菜单: pointerup 双通道激活并自关", miniFired === 1 && !window.document.querySelector(".cs-mini-menu"));
}

// B0-1c:翻页合并去重(模型页/画廊/节点条三处共用)
const mg = P.mergePage([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }, { id: 3 }]);
ck("mergePage: 按 id 去重追加且不改入参", mg.length === 3 && mg.map((x) => x.id).join(",") === "1,2,3",
  JSON.stringify(mg));
ck("mergePage: 空入参安全", P.mergePage([], null).length === 0);

// ---------- 批14.2 收藏页 12 格制同构 ----------
const fRoot = window.document.createElement("div");
window.document.body.appendChild(fRoot);
P.buildFavoritesView(fRoot);
const fq = (s) => fRoot.querySelector(s);
ck("收藏 toolbar 四件(搜索/类别/⟳同步/⟲重置)", !!(fq(".cs-toolbar #cs-fav-search") && fq(".cs-toolbar #cs-fav-kind")
  && fq(".cs-toolbar #cs-fav-sync") && fq(".cs-toolbar #cs-fav-rstf")));
ck("收藏 12 格制类名", !!fq(".cs-filters.cs-filters-gal"));
ck("收藏 分组+排序两等分同排", fq("#cs-fav-group").classList.contains("cs-span-6")
  && fq("#cs-fav-sort").classList.contains("cs-span-6")
  && fq("#cs-fav-group").parentElement === fq("#cs-fav-sort").parentElement);
ck("收藏 动作组三等分(管理/导入/导出)", ["cs-fav-manage", "cs-fav-import", "cs-fav-export"].every((id) =>
  fq("#" + id) && fq("#" + id).classList.contains("cs-span-4")));
ck("收藏 危险重置库在折叠区且红色", fq("#cs-fav-reset") && !!fq("#cs-fav-reset").closest(".cs-fwrap")
  && fq("#cs-fav-reset").style.color === "rgb(226, 84, 63)");
ck("收藏 折叠钮存在", !!fq("#cs-fav-ffold"));
ck("收藏 状态行在折叠区下方", fq("#cs-fav-syncline") && fq(".cs-fwrap")
  && !!(fq(".cs-fwrap").compareDocumentPosition(fq("#cs-fav-syncline")) & window.Node.DOCUMENT_POSITION_FOLLOWING));
P.S.favUi.group = "g_x"; P.S.favUi.sort = "name";
fq("#cs-fav-rstf").click();
ck("收藏 ⟲ 清分组与排序", P.S.favUi.group === "all" && P.S.favUi.sort === "updated" && fq("#cs-fav-sort").value === "updated");
fq("#cs-fav-ffold").click();
ck("收藏 折叠可切换且持久化", fq(".cs-fwrap").classList.contains("folded") && localStorage.getItem("cs_fav_fold") === "1");
fq("#cs-fav-ffold").click();
localStorage.removeItem("cs_fav_fold");

// ---------- 批14.3 键盘隔离(宿主全局快捷键不串台) ----------
let wkHits = 0;
const wkHandler = () => wkHits++;
window.addEventListener("keydown", wkHandler);
const gDiv = window.document.createElement("div");
const gInp = window.document.createElement("input");
gDiv.appendChild(gInp);
window.document.body.appendChild(gDiv);
gInp.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }));
ck("键盘隔离: 无守卫输入的 keydown 会冒泡到 window", wkHits === 1, String(wkHits));
P.guardKeys(gDiv);
gInp.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }));
ck("键盘隔离: 守卫后 Ctrl+V 不外溢", wkHits === 1, String(wkHits));
gInp.dispatchEvent(new window.KeyboardEvent("keyup", { key: "v", ctrlKey: true, bubbles: true }));
ck("键盘隔离: keyup 同样被拦", wkHits === 1, String(wkHits));
gInp.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
ck("键盘隔离: Escape 放行(Esc 关闭链依赖冒泡)", wkHits === 2, String(wkHits));
// 批14.3b:粘贴走 ClipboardEvent 而非 keydown(实测 Ctrl+V 仍串台的根因)
let wcp = 0;
const wcpH = () => wcp++;
window.addEventListener("paste", wcpH);
gInp.dispatchEvent(new window.Event("paste", { bubbles: true, composed: true }));
ck("剪贴板隔离: paste 不外溢", wcp === 0, String(wcp));
gInp.dispatchEvent(new window.Event("copy", { bubbles: true, composed: true }));
let wcc = 0;
window.addEventListener("copy", () => wcc++);
gInp.dispatchEvent(new window.Event("copy", { bubbles: true, composed: true }));
ck("剪贴板隔离: copy 不外溢", wcc === 0, String(wcc));
window.removeEventListener("paste", wcpH);
window.removeEventListener("keydown", wkHandler);
let wk2 = 0;
const wkH2 = () => wk2++;
window.addEventListener("keydown", wkH2);
P.openMiniMenu({ clientX: 30, clientY: 30 }, [{ label: "x", cb: () => { } }]);
const menuGuard = window.document.querySelector(".cs-mini-menu");
menuGuard.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }));
ck("键盘隔离: body 弹层(makeBodyPopup)内按键不外溢", wk2 === 0, String(wk2));
window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
window.removeEventListener("keydown", wkH2);

// ---------- 批14.4 失焦文本 undo 抑制 ----------
P.installUndoGuard();
const ugCanvas = window.document.createElement("canvas");
window.document.body.appendChild(ugCanvas);
const ugEv = (target, opts) => {
  const e = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};
ck("undo 抑制: 画布目标 Ctrl+Z 被 preventDefault", ugEv(ugCanvas, { key: "z", ctrlKey: true }));
ck("undo 抑制: Ctrl+Shift+Z 同拦(redo 组合)", ugEv(ugCanvas, { key: "z", ctrlKey: true, shiftKey: true }));
ck("undo 抑制: Ctrl+Y 同拦", ugEv(ugCanvas, { key: "y", ctrlKey: true }));
ck("undo 抑制: mac Cmd+Z 同拦", ugEv(ugCanvas, { key: "z", metaKey: true }));
ck("undo 抑制: 普通键不拦", !ugEv(ugCanvas, { key: "a", ctrlKey: true }));
ck("undo 抑制: 无修饰 z 不拦", !ugEv(ugCanvas, { key: "z" }));
const ugInp2 = window.document.createElement("input");
window.document.body.appendChild(ugInp2);
ck("undo 抑制: 输入框目标放行(文本 undo 合法)", !ugEv(ugInp2, { key: "z", ctrlKey: true }));

console.log(fail ? `\n${fail} 项失败` : "\n全部通过");
process.exit(fail ? 1 : 0);
