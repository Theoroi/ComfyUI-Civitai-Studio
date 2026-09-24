"""HTTP 路由 — 服务端代理 Civitai API + 本地模型管理 + 下载控制.

路由前缀 /civitai_studio/。若 PromptServer 不可用则跳过注册(仅打印警告)。
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

import aiohttp
import folder_paths
from aiohttp import web
from yarl import URL

from . import civitai_client, config, downloader, local_index
from .version import VERSION, build

_enums_cache = {"data": None, "ts": 0.0}
_ENUMS_TTL = 6 * 3600.0


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


@_get("/civitai_studio/version")
async def version_route(request):
    """前端用它对照自身版本,检测"服务端还是重启前的旧代码"."""
    return web.json_response({"version": VERSION, "build": build()})


# ---------- 图片分类 tag:网页端 trpc 抓取 + 本地映射 ----------

_TAG_MAPPING_FILE = os.path.join(config._CONFIG_DIR, "tag_mapping.json")

# tag 抓取熔断:连续失败 N 次暂停一段时间,避免上游故障时反复打请求
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
    try:
        with open(_TAG_MAPPING_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_tag_mapping(mapping):
    try:
        os.makedirs(os.path.dirname(_TAG_MAPPING_FILE), exist_ok=True)
        tmp = _TAG_MAPPING_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=0, sort_keys=True)
        os.replace(tmp, _TAG_MAPPING_FILE)
    except Exception as e:
        print(f"[Civitai-Studio] tag 映射文件写入失败: {e}")


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
    # 跟随 API 站点配置(镜像 civitai.red / 官方):与搜索、画廊同源,不再硬编码官方域
    url = civitai_client.base_url().rstrip("/") + "/api/trpc/tag.getVotableTags?input=" + inp
    # trpc 端点需要鉴权:匿名一律 401(Civitai 2026-09 收紧,官方与镜像同行为);
    # 镜像的 /api/v1 会拒 Bearer(全局规则仍不给镜像发 key),但 trpc 带 Bearer 实测放行,
    # 故仅在本路由显式下发 key
    key = (config.load().get("api_key") or "").strip()
    extra = {"Authorization": "Bearer " + key} if key else None
    try:
        timeout = aiohttp.ClientTimeout(total=30, connect=15)
        async with await civitai_client.open_stream(url, extra_headers=extra, timeout=timeout, allow_redirects=True) as resp:
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
    mapping = _load_tag_mapping()
    for t in tags:
        mapping[t["name"]] = t["id"]
    if tags:
        _save_tag_mapping(mapping)
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
        print(f"[Civitai-Studio] 最近图片 ID 写入失败: {e}")
    return web.json_response({"ok": True, "ids": ids[:50]})


@_get("/civitai_studio/tag_mapping")
async def tag_mapping_list(request):
    """本地 tag 名称→ID 映射(供输入自动补全)."""
    mapping = _load_tag_mapping()
    items = [{"name": k, "id": v} for k, v in sorted(mapping.items(), key=lambda kv: str(kv[0]).lower())]
    return web.json_response({"tags": items})


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
        "persist_description": cfg.get("persist_description", False),
        "tag_scrape": cfg.get("tag_scrape", True),
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
    for key in ("proxy_images", "verify_hash", "persist_description", "tag_scrape"):
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
        data = await civitai_client.get_json("/images", params=params)
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
                if not (ctype.startswith("image/") or ctype.startswith("video/")):
                    return _json_error("图片中转失败: 上游返回的不是图片/视频(可能被 WAF 拦截),可尝试更换代理节点", 502)
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
                        ("model_id", "model_name", "version_id", "version_name", "base_model", "trained_words",
                         "description_html", "tags", "cover_url")
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


@_post("/civitai_studio/local/rename")
async def local_rename(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    await _scan_async(False)
    path = local_index.resolve(body.get("category"), body.get("rel"))
    if not path or not os.path.isfile(path):
        return _json_error("文件不存在或不在模型目录内", 404)
    new_name = downloader.sanitize_filename(body.get("new_name"))
    if not new_name or new_name in (".", ".."):
        return _json_error("新文件名无效", 400)
    dest = os.path.join(os.path.dirname(path), new_name)
    if os.path.normcase(os.path.abspath(dest)) == os.path.normcase(os.path.abspath(path)):
        return _ok(new_name=new_name)  # 同名(含仅大小写差异):无需改动
    if os.path.exists(dest):
        return _json_error("目标文件名已存在", 400)
    ext = os.path.splitext(new_name)[1].lower()
    if ext not in local_index.MODEL_EXTS:
        return _json_error(f"不支持的扩展名 {ext or '(无)'}:重命名后需仍是模型文件", 400)
    try:
        os.rename(path, dest)
    except OSError as e:
        return _json_error(f"重命名失败(文件可能被占用): {e}", 500)
    old_sidecar = local_index.sidecar_path(path)
    old_meta = local_index.read_sidecar(path)
    if old_meta:
        old_meta["file_name"] = new_name
        local_index.write_sidecar(dest, old_meta)
    if os.path.exists(old_sidecar):
        try:
            os.remove(old_sidecar)
        except OSError:
            pass
    await _scan_async(True)
    return _ok(new_name=new_name)


@_post("/civitai_studio/local/associate")
async def local_associate(request):
    """为未关联的本地文件手动建立 Civitai 关联:写入 sidecar(关联最新发布版本)."""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    await _scan_async(False)
    path = local_index.resolve(body.get("category"), body.get("rel"))
    if not path or not os.path.isfile(path):
        return _json_error("文件不存在或不在模型目录内", 404)
    try:
        mid, vid = _parse_model_ref(body.get("ref"))
    except ValueError as e:
        return _json_error(e, 400)
    # 搜索选择的走显式 model_id/version_id 字段,优先于 ref 解析
    mid = str(body.get("model_id") or mid or "").strip()
    vid = str(body.get("version_id") or vid or "").strip()
    if not mid.isdigit():
        return _json_error("无法解析模型 ID:请从搜索结果选择,或粘贴页面链接/模型 ID", 400)
    try:
        data = await civitai_client.get_model_cached(mid)
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    versions = [v for v in data.get("modelVersions", []) if v.get("id")]
    version = None
    if vid:
        version = next((v for v in versions if str(v.get("id")) == str(vid)), None)
        if version is None:
            return _json_error(f"该模型下未找到版本 {vid}", 400)
    elif versions:
        version = versions[0]
    # 合并旧 sidecar(保留 sha256/download_url 等文件级字段),再覆盖关联身份字段
    old = local_index.read_sidecar(path) or {}
    meta = {
        **old,
        "source": "civitai",
        "model_id": data.get("id"),
        "version_id": str(version.get("id")) if version else "",
        "model_name": data.get("name"),
        "version_name": (version or {}).get("name"),
        "base_model": (version or {}).get("baseModel"),
        "type": data.get("type"),
        "file_name": os.path.basename(path),
        "trained_words": (version or {}).get("trainedWords") or [],
        "manual": True,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    model_changed = str(old.get("model_id") or "") != str(meta["model_id"])
    version_changed = str(old.get("version_id") or "") != str(meta["version_id"])
    if model_changed or version_changed:
        # 关联目标变化:旧版本的哈希/下载地址不再适用
        meta.pop("sha256", None)
        meta.pop("download_url", None)
    if model_changed:
        # 换了模型:落盘说明/标签/封面也要换(persist 开则用新模型数据回填)
        if config.load().get("persist_description"):
            meta["description_html"] = local_index.truncate_desc(data.get("description"))
            meta["tags"] = data.get("tags") or []
            meta["cover_url"] = next(
                (i.get("url") for v in versions for i in (v.get("images") or []) if i.get("url")), None)
        else:
            meta.pop("description_html", None)
            meta.pop("tags", None)
            meta.pop("cover_url", None)
    # 网络等待期间文件可能已被重命名/删除,写盘前复验
    if not os.path.isfile(path):
        return _json_error("文件已移动或删除,请刷新本地库后重试", 409)
    if not local_index.write_sidecar(path, meta):
        return _json_error("写入 .civitai.json 失败(权限/磁盘?)", 500)
    await _scan_async(True)
    return _ok(associated=meta)


@_post("/civitai_studio/local/refresh_meta")
async def local_refresh_meta(request):
    """刷新已关联模型的元数据:版本信息取最新;说明/标签/封面按设置落盘."""
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    await _scan_async(False)
    path = local_index.resolve(body.get("category"), body.get("rel"))
    if not path or not os.path.isfile(path):
        return _json_error("文件不存在或不在模型目录内", 404)
    meta = local_index.read_sidecar(path)
    if not meta or not meta.get("model_id"):
        return _json_error("该文件未关联 Civitai(缺少 .civitai.json)", 400)
    meta["model_id"] = str(meta.get("model_id"))
    if not meta["model_id"].isdigit():
        return _json_error("sidecar 中的 model_id 无效,请重新关联", 400)
    try:
        # 绕过缓存取最新
        data = await civitai_client.get_json(f"/models/{meta['model_id']}")
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    except (asyncio.TimeoutError, aiohttp.ClientError) as e:
        return _json_error(civitai_client.net_error_message(e), 502)
    meta["model_name"] = data.get("name") or meta.get("model_name")
    versions = [v for v in data.get("modelVersions", []) if v.get("id")]
    cur = next((v for v in versions if str(v.get("id")) == str(meta.get("version_id"))), None)
    if cur:
        meta["version_name"] = cur.get("name") or meta.get("version_name")
        meta["base_model"] = cur.get("baseModel") or meta.get("base_model")
        meta["trained_words"] = cur.get("trainedWords") or meta.get("trained_words") or []
    if config.load().get("persist_description"):
        meta["description_html"] = local_index.truncate_desc(data.get("description"))
        meta["tags"] = data.get("tags") or []
        meta["cover_url"] = next(
            (i.get("url") for v in versions for i in (v.get("images") or []) if i.get("url")),
            meta.get("cover_url"))
    # 网络等待期间文件可能已被重命名/删除,写盘前复验
    if not os.path.isfile(path):
        return _json_error("文件已移动或删除,请刷新本地库后重试", 409)
    if not local_index.write_sidecar(path, meta):
        return _json_error("写入 .civitai.json 失败(权限/磁盘?)", 500)
    civitai_client.prime_model_cache(meta["model_id"], data)  # 让随后的 /model/{id} 读到新数据
    await _scan_async(True)
    return _ok()


@_get("/civitai_studio/version/{vid}")
async def version_detail(request):
    """单个版本的完整数据(含 images.meta — 列表接口在镜像上被剥掉,这里保留)."""
    vid = request.match_info["vid"]
    if not vid.isdigit():
        return _json_error("版本 ID 必须是数字", 400)
    try:
        data = await civitai_client.get_json(f"/model-versions/{vid}")
    except civitai_client.CivitaiError as e:
        return _json_error(e, 502)
    return web.json_response(data)


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
else:
    # 防缓存:覆盖 ComfyUI 静态路由,始终返回最新 JS 并发 no-cache 头。
    # 没有这段,Desktop webview 会启发式缓存旧版 JS,导致更新后侧边栏消失。
    @_routes.get("/extensions/ComfyUI-Civitai-Studio/{filename}")
    async def serve_extension_js(request):
        filename = request.match_info["filename"]
        if "/" in filename or "\\" in filename or ".." in filename or ":" in filename:
            return web.Response(status=404)
        js_root = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "js"))
        fp = os.path.realpath(os.path.join(js_root, filename))
        # realpath 归一化后必须仍落在 js 目录内(防盘符相对路径等穿越)
        if not fp.startswith(js_root + os.sep) or not os.path.isfile(fp):
            return web.Response(status=404)
        with open(fp, "r", encoding="utf-8") as f:
            content = f.read()
        return web.Response(text=content, content_type="application/javascript",
                            headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
