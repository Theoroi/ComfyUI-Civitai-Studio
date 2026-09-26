"""收藏双向同步引擎 — 能力矩阵与实测依据见 docs/favorites-api-research.md.

矩阵:
- 资产(图片)收藏:远端→本地 ✅(REST /images?favorites=true);本地→远端 ❌(无公开端点,
  本地新增仅本地,同步时保留不推)
- 模型收藏:双向 ✅(读 REST /models?favorites=true;写 tRPC user.toggleFavorite,
  需 key 勾选 SocialWrite — 缺作用域时返回 scope_hint,不中断下同步)
- 集合/分组:读 tRPC collection.getAllUser + getAllCollectionItems;写 collection.saveItem
  /removeFromCollection(需 CollectionsRead/写作用域)
- 冲突:updated_at 新者胜(本地 dirty 视为最新,远端让位)

同步是"尽力而为"的合并:任何单通道失败不阻塞其它通道;结果逐项计数返回给设置页展示。
"""

import os
import time
from datetime import datetime, timezone

from . import bg, cache_store, civitai_client, favorites_store as fs

_PAGE_LIMIT = 50
_MAX_PAGES = 20  # 单方向单次同步最多 20 页(1000 条),够用且防失控
_SYNC_LOCK_KEY = "fav:sync_inflight"


def _ts(iso):
    """Civitai ISO 时间 → epoch;解析失败返回 0(视为很旧)."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return 0.0


async def _trpc_paged(proc, base_input, item_key):
    """tRPC 分页 query 包装:getAllCollectionItems 等 cursor 型端点."""
    items, cursor, pages = [], None, 0
    while pages < _MAX_PAGES:
        js = dict(base_input or {})
        if cursor:
            js["cursor"] = cursor
        data = await civitai_client.trpc_query(proc, js)
        page = data.get("items") if isinstance(data, dict) else data
        items.extend(page or [])
        cursor = (data or {}).get("nextCursor") if isinstance(data, dict) else None
        pages += 1
        if not cursor or not page:
            break
    return items


async def _down_favorites(kind):
    """REST 收藏读。返回 {n, truncated, seen}:truncated=翻到页数上限;seen=本次远端
    存在的 id 集(供缺席对账)。"""
    path = "/images" if kind == fs.KIND_ASSET else "/models"
    cursor, pages, n = None, 0, 0
    seen = set()
    truncated = False
    while pages < _MAX_PAGES:
        params = {"favorites": "true", "limit": str(_PAGE_LIMIT)}
        if cursor:
            params["cursor"] = cursor
        data = await civitai_client.get_json(path, params=params)
        items = data.get("items") or []
        for it in items:
            oid = str(it.get("id") or "")
            if not oid:
                continue
            seen.add(oid)
            if kind == fs.KIND_ASSET:
                fs.upsert_remote(kind, oid, name=it.get("username") or None,
                                 cover=it.get("url"),
                                 extra={"modelVersionIds": it.get("modelVersionIds")},
                                 remote_updated=_ts(it.get("createdAt")))
            else:
                versions = it.get("modelVersions") or []
                cover = ((versions[0] or {}).get("images") or [{}])[0].get("url") if versions else None
                fs.upsert_remote(kind, oid, name=it.get("name"), cover=cover,
                                 extra={"type": it.get("type")},
                                 remote_updated=_ts(it.get("lastVersionAt") or it.get("createdAt")))
            n += 1
        meta = data.get("metadata") or {}
        cursor = meta.get("nextCursor")
        pages += 1
        if not cursor or not items:
            break
    truncated = bool(cursor)  # 循环因页数上限退出但仍有下一页 → 截断
    return {"n": n, "truncated": truncated, "seen": seen}


async def _down_groups():
    """集合 → 本地分组;集合内图片条目 → 本地资产收藏(group 挂钩)."""
    cols = await civitai_client.trpc_query("collection.getAllUser", {})
    if isinstance(cols, dict):
        cols = cols.get("collections") or cols.get("items") or []
    n = 0
    for c in cols or []:
        cid = c.get("id")
        name = c.get("name")
        if not cid or not name:
            continue
        fs.upsert_group(str(name), civitai_id=int(cid),
                        updated_at=_ts(c.get("updatedAt") or c.get("createdAt")) or None)
        gid = None
        for g in fs.groups_list():
            if g["civitai_id"] == int(cid):
                gid = g["gid"]
                break
        try:
            items = await _trpc_paged("collection.getAllCollectionItems",
                                      {"collectionId": int(cid), "limit": 100}, "items")
        except civitai_client.CivitaiError:
            items = []
        for it in items:
            img = it.get("image") or {}
            iid = str(img.get("id") or it.get("imageId") or "")
            if not iid:
                continue
            fs.upsert_remote(fs.KIND_ASSET, iid, group_id=gid,
                             cover=img.get("url"),
                             extra={"modelVersionIds": img.get("modelVersionIds")},
                             remote_updated=_ts(it.get("createdAt")))
            n += 1
    return n


async def _upsync_models(result):
    """本地模型收藏上推:user.toggleFavorite(需 SocialWrite)."""
    dirty = [it for it in fs.list_items(include_deleted=True)
             if it["kind"] == fs.KIND_MODEL and it["dirty"]]
    for it in dirty:
        try:
            await civitai_client.trpc_mutation(
                "user.toggleFavorite",
                {"modelId": int(it["oid"]), "setTo": not it["deleted"]},
            )
            result["upsynced"] += 1
            fs.mark_synced(it["kind"], it["oid"], expected_updated=it["updated_at"])
        except civitai_client.TrpcScopeError as e:
            result["scope_hint"] = str(e)
            break
        except Exception as e:
            result["upsync_failed"] += 1
            result["errors"].append(str(e)[:160])


async def sync_now():
    """全量同步入口(设置页按钮/自动同步);返回计数供 UI 展示."""
    token = os.urandom(8).hex()
    if cache_store.kv_get(_SYNC_LOCK_KEY):
        return {"status": "busy"}
    cache_store.kv_put(_SYNC_LOCK_KEY, token, ttl=300)  # 防重入;finally 校验 token 再清
    result = {"assets_down": 0, "models_down": 0, "groups_down": 0, "upsynced": 0,
              "upsync_failed": 0, "scope_hint": "", "truncated": False, "errors": [],
              "at": time.time()}
    try:
        try:
            r = await _down_favorites(fs.KIND_ASSET)
            result["assets_down"] = r["n"]
            result["truncated"] = r["truncated"]
        except Exception as e:
            result["errors"].append("资产收藏读取: " + str(e)[:160])
        try:
            r = await _down_favorites(fs.KIND_MODEL)
            result["models_down"] = r["n"]
            if r["truncated"]:
                result["truncated"] = True
            else:
                # 未截断才做缺席对账(截断时"缺席"可能只是翻页上限,会误杀)
                await bg.run_bg(fs.mark_remote_absent, fs.KIND_MODEL, r["seen"])
        except Exception as e:
            result["errors"].append("模型收藏读取: " + str(e)[:160])
        try:
            result["groups_down"] = await _down_groups()
        except Exception as e:
            result["errors"].append("集合读取: " + str(e)[:160])
        await _upsync_models(result)
        await bg.run_bg(fs.purge_tombstones)
        result["status"] = "ok"
    finally:
        if cache_store.kv_get(_SYNC_LOCK_KEY) == token:
            cache_store.kv_delete(_SYNC_LOCK_KEY)
    return result
