"""Civitai Studio 功能节点(与本地库/在线数据打通).

节点里发网络请求用独立事件循环 + 独立会话(不碰主循环的共享会话);
代理仅支持 HTTP 形态(socks 需在设置里改用 HTTP 端口)。
CivitaiImageSearch.run 为 async:网络耗时部分经 asyncio.to_thread 进入
线程池执行,避免阻塞 ComfyUI 主事件循环。
"""

import asyncio
import io
import json
import re
import urllib.parse
import urllib.request

import aiohttp
import folder_paths

from . import civitai_client, local_index

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def _recent_image_ids():
    """最近点选/查询过的图片 ID(新→旧),供 image_id 下拉列出."""
    try:
        path = folder_paths.get_user_directory() + "/civitai_studio/recent_image_ids.json"
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return [str(x) for x in data] if isinstance(data, list) else []
    except Exception:
        return []


def _load_tag_mapping():
    """本地 tag 名称→ID 映射(与 routes 侧共用同一文件)."""
    try:
        path = folder_paths.get_user_directory() + "/civitai_studio/tag_mapping.json"
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

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
        # 分组顺序与 UI 两列排版意图一致:底模/NSFW → Tag → 时间/排序 → 数量/序号
        return {"required": {
            "base_model": (["(any)"] + sorted(_BASE_MODEL_OPTIONS, key=str.lower),),
            "nsfw": (["false", "true"],),
            "tag": ("STRING", {"default": "", "multiline": False,
                               "tooltip": "仅数字 Tag ID,多个用逗号分隔 / numeric tag IDs only, comma-separated"}),
            "period": (["AllTime", "Month", "Week", "Day"],),
            "sort": (["Newest", "Most Reactions", "Most Comments"],),
            "limit": ("INT", {"default": 50, "min": 10, "max": 100, "step": 10}),
            "index": ("INT", {"default": 0, "min": 0, "max": 199}),
            # COMBO:首项 (index) = 按 index 取图;其余为最近点选/查询过的图片 ID(选之即精确取图)
            "image_id": (["(index)"] + _recent_image_ids(),
                         {"tooltip": "选最近浏览的图片 ID 则精确取该图与参数;选 (index) 按下方序号取图"}),
            # COMBO:(auto) = 输出图片自带 LoRA 配方;选本地 lora 文件则 lora_name 输出该文件(可直连 LoraLoader)
            "lora_name": (["(auto)"] + sorted(folder_paths.get_filename_list("loras")),
                          {"tooltip": "(auto) = 使用图片自带的 LoRA 配方;选定本地 lora 文件时,lora_name 输出该文件供直连 LoraLoader"}),
        },
        # 面板布局参数:仅前端渲染使用,optional 保证旧 API 调用不因缺参被拒
        "optional": {
            "thumbs_size": (["medium", "small", "large"],),
            "panel_h": ("INT", {"default": 420, "min": 160, "max": 1600, "step": 20}),
        }}

    # base_model/lora_name 用 COMBO:加载器(LoRA/UNET/Checkpoint)的模型字段 widget
    # 转成输入口后类型是 COMBO,前端实测拒绝 STRING→COMBO 连线、放行 COMBO→COMBO
    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "COMBO", "IMAGE", "COMBO")
    RETURN_NAMES = ("positive", "negative", "lora_string", "trigger_words", "base_model", "image", "lora_name")
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"

    @staticmethod
    def VALIDATE_INPUTS(image_id):
        # image_id 是动态组合(最近浏览记录,随前端点选增长),
        # 跳过 ComfyUI 对 COMBO 的静态"值不在列表"校验
        return True

    async def run(self, base_model, nsfw, tag, period, sort, limit, index, image_id,
                  thumbs_size, panel_h, lora_name):
        # 网络与下载均为阻塞调用,丢进线程池避免冻结 ComfyUI 主事件循环
        return await asyncio.to_thread(
            self._run_sync, base_model, nsfw, tag, period, sort, limit, index, image_id, lora_name)

    def _run_sync(self, base_model, nsfw, tag, period, sort, limit, index, image_id, lora_name):
        params = {
            "limit": str(min(100, max(10, int(limit)))),
            "nsfw": str(nsfw), "sort": sort, "period": period, "withMeta": "true",
        }
        if base_model and base_model != "(any)":
            params["baseModels"] = base_model
        if tag:
            # 官方 /images 的 tags 只认逗号分隔的数字 Tag ID;名称经本地映射换 ID
            tokens = [t.strip() for t in tag.replace("，", ",").split(",") if t.strip()]
            ids = [t for t in tokens if t.isdigit()]
            names = [t for t in tokens if not t.isdigit()]
            unresolved = []
            if names:
                mapping = _load_tag_mapping()
                for t in names:
                    if t in mapping:
                        ids.append(str(mapping[t]))
                    else:
                        unresolved.append(t)
            if unresolved:
                raise RuntimeError("tag 仅支持数字 ID(名称需先经大图悬浮层抓取入库),未识别: "
                                   + ", ".join(unresolved))
            if not ids:
                raise RuntimeError("tag 填了名称但本地映射里没有对应 ID(先在大图悬浮层点抓一次),未识别: "
                                   + ", ".join(names))
        # ID 优先:填入 image_id 时按 ID 精确取图(带 meta),忽略 index 与筛选
        chosen = None
        wanted_id = str(image_id or "").strip()
        if wanted_id.isdigit():
            page = _sync_get_json("/images", {
                "imageId": wanted_id, "limit": "1", "withMeta": "true",
            })
            items = page.get("items") or []
            chosen = items[0] if items else None
            if chosen is None:
                raise RuntimeError(f"图片 ID {wanted_id} 未找到(可能已删除、无权限或 ID 有误)")
        if chosen is None:
            data = _sync_get_json("/images", params)
            items = data.get("items") or []
            if not items:
                raise RuntimeError("没有搜索结果,请调整筛选条件")
            idx = min(max(int(index), 0), len(items) - 1)
            chosen = items[idx]
        vids = chosen.get("modelVersionIds") or []
        vdata = _sync_get_json(f"/model-versions/{vids[0]}") if vids else {}
        # withMeta=true 已在 feed 条目带回生成参数;个别图未公开则留空
        # imageId 精确查询的响应会把参数再包一层 {id, meta:{...}},归一化取内层
        meta = chosen.get("meta") or {}
        if isinstance(meta, dict) and "prompt" not in meta and isinstance(meta.get("meta"), dict):
            meta = meta["meta"] or {}
        pos = meta.get("prompt") or ""
        neg = meta.get("negativePrompt") or ""
        lora_parts = [
            f"{r.get('name', '?')} × {r.get('weight', 1)}"
            for r in (meta.get("resources") or [])
            if (r.get("type") or "lora").lower() == "lora"
        ]
        # 触发词:资源里的 LoRA 若在本地库中已关联,取其触发词
        trigger = ", ".join(vdata.get("trainedWords") or [])
        # base_model 输出:选了具体底模时以输入为准,(any) 时用图片实际底模
        base = base_model if base_model != "(any)" else (vdata.get("baseModel") or base_model)
        # lora_name 输出:选定本地 lora 文件时原样输出(供直连 LoraLoader),否则空
        lora_name_out = lora_name if (lora_name and not lora_name.startswith("(auto)")) else ""
        img_bytes = _sync_download(chosen.get("url"))
        return (pos, neg, lora_parts and (", ".join(lora_parts)) or "", trigger, base,
                _bytes_to_tensor(img_bytes), lora_name_out)


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


class CivitaiShowText:
    """显示传入的文本(验证输出用),并原样透传给下游."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"text": ("STRING", {"forceInput": True})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"
    OUTPUT_NODE = True

    def run(self, text):
        return {"ui": {"text": [text]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {
    "CivitaiTriggerWords": CivitaiTriggerWords,
    "CivitaiImageSearch": CivitaiImageSearch,
    "CivitaiLoraRecipe": CivitaiLoraRecipe,
    "CivitaiShowText": CivitaiShowText,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CivitaiTriggerWords": "Civitai 触发词 (Trigger Words)",
    "CivitaiImageSearch": "Civitai 图片搜索 (Image Search)",
    "CivitaiLoraRecipe": "Civitai LoRA 配方 (LoRA Recipe)",
    "CivitaiShowText": "Civitai 显示文本 (Show Text)",
}
