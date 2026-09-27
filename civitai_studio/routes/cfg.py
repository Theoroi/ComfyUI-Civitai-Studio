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

@_get("/civitai_studio/version")
async def version_route(request):
    """前端用它对照自身版本,检测"服务端还是重启前的旧代码"."""
    return web.json_response({"version": VERSION, "build": build()})


_TAG_MAPPING_FILE = os.path.join(config._CONFIG_DIR, "tag_mapping.json")


_TAG_FETCH_STATE = {"fails": 0, "paused_until": 0.0}


_TAG_FAIL_LIMIT = 3


_TAG_PAUSE_SEC = 600


def _tag_fetch_fail():
    st = _TAG_FETCH_STATE
    st["fails"] += 1
    if st["fails"] >= _TAG_FAIL_LIMIT:
        st["paused_until"] = time.time() + _TAG_PAUSE_SEC
        st["fails"] = 0


def _tag_fetch_paused():
    now = time.time()
    if _TAG_FETCH_STATE["paused_until"] > now:
        return int(_TAG_FETCH_STATE["paused_until"] - now)
    return 0


def _load_tag_mapping():
    """读 tag 映射(DB 真值);首调把 0.7.x 的 tag_mapping.json 一次性导入(文件只读保留)."""
    mapping = cache_store.tag_map_all()
    if mapping or cache_store.kv_get("tagmap:migrated_v1"):
        return mapping
    try:
        with open(_TAG_MAPPING_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data:
            pairs = [(str(k), int(v)) for k, v in data.items()
                     if str(k).strip() and str(v).lstrip("-").isdigit()]
            cache_store.tag_map_put(pairs)
            mapping = cache_store.tag_map_all()
    except Exception as e:
        error(f"[Civitai-Studio] 旧 tag 映射文件读取失败(跳过迁移): {e}")
    cache_store.kv_put("tagmap:migrated_v1", True)
    return mapping


def _save_tag_pairs(pairs):
    """增量 upsert 新映射(不再整文件重写;多实例 WAL 安全)."""
    cache_store.tag_map_put(pairs)


@_get("/civitai_studio/image_tags/{image_id}")
async def image_tags(request):
    """抓取图片的分类 tag(id+名称)并累积到本地映射.

    分类 tags 不在 /api/v1/images 返回里,网页端图片页用
    trpc tag.getVotableTags 取,这里复刻同一条链路.
    """
    image_id = request.match_info["image_id"]
    if not (image_id.isascii() and image_id.isdigit()):
        return _json_error("image id 必须是数字", 400)
    remain = _tag_fetch_paused()
    if remain > 0:
        return web.json_response({"paused": True, "retryAfterSec": remain, "tags": []})
    inp = urllib.parse.quote(json.dumps({"json": {"id": int(image_id), "type": "image"}}))
    # 跟随 API 站点配置(镜像 civitai.red / 官方):与搜索、画廊同源,不再硬编码官方域。
    # trpc 端点需鉴权:匿名一律 401(Civitai 2026-09 收紧);Bearer 由 _headers_for 全局下发
    url = civitai_client.base_url().rstrip("/") + "/api/trpc/tag.getVotableTags?input=" + inp
    try:
        timeout = aiohttp.ClientTimeout(total=30, connect=15)
        async with await civitai_client.open_stream(url, timeout=timeout, allow_redirects=True) as resp:
            if resp.status != 200:
                _tag_fetch_fail()
                # Civitai 2026-09 起对该 trpc 端点关闭匿名访问(HTTP 401),必须带 API Key;
                # 代理/网络类失败由 net_error_message 给出配置指引,这里只解读上游状态码
                reason = {
                    401: "Civitai 已关闭此接口的匿名访问(HTTP 401)— 请在 ⚙ 设置里配置 Civitai API Key 后重试",
                    403: "Civitai 拒绝访问(HTTP 403)— 该图片需要登录态或 API Key 无效",
                    429: "触发 Civitai 限速(HTTP 429)— 稍后再试,或配置 API Key 提升限额",
                }.get(resp.status, f"上游 HTTP {resp.status}")
                return _json_error(reason, 502)
            data = await resp.json(content_type=None)
        # 解析也在 try 内:畸形 trpc 响应同样走结构化 502 + 熔断计数
        payload = (data.get("result") or {}).get("data") or {}
        raw = payload.get("json")
        if not isinstance(raw, list):
            raw = (raw or {}).get("items") or []
        tags = [{"id": t["id"], "name": t["name"]} for t in raw
                if isinstance(t, dict) and isinstance(t.get("id"), int) and t.get("name")]
    except civitai_client.CivitaiError as e:
        _tag_fetch_fail()
        return _json_error(e, 502)
    except Exception as e:
        _tag_fetch_fail()
        return _json_error(civitai_client.net_error_message(e), 502)
    _TAG_FETCH_STATE["fails"] = 0
    _TAG_FETCH_STATE["paused_until"] = 0.0
    if tags:
        _save_tag_pairs([(t["name"], t["id"]) for t in tags])
    mapping = _load_tag_mapping()
    return web.json_response({"imageId": int(image_id), "tags": tags, "mappingCount": len(mapping)})


@_post("/civitai_studio/remember_image/{image_id}")
async def remember_image(request):
    """记录最近点选的图片 ID(供节点 image_id 下拉与精确取图)."""
    image_id = request.match_info["image_id"]
    if not (image_id.isascii() and image_id.isdigit()):
        return _json_error("image id 必须是数字", 400)
    path = os.path.join(config._CONFIG_DIR, "recent_image_ids.json")
    try:
        with open(path, encoding="utf-8") as f:
            ids = [str(x) for x in json.load(f)]
    except Exception:
        ids = []
    ids = [image_id] + [x for x in ids if x != image_id]
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(ids[:50], f)
    except Exception as e:
        error(f"[Civitai-Studio] 最近图片 ID 写入失败: {e}")
    return web.json_response({"ok": True, "ids": ids[:50]})


@_get("/civitai_studio/tag_mapping")
async def tag_mapping_list(request):
    """本地 tag 名称→ID 映射(供输入自动补全)."""
    mapping = _load_tag_mapping()
    items = [{"name": k, "id": v} for k, v in sorted(mapping.items(), key=lambda kv: str(kv[0]).lower())]
    return web.json_response({"tags": items})


@_get("/civitai_studio/config")
async def get_config(request):
    cfg = config.load()
    key = cfg.get("api_key") or ""
    return web.json_response({
        "api_key_set": bool(key.strip()),
        "api_key_tail": key.strip()[-4:] if key.strip() else "",
        "proxy": cfg.get("proxy", ""),
        "mirror": cfg.get("mirror", ""),
        "nsfw": cfg.get("nsfw", 1),
        "proxy_images": cfg.get("proxy_images", False),
        "verify_hash": cfg.get("verify_hash", True),
        "max_concurrent": cfg.get("max_concurrent", 1),
        "persist_description": cfg.get("persist_description", False),
        "tag_scrape": cfg.get("tag_scrape", True),
        "tag_and_mode": cfg.get("tag_and_mode", False),
        "cache_max_mb": cfg.get("cache_max_mb", 500),
        "fav_autosync": cfg.get("fav_autosync", False),
        "fav_pull_legacy": cfg.get("fav_pull_legacy", False),
    })


@_post("/civitai_studio/config")
async def set_config(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    partial = {}
    for key in ("proxy", "mirror"):
        if key in body:
            v = str(body.get(key) or "").strip()
            if v and not v.lower().startswith(("http://", "https://", "socks5://", "socks5h://")):
                return _json_error(f"{key} 需为 http(s)/socks5 地址或留空", 400)
            partial[key] = v
    if "api_key" in body:
        partial["api_key"] = str(body.get("api_key") or "").strip()
    for key, (lo, hi) in (("nsfw", (0, 2)), ("max_concurrent", (1, 4)),
                          ("cache_max_mb", (50, 2000))):
        if key in body:
            try:
                value = int(body.get(key))
            except (TypeError, ValueError):
                return _json_error(f"{key} 必须是整数", 400)
            partial[key] = max(lo, min(hi, value))
    for key in ("proxy_images", "verify_hash", "persist_description", "tag_scrape", "tag_and_mode",
                "fav_autosync", "fav_pull_legacy"):
        if key in body:
            partial[key] = bool(body.get(key))
    cfg = config.update(partial)
    key = cfg.get("api_key") or ""
    return web.json_response({
        "status": "ok",
        "api_key_set": bool(key.strip()),
        "api_key_tail": key.strip()[-4:] if key.strip() else "",
    })


@_post("/civitai_studio/key_probe")
async def key_probe(request):
    """设置页「测试连接」:key 有效性 + 收藏写权限探测;不落库不改收藏状态.

    body 可带 {"api_key": "<候选 key>"}:只探测本次给的 key(保存仍由 /config 负责);
    缺省探测已配置 key(含 CIVITAI_API_KEY 环境变量兜底)。
    - GET <api_root>/me:401=无效,200=有效(open_stream 自带代理分支与重试退避)
    - tRPC user.toggleFavorite(modelId=0, setTo=false):仅过 TokenScope 闸,
      modelId=0 不存在,即使通过也是 no-op;scope 错误=social_write False,
      网络/其它错误=null(未知,不误报通过)
    """
    body = await _read_json_dict(request)
    cand = str((body or {}).get("api_key") or "").strip()
    key = cand or civitai_client.api_key().strip()
    if not key:
        return web.json_response({"ok": False, "reason": "no_key"})
    auth = {"Authorization": "Bearer " + key}
    # 1) 有效性:轻量只读
    try:
        timeout = aiohttp.ClientTimeout(total=20, connect=10)
        async with await civitai_client.open_stream(
                civitai_client.api_root() + "/me", extra_headers=auth, timeout=timeout) as resp:
            if resp.status == 401:
                return web.json_response({"ok": False, "reason": "invalid"})
            if resp.status != 200:
                return web.json_response({"ok": False, "reason": "http_" + str(resp.status)})
            me = await resp.json(content_type=None)
            username = str((me or {}).get("username") or "")
    except asyncio.TimeoutError:
        return web.json_response({"ok": False, "reason": "timeout"})
    except Exception as e:
        return web.json_response({"ok": False, "reason": "network",
                                  "message": civitai_client.net_error_message(e)})
    # 2) 写权限:15s 超时防"测试中…"挂满 session 默认 120s
    social = None
    try:
        await asyncio.wait_for(
            civitai_client.trpc_mutation("user.toggleFavorite", {"modelId": 0, "setTo": False},
                                         extra_headers=auth),
            timeout=15)
        social = True
    except civitai_client.TrpcScopeError:
        social = False
    except Exception:
        social = None  # 网络/WAF/入参校验等:写权限未知,如实上报
    return web.json_response({"ok": True, "username": username, "social_write": social})


