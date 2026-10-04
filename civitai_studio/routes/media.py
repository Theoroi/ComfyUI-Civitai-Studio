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
from ..mem_lru import MemLru
from ..bg import spawn as bg_spawn
from ..version import VERSION, build
from ..log import info, warn, error
from .common import (  # noqa: F401 — 共享工具与跨区状态
    _parse_model_ref, _json_error, _ok, _read_json_dict, _scan_async,
    _ENUMS_TTL, _enums_cache, _VERSION_CACHE, _VERSION_TTL,
    _annotate_version, _annotate_items, _get, _post,
)

@_get("/civitai_studio/image")
async def image_proxy(request):
    url = request.query.get("url", "")
    if not config.load().get("proxy_images"):
        # 关闭中转也只允许白名单域的 302,防开放重定向
        if not civitai_client.host_allowed_image(url):
            return _json_error("不允许的图片地址", 400)
        raise web.HTTPFound(url)
    if not url.startswith(("http://", "https://")) or not civitai_client.host_allowed_image(url):
        return _json_error("不允许的图片地址", 400)
    # 磁盘缓存命中:直接回文件(FileResponse 支持 Range,视频拖动不再整段重拉)
    hit = await local_index.run_bg(cache_store.media_lookup, url)
    if hit:
        resp = web.FileResponse(hit[0], headers={"Cache-Control": "public, max-age=86400"})
        resp.content_type = hit[1]  # .bin 扩展名会被推断成 octet-stream,必须显式回写
        return resp
    timeout = aiohttp.ClientTimeout(total=15, connect=8)  # 单跳 15s,5 跳留在会话退役窗口内
    current = url
    rng = request.headers.get("Range")  # 批5 E2E 19:<video> 取首帧/拖动发 Range,miss 路径透传
    try:
        # 逐跳手动跟随重定向,每一跳(含跳转后)都过域名白名单,鉴权头按目标主机自动决定
        for _hop in range(5):
            extra = {"Range": rng} if (rng and _hop == 0) else None
            async with await civitai_client.open_stream(current, timeout=timeout,
                                                        extra_headers=extra) as resp:
                if resp.status in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                    current = str(URL(resp.headers["Location"]).join(URL(current)))
                    if not civitai_client.host_allowed_image(current):
                        return _json_error("重定向到不允许的图片地址", 400)
                    continue
                if resp.status == 206:  # 批5 E2E 19:部分内容直通(不缓存),视频首帧/拖动不再空
                    ctype = (resp.content_type or "").split(";")[0]
                    if not (ctype.startswith("image/") or ctype.startswith("video/")):
                        return _json_error("图片中转失败: 上游返回的不是图片/视频", 502)
                    body = await resp.content.read(20 * 1024 * 1024 + 1)
                    if len(body) > 20 * 1024 * 1024:
                        return _json_error("分段超过 20MB 上限", 502)
                    headers = {"Accept-Ranges": "bytes"}
                    for k in ("Content-Range", "Content-Length"):
                        if resp.headers.get(k):
                            headers[k] = resp.headers[k]
                    return web.Response(status=206, body=body, content_type=ctype, headers=headers)
                if resp.status != 200:
                    warn(f"图片中转失败: HTTP {resp.status} url={url[:120]}")  # 批5.1:请求错误落日志
                    return _json_error(f"图片中转失败: HTTP {resp.status}", 502)
                ctype = (resp.content_type or "").split(";")[0]
                if not (ctype.startswith("image/") or ctype.startswith("video/")):
                    warn(f"图片中转失败: 非 media 内容 {ctype} url={url[:120]}")  # 批5.1
                    return _json_error("图片中转失败: 上游返回的不是图片/视频(可能被 WAF 拦截),可尝试更换代理节点", 502)
                body = await resp.content.read(20 * 1024 * 1024 + 1)
                if len(body) > 20 * 1024 * 1024:
                    return _json_error("图片超过 20MB 上限", 502)
                # 键用原始 url(与 media_lookup 对齐;302 终点的 ctype/内容才是实际下发的)
                bg_spawn(local_index.run_bg(cache_store.media_store, url, ctype, body))
                return web.Response(body=body, content_type=ctype,
                                    headers={"Cache-Control": "public, max-age=86400",
                                             "Accept-Ranges": "bytes"})
        return _json_error("图片重定向次数过多", 502)
    except Exception as e:
        warn(f"图片中转异常: {civitai_client.net_error_message(e)} url={url[:120]}")  # 批5.1:请求错误落日志
        return _json_error(f"图片中转失败: {civitai_client.net_error_message(e)}", 502)


_META_EXTS = (".png", ".mp4", ".mov")


def _meta_roots():
    """内嵌元数据可读的目录白名单:output/input/temp + 全部已注册模型根."""
    roots = []
    for getter in (folder_paths.get_output_directory, folder_paths.get_input_directory,
                   folder_paths.get_temp_directory):
        try:
            p = getter()
        except Exception:
            p = None
        if p:
            roots.append(os.path.realpath(p))
    for _key, entry in folder_paths.folder_names_and_paths.items():
        for p in entry[0]:
            try:
                if p and os.path.isdir(p):
                    roots.append(os.path.realpath(p))
            except (OSError, TypeError):
                pass
    return roots


@_post("/civitai_studio/embedded_meta")
async def embedded_meta(request):
    """读本地图片/视频的内嵌生成数据(PNG tEXt/iTXt、MP4 mdta;结果随 mtime 缓存).

    body {path} 或 {filename}(output 目录,画廊存图后的浮层回读):
    须位于 output/input/temp 或已注册模型根之下。
    meta 形状:{prompt|workflow: dict|str, parameters|encoder: str} 或 null(无内嵌数据)。
    """
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    raw = str(body.get("path") or "")
    if not raw and body.get("filename"):
        # 画廊「存图到本地」后的浮层回读:前端只有文件名,服务端拼 output 全路径
        try:
            out_dir = folder_paths.get_output_directory()
        except Exception:
            out_dir = None
        if out_dir:
            sub = str(body.get("subfolder") or "")
            raw = os.path.join(out_dir, sub, str(body["filename"]))
    if os.path.splitext(raw)[1].lower() not in _META_EXTS:
        return _json_error("仅支持 PNG/MP4/MOV 文件", 400)
    if not os.path.isfile(raw):
        return _json_error("文件不存在", 404)
    real = os.path.realpath(raw)
    # 大小写不敏感比对(与 local/reveal 的约定一致;大小写不敏感卷上防误 403)
    real_l, roots_l = real.lower(), [r.lower() for r in _meta_roots()]
    if not any(real_l == r or real_l.startswith(r + os.sep) for r in roots_l):
        return _json_error("路径不在允许目录内(output/input/temp/模型目录)", 403)
    meta = await local_index.run_bg(media_meta.get_embedded, real)
    return _ok(meta=meta)


@_get("/civitai_studio/cache_usage")
async def cache_usage(request):
    cfg = config.load()
    return web.json_response({
        "status": "ok",
        "used_bytes": cache_store.usage(),
        "max_mb": cfg.get("cache_max_mb", 500),
    })


@_post("/civitai_studio/cache_clear")
async def cache_clear(request):
    """清空缓存(内存层 + kv 表 + 指纹表,穿透全部层)后立即全量重建索引."""
    await local_index.run_bg(cache_store.clear_cache)  # checkpoint 别堵事件循环
    api_cache.clear_mem()
    civitai_client._model_cache.clear()
    from .common import reset_enums_cache
    reset_enums_cache()
    _VERSION_CACHE.clear()
    await _scan_async(True, True)
    cfg = config.load()
    return web.json_response({
        "status": "ok",
        "used_bytes": cache_store.usage(),
        "max_mb": cfg.get("cache_max_mb", 500),
    })

_GEN_DATA_CACHE = MemLru(300)
_GEN_DATA_TTL = 3600
_GEN_FAIL = {"fails": 0, "paused_until": 0.0}  # 与 image_tags 同款熔断:连败 3 次暂停 600s(评审R1 F6)


def _gen_fail():
    st = _GEN_FAIL
    st["fails"] += 1
    if st["fails"] >= 3:
        st["paused_until"] = time.time() + 600
        st["fails"] = 0


@_get("/civitai_studio/image_gen_data/{image_id}")
async def image_gen_data(request):
    """非公开 API 生成数据回退(E2E d):REST /images 与文件内嵌参数都拿不到时,
    复刻站方图片页的 tRPC image.getGenerationData 读路(与 tag 抓取同链路)。
    meta=null 的图(无生成参数)仍能给出 resources(底模/LoRA 链路)与 tools/techniques。
    MemLru 缓存 1h,不落盘、不受配额淘汰影响。"""
    image_id = request.match_info["image_id"]
    if not config.load().get("gen_data", True):
        return _json_error("生成参数回退已在设置(实验)中关闭", 403)  # 批12-g
    if not (image_id.isascii() and image_id.isdigit()):
        return _json_error("image id 必须是数字", 400)
    remain = _GEN_FAIL["paused_until"] - time.time()
    if remain > 0:  # 熔断期:空 payload(前端无感降级)+ 重试提示
        return web.json_response({"meta": None, "resources": [], "tools": [], "techniques": [],
                                  "paused": True, "retryAfterSec": int(remain)})
    if len(image_id) > 18:  # 挡超长数字串进 URL(评审R1 F5)
        return _json_error("image id 过长", 400)
    key = "imgendata:" + str(int(image_id))  # 归一化前导零,同图单缓存键
    hit = _GEN_DATA_CACHE.get(key)
    if hit is not None:
        return web.json_response(hit)
    try:
        d = await civitai_client.trpc_query("image.getGenerationData", {"id": int(image_id)})
    except civitai_client.CivitaiError as e:
        _gen_fail()
        return _json_error(e, 502)
    except Exception as e:
        _gen_fail()
        return _json_error(civitai_client.net_error_message(e), 502)
    _GEN_FAIL["fails"] = 0
    _GEN_FAIL["paused_until"] = 0.0
    payload = {
        "meta": d.get("meta") if isinstance(d, dict) else None,
        "resources": (d.get("resources") or []) if isinstance(d, dict) else [],
        "tools": (d.get("tools") or []) if isinstance(d, dict) else [],
        "techniques": (d.get("techniques") or []) if isinstance(d, dict) else [],
    }
    _GEN_DATA_CACHE.put(key, payload, expires_at=time.time() + _GEN_DATA_TTL)
    return web.json_response(payload)
