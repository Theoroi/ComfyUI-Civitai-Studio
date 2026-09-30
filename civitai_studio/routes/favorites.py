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
    """分组赋值:group_ids 数组=多选挂载(跨集合多挂);兼容旧 group_id 单值。"""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    kind = str(body.get("kind") or fs.KIND_ASSET)
    oid = str(body.get("oid") or "")
    if not oid:
        return _json_error("缺少 oid", 400)
    gids = body.get("group_ids")
    if not isinstance(gids, list):
        gid = body.get("group_id")
        gids = [gid] if gid else []
    gids = [str(g) for g in gids if g]
    # 批4 F1:记 UI 实际下发的分组(带组名),排"误挂系统集合"类反馈时有据可查
    names = {g["gid"]: g["name"] for g in await local_index.run_bg(fs.groups_list)}
    info("[Civitai-Studio] [UI] 分组赋值: %s %s → [%s]" % (
        kind, oid, ", ".join("%s(%s)" % (g, names.get(g, "?")) for g in gids) or "无"))
    n = await local_index.run_bg(fs.set_memberships, kind, oid, gids)
    return _ok(changed=n)


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
        remote_deleted = False
        remote_err = ""
        if body.get("remote"):  # 连远端:必须前端弹窗确认后才会带此标记
            g = next((g for g in await local_index.run_bg(fs.groups_list) if g["gid"] == gid), None)
            cid = (g or {}).get("civitai_id")
            if cid:
                try:
                    await civitai_client.trpc_mutation("collection.delete", {"id": int(cid)})
                    remote_deleted = True
                except Exception as e:
                    remote_err = str(e)[:160]
        await local_index.run_bg(fs.delete_group, gid)
        return _ok(remote_deleted=remote_deleted, remote_error=remote_err)
    if not name:
        return _json_error("缺少分组名", 400)
    if not gid:  # 批4 E2E 5b:同名组直接复用,杜绝"同名不同 id"的本地分叉(上行再造远端重复)
        hit = next((x for x in await local_index.run_bg(fs.groups_list)
                    if (x["name"] or "").strip() == name), None)
        if hit:
            return _ok(group=hit, existed=True)
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


@_post("/civitai_studio/favorites/reset")
async def favorites_reset(request):
    """收藏库全量重置(批A):三表清空+缓存清除,下次同步全量重新下拉。
    ⚠️ 本地★一并清除 — 前端弹窗强制确认并建议先导出。"""
    await local_index.run_bg(fs.reset_all)
    info("[Civitai-Studio] 收藏库已重置(全清),下次同步全量重新下拉")
    return _ok()


@_post("/civitai_studio/favorites/sync")
async def favorites_sync(request):
    """手动/自动同步入口:能力矩阵见 docs/research/favorites-api-research.md。"""
    result = await fav_sync.sync_now()
    return web.json_response({"status": result.get("status", "ok"), **result})


