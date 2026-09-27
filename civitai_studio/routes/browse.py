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

@_get("/civitai_studio/resolve_versions")
async def resolve_versions(request):
    """批量解析 model-versions:返回 vid → {AutoV3, modelId, modelName, versionName, type, baseModel}.

    大图详情用它把 meta.resources(modelId 常为 null)/civitaiResources/modelVersionIds
    解析成可跳转的模型信息;缓存避免重复请求。
    """
    raw = request.query.get("ids", "")
    ids = [s.strip() for s in raw.split(",") if s.strip().isdigit()][:20]
    if not ids:
        return _json_error("ids 必须是逗号分隔的数字", 400)
    out = {}
    now = time.time()
    fetch_list = []
    for vid in ids:
        hit = _VERSION_CACHE.get(vid)
        if hit and now - hit[0] < _VERSION_TTL:
            out[vid] = hit[1]
        else:
            fetch_list.append(vid)
    if fetch_list:
        import asyncio as _asyncio

        async def fetch_one(vid):
            try:
                data = await civitai_client.get_version_cached(vid)
                files = data.get("files") or [{}]
                mv = data.get("model") or {}
                model_id = data.get("modelId") or mv.get("id")  # 镜像响应只有 modelId 顶层字段
                model_name = mv.get("name") or ""
                if model_id and not model_name:
                    # 名称缺失时补查模型详情(仍走缓存)
                    try:
                        mdata = await civitai_client.get_model_cached(str(model_id))
                        model_name = mdata.get("name") or ""
                    except Exception:
                        pass
                info = {
                    "AutoV3": (files[0].get("hashes") or {}).get("AutoV3") or "",
                    "modelId": model_id,
                    "modelName": model_name,
                    "versionName": data.get("name") or "",
                    "baseModel": data.get("baseModel") or "",
                }
            except Exception as e:
                info = {"error": civitai_client.net_error_message(e) if not isinstance(e, civitai_client.CivitaiError) else str(e)}
            _VERSION_CACHE[vid] = (now, info)
            if len(_VERSION_CACHE) > _VERSION_CACHE_MAX:
                oldest = min(_VERSION_CACHE, key=lambda k: _VERSION_CACHE[k][0])
                _VERSION_CACHE.pop(oldest, None)
            out[vid] = info

        await _asyncio.gather(*(fetch_one(vid) for vid in fetch_list))
    return web.json_response({"versions": out})


@_get("/civitai_studio/search")
async def search_models(request):
    q = request.query
    try:
        params = {
            "limit": min(60, max(1, int(q.get("limit", "24")))),
            # Civitai 新 API 的 nsfw 是布尔开关(zod 校验):数字字符串会被 400,映射为 true/false
            "nsfw": "true" if str(q.get("nsfw", "1")) not in ("0", "false") else "false",
        }
    except ValueError:
        return _json_error("limit 必须是数字", 400)
    # 注意:不要传 page 参数——镜像站带 page 时会走预物化热榜路径,忽略全部筛选;
    # 翻页用 cursor(metadata.nextCursor)透传。
    if q.get("cursor"):
        params["cursor"] = q["cursor"]
    for key in ("query", "types", "baseModels", "sort", "period"):
        if q.get(key):
            params[key] = q[key]
    try:
        data = await civitai_client.get_json("/models", params=params)
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    index = await _scan_async(False)
    return web.json_response(_annotate_items(data, index))


@_get("/civitai_studio/model/{mid}")
async def model_detail(request):
    mid = request.match_info["mid"]
    if not mid.isdigit():
        return _json_error("模型 ID 必须是数字", 400)
    try:
        data = await civitai_client.get_model_cached(mid)
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    index = await _scan_async(False)
    return web.json_response(_annotate_items({"items": [data]}, index)["items"][0])


@_get("/civitai_studio/images")
async def version_images(request):
    """代理 /images:模型版本预览 + 社区画廊(不传 modelVersionId 时为全站图片流)."""
    q = request.query
    params = {}
    if q.get("modelVersionId"):
        params["modelVersionId"] = q["modelVersionId"]
    if q.get("imageId"):
        params["imageId"] = q["imageId"]
    try:
        params["limit"] = min(100, max(1, int(q.get("limit", "20"))))
    except ValueError:
        return _json_error("limit 必须是数字", 400)
    if q.get("cursor"):
        params["cursor"] = q["cursor"]
    if q.get("username"):
        params["username"] = q["username"]
    if q.get("postId"):
        params["postId"] = q["postId"]
    for key in ("baseModels", "tags"):
        if q.get(key):
            params[key] = q[key]
    # 官方文档:meta 需 withMeta=true 显式请求,否则 feed 条目一律不带生成参数
    params["withMeta"] = "true"
    if q.get("sort"):
        params["sort"] = q["sort"]
    if q.get("period"):
        params["period"] = q["period"]
    if q.get("nsfw"):
        # 与搜索同档位;新 API 是布尔开关,映射后再透传
        params["nsfw"] = "false" if q["nsfw"] in ("0", "false") else "true"
    try:
        data = await civitai_client.get_images_page(params)
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    # images 接口的翻页在 metadata.nextPage(完整 URL):解析成查询对回传给前端
    next_page = ((data.get("metadata") or {}).get("nextPage")) or ""
    next_query = []
    if next_page:
        try:
            parsed = urllib.parse.urlparse(next_page)
            next_query = urllib.parse.parse_qsl(parsed.query)
        except Exception:
            next_query = []
    return web.json_response({"items": data.get("items", []), "next_query": next_query})


@_get("/civitai_studio/enums")
async def enums(request):
    """代理站方枚举(ModelType/ActiveBaseModel/BaseModel...):内存 6h + 磁盘 24h SWR."""
    global _enums_cache
    now = time.time()
    if _enums_cache["data"] is None or now - _enums_cache["ts"] > _ENUMS_TTL:
        try:
            data = await civitai_client.get_enums_cached()
        except civitai_client.CivitaiError as e:
            if _enums_cache["data"] is not None:  # 失败时回退旧缓存
                return web.json_response(_enums_cache["data"])
            return _json_error(e, 502)
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            if _enums_cache["data"] is not None:
                return web.json_response(_enums_cache["data"])
            return _json_error(civitai_client.net_error_message(e), 502)
        _enums_cache = {"data": data, "ts": now}
    return web.json_response(_enums_cache["data"])


@_get("/civitai_studio/version/{vid}")
async def version_detail(request):
    """单个版本的完整数据(含 images.meta — 列表接口在镜像上被剥掉,这里保留)."""
    vid = request.match_info["vid"]
    if not vid.isdigit():
        return _json_error("版本 ID 必须是数字", 400)
    try:
        data = await civitai_client.get_version_cached(vid)
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    return web.json_response(data)


