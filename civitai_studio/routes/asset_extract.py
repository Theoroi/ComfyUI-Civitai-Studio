import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse

import aiohttp
import folder_paths
from aiohttp import web
from yarl import URL

from .. import (api_cache, cache_store, civitai_client, config, downloader, fav_sync,
                favorites_store as fs, local_index, media_meta)
from ..bg import spawn as bg_spawn
from ..version import VERSION, build
from ..log import info, warn, error
from .common import (  # noqa: F401 — 共享工具与跨区状态
    _parse_model_ref, _json_error, _ok, _read_json_dict, _scan_async,
    _ENUMS_TTL, _enums_cache, _VERSION_CACHE, _VERSION_TTL,
    _annotate_version, _annotate_items, _get, _post,
)

_ASSET_MAX_BYTES = 100 * 1024 * 1024


_EXTRACT_DIR = "workflows/civitai_studio"


_EXTRACT_WARN_COUNT = 300  # 子目录内提取文件数告警阈值(防泛滥软上限)


async def _download_asset_bytes(url):
    """异步下载原始文件(白名单域,重定向逐跳校验,≤100MB,Content-Type 白名单).
    已知取舍:单用户本地插件,响应全量驻内存(≤100MB×并发数)可接受,不做流式落盘."""
    timeout = aiohttp.ClientTimeout(total=180, connect=15)
    current = url
    for _hop in range(5):
        # 注意:不能用 allow_redirects=True —— aiohttp 自动跟随会让逐跳白名单形同虚设,
        # 且 Authorization 头不会被剥离,302 到外域就泄露 API Key
        async with await civitai_client.open_stream(current, timeout=timeout) as resp:
            if resp.status in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                # yarl join:基座=当前 URL,解析 Location(相对/绝对都正确);
                # 此前参数写反导致 current 恒等原 URL、每跳重复请求 → "重定向次数过多"
                current = str(URL(current).join(URL(resp.headers["Location"])))
                if not civitai_client.host_allowed_image(current):
                    return None, "重定向到不允许的地址"
                continue
            if resp.status != 200:
                return None, f"下载失败: HTTP {resp.status}"
            ctype = (resp.content_type or "").split(";")[0]
            if not (ctype.startswith("image/") or ctype.startswith("video/")):
                return None, "上游返回的不是图片/视频(可能被 WAF 拦截),可尝试更换代理节点"
            # 响应级全量读(至 Content-Length/EOF)。content.read(N) 是 readany 语义:
            # 有一个 buffer 的数据就短读返回 → 半截文件被当成功落盘(实测 1.9KB~8KB 截断 PNG)
            body = await resp.read()
            if len(body) > _ASSET_MAX_BYTES:
                return None, "文件超过 100MB 上限"
            cl = resp.headers.get("Content-Length")
            if cl and cl.isdigit() and len(body) != int(cl):
                return None, f"下载不完整({len(body)}/{cl} 字节),请重试"
            return body, None
    return None, "重定向次数过多"


def _url_ext(url):
    """已知简化:白名单外/无扩展名一律按 .png 落盘(浏览器/LoadImage 按内容嗅探可打开,
    仅文件名误导);跨扩展名同内容不去重(去重键=完整文件名)."""
    path = urllib.parse.urlparse(url).path
    ext = os.path.splitext(path)[1].lower()
    return ext if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".webm") else ".png"


_ASSET_IO_LOCK = threading.Lock()  # 选名+比对+写入全程串行:并发同 id 不再共享 tmp/TOCTOU


def _asset_save(image_id, ext, data):
    """civitai_<id> 命名 + hash 去重 + 落盘,一把锁内完成(同步实现,走 bg 线程池).
    同名同 SHA256 → 幂等跳过;同 id 内容不同 → civitai_<id>_x 递增;不同 id 互不影响."""
    import hashlib
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        import io as _io
        from PIL import Image
        try:
            im = Image.open(_io.BytesIO(data))
            im.load()  # 截断 PNG 会在解码时抛 OSError,挡在落盘前
            im.close()
        except Exception:
            raise ValueError("下载的图片不完整(解码失败,CDN/网络截断),请重试")
    h = hashlib.sha256(data).hexdigest()
    base = folder_paths.get_input_directory()
    d = os.path.join(base, "civitai_import")
    os.makedirs(d, exist_ok=True)
    with _ASSET_IO_LOCK:
        name = f"civitai_{image_id}{ext}"
        i = 0
        while True:
            p = os.path.join(d, name)
            if os.path.exists(p):
                try:
                    with open(p, "rb") as f:
                        if hashlib.sha256(f.read()).hexdigest() == h:
                            return name, h, True, p  # 同名同内容:幂等
                except OSError:
                    pass
                i += 1
                name = f"civitai_{image_id}_{i}{ext}"
                if i > 99:
                    raise ValueError("同名冲突过多,请清理 input/civitai_import")
                continue
            _write_file(p, data)
            return name, h, False, p


@_post("/civitai_studio/import_asset")
async def import_asset(request):
    """【导入为资产】:下载原始图片到 input/civitai_import/,命名 civitai_<id>(hash 去重).

    文件内嵌的工作流随文件可用(拖入 ComfyUI/LoadImage 皆可)."""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    url = str(body.get("url") or "")
    image_id = str(body.get("image_id") or "").strip()
    if not image_id.isdigit():
        return _json_error("缺少有效的图片 ID", 400)
    if not url.startswith(("http://", "https://")) or not civitai_client.host_allowed_image(url):
        return _json_error("不允许的图片地址", 400)
    try:
        data, err = await _download_asset_bytes(url)
    except Exception as e:
        return _json_error(f"下载失败: {civitai_client.net_error_message(e)}", 502)
    if err:
        return _json_error(err, 502)
    try:
        name, h, existed, target = await local_index.run_bg(_asset_save, image_id, _url_ext(url), data)
    except ValueError as e:
        return _json_error(str(e), 400)
    except OSError as e:
        return _json_error(f"写入失败: {e}", 500)
    return _ok(name=name, existed=existed, hash=h,
               dir=os.path.relpath(os.path.dirname(target), folder_paths.get_input_directory()))


def _write_file(path, data):
    """同步实现 — 经 run_bg(executor) 调用;tmp 带 tid,同进程多线程不共享 tmp."""
    tmp = "%s.%d.%d.tmp" % (path, os.getpid(), threading.get_ident())
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _extract_filepath(request, image_id, create_dir=True):
    """per-user 工作流目录:workflows/civitai_studio/extract_<id>.json."""
    um = getattr(PromptServer.instance, "user_manager", None)
    if um is None:
        return None
    try:
        return um.get_request_user_filepath(
            request, f"{_EXTRACT_DIR}/extract_{image_id}.json", create_dir=create_dir)
    except Exception:
        return None


@_post("/civitai_studio/extract_workflow")
async def extract_workflow(request):
    """【提取工作流】:下载原始文件,解析内嵌 workflow,存 per-user 工作流子目录.

    防泛滥:① 提取放 workflows/civitai_studio/ 子目录(模板浏览器非递归 glob,
    实测不会涌入模板列表);② extract_<id> 固定命名幂等覆盖,重复提取不膨胀;
    ③ 提供列表/删除管理端点;④ 超 300 个提示清理。"""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    url = str(body.get("url") or "")
    image_id = str(body.get("image_id") or "").strip()
    if not image_id.isdigit():
        return _json_error("缺少有效的图片 ID", 400)
    if not url.startswith(("http://", "https://")) or not civitai_client.host_allowed_image(url):
        return _json_error("不允许的图片地址", 400)
    ext = _url_ext(url)
    if ext not in (".png", ".mp4", ".mov"):
        return _json_error(f"该格式{ext}暂不支持提取(仅 PNG/MP4/MOV 内嵌工作流)", 415)
    try:
        data, err = await _download_asset_bytes(url)
    except Exception as e:
        return _json_error(f"下载失败: {civitai_client.net_error_message(e)}", 502)
    if err:
        return _json_error(err, 502)
    meta = await local_index.run_bg(media_meta.extract_from_bytes, data, ext)
    wf = (meta or {}).get("workflow")
    if isinstance(wf, str):
        try:
            wf = json.loads(wf)
        except ValueError:
            wf = None
    # 只认 UI 格式工作流(API 格式没有 nodes/links,存成模板会打不开)
    if not isinstance(wf, dict) or not wf.get("nodes"):
        return _json_error("该文件未内嵌 ComfyUI 工作流(站方脱敏且原文件无内嵌数据)", 404)
    target = _extract_filepath(request, image_id)
    if not target:
        return _json_error("无法定位用户工作流目录(user_manager 不可用)", 500)
    payload = json.dumps(wf, ensure_ascii=False)
    try:
        await local_index.run_bg(_write_file, target, payload.encode("utf-8"))
    except OSError as e:
        return _json_error(f"写入失败: {e}", 500)
    d = os.path.dirname(target)
    try:
        count = len([f for f in os.listdir(d) if f.endswith(".json")])
    except OSError:
        count = 0
    return _ok(name=os.path.basename(target), count=count,
               warn=("提取文件已达 {n} 个,建议清理".format(n=count) if count > _EXTRACT_WARN_COUNT else ""))


@_get("/civitai_studio/workflow_extracts")
async def workflow_extracts(request):
    target = _extract_filepath(request, "list", create_dir=False)  # 只读:不建目录
    d = os.path.dirname(target) if target else None
    out = []
    if d and os.path.isdir(d):
        for f in os.listdir(d):
            if not f.endswith(".json"):
                continue
            p = os.path.join(d, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            out.append({"name": f, "size": st.st_size, "mtime": st.st_mtime})
    out.sort(key=lambda x: -x["mtime"])
    return _ok(items=out)


@_post("/civitai_studio/workflow_extracts/delete")
async def workflow_extracts_delete(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    name = os.path.basename(str(body.get("name") or ""))
    if not re.fullmatch(r"extract_\d+\.json", name):
        return _json_error("仅允许删除 extract_<id>.json", 400)
    target = _extract_filepath(request, name[len("extract_"):-len(".json")])
    if not target or not os.path.isfile(target):
        return _json_error("文件不存在", 404)
    try:
        os.remove(target)
    except OSError as e:
        return _json_error(f"删除失败: {e}", 500)
    return _ok()


