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

def _scope_of(root: str) -> str:
    """按注册根与当前实例安装目录(folder_paths.base_path)的关系归类:
    install=本实例目录内;shared=extra_model_paths 等共享路径。不猜路径名。"""
    try:
        base = os.path.realpath(folder_paths.base_path)
        rp = os.path.realpath(root)
    except OSError:
        return "shared"
    if rp == base or rp.lower().startswith(base.lower() + os.sep):
        return "install"
    return "shared"


def _scopes() -> list:
    """[实例]下拉选项:共享目录在前,其后当前安装实例(按实际注册根归类)."""
    try:
        name = os.path.basename(os.path.realpath(folder_paths.base_path)) or "ComfyUI"
    except Exception:
        name = "ComfyUI"
    return [
        {"id": "shared", "label": "共享目录 (extra_model_paths)"},
        {"id": "install", "label": f"本实例 ({name})"},
    ]


@_get("/civitai_studio/destinations")
async def destinations(request):
    ctype = request.query.get("type", "Checkpoint")
    if ctype == "all":
        keys = local_index.categories()
    else:
        keys = local_index.TYPE_TO_FOLDERS.get(ctype)
        if keys is None:
            # 未映射类型(Other/Poses 等)回退全部注册目录,保证仍可下载
            keys = local_index.categories()
    out = []
    seen_roots = set()
    for key in keys:
        if key not in folder_paths.folder_names_and_paths:
            continue
        for root in local_index.roots_for(key):
            rp = os.path.normpath(root)
            if rp in seen_roots:
                continue
            seen_roots.add(rp)
            out.append({"key": key, "root": root, "label": f"{key} · {root}", "scope": _scope_of(root)})
    resp: dict = {"destinations": out}
    if ctype == "all":
        # 下载/移动框"模型类型"覆盖与"实例"下拉用
        resp["type_map"] = {k: list(v) for k, v in local_index.TYPE_TO_FOLDERS.items()}
        resp["scopes"] = _scopes()
    return web.json_response(resp)


@_post("/civitai_studio/download")
async def start_download(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    try:
        job = downloader.enqueue(body)
    except ValueError as e:
        return _json_error(e, 400)
    return web.json_response({"status": "ok", "job": job})


@_get("/civitai_studio/downloads")
async def list_downloads(request):
    return web.json_response({"jobs": downloader.get_state()})


@_post("/civitai_studio/downloads/cancel")
async def cancel_download(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    ok = downloader.cancel(str(body.get("id", "")))
    return _ok(cancelled=ok)


@_post("/civitai_studio/downloads/retry")
async def retry_download(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    try:
        job = downloader.retry(str(body.get("id", "")))
    except ValueError as e:
        return _json_error(e, 400)
    return _ok(job=job)


@_post("/civitai_studio/downloads/clear")
async def clear_downloads(request):
    downloader.clear_finished()
    return _ok()


@_post("/civitai_studio/save_image")
async def save_image(request):
    """把 Civitai 预览图存入 ComfyUI output 目录."""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    url = str(body.get("url") or "")
    if not url.startswith(("http://", "https://")) or not civitai_client.host_allowed_image(url):
        return _json_error("不允许的图片地址", 400)
    base = urllib.parse.urlparse(url).path.rstrip("/").split("/")[-1] or "preview"
    base = re.sub(r"[^A-Za-z0-9._\-一-龥]", "_", base)[:80]
    fname = "civitai_" + str(int(time.time())) + "_" + base
    if not os.path.splitext(fname)[1]:
        fname += ".jpeg"
    out_dir = folder_paths.get_output_directory()
    out_path = os.path.join(out_dir, fname)
    try:
        timeout = aiohttp.ClientTimeout(total=120, connect=10)
        async with civitai_client.open_isolated_stream(url, timeout=timeout) as resp:
            if resp.status != 200:
                return _json_error(f"HTTP {resp.status}", 502)
            ctype = (resp.content_type or "").split(";")[0]
            if not ctype.startswith("image/") and not ctype.startswith("video/"):
                return _json_error("上游返回的不是图片/视频(可能被 WAF 拦截)", 502)
            ext = {"image/jpeg": ".jpeg", "image/png": ".png", "image/webp": ".webp",
                   "video/mp4": ".mp4"}.get(ctype, ".jpeg")
            if not os.path.splitext(fname)[1]:
                fname += ext
                out_path += ext
            with open(out_path, "wb") as f:
                total = 0
                while True:
                    chunk = await resp.content.read(512 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > 200 * 1024 * 1024:
                        f.close()
                        os.remove(out_path)
                        return _json_error("文件超过 200MB 上限", 502)
                    f.write(chunk)
    except Exception as e:
        return _json_error(f"保存失败: {civitai_client.net_error_message(e)}", 502)
    return _ok(filename=fname, path=out_path)


