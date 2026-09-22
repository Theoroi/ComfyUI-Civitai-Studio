"""HTTP 路由 — 服务端代理 Civitai API + 本地模型管理 + 下载控制.

路由前缀 /civitai_studio/。若 PromptServer 不可用则跳过注册(仅打印警告)。
"""

import asyncio
import os
import subprocess
import sys
import urllib.parse

import aiohttp
import folder_paths
from aiohttp import web

from . import civitai_client, config, downloader, local_index

try:
    from server import PromptServer
    _routes = PromptServer.instance.routes if PromptServer.instance else None
except Exception:
    _routes = None

if _routes is not None:
    def _get(path):
        return _routes.get(path)

    def _post(path):
        return _routes.post(path)
else:
    def _get(path):
        return lambda fn: fn

    def _post(path):
        return lambda fn: fn


def _json_error(message, status=500):
    return web.json_response({"error": str(message)}, status=status)


def _ok(**kw):
    return web.json_response({"status": "ok", **kw})


async def _scan_async(force=False):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: local_index.scan(force=force))


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
    try:
        for model in data.get("items", []):
            model["installed"] = False
            for v in model.get("modelVersions", []):
                if _annotate_version(v, index):
                    model["installed"] = True
    except AttributeError:
        pass
    return data


# ---------- 配置 ----------

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
    })


@_post("/civitai_studio/config")
async def set_config(request):
    try:
        body = await request.json()
    except Exception:
        return _json_error("请求体不是合法 JSON", 400)
    partial = {}
    for key in ("proxy", "mirror"):
        if key in body:
            partial[key] = str(body.get(key) or "").strip()
    if "api_key" in body:
        partial["api_key"] = str(body.get("api_key") or "").strip()
    for key in ("nsfw", "max_concurrent"):
        if key in body:
            try:
                partial[key] = int(body.get(key))
            except (TypeError, ValueError):
                return _json_error(f"{key} 必须是整数", 400)
    for key in ("proxy_images", "verify_hash"):
        if key in body:
            partial[key] = bool(body.get(key))
    cfg = config.update(partial)
    key = cfg.get("api_key") or ""
    return web.json_response({
        "status": "ok",
        "api_key_set": bool(key.strip()),
        "api_key_tail": key.strip()[-4:] if key.strip() else "",
    })


# ---------- 在线浏览(代理 Civitai API) ----------

@_get("/civitai_studio/search")
async def search_models(request):
    q = request.query
    try:
        params = {
            "limit": min(60, max(1, int(q.get("limit", "24")))),
            "page": max(1, int(q.get("page", "1"))),
            "nsfw": str(q.get("nsfw", "1")),
        }
    except ValueError:
        return _json_error("page/limit 必须是数字", 400)
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
    try:
        data = await civitai_client.get_json(f"/models/{mid}")
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    index = await _scan_async(False)
    return web.json_response(_annotate_items({"items": [data]}, index)["items"][0])


@_get("/civitai_studio/version/{vid}")
async def version_detail(request):
    vid = request.match_info["vid"]
    try:
        data = await civitai_client.get_json(f"/model-versions/{vid}")
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    index = await _scan_async(False)
    _annotate_version(data, index)
    return web.json_response(data)


@_get("/civitai_studio/images")
async def version_images(request):
    q = request.query
    params = {}
    if q.get("modelVersionId"):
        params["modelVersionId"] = q["modelVersionId"]
    if not params.get("modelVersionId"):
        return _json_error("缺少 modelVersionId", 400)
    try:
        params["limit"] = min(50, max(1, int(q.get("limit", "20"))))
    except ValueError:
        return _json_error("limit 必须是数字", 400)
    if q.get("cursor"):
        params["cursor"] = q["cursor"]
    try:
        data = await civitai_client.get_json("/images", params=params)
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    return web.json_response(data)


@_get("/civitai_studio/image")
async def image_proxy(request):
    url = request.query.get("url", "")
    if not config.load().get("proxy_images"):
        raise web.HTTPFound(url)
    host = urllib.parse.urlparse(url).hostname or ""
    allowed = host.endswith(("civitai.com", "civitai.green", "civitai.work", "civitai.red"))
    if not url.startswith(("http://", "https://")) or not allowed:
        return _json_error("不允许的图片地址", 400)
    try:
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
        async with await civitai_client.open_stream(url, timeout=timeout) as resp:
            body = await resp.read()
            ctype = (resp.headers.get("Content-Type") or "image/jpeg").split(";")[0]
            return web.Response(body=body, content_type=ctype,
                                headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        return _json_error(f"图片中转失败: {civitai_client.net_error_message(e)}", 502)


# ---------- 下载 ----------

@_get("/civitai_studio/destinations")
async def destinations(request):
    ctype = request.query.get("type", "Checkpoint")
    keys = local_index.TYPE_TO_FOLDERS.get(ctype) or local_index.categories()
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
            out.append({"key": key, "root": root, "label": f"{key} · {root}"})
    return web.json_response({"destinations": out})


@_post("/civitai_studio/download")
async def start_download(request):
    try:
        body = await request.json()
    except Exception:
        return _json_error("请求体不是合法 JSON", 400)
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
    try:
        body = await request.json()
    except Exception:
        return _json_error("请求体不是合法 JSON", 400)
    ok = downloader.cancel(str(body.get("id", "")))
    return _ok(cancelled=ok)


@_post("/civitai_studio/downloads/clear")
async def clear_downloads(request):
    downloader.clear_finished()
    return _ok()


# ---------- 本地管理 ----------

@_get("/civitai_studio/local")
async def local_models(request):
    force = request.query.get("force") == "1"
    index = await _scan_async(force)
    return web.json_response({
        "status": "ok",
        "models": index["models"],
        "truncated": index.get("truncated", False),
        "scanned_at": index["ts"],
    })


@_post("/civitai_studio/local/delete")
async def local_delete(request):
    try:
        body = await request.json()
    except Exception:
        return _json_error("请求体不是合法 JSON", 400)
    path = local_index.resolve(body.get("category"), body.get("rel"))
    if not path or not os.path.isfile(path):
        return _json_error("文件不存在或不在模型目录内", 404)
    try:
        os.remove(path)
    except OSError as e:
        return _json_error(f"删除失败: {e}", 500)
    sidecar = local_index.sidecar_path(path)
    if os.path.exists(sidecar):
        try:
            os.remove(sidecar)
        except OSError:
            pass
    local_index.scan(force=True)
    return _ok()


@_post("/civitai_studio/local/reveal")
async def local_reveal(request):
    try:
        body = await request.json()
    except Exception:
        return _json_error("请求体不是合法 JSON", 400)
    path = local_index.resolve(body.get("category"), body.get("rel"))
    if not path or not os.path.isfile(path):
        return _json_error("文件不存在或不在模型目录内", 404)
    folder = os.path.dirname(path)
    try:
        if sys.platform == "win32":
            os.startfile(folder)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder])  # noqa: S603, S607
        else:
            subprocess.Popen(["xdg-open", folder])  # noqa: S603, S607
    except OSError as e:
        return _json_error(f"打开文件夹失败: {e}", 500)
    return _ok()


@_post("/civitai_studio/local/check_updates")
async def check_updates(request):
    try:
        body = await request.json() if request.can_read_body else {}
    except Exception:
        body = {}
    wanted = body.get("items") or []
    index = await _scan_async(False)
    targets = []
    for m in index["models"]:
        meta = m.get("civitai") or {}
        if not meta.get("model_id") or not meta.get("version_id"):
            continue
        if wanted:
            key_id = m["id"]
            if not any(w.get("category") == m["category"] and w.get("rel") == m["rel"] for w in wanted):
                continue
        targets.append(m)
    results = []
    errors = 0
    for m in targets[:30]:
        meta = m["civitai"]
        try:
            data = await civitai_client.get_json(f"/models/{meta['model_id']}")
            versions = [v for v in data.get("modelVersions", []) if v.get("id")]
            latest = versions[0] if versions else None
            current = str(meta.get("version_id"))
            entry = {
                "id": m["id"], "category": m["category"], "rel": m["rel"],
                "name": m["name"], "model_id": meta.get("model_id"),
                "current_version": meta.get("version_name"),
            }
            if latest and str(latest.get("id")) != current:
                entry["update"] = {
                    "version_id": latest["id"], "version_name": latest.get("name"),
                    "base_model": latest.get("baseModel"),
                    "model_name": data.get("name"),
                }
            results.append(entry)
        except civitai_client.CivitaiError as e:
            errors += 1
            results.append({"id": m["id"], "error": str(e)})
    return web.json_response({"status": "ok", "checked": len(targets[:30]), "errors": errors, "results": results})


if _routes is None:
    print("[Civitai-Studio] 警告: PromptServer 不可用,HTTP 路由未注册")
