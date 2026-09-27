"""路由公共工具与跨区状态(所有子模块经 from .common import 引用)."""

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
from ..mem_lru import MemLru

try:
    from server import PromptServer
    _routes = PromptServer.instance.routes if PromptServer.instance else None

    # ComfyUI 自身的 /api/extensions 响应没有 Cache-Control,Electron webview 会按启发式
    # 把扩展清单缓存住:服务端更新后页面仍加载旧 JS 文件名。显式 no-store 才能压住。
    if PromptServer.instance:
        from aiohttp import web as _web

        @_web.middleware
        async def _no_cache_ext_middleware(request, handler):
            resp = await handler(request)
            if request.path.startswith(("/api/extensions", "/extensions/")):
                resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return resp

        PromptServer.instance.app.middlewares.append(_no_cache_ext_middleware)

        async def _shutdown_close(_app):
            # 退出清理(裁决①):关共享 aiohttp session;短暂让步给 retire 延迟关闭
            await civitai_client.close_session()
            await asyncio.sleep(0.15)

        PromptServer.instance.app.on_shutdown.append(_shutdown_close)
except Exception:
    _routes = None

if _routes is not None:
    ROUTES = None  # 生产:路由由 PromptServer 托管,无清单(契约测试跑桩分支才有)
    def _get(path):
        return _routes.get(path)

    def _post(path):
        return _routes.post(path)
else:
    # 无 PromptServer(测试/裸 import):只登记路由清单供契约测试快照,不做任何挂载
    ROUTES = []  # [(method, path), ...]
    def _get(path):
        ROUTES.append(("GET", path))
        return lambda fn: fn
    def _post(path):
        ROUTES.append(("POST", path))
        return lambda fn: fn




_enums_cache = {"data": None, "ts": 0.0}


_ENUMS_TTL = 6 * 3600.0


def reset_enums_cache():
    """清空缓存时重置枚举缓存(from-import 各持全局,必须经此函数原地/重置)."""
    global _enums_cache
    _enums_cache = {"data": None, "ts": 0.0}


def _parse_model_ref(text):
    """从页面链接或纯数字里提取 (model_id, version_id|None)。

    支持: https://civitai.com/models/12345、...?modelVersionId=678、纯 '12345'。
    下载直链(api/download/models/)不是模型页,单独拦截。
    """
    t = str(text or "").strip()
    if not t:
        return None, None
    if re.search(r"download/models/\d+", t):
        raise ValueError("请粘贴模型页链接(models/数字),而不是下载直链")
    m = re.search(r"models/(\d+)", t)
    mid = m.group(1) if m else (t if t.isdigit() else None)
    mv = re.search(r"modelVersionId=(\d+)", t)
    vid = mv.group(1) if mv else None
    return mid, vid


def _json_error(message, status=500):
    return web.json_response({"error": str(message)}, status=status)


def _ok(**kw):
    return web.json_response({"status": "ok", **kw})


async def _read_json_dict(request):
    """解析请求体,必须是 JSON 对象;否则返回 None(调用方回 400)."""
    try:
        body = await request.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


async def _scan_async(force=False, deep=False):
    return await local_index.run_bg(local_index.scan, force, deep)


_VERSION_CACHE = MemLru(200)  # C-1:共享 MemLru,条目 TTL 10min


_VERSION_TTL = 600.0


def _annotate_version(version, index):
    """给 modelVersion 打上 local(已安装位置)标记."""
    hits = []
    item = index["by_version"].get(str(version.get("id")))
    if item:
        hits.append(item)
    else:
        for f in version.get("files") or []:
            cands = index["by_name"].get((f.get("name") or "").lower())
            if cands:
                hits.extend(cands)
    if hits:
        first = hits[0]
        version["local"] = {
            "id": first["id"], "category": first["category"], "rel": first["rel"],
            "name": first["name"], "path": first["path"],
        }
    return bool(hits)


def _annotate_items(data, index):
    """标注安装状态。nsfw 参数保持 0/1/2 数字档位:镜像站(civitai.red)实测可用,
    官方站的枚举口径如有出入再按需映射。"""
    try:
        for model in data.get("items", []):
            model["installed"] = False
            for v in model.get("modelVersions", []):
                if _annotate_version(v, index):
                    model["installed"] = True
    except AttributeError:
        pass
    return data


