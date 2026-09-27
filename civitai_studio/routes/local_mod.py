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
        "scan_stats": index.get("stats"),
    })


@_post("/civitai_studio/local/deep_rescan")
async def local_deep_rescan(request):
    """清指纹表全量重扫:手动改过 sidecar 后的兜底入口(设置页按钮)."""
    index = await _scan_async(True, True)
    return web.json_response({"status": "ok", "scan_stats": index.get("stats")})


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
    path = str(body.get("path") or "")
    if not path:
        await _scan_async(False)
        path = local_index.resolve(body.get("category"), body.get("rel")) or ""
    path = os.path.normpath(path)
    if not os.path.isfile(path):
        return _json_error("文件不存在", 404)
    # 防目录穿越:只允许打开已注册模型根内的文件
    real = os.path.realpath(path)
    parent = os.path.dirname(real).lower()
    ok = any(
        parent == os.path.realpath(r).lower() or parent.startswith(os.path.realpath(r).lower() + os.sep)
        for key in local_index.categories() for r in local_index.roots_for(key)
    )
    if not ok:
        return _json_error("文件不在已注册的模型目录内", 403)
    try:
        if sys.platform == "win32":
            # explorer /select 打开所在文件夹并选中该文件(只开文件夹观感像"没定位到")
            subprocess.Popen(["explorer", "/select,", str(real)])  # noqa: S603
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(real)])  # noqa: S603
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(real)])  # noqa: S603,S607
    except OSError as e:
        return _json_error(f"打开文件夹失败: {e}", 500)
    return _ok()


@_post("/civitai_studio/local/move")
async def local_move(request):
    body = await _read_json_dict(request)
    if body is None:
        return _json_error("请求体必须是 JSON 对象", 400)
    await _scan_async(False)
    src = local_index.resolve(body.get("category"), body.get("rel"))
    if not src or not os.path.isfile(src):
        return _json_error("源文件不存在或不在模型目录内", 404)
    dest_root = downloader._validate_root(body.get("root"))
    if dest_root is None:
        return _json_error("目标目录不在已注册的模型目录内", 400)
    sub = downloader.sanitize_subfolder(body.get("subfolder"))
    dest_dir = os.path.join(dest_root, sub) if sub else dest_root
    os.makedirs(dest_dir, exist_ok=True)
    real_dest = os.path.realpath(dest_dir).lower()
    real_root = os.path.realpath(dest_root).lower()
    if real_dest != real_root and not real_dest.startswith(real_root + os.sep):
        return _json_error("子文件夹越出目标目录", 400)
    final = os.path.join(dest_dir, os.path.basename(src))
    if os.path.normpath(final).lower() == os.path.normpath(src).lower():
        return _json_error("目标位置与当前位置相同", 400)
    base, ext = os.path.splitext(final)
    n = 0
    while os.path.exists(final):
        n += 1
        final = f"{base} ({n}){ext}"
    try:
        shutil.move(src, final)
    except OSError as e:
        return _json_error(f"移动失败: {e}", 500)
    # sidecar 失败不能回滚整个移动(文件已就位):降级为成功+警告,清掉源侧孤儿
    warn = ""
    side = local_index.sidecar_path(src)
    if os.path.exists(side):
        side_dst = local_index.sidecar_path(final)
        try:
            if os.path.exists(side_dst):
                os.remove(side_dst)  # 目标已有同名 sidecar:以移动后的模型为准
            shutil.move(side, side_dst)
        except OSError as e:
            warn = f"模型已移动,但 .civitai.json 迁移失败({e}),旧 sidecar 已清理,请重新关联"
            try:
                os.remove(side)
            except OSError:
                pass
    # 关联行平移(DB 主存储):sidecar 迁移失败时标 pending,防扫描对账误清
    cache_store.rename_assoc(src, final, pending=bool(warn))
    local_index.schedule_rescan()
    return web.json_response({"status": "ok", "path": final, "name": os.path.basename(final), "warning": warn})


@_get("/civitai_studio/local/subdirs")
async def local_subdirs(request):
    """目标根下已存在的相对子目录(深度≤3,上限 500),供下载/移动对话框的浏览按钮."""
    root = os.path.normpath(str(request.query.get("root", "")))
    ok = any(os.path.normpath(r) == root
             for key in local_index.categories() for r in local_index.roots_for(key))
    if not ok:
        return _json_error("目录不在已注册的模型目录内", 400)
    out, queue = [], [(root, "", 0)]
    while queue and len(out) < 500:
        base, rel, depth = queue.pop(0)
        try:
            entries = sorted(os.listdir(base))
        except OSError:
            continue
        for name in entries:
            if name.startswith("."):
                continue
            p = os.path.join(base, name)
            if os.path.isdir(p):
                r = f"{rel}/{name}" if rel else name
                out.append(r)
                if depth + 1 < 3:
                    queue.append((p, r, depth + 1))
    return web.json_response({"subdirs": sorted(out)})


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
    cache_store.rename_assoc(path, dest)  # 关联行平移(DB 主存储):重命名不丢关联
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
    # 阶段2 完整导出语义:DB 恒为关联主存储(完整元数据入库,快照恢复不依赖 sidecar);
    # .civitai.json 仅在 persist_description 开时导出,失败仅影响互操作(关联不丢)
    persist = config.load().get("persist_description")
    sidecar_ok = True
    if persist:
        sidecar_ok = local_index.write_sidecar(path, meta)
    cover_url = next(
        (i.get("url") for v in versions for i in (v.get("images") or []) if i.get("url")), None)
    cache_store.sync_assocs(
        [(path, str(meta["model_id"]), str(meta["version_id"]),
          meta["model_name"], cover_url,
          json.dumps(meta, ensure_ascii=False))],
        pending=(persist and not sidecar_ok))
    await _scan_async(True)
    return _ok(associated=meta, warning=None if sidecar_ok
               else "关联已保存,但 .civitai.json 导出失败(权限/磁盘?)——仅影响外部工具互操作")


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
    # 关联身份:sidecar 优先,缺席回退 DB meta(阶段2 主存储:persist 关的文件无 sidecar)
    meta = local_index.read_sidecar(path)
    if not isinstance(meta, dict) or not meta.get("model_id"):
        assoc = cache_store.get_assoc(path)
        meta = (json.loads(assoc["meta"]) if assoc and assoc.get("meta")
                and isinstance(assoc["meta"], str) else None)
        if not isinstance(meta, dict):
            meta = None
    if not meta or not meta.get("model_id"):
        return _json_error("该文件未关联 Civitai(本地数据库与 .civitai.json 均无关联)", 400)
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
    # DB 恒为真值:刷新结果直接落库(不依赖 sidecar 写盘成败);sidecar 按 persist 口径导出
    cache_store.sync_assocs(
        [(path, str(meta["model_id"]), str(meta.get("version_id") or ""),
          meta.get("model_name"), meta.get("cover_url"),
          json.dumps(meta, ensure_ascii=False))])
    persist = config.load().get("persist_description")
    sidecar_ok = True
    if persist:
        sidecar_ok = local_index.write_sidecar(path, meta)
    civitai_client.prime_model_cache(meta["model_id"], data)  # 让随后的 /model/{id} 读到新数据
    await _scan_async(True)
    return _ok(warning=None if sidecar_ok
               else "元数据已更新,但 .civitai.json 导出失败(权限/磁盘?)——仅影响外部工具互操作")


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
                data = await civitai_client.get_model_cached(meta["model_id"])
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


