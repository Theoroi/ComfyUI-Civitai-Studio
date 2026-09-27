"""收藏双向同步引擎 — 能力矩阵与实测依据见 docs/research/favorites-api-research.md.

矩阵(E2E 11.x 重构后):
- 资产(图片)收藏:以集合为主通道 — tRPC collection.getAllUser + getAllCollectionItems
  (条目键 collectionItems,实体在 data 字段,type=model/image);旧版 REST
  /images?favorites=true 读路(web 已不可见)由 fav_pull_legacy 开关控制,默认关,
  开启时落入 ctype='Legacy' 哨兵分组,关闭状态下首次同步一次性清理其残留;本地→远端 ❌(无公开端点)
- 模型收藏:双向 ✅(读 REST /models?favorites=true;写 tRPC user.toggleFavorite,
  需 key 勾选 SocialWrite — 缺作用域时返回 scope_hint,不中断下同步)
- 集合/分组:读 tRPC collection.getAllUser(type=Model/Image,Article 跳过)+getAllCollectionItems;
  写 collection.upsert/saveItem(需 CollectionsRead/写作用域;ctype='Legacy' 组不上行)
- 冲突:updated_at 新者胜(本地 dirty 视为最新,远端让位)

同步是"尽力而为"的合并:任何单通道失败不阻塞其它通道;结果逐项计数返回给设置页展示。
"""

import asyncio
import json
import os
import time
from datetime import datetime

from . import bg, cache_store, civitai_client, config, favorites_store as fs

_PAGE_LIMIT = 50
_MAX_PAGES = 20  # 单方向单次同步最多 20 页(1000 条),够用且防失控
_SYNC_LOCK_KEY = "fav:sync_inflight"
_COLMODELS_KEY = "fav:colmodels"  # cid → 集合内模型 id 集(增量跳过用)

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
    """tRPC 分页 query 包装:getAllCollectionItems(cursor 型,条目键 collectionItems).
    返回 (items, truncated):truncated=翻到页数上限时仍有下一页."""
    items, cursor, pages = [], None, 0
    while pages < _MAX_PAGES:
        js = dict(base_input or {})
        if cursor:
            js["cursor"] = cursor
        data = await civitai_client.trpc_query(proc, js)
        page = data.get(item_key) if isinstance(data, dict) else data
        if page is None:
            # 条目键缺失(站方若再改键名):按不完整处理,防下游对账误杀(评审R1 D2-5)
            return items, True
        items.extend(page or [])
        cursor = (data or {}).get("nextCursor") if isinstance(data, dict) else None
        pages += 1
        if not cursor or not page:
            return items, False
    return items, True


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
    """集合 → 本地分组;集合条目 → 本地收藏并挂钩分组.

    实测(E2E 修复依据):getAllUser {} 返回集合数组,元素含 type(Model/Image/Article);
    条目分页键是 collectionItems(不是 items);条目实体在 data 字段,
    type="model"/"image" 对应模型/图片——旧实现读 items/image 键导致收藏夹全空.
    增量(评审R1 P1):集合 updatedAt 未变 → 条目集不变,复用 kv 缓存的模型 id 集
    跳过全量翻页(重户同步从每轮几十请求降到 1+N_变更);集合被删时其缓存随
    本轮重建自然淘汰;本地手动改组不被远端重置.
    返回 {"groups": 组数, "images": 本轮实拉图片条目数, "model_ids": 全量模型 id 集,
    "truncated": 任一通道枚举不完整}."""
    cols = await civitai_client.trpc_query("collection.getAllUser", {})
    if isinstance(cols, dict):
        cols = cols.get("collections") or cols.get("items") or []
    prev = {}
    for g in fs.groups_list():
        if g.get("civitai_id"):
            prev[int(g["civitai_id"])] = g
    cache = cache_store.kv_get(_COLMODELS_KEY)  # kv_get 返回已解码对象
    if not isinstance(cache, dict):
        cache = {}
    g_n = i_n = 0
    m_seen, any_tr = set(), False
    new_cache = {}
    if not cols:
        # 空结果保守处理:要么用户真清空了全部集合,要么响应异常——都按"枚举不完整"
        # 跳过本轮对账(墓碑终局,误杀不可自愈;窄域复审 O1)
        cache_store.kv_put(_COLMODELS_KEY, {})
        return {"groups": 0, "images": 0, "model_ids": set(), "truncated": True}
    for c in cols:
        cid, name, ctype = c.get("id"), c.get("name"), c.get("type")
        if not cid or not name or ctype == "Article":
            continue  # 文章书签集合与插件无关
        cid = int(cid)
        ts = _ts(c.get("updatedAt") or c.get("createdAt"))
        # 新集合首次落地 prev 里还没有映射:必须用 upsert 返回的 gid,
        # 否则本轮条目全部挂不上组(集合"看似同步了但空")
        g = fs.upsert_group(str(name), civitai_id=cid, ctype=ctype, updated_at=ts or None)
        gid = (g or {}).get("gid") or (prev.get(cid) or {}).get("gid")
        g_n += 1
        p = prev.get(cid)
        cached = cache.get(str(cid))
        if p is not None and cached is not None and abs((p.get("updated_at") or 0) - ts) < 1:
            # 集合未变:复用上轮模型 id 集,跳过全量翻页(评审R1 P1)
            new_cache[str(cid)] = cached
            m_seen.update(str(x) for x in cached)
            continue
        try:
            items, tr = await _trpc_paged("collection.getAllCollectionItems",
                                          {"collectionId": cid, "limit": 100}, "collectionItems")
            any_tr = any_tr or tr
        except civitai_client.CivitaiError:
            items = []
            tr = True  # 与截断同路:不写缓存,下轮强制重拉
            any_tr = True  # 单集合失败=枚举不完整,防缺席对账误杀其模型(评审R1 D2-3)
        if tr:
            # 截断/失败:条目仍入库(有多少算多少),但不写缓存——下轮 cache miss 强制
            # 重拉,防"空/部分 id 集"被当成完整集参与下轮对账(窄域复审 H1)
            continue
        ids = []
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
                ids.append(oid)
                m_seen.add(oid)
                fs.upsert_remote(fs.KIND_MODEL, oid, group_id=gid, name=d.get("name"),
                                 cover=_cover_url(((d.get("images") or [{}])[0] or {})),
                                 extra={"type": d.get("type"), "baseModels": d.get("baseModels")},
                                 remote_updated=_ts(d.get("lastVersionAt") or it.get("createdAt")))
        new_cache[str(cid)] = ids
    cache_store.kv_put(_COLMODELS_KEY, new_cache)
    return {"groups": g_n, "images": i_n, "model_ids": m_seen, "truncated": any_tr}


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
    if not cache_store.kv_putnx(_SYNC_LOCK_KEY, token, ttl=1800):  # 原子占位防 TOCTOU(评审R1 F2);存量首推 0.5s/条限速,finally 校验 token 再清
        return {"status": "busy"}
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
        elif not cache_store.kv_get("legacy_purged_v1"):
            # 一次性清理残留(审计 F-4:每轮都清会吞掉"手动移出分组"的粘滞操作)
            try:
                result["legacy_purged"] = await bg.run_bg(fs.purge_legacy_ungrouped)
                cache_store.kv_put("legacy_purged_v1", True)
            except Exception as e:
                result["errors"].append("legacy 残留清理: " + str(e)[:160])
        # 模型 ★ 下行:full=完整枚举才允许缺席对账(评审R1 D2-1:失败路径若以空 seen
        # 参与对账,一次瞬时 429/WAF 就会把全部 ★ 模型误杀成墓碑)
        models_seen, models_full = set(), False
        try:
            r = await _down_favorites(fs.KIND_MODEL)
            result["models_down"] = r["n"]
            models_seen = r["seen"]
            models_full = not r["truncated"]
            if r["truncated"]:
                result["truncated"] = True  # 仅真实翻页截断才提示"仅同步前 1000 条"
        except Exception as e:
            result["errors"].append("模型收藏读取(本轮跳过缺席对账): " + str(e)[:160])
        d = {"model_ids": set(), "truncated": True}
        try:
            d = await _down_groups()
            result["groups_down"] = d["groups"]
            result["collection_images"] = d["images"]
            if d["truncated"]:
                result["truncated"] = True
        except Exception as e:
            result["errors"].append("集合读取(本轮跳过缺席对账): " + str(e)[:160])
        # 缺席对账口径 = REST ★ 收藏 ∪ 集合 model 条目(审计 F-3);两通道都完整枚举才执行
        if models_full and not d["truncated"]:
            await bg.run_bg(fs.mark_remote_absent, fs.KIND_MODEL, models_seen | d["model_ids"])
        await _upsync_models(result)
        await _upsync_groups(result)
        await bg.run_bg(fs.purge_tombstones)
        result["status"] = "ok"
    finally:
        if cache_store.kv_get(_SYNC_LOCK_KEY) == token:
            cache_store.kv_delete(_SYNC_LOCK_KEY)
    return result
