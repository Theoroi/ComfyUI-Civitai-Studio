"""收藏双向同步引擎 — 能力矩阵与实测依据见 docs/research/favorites-api-research.md.

矩阵(E2E 11.x 重构后):
- 资产(图片)收藏:以集合为主通道 — tRPC collection.getAllUser + getAllCollectionItems
  (条目键 collectionItems,实体在 data 字段,type=model/image);旧版 REST
  /images?favorites=true 读路(web 已不可见)由 fav_pull_legacy 开关控制,默认关,
  开启时落入 ctype='Legacy' 哨兵分组,关闭时同步清理其残留;本地→远端 ❌(无公开端点)
- 模型收藏:双向 ✅(读 REST /models?favorites=true;写 tRPC user.toggleFavorite,
  需 key 勾选 SocialWrite — 缺作用域时返回 scope_hint,不中断下同步)
- 集合/分组:读 tRPC collection.getAllUser(type=Model/Image,Article 跳过)+getAllCollectionItems;
  写 collection.upsert/saveItem(需 CollectionsRead/写作用域;ctype='Legacy' 组不上行)
- 冲突:updated_at 新者胜(本地 dirty 视为最新,远端让位)

同步是"尽力而为"的合并:任何单通道失败不阻塞其它通道;结果逐项计数返回给设置页展示。
"""

import asyncio
import os
import time
from datetime import datetime

from . import bg, cache_store, civitai_client, config, favorites_store as fs

_PAGE_LIMIT = 50
_MAX_PAGES = 20  # 单方向单次同步最多 20 页(1000 条),够用且防失控
_SYNC_LOCK_KEY = "fav:sync_inflight"

# 集合条目里的 image.url 是裸文件 UUID(非完整 CDN 链接);桶名是站方常量。
# 构造失败只影响封面显隐(onerror 隐藏),不影响收藏数据本身。
_IMG_BUCKET = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA"


def _cover_url(d):
    uuid = str((d or {}).get("url") or "")
    if not uuid:
        return None
    if uuid.startswith("http://") or uuid.startswith("https://"):
        return uuid
    return f"{_IMG_BUCKET}/{uuid}/original=true/{uuid}.jpeg"


def _ts(iso):
    """Civitai ISO 时间 → epoch;解析失败返回 0(视为很旧)."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return 0.0


async def _trpc_paged(proc, base_input, item_key):
    """tRPC 分页 query 包装:getAllCollectionItems(cursor 型,条目键 collectionItems)."""
    items, cursor, pages = [], None, 0
    while pages < _MAX_PAGES:
        js = dict(base_input or {})
        if cursor:
            js["cursor"] = cursor
        data = await civitai_client.trpc_query(proc, js)
        page = data.get(item_key) if isinstance(data, dict) else data
        items.extend(page or [])
        cursor = (data or {}).get("nextCursor") if isinstance(data, dict) else None
        pages += 1
        if not cursor or not page:
            break
    return items


async def _down_favorites(kind, group_id=None):
    """REST 收藏读。返回 {n, truncated, seen}:truncated=翻到页数上限;seen=本次远端
    存在的 id 集(供缺席对账)。group_id 非空时条目落入该组(legacy 下行 → Legacy 组)。"""
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
                                 cover=it.get("url"), group_id=group_id,
                                 extra={"modelVersionIds": it.get("modelVersionIds")},
                                 remote_updated=_ts(it.get("createdAt")))
            else:
                versions = it.get("modelVersions") or []
                cover = ((versions[0] or {}).get("images") or [{}])[0].get("url") if versions else None
                fs.upsert_remote(kind, oid, name=it.get("name"), cover=cover, group_id=group_id,
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
    """集合 → 本地分组;集合条目 → 本地收藏并挂钩分组。

    实测(E2E 修复依据):getAllUser {} 返回集合数组,元素含 type(Model/Image/Article);
    条目分页键是 collectionItems(不是 items);条目实体在 data 字段,
    type="model"/"image" 对应模型/图片——旧实现读 items/image 键导致收藏夹全空。
    返回 {"groups": 组数, "images": 图片条目数}。"""
    cols = await civitai_client.trpc_query("collection.getAllUser", {})
    if isinstance(cols, dict):
        cols = cols.get("collections") or cols.get("items") or []
    by_cid = {}
    for g in fs.groups_list():
        if g.get("civitai_id"):
            by_cid[int(g["civitai_id"])] = g["gid"]
    g_n = i_n = 0
    for c in cols or []:
        cid, name, ctype = c.get("id"), c.get("name"), c.get("type")
        if not cid or not name or ctype == "Article":
            continue  # 文章书签集合与插件无关
        # 新集合首次落地 by_cid 里还没有映射:必须用 upsert 返回的 gid,
        # 否则本轮条目全部挂不上组(集合"看似同步了但空")
        g = fs.upsert_group(str(name), civitai_id=int(cid), ctype=ctype,
                            updated_at=_ts(c.get("updatedAt") or c.get("createdAt")) or None)
        gid = (g or {}).get("gid") or by_cid.get(int(cid))
        g_n += 1
        try:
            items = await _trpc_paged("collection.getAllCollectionItems",
                                      {"collectionId": int(cid), "limit": 100}, "collectionItems")
        except civitai_client.CivitaiError:
            items = []
        for it in items:
            et = str(it.get("type") or "")
            d = it.get("data") or {}
            oid = str(d.get("id") or "")
            if not oid:
                continue
            if et == "image":
                fs.upsert_remote(fs.KIND_ASSET, oid, group_id=gid,
                                 cover=_cover_url(d),
                                 extra={"modelVersionIds": d.get("modelVersionIds")
                                        or d.get("modelVersionIdsManual")},
                                 remote_updated=_ts(it.get("createdAt")))
                i_n += 1
            elif et == "model":
                fs.upsert_remote(fs.KIND_MODEL, oid, group_id=gid, name=d.get("name"),
                                 cover=_cover_url(((d.get("images") or [{}])[0] or {})),
                                 extra={"type": d.get("type"), "baseModels": d.get("baseModels")},
                                 remote_updated=_ts(d.get("lastVersionAt") or it.get("createdAt")))
    return {"groups": g_n, "images": i_n}


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


async def _upsync_groups(result):
    """分组上行(需 key 勾选 CollectionsWrite):
    - 已同步过的组改名 → collection.upsert {id, name}
    - 本地新建组:惰性建集——首条条目推送时才 upsert(按条目类型定 CollectionType)
    - 组内条目 → collection.saveItem,成功记入 gpushed 防重推"""
    kind_enum = {fs.KIND_ASSET: "Image", fs.KIND_MODEL: "Model"}

    async def ensure_collection(g, item_kind):
        if g.get("civitai_id"):
            return g["civitai_id"]
        data = await civitai_client.trpc_mutation(
            "collection.upsert", {"name": (g["name"] or "collection")[:30],
                                  "type": kind_enum[item_kind]})
        cid = int((data or {}).get("id") or 0) if isinstance(data, dict) else 0
        if cid:
            fs.mark_group_synced(g["gid"], cid)
            g["civitai_id"] = cid
            result["groups_up"] += 1
        return cid or 0

    groups = {g["gid"]: g for g in fs.groups_list()}
    for g in groups.values():
        if g["dirty"] and g["civitai_id"]:
            try:  # 已绑定集合:本地改名上行
                await civitai_client.trpc_mutation(
                    "collection.upsert", {"id": g["civitai_id"], "name": g["name"][:30]})
                fs.mark_group_synced(g["gid"], g["civitai_id"])
                result["groups_up"] += 1
            except civitai_client.TrpcScopeError as e:
                result["scope_hint"] = str(e)
                return
            except Exception as e:
                result["errors"].append("分组上行: " + str(e)[:160])
    for it in fs.list_items(include_deleted=False):
        gid = it["group_id"]
        if not gid:
            continue
        g = groups.get(gid)
        if not g:
            continue
        if g.get("ctype") == fs.LEGACY_CTYPE:
            continue  # legacy 残留组不上行(无对应远端集合,也绝不替它建)
        try:
            cid = await ensure_collection(g, it["kind"])
            if not cid or gid in (it.get("gpushed") or []):
                continue
            js = {"type": kind_enum[it["kind"]],
                  "collections": [{"collectionId": cid}]}
            js["imageId" if it["kind"] == fs.KIND_ASSET else "modelId"] = int(it["oid"])
            await civitai_client.trpc_mutation("collection.saveItem", js)
            fs.mark_group_pushed(it["kind"], it["oid"], gid)
            result["items_up"] += 1
            await asyncio.sleep(0.5)  # 限速:存量首推为逐条 POST,防撞 429
        except civitai_client.TrpcScopeError as e:
            result["scope_hint"] = str(e)
            return
        except Exception as e:
            result["items_up_failed"] = result.get("items_up_failed", 0) + 1
            result["errors"].append("条目上行: " + str(e)[:120])


async def sync_now():
    """全量同步入口(设置页按钮/自动同步);返回计数供 UI 展示.

    图片收藏下行以集合(collections)为准;旧版 /images?favorites=true 读路是 Civitai
    改版前的遗留表,web 上已不可见(E2E 11.1"虚标1000"),由 fav_pull_legacy 开关控制,
    默认关 + 落入 Legacy 分组;关闭时同步清理其残留(未分组 remote 资产行)。"""
    token = os.urandom(8).hex()
    if cache_store.kv_get(_SYNC_LOCK_KEY):
        return {"status": "busy"}
    cache_store.kv_put(_SYNC_LOCK_KEY, token, ttl=1800)  # 防重入;存量首推带 0.5s/条限速,最坏可达 30 分钟,finally 校验 token 再清
    result = {"assets_down": 0, "models_down": 0, "groups_down": 0, "groups_up": 0,
              "items_up": 0, "upsynced": 0, "upsync_failed": 0, "scope_hint": "",
              "collection_images": 0, "legacy_purged": 0,
              "truncated": False, "errors": [], "at": time.time()}
    try:
        legacy = bool(config.load().get("fav_pull_legacy"))
        if legacy:
            try:
                legacy_gid = await bg.run_bg(fs.ensure_legacy_group)
                r = await _down_favorites(fs.KIND_ASSET, group_id=legacy_gid)
                result["assets_down"] = r["n"]
                result["truncated"] = r["truncated"]
            except Exception as e:
                result["errors"].append("旧版图片收藏读取: " + str(e)[:160])
        else:
            try:
                result["legacy_purged"] = await bg.run_bg(fs.purge_legacy_ungrouped)
            except Exception as e:
                result["errors"].append("legacy 残留清理: " + str(e)[:160])
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
            d = await _down_groups()
            result["groups_down"] = d["groups"]
            result["collection_images"] = d["images"]
        except Exception as e:
            result["errors"].append("集合读取: " + str(e)[:160])
        await _upsync_models(result)
        await _upsync_groups(result)
        await bg.run_bg(fs.purge_tombstones)
        result["status"] = "ok"
    finally:
        if cache_store.kv_get(_SYNC_LOCK_KEY) == token:
            cache_store.kv_delete(_SYNC_LOCK_KEY)
    return result
