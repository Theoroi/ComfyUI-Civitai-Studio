"""Civitai Studio 功能节点(与本地库/在线数据打通).

节点里发网络请求用独立事件循环 + 独立会话(不碰主循环的共享会话);
代理仅支持 HTTP 形态(socks 需在设置里改用 HTTP 端口)。
CivitaiImageSearch.run 为 async:网络耗时部分经 asyncio.to_thread 进入
线程池执行,避免阻塞 ComfyUI 主事件循环。
"""

import asyncio
import io
import json
import os
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


class CivitaiImageSearch:
    """搜索社区图片(关键字/底模/tag/排序/时间),输出选中图片的生成配方与图像."""

    @classmethod
    def INPUT_TYPES(cls):
        # image_id 放首位:值由前端信息面板的输入行/[选为输出]维护,poll 会隐藏本行渲染
        # (必须保留在 INPUT_TYPES:执行链路按名传参,且序列化依赖 widget 存在)
        return {"required": {
            "image_id": ("STRING", {"default": "(index)"}),
            "base_model": (["(any)"] + sorted(_BASE_MODEL_OPTIONS, key=str.lower),),
            "nsfw": (["false", "true"],),
            # 多选标签存储:前端选择器(chips+下拉+自由输入)维护的逗号分隔名称串(隐藏)。
            # 旧版单个 tag COMBO 已删除,由本字段承担全部筛选语义(OR/实验 AND)
            "tags_selected": ("STRING", {"default": ""}),
            "period": (["AllTime", "Month", "Week", "Day"],),
            "sort": (["Newest", "Most Reactions", "Most Comments"],),
            "limit": ("INT", {"default": 50, "min": 10, "max": 100, "step": 10}),
            "index": ("INT", {"default": 0, "min": 0, "max": 199}),
        },
        # 面板布局参数:仅前端渲染使用,optional 保证旧 API 调用不因缺参被拒
        "optional": {
            # 缩略图统一行高:选项带 px 单位,前端 parseInt 取数值;键名必须与 run 的
            # thumbs_height 参数一致(ComfyUI 按名传参,不一致直接 TypeError)
            "thumbs_height": (["128px", "256px", "512px"],),
            "panel_h": ("INT", {"default": 420, "min": 160, "max": 1600, "step": 20}),
        }}

    # base_model 用 COMBO:加载器(UNET/Checkpoint)的模型字段 widget 转成输入口后
    # 类型是 COMBO,前端实测拒绝 STRING→COMBO 连线、放行 COMBO→COMBO
    RETURN_TYPES = ("STRING", "STRING", "STRING", "COMBO", "IMAGE")
    RETURN_NAMES = ("positive", "negative", "trigger_words", "local_checkpoint", "image")
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"

    @staticmethod
    def VALIDATE_INPUTS(image_id, tags_selected):
        # image_id/tags_selected 都是动态值(最近浏览记录/本地标签映射,随前端操作增长),
        # 跳过 ComfyUI 对 COMBO 的静态"值不在列表"校验
        return True

    async def run(self, image_id, base_model, nsfw, tags_selected, period, sort,
                  limit, index, thumbs_height, panel_h):
        # 网络与下载均为阻塞调用,丢进线程池避免冻结 ComfyUI 主事件循环
        return await asyncio.to_thread(
            self._run_sync, image_id, base_model, nsfw, tags_selected, period, sort, limit, index)

    def _run_sync(self, image_id, base_model, nsfw, tags_selected, period, sort, limit, index):
        params = {
            "limit": str(min(100, max(10, int(limit)))),
            "nsfw": str(nsfw), "sort": sort, "period": period, "withMeta": "true",
        }
        if base_model and base_model != "(any)":
            params["baseModels"] = base_model
        # 多选标签(tags_selected,前端选择器维护)。
        # 官方 /images 的 tags 只认逗号分隔的数字 Tag ID;名称经本地映射换 ID。
        # 多标签为任一命中(OR 语义,Civitai API 限制)
        tag_expr = (tags_selected or "").strip()
        if tag_expr and tag_expr != "(none)":
            tokens = [t.strip() for t in tag_expr.replace("，", ",").split(",") if t.strip()]
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
        # 触发词:资源里的 LoRA 若在本地库中已关联,取其触发词
        trigger = ", ".join(vdata.get("trainedWords") or [])
        # base_model 输入仍按 Civitai 底模筛选;/images 结果的底模名兜底
        base = base_model if base_model != "(any)" else (vdata.get("baseModel") or base_model)
        # 底模输出(曾为诱饵连线:直接输出 Civitai 底模名,连加载器必报"值不在列表")。
        # 现改为解析本地已安装的 checkpoint 文件名,三级匹配:version_id 精确 >
        # model_id 同模型 > base_model 兜底;全未命中输出 "(none)"
        local_ckpt = "(none)"
        try:
            idx = local_index.scan()
            ckpts = [m for m in idx["models"]
                     if m.get("category") in ("checkpoints", "diffusion_models", "unet")]
            side = lambda m: (m.get("civitai") or {})  # noqa: E731
            want_vid = str(vids[0]) if vids else ""
            want_mid = str(vdata.get("modelId") or "")
            hit = (next((m for m in ckpts if want_vid and str(side(m).get("version_id") or "") == want_vid), None)
                   or next((m for m in ckpts if want_mid and str(side(m).get("model_id") or "") == want_mid), None)
                   or next((m for m in ckpts if side(m).get("base_model") == base), None))
            if hit:
                local_ckpt = hit.get("rel") or hit.get("name") or "(none)"  # 子目录模型用相对路径
        except Exception:
            pass
        img_bytes = _sync_download(chosen.get("url"))
        return (pos, neg, trigger, local_ckpt, _bytes_to_tensor(img_bytes))


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


class CivitaiSaveImage:
    """保存 PNG 并写入 Civitai 兼容元数据:ComfyUI prompt/workflow + A1111 parameters 行
    (含模型/LoRA 的 SHA256,经本地索引 sidecar 解析)。hash 拿不到时显式标注
    "hash unknown" 并打印警告,不静默。上传 Civitai 可自动挂接全部资源。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "civitai_studio/ComfyStudio"}),
                "write_metadata": (["true", "false"],),
            },
            "optional": {
                # 可连 图像搜索 的 positive/negative;不连时从工作流节点尽力提取
                "positive": ("STRING", {"forceInput": True}),
                "negative": ("STRING", {"forceInput": True}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = "Civitai Studio"
    OUTPUT_NODE = True

    # ---- 工作流解析(尽力而为,失败留空不抛错) ----
    @staticmethod
    def _find_sampler(prompt):
        for node in (prompt or {}).values():
            ct = str(node.get("class_type") or "")
            if "KSampler" in ct or "SamplerCustom" in ct:
                return node.get("inputs") or {}
        return {}

    @classmethod
    def _extract_texts(cls, prompt):
        """沿 KSampler 的 positive/negative 连线取 CLIPTextEncode 的 text."""
        inputs = cls._find_sampler(prompt)

        def text_of(ref):
            if not isinstance(ref, list) or len(ref) < 2:
                return str(ref or "")
            node = (prompt or {}).get(str(ref[0])) or {}
            return str((node.get("inputs") or {}).get("text") or "")

        return text_of(inputs.get("positive")), text_of(inputs.get("negative"))

    @staticmethod
    def _resolve_hashes(prompt):
        """从 API prompt 抽 ckpt/lora 文件名,经本地索引 sidecar 查 SHA256.
        返回 (model_hash, model_name, lora_pairs, missing_list)。"""
        unknown = "(hash unknown)"
        idx = local_index.scan()
        by_name, by_rel = {}, {}
        for m in idx["models"]:
            by_name[m["name"].lower()] = m
            by_rel[(m.get("rel") or "").lower()] = m

        def sha_of(fname):
            item = by_rel.get(str(fname).lower()) or by_name.get(os.path.basename(str(fname)).lower())
            side = (item or {}).get("civitai") or {}
            return side.get("sha256"), item, bool(side.get("sha256"))

        model_hash, model_name, lora_pairs, missing = unknown, "", [], []
        for node in (prompt or {}).values():
            ct = str(node.get("class_type") or "")
            inputs = node.get("inputs") or {}
            if "CheckpointLoader" in ct and inputs.get("ckpt_name"):
                name = str(inputs["ckpt_name"])
                sha, item, ok = sha_of(name)
                model_hash = sha if ok else unknown
                model_name = ((item or {}).get("civitai") or {}).get("model_name") or os.path.basename(name)
                if not ok:
                    missing.append(f"{name}(无 SHA256:本地库未关联或非本插件下载)")
            elif ct == "LoraLoader" and inputs.get("lora_name"):
                name = str(inputs["lora_name"])
                sha, item, ok = sha_of(name)
                disp = ((item or {}).get("civitai") or {}).get("model_name") or os.path.basename(name)
                lora_pairs.append((disp, sha if ok else unknown))
                if not ok:
                    missing.append(f"{name}(无 SHA256)")
        return model_hash, model_name, lora_pairs, missing

    def run(self, images, filename_prefix="civitai_studio/ComfyStudio", write_metadata="true",
            positive=None, negative=None, prompt=None, extra_pnginfo=None):
        import numpy as np
        from PIL import Image
        from PIL.PngImagePlugin import PngInfo

        output_dir = folder_paths.get_output_directory()
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, output_dir, images.shape[1], images.shape[0], images.shape[1] if images.ndim < 4 else 3)

        pnginfo = None
        if write_metadata == "true":
            pos_api, neg_api = self._extract_texts(prompt)
            pos = (positive or "").strip() or pos_api
            neg = (negative or "").strip() or neg_api
            model_hash, model_name, lora_pairs, missing = self._resolve_hashes(prompt)
            inp = self._find_sampler(prompt)
            bits = []
            try:
                bits.append(f"Steps: {int(inp.get('steps'))}")
            except (TypeError, ValueError):
                pass
            if inp.get("sampler_name"):
                bits.append(f"Sampler: {inp.get('sampler_name')}")
            try:
                bits.append(f"CFG scale: {float(inp.get('cfg'))}")
            except (TypeError, ValueError):
                pass
            seed = inp.get("seed", inp.get("noise_seed"))
            if seed is not None:
                bits.append(f"Seed: {seed}")
            bits.append(f"Model hash: {model_hash}")
            if model_name:
                bits.append(f"Model: {model_name}")
            if lora_pairs:
                bits.append("Lora hashes: " + ", ".join(f'"{n}: {h}"' for n, h in lora_pairs))
            params = pos
            if neg:
                params = (params + "\n" if params else "") + "Negative prompt: " + neg
            if bits:
                params = (params + ", " if params else "") + ", ".join(bits)
            if missing:
                print("[Civitai-Studio] 保存警告(元数据 hash 缺失): " + "; ".join(missing))

            pnginfo = PngInfo()
            if params:
                pnginfo.add_text("parameters", params)
            if prompt is not None:
                pnginfo.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo:
                for k, v in extra_pnginfo.items():
                    pnginfo.add_text(k, v if isinstance(v, str) else json.dumps(v))
            if missing:
                pnginfo.add_text("cs_hash_warnings", "; ".join(missing))

        results = []
        for i in range(images.shape[0]):
            arr = (images[i].cpu().numpy() * 255.0).clip(0, 255).astype("uint8")
            file = f"{filename}_{counter + i:05}_.png"
            Image.fromarray(arr).save(os.path.join(full_output_folder, file), pnginfo=pnginfo, compress_level=4)
            results.append({"filename": file, "subfolder": subfolder, "type": "output"})
        return {"ui": {"images": results}, "result": ()}


NODE_CLASS_MAPPINGS = {
    "CivitaiImageSearch": CivitaiImageSearch,
    "CivitaiLoraRecipe": CivitaiLoraRecipe,
    "CivitaiShowText": CivitaiShowText,
    "CivitaiSaveImage": CivitaiSaveImage,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CivitaiImageSearch": "Civitai 图片搜索 (Image Search)",
    "CivitaiLoraRecipe": "Civitai LoRA 配方 (LoRA Recipe)",
    "CivitaiShowText": "Civitai 显示文本 (Show Text)",
    "CivitaiSaveImage": "Civitai 保存图片 (Save · meta+hash)",
}
