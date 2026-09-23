"""HTTP 路由 — 服务端代理 Civitai API + 本地模型管理 + 下载控制.

路由前缀 /civitai_studio/。若 PromptServer 不可用则跳过注册(仅打印警告)。
"""

import asyncio
import os
import subprocess
import sys
import time

import aiohttp
import folder_paths
from aiohttp import web
from yarl import URL

from . import civitai_client, config, downloader, local_index

_enums_cache = {"data": None, "ts": 0.0}
_ENUMS_TTL = 6 * 3600.0

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


async def _read_json_dict(request):
    """解析请求体,必须是 JSON 对象;否则返回 None(调用方回 400)."""
    try:
        body = await request.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


async def _scan_async(force=False):
    return await local_index.run_bg(local_index.scan, force)


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
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    partial = {}
    for key in ("proxy", "mirror"):
        if key in body:
            partial[key] = str(body.get(key) or "").strip()
    if "api_key" in body:
        partial["api_key"] = str(body.get("api_key") or "").strip()
    for key, (lo, hi) in (("nsfw", (0, 2)), ("max_concurrent", (1, 4))):
        if key in body:
            try:
                value = int(body.get(key))
            except (TypeError, ValueError):
                return _json_error(f"{key} 必须是整数", 400)
            partial[key] = max(lo, min(hi, value))
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
    try:
        data = await civitai_client.get_json(f"/models/{mid}")
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    index = await _scan_async(False)
    return web.json_response(_annotate_items({"items": [data]}, index)["items"][0])


@_get("/civitai_studio/images")
async def version_images(request):
    """预留:分页拉取某版本更多预览图(当前前端只用详情内嵌 images)。"""
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
    if q.get("nsfw"):
        # 与搜索同档位;新 API 是布尔开关,映射后再透传
        params["nsfw"] = "false" if q["nsfw"] in ("0", "false") else "true"
    try:
        data = await civitai_client.get_json("/images", params=params)
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    return web.json_response(data)


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
    timeout = aiohttp.ClientTimeout(total=15, connect=8)  # 单跳 15s,5 跳留在会话退役窗口内
    current = url
    try:
        # 逐跳手动跟随重定向,每一跳(含跳转后)都过域名白名单,鉴权头按目标主机自动决定
        for _hop in range(5):
            async with await civitai_client.open_stream(current, timeout=timeout) as resp:
                if resp.status in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                    current = str(URL(resp.headers["Location"]).join(URL(current)))
                    if not civitai_client.host_allowed_image(current):
                        return _json_error("重定向到不允许的图片地址", 400)
                    continue
                if resp.status != 200:
                    return _json_error(f"图片中转失败: HTTP {resp.status}", 502)
                ctype = (resp.content_type or "").split(";")[0]
                if not ctype.startswith("image/"):
                    return _json_error("图片中转失败: 上游返回的不是图片(可能被 WAF 拦截),可尝试更换代理节点", 502)
                body = await resp.content.read(20 * 1024 * 1024 + 1)
                if len(body) > 20 * 1024 * 1024:
                    return _json_error("图片超过 20MB 上限", 502)
                return web.Response(body=body, content_type=ctype,
                                    headers={"Cache-Control": "public, max-age=86400"})
        return _json_error("图片重定向次数过多", 502)
    except Exception as e:
        return _json_error(f"图片中转失败: {civitai_client.net_error_message(e)}", 502)


# ---------- 下载 ----------

@_get("/civitai_studio/enums")
async def enums(request):
    """代理站方枚举(ModelType/ActiveBaseModel/BaseModel...),内存缓存 6h."""
    global _enums_cache
    now = time.time()
    if _enums_cache["data"] is None or now - _enums_cache["ts"] > _ENUMS_TTL:
        try:
            data = await civitai_client.get_json("/enums", timeout=aiohttp.ClientTimeout(total=20, connect=10))
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


@_get("/civitai_studio/destinations")
async def destinations(request):
    ctype = request.query.get("type", "Checkpoint")
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
            out.append({"key": key, "root": root, "label": f"{key} · {root}"})
    return web.json_response({"destinations": out})


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


@_post("/civitai_studio/downloads/clear")
async def clear_downloads(request):
    downloader.clear_finished()
    return _ok()


# ---------- 本地管理 ----------

@_get("/civitai_studio/local")
async def local_models(request):
    force = request.query.get("force") == "1"
    index = await _scan_async(force)
    # 响应瘦身:去掉 sidecar 里的长字段,完整元数据暂无按需详情接口,前端只用这些
    slim = []
    for m in index["models"]:
        civ = m.get("civitai") or {}
        slim.append({
            "id": m["id"], "category": m["category"], "root": m["root"],
            "rel": m["rel"], "name": m["name"], "path": m["path"],
            "size": m["size"], "mtime": m["mtime"],
            "civitai": {k: civ[k] for k in
                        ("model_id", "model_name", "version_id", "version_name", "base_model", "trained_words")
                        if k in civ},
        })
    return web.json_response({
        "status": "ok",
        "models": slim,
        "truncated": index.get("truncated", False),
        "scanned_at": index["ts"],
    })


@_post("/civitai_studio/local/delete")
async def local_delete(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    await _scan_async(False)  # resolve 只查内存索引,扫描必须先在 executor 完成
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
    await _scan_async(True)
    return _ok()


@_post("/civitai_studio/local/reveal")
async def local_reveal(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    await _scan_async(False)
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
    body = (await _read_json_dict(request)) or {}
    wanted = [w for w in (body.get("items") or []) if isinstance(w, dict)]
    index = await _scan_async(False)
    targets = []
    for m in index["models"]:
        meta = m.get("civitai") or {}
        if not meta.get("model_id") or not meta.get("version_id"):
            continue
        if wanted:
            if not any(w.get("category") == m["category"] and w.get("rel") == m["rel"] for w in wanted):
                continue
        targets.append(m)
    batch = targets[:30]
    sem = asyncio.Semaphore(4)

    async def fetch_one(m):
        meta = m["civitai"]
        entry = {
            "id": m["id"], "category": m["category"], "rel": m["rel"],
            "name": m["name"], "model_id": meta.get("model_id"),
            "current_version": meta.get("version_name"),
        }
        async with sem:
            try:
                data = await civitai_client.get_json(f"/models/{meta['model_id']}")
                versions = [v for v in data.get("modelVersions", []) if v.get("id")]
                latest = versions[0] if versions else None
                current = str(meta.get("version_id"))
                if latest and str(latest.get("id")) != current:
                    entry["update"] = {
                        "version_id": latest["id"], "version_name": latest.get("name"),
                        "base_model": latest.get("baseModel"),
                        "model_name": data.get("name"),
                    }
                return entry
            except civitai_client.CivitaiError as e:  # 已是可读中文
                entry["error"] = str(e)
                return entry
            except Exception:  # 未知异常不给用户看英文堆栈
                entry["error"] = "查询失败,请稍后重试"
                return entry

    try:
        results = await asyncio.wait_for(
            asyncio.gather(*(fetch_one(m) for m in batch)), timeout=120
        )
    except asyncio.TimeoutError:
        results = [{"id": m["id"], "error": "批量检查整体超时,请分批重试"} for m in batch]
    errors = sum(1 for r in results if r.get("error"))
    return web.json_response({
        "status": "ok", "checked": len(batch), "total_linked": len(targets),
        "errors": errors, "results": results,
    })


if _routes is None:
    print("[Civitai-Studio] 警告: PromptServer 不可用,HTTP 路由未注册")
