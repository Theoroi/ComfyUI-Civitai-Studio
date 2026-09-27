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

@_get("/civitai_studio/favorites")
async def favorites_get(request):
    """兼容轻量版(ids=资产 id 列表,画廊★过滤用)+ 完整 items/groups。"""
    items = await local_index.run_bg(fs.list_items, None, None)
    assets = [it for it in items if it["kind"] == fs.KIND_ASSET]
    models = [it for it in items if it["kind"] == fs.KIND_MODEL]
    groups = await local_index.run_bg(fs.groups_list)
    return web.json_response({
        "status": "ok",
        "ids": [it["oid"] for it in assets],
        "model_ids": [it["oid"] for it in models],
        "items": items,
        "groups": groups,
    })


@_post("/civitai_studio/favorites/toggle")
async def favorites_toggle(request):
    """兼容轻量版 {id}(资产);扩展 {kind, oid, name, cover, extra}。"""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    kind = str(body.get("kind") or fs.KIND_ASSET)
    if kind not in (fs.KIND_MODEL, fs.KIND_ASSET):
        return _json_error("kind 必须是 model 或 asset", 400)
    oid = str(body.get("oid") or body.get("id") or "").strip()
    if not oid or not oid.isdigit():
        return _json_error("缺少有效的数字 id", 400)
    fields = {k: body.get(k) for k in ("group_id", "name", "cover", "extra") if body.get(k) is not None}
    fav = await local_index.run_bg(fs.toggle, kind, oid, fields)
    return _ok(fav=fav, kind=kind, oid=oid)


@_post("/civitai_studio/favorites/assign")
async def favorites_assign(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    kind = str(body.get("kind") or fs.KIND_ASSET)
    oid = str(body.get("oid") or "")
    if not oid:
        return _json_error("缺少 oid", 400)
    gid = body.get("group_id")
    await local_index.run_bg(fs.set_group, kind, oid, (str(gid) if gid else None))
    return _ok()


@_post("/civitai_studio/favorites/groups")
async def favorites_groups(request):
    """建组/改名:{gid?, name};删除:{gid, delete:true}。"""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    name = str(body.get("name") or "").strip()
    gid = str(body.get("gid") or "") or None
    if body.get("delete"):
        if not gid:
            return _json_error("缺少 gid", 400)
        await local_index.run_bg(fs.delete_group, gid)
        return _ok()
    if not name:
        return _json_error("缺少分组名", 400)
    g = await local_index.run_bg(fs.upsert_group, name, gid, None, 1)  # 本地建/改:dirty=1 待上行
    return _ok(group=g)


@_get("/civitai_studio/favorites/export")
async def favorites_export(request):
    payload = await local_index.run_bg(fs.export_json)
    return web.json_response(
        payload,
        headers={"Content-Disposition": "attachment; filename=civitai_studio_favorites.json"},
    )


@_post("/civitai_studio/favorites/import")
async def favorites_import(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    payload = body.get("payload")
    if payload is None and ("items" in body or "groups" in body):
        payload = body  # 直接粘贴导出文件内容也可
    if not isinstance(payload, dict):
        return _json_error("payload 必须是导出文件的对象", 400)
    try:
        n = await local_index.run_bg(fs.import_json, payload, bool(body.get("replace")))
    except (ValueError, RuntimeError) as e:
        return _json_error(str(e), 400)
    return _ok(imported=n)


@_post("/civitai_studio/favorites/sync")
async def favorites_sync(request):
    """手动/自动同步入口:能力矩阵见 docs/research/favorites-api-research.md。"""
    result = await fav_sync.sync_now()
    return web.json_response({"status": result.get("status", "ok"), **result})


