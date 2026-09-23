"""Civitai Studio 功能节点(与本地库/在线数据打通).

节点里发网络请求用独立事件循环 + 独立会话(不碰主循环的共享会话);
代理仅支持 HTTP 形态(socks 需在设置里改用 HTTP 端口)。
"""

import io
import json
import urllib.parse
import urllib.request

import aiohttp

from . import civitai_client, local_index

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

_BASE_MODEL_OPTIONS = [
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
]


class CivitaiTriggerWords:
    """选择本地已关联的 LoRA,输出其 Civitai 触发词(+ 手动补充词)."""

    @classmethod
    def INPUT_TYPES(cls):
        idx = local_index.scan()
        options = []
        for m in idx["models"]:
            if m["category"] != "loras":
                continue
            civ = m.get("civitai") or {}
            if civ.get("trained_words"):
                options.append(m["id"])
        if not options:
            options = ["(no loras with trigger words - associate one first)"]
        return {"required": {
            "lora": (options,),
            "extra_words": ("STRING", {"default": "", "multiline": False}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("trigger_words",)
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"

    def run(self, lora, extra_words):
        words = []
        item = local_index.scan().get("by_id", {}).get(str(lora))
        if item:
            meta = item.get("civitai") or {}
            words = meta.get("trained_words") or []
        extra = [w.strip() for w in re.split(r"[,，]", extra_words or "") if w.strip()]
        return (", ".join(words + extra),)


class CivitaiImageSearch:
    """搜索社区图片(关键字/底模/tag/排序/时间),输出选中图片的生成配方与图像."""

    @classmethod
    def INPUT_TYPES(cls):
        # 分组顺序与 UI 两列排版意图一致:底模/NSFW → 关键词/Tag → 时间/排序 → 数量/序号
        return {"required": {
            "base_model": (["(any)"] + _BASE_MODEL_OPTIONS,),
            "nsfw": (["true", "false"],),
            "keyword": ("STRING", {"default": ""}),
            "tag": ("STRING", {"default": ""}),
            "period": (["AllTime", "Month", "Week", "Day"],),
            "sort": (["Newest", "Most Reactions", "Most Comments"],),
            "limit": ("INT", {"default": 50, "min": 10, "max": 100, "step": 10}),
            "index": ("INT", {"default": 0, "min": 0, "max": 199}),
            # 点选缩略图后由前端写入;非空时执行直接按 URL 取图与参数
            "image_url": ("STRING", {"default": "", "multiline": False}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "IMAGE")
    RETURN_NAMES = ("positive", "negative", "lora_string", "trigger_words", "base_model", "image")
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"

    def run(self, base_model, nsfw, keyword, tag, period, sort, limit, index, image_url):
        params = {
            "limit": str(min(100, max(10, int(limit)))),
            "nsfw": str(nsfw), "sort": sort, "period": period, "withMeta": "true",
        }
        if keyword:
            params["query"] = keyword
        if base_model and base_model != "(any)":
            params["baseModels"] = base_model
        if tag:
            # 官方 /images 的 tags 只认逗号分隔的数字 Tag ID,文本名会被忽略
            ids = ",".join(t.strip() for t in tag.replace("，", ",").split(",") if t.strip().isdigit())
            if ids:
                params["tags"] = ids
        # /images 无关键词检索:逐页拉取后按 提示词/作者 包含关键词过滤(与路由侧逻辑一致)
        kw = (keyword or "").strip().lower()
        if kw:
            collected = []
            cur = dict(params)
            for _page in range(6):
                page = _sync_get_json("/images", cur)
                for it in page.get("items") or []:
                    hay = " ".join([
                        str(((it.get("meta") or {}).get("prompt")) or ""),
                        str(it.get("username") or ""),
                    ]).lower()
                    if kw in hay:
                        collected.append(it)
                nxt = ((page.get("metadata") or {}).get("nextPage")) or ""
                if not nxt or len(collected) >= int(params["limit"]):
                    break
                cur = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(nxt).query))
            data = {"items": collected}
        else:
            data = _sync_get_json("/images", params)
        items = data.get("items") or []
        if not items:
            raise RuntimeError("没有搜索结果,请调整筛选条件")
        # 优先按前端点选的 URL 取图(翻页/追加后 index 不再可靠);否则退回 index
        chosen = None
        wanted = (image_url or "").strip()
        if wanted:
            chosen = next((it for it in items if (it.get("url") or "") == wanted), None)
        if chosen is None:
            idx = min(max(int(index), 0), len(items) - 1)
            chosen = items[idx]
        vids = chosen.get("modelVersionIds") or []
        if not vids:
            raise RuntimeError("该图片未关联模型版本,请换一张(调整 index 或重新点选)")
        vdata = _sync_get_json(f"/model-versions/{vids[0]}")
        # withMeta=true 已在 feed 条目带回生成参数;个别图未公开则留空
        meta = chosen.get("meta") or {}
        pos = meta.get("prompt") or ""
        neg = meta.get("negativePrompt") or ""
        lora_parts = [
            f"{r.get('name', '?')} × {r.get('weight', 1)}"
            for r in (meta.get("resources") or [])
            if (r.get("type") or "lora").lower() == "lora"
        ]
        # 触发词:资源里的 LoRA 若在本地库中已关联,取其触发词
        trigger = ", ".join(vdata.get("trainedWords") or [])
        base = vdata.get("baseModel") or base_model
        img_bytes = _sync_download(chosen.get("url"))
        return (pos, neg, lora_parts and (", ".join(lora_parts)) or "", trigger, base, _bytes_to_tensor(img_bytes))


class CivitaiLoraRecipe:
    """按名称输出本地已关联 LoRA 的触发词与建议权重(手动输入名称)."""

    @classmethod
    def INPUT_TYPES(cls):
        idx = local_index.scan()
        options = []
        for m in idx["models"]:
            if m["category"] != "loras":
                continue
            options.append(m["id"])
        if not options:
            options = ["(no associated loras - associate one first)"]
        return {"required": {
            "lora": (options,),
            "strength": ("FLOAT", {"default": 1.0, "min": -4.0, "max": 4.0, "step": 0.05}),
            "extra_words": ("STRING", {"default": "", "multiline": False}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "FLOAT")
    RETURN_NAMES = ("trigger_words", "lora_name", "strength")
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"

    def run(self, lora, strength, extra_words):
        item = local_index.scan().get("by_id", {}).get(str(lora))
        meta = (item or {}).get("civitai") or {}
        words = meta.get("trained_words") or []
        extra = [w.strip() for w in re.split(r"[,，]", extra_words or "") if w.strip()]
        return (", ".join(words + extra), (item or {}).get("name", ""), strength)


def _sync_opener():
    """带代理的同步 opener(HTTP 形态代理;socks 请改用 HTTP 端口)."""
    proxy = (civitai_client.config.load().get("proxy") or "").strip()
    if proxy and "://" not in proxy:
        proxy = "http://" + proxy
    if proxy:
        proxy = proxy.replace("://localhost:", "://127.0.0.1:")
    if proxy and proxy.startswith("socks"):
        raise RuntimeError("节点内请求不支持 SOCKS 代理,请在设置里改用 HTTP 代理端口(如 http://127.0.0.1:10808)")
    handlers = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    return urllib.request.build_opener(*handlers)


def _sync_get_json(path, params=None):
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    url = civitai_client.api_root() + path + qs
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with _sync_opener().open(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def _sync_download(url):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with _sync_opener().open(req, timeout=120) as r:
        return r.read()


def _bytes_to_tensor(data):
    import numpy as np
    import torch
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


NODE_CLASS_MAPPINGS = {
    "CivitaiTriggerWords": CivitaiTriggerWords,
    "CivitaiImageSearch": CivitaiImageSearch,
    "CivitaiLoraRecipe": CivitaiLoraRecipe,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CivitaiTriggerWords": "Civitai 触发词 (Trigger Words)",
    "CivitaiImageSearch": "Civitai 图片搜索 (Image Search)",
    "CivitaiLoraRecipe": "Civitai LoRA 配方 (LoRA Recipe)",
}
