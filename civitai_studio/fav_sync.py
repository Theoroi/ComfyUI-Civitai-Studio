"""收藏双向同步引擎 — 批1 重构(REST favorites 双通道退役后的定稿架构).

通道事实(2026-09-28 三方铁证,docs/research/favorites-api-research.md 待更新):
- REST /images?favorites=true 与 /models?favorites=true 均已废弃:参数被服务端忽略
  (官方域+镜像 civitai.red 双域对照返回同一批全站 Newest 图),/models 恒空
  (PR #4836 源码注释"no longer written since favorites were deprecated")。
- 收藏体系唯一真通道 = collections(tRPC):collection.getAllUser +
  getAllCollectionItems(下行),collection.upsert/saveItem/removeFromCollection(上行)。

批1架构:
- 下行:集合 → 本地分组;集合条目 → fav_items + fav_item_groups 挂载镜像
  (跨集合重复挂组与站方一致);计数只算真实新入库(upsert 返回 created)。
- 对账:已完整枚举的集合里消失的挂载 → 摘除;摘完零挂载的 remote 条目落墓碑
  (站方移除传播到本地)。软删挂载(本地移出待上推)不参与,防误杀在途改动。
- 上行:★模型 → user.toggleFavorite(需 SocialWrite);挂载 → saveItem/
  removeFromCollection 对账(需 CollectionsWrite),itemId 用下行缓存,旧数据
  无缓存时按需现拉该集合补查。
- Legacy:REST 残留机制已整体退役(批A),遗留组经组管理手动删除。

同步是"尽力而为"的合并:任何单通道失败不阻塞其它通道;结果逐项计数返回给设置页展示。
"""

import asyncio
import os
import time
from datetime import datetime

from . import bg, cache_store, civitai_client, config, favorites_store as fs
from .log import info, warn, error, debug

_PAGE_LIMIT = 100
_MAX_PAGES = 20  # 单方向单次同步最多 20 页(2000 条),够用且防失控
# ⚠️ cache_store.clear_cache 以字面量保留本键不清(F-S2-8,两处注释互指;改名需同步改)
_SYNC_LOCK_KEY = "fav:sync_inflight"
_COLITEMS_KEY = "fav:colitems_v3"  # cid → {u: updatedAt, m/i: {oid: collectionItemId}}(批5:v3 强制一轮全量重拉,存量坏封面/.mp4 交付名修复落地)

# 集合条目里的 image.url 是裸文件 UUID(非完整 CDN 链接);桶名是站方常量。
# 构造失败只影响封面显隐(onerror 隐藏),不影响收藏数据本身。
_IMG_BUCKET = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA"

_UPSYNC_DELAY = 0.5  # 逐条 POST 限速,防撞 429


def _cover_url(d, video=False):
    uuid = str((d or {}).get("url") or "")
    if not uuid:
        return None
    if uuid.startswith("http://") or uuid.startswith("https://"):
        return uuid
    # 批4 F2:视频实体交付名用 .mp4(站方 blob 按存储键路由,扩展名只用于前端识别类型走
    # <video> 渲染;实测 .jpeg 名对视频同样 302 到 video/mp4,但前端按扩展名判型会走 <img> 裂图)
    return f"{_IMG_BUCKET}/{uuid}/original=true/{uuid}.{'mp4' if video else 'jpeg'}"


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


def _extract_item_id(data):
    """saveItem 响应里抠集合条目主键(形状站方未承诺,多层防御)."""
    if not isinstance(data, dict):
        return None
    for cand in (data, data.get("collectionItem") or {}, data.get("item") or {}):
        v = cand.get("id")
        if isinstance(v, (int, str)) and str(v).isdigit() and int(v) > 0:
            return int(v)
    return None


async def _down_groups(heartbeat=None):
    """集合 → 本地分组;集合条目 → fav_items + 挂载镜像(跨集合多挂,批1-6).

    条目主键(itemId)随挂载缓存 — removeFromCollection 对账的必需品(批1-4)。
    增量:集合 updatedAt 未变 → 复用 kv 缓存的条目表跳过全量翻页;截断/失败的集合
    不写缓存、本轮不参与对账。
    heartbeat: 可选续锁回调,集合循环每轮调用(N-V1-1:大库首拉整段可能超锁 TTL)。
    返回 {"groups": 组数, "models_down"/"images_down": 首入库条目数,
    "mounts": 新挂载数, "seen": {cid: {"m"/"i": {oid: itemId}}}, "truncated": 枚举不完整}"""
    cols = await civitai_client.trpc_query("collection.getAllUser", {})
    if isinstance(cols, dict):
        cols = cols.get("collections") or cols.get("items") or []
    prev = {}
    for g in fs.groups_list():
        if g.get("civitai_id"):
            prev[int(g["civitai_id"])] = g
    cache = cache_store.kv_get(_COLITEMS_KEY)
    if not isinstance(cache, dict):
        cache = {}
    g_n = m_n = i_n = mounts = 0
    seen, any_tr = {}, False
    new_cache = {}
    if not cols:
        # 空结果保守处理:要么用户真清空了全部集合,要么响应异常——都按"枚举不完整"
        # 跳过本轮对账(墓碑终局,误杀不可自愈;窄域复审 O1)
        cache_store.kv_put(_COLITEMS_KEY, {})
        return {"groups": 0, "models_down": 0, "images_down": 0, "mounts": 0,
                "seen": {}, "truncated": True}
    for c in cols:
        if heartbeat:
            heartbeat()  # N-V1-1:逐集合推进中续锁,防大库首拉整段超过锁 TTL
        cid, name, ctype = c.get("id"), c.get("name"), c.get("type")
        if not cid or not name or ctype == "Article":
            continue  # 文章书签集合与插件无关
        if c.get("mode") == "Bookmark":
            # 批4 F1:站方系统集合(Liked Models 等)——成员由 ❤ 状态托管,removeFromCollection
            # 会被站方按 ❤ 拉回。存 ctype="Bookmark" 让 UI 只读(picker/筛选/组管理排除),上行一律跳过
            ctype = "Bookmark"
        cid = int(cid)
        ts = _ts(c.get("updatedAt") or c.get("createdAt"))
        # 新集合首次落地 prev 里还没有映射:必须用 upsert 返回的 gid,
        # 否则本轮条目全部挂不上组(集合"看似同步了但空")
        is_new = cid not in prev
        g = fs.upsert_group(str(name), civitai_id=cid, ctype=ctype, updated_at=ts or None)
        gid = (g or {}).get("gid") or (prev.get(cid) or {}).get("gid")
        g_n += 1 if is_new else 0  # 只计新增组(E2E #6:每轮"分组 +6"虚标)
        p = prev.get(cid)
        cached = cache.get(str(cid))
        # 增量判定以缓存自带 u 为准(批A修复):组行 updated_at 在"先落组后拉条目"
        # 的时序里可能被失败轮锚定成新值,拿它比对会让陈旧缓存永远命中(实测
        # pending 混入 2852917/缺 929497、Images 组空的根因);缓存 u 不匹配 → 全量重拉
        if cached is not None and abs((cached.get("u") or 0) - ts) < 1:
            # 集合未变:复用上轮条目表,跳过全量翻页;仍要补挂载(自愈老库迁移造成的
            # 缺失挂载 — 否则未变化的集合永远修不好,E2E 实测 encoder 空组)
            seen[cid] = {"m": cached.get("m") or {}, "i": cached.get("i") or {}}
            new_cache[str(cid)] = cached
            for oid2 in (cached.get("m") or {}):
                mounts += 1 if fs.membership_add(fs.KIND_MODEL, oid2, gid, source="remote",
                                                 item_id=(cached.get("m") or {}).get(oid2),
                                                 pushed=1) else 0
            for oid2 in (cached.get("i") or {}):
                mounts += 1 if fs.membership_add(fs.KIND_ASSET, oid2, gid, source="remote",
                                                 item_id=(cached.get("i") or {}).get(oid2),
                                                 pushed=1) else 0
            continue
        debug(f"集合 {cid}「{name}」ts={ts:.0f} 增量判定: prev={p is not None} cached={cached is not None}")
        try:
            items, tr = await _trpc_paged("collection.getAllCollectionItems",
                                          {"collectionId": cid, "limit": _PAGE_LIMIT},
                                          "collectionItems")
            any_tr = any_tr or tr
        except civitai_client.CivitaiError as e:
            warn(f"集合 {cid}「{name}」条目拉取失败(本轮不对账该集合): {e}")
            items = []
            tr = True  # 与截断同路:不写缓存,下轮强制重拉
            any_tr = True  # 单集合失败=枚举不完整,防缺席对账误杀其条目(评审R1 D2-3)
        if tr:
            # 截断/失败:条目仍入库(有多少算多少),但不写缓存——下轮 cache miss 强制
            # 重拉,防"空/部分 id 集"被当成完整集参与下轮对账(窄域复审 H1)
            continue
        tab = {"m": {}, "i": {}}
        for it in items:
            et = str(it.get("type") or "")
            d = it.get("data") or {}
            oid = str(d.get("id") or "")
            item_id = it.get("id")
            item_id = int(item_id) if isinstance(item_id, (int, str)) and str(item_id).isdigit() else None
            if not oid:
                continue
            if et == "image":
                tab["i"][oid] = item_id
                is_vid = str(d.get("type") or "") == "video"
                st = fs.upsert_remote(fs.KIND_ASSET, oid, group_id=gid,
                                      cover=_cover_url(d, video=is_vid),
                                      extra={"modelVersionIds": d.get("modelVersionIds")
                                             or d.get("modelVersionIdsManual"),
                                             "nsfwLevel": d.get("nsfwLevel"),  # 批F:遮罩用
                                             "type": d.get("type"),  # 批4 F2:前端识别视频
                                             "baseModel": d.get("baseModel"),  # 批4 D1:无 meta 图详情底模
                                             "width": d.get("width"), "height": d.get("height")},
                                      remote_updated=_ts(it.get("createdAt")), resurrect=True)
                i_n += 1 if st == "created" else 0
            elif et == "model":
                tab["m"][oid] = item_id
                # 批4 F3:首图是视频时 _cover_url 拼 .jpeg 必 404(实测 TE_SoLordZ_ZImage_Krea2
                # images[0..1] 全是 video)——优先第一张静态图,全视频才回退首视频(.mp4 交付名)
                imgs = [im for im in (d.get("images") or []) if isinstance(im, dict) and im.get("url")]
                pic = next((im for im in imgs if str(im.get("type") or "image") == "image"), None) \
                    or (imgs[0] if imgs else None)
                st = fs.upsert_remote(fs.KIND_MODEL, oid, group_id=gid, name=d.get("name"),
                                      cover=_cover_url(pic or {}, video=bool(pic and pic.get("type") == "video")),
                                      extra={"type": d.get("type"), "baseModels": d.get("baseModels")},
                                      remote_updated=_ts(d.get("lastVersionAt") or it.get("createdAt")))
                m_n += 1 if st == "created" else 0
            else:
                continue
            if gid:
                key = "m" if et == "model" else "i"
                kind = fs.KIND_MODEL if et == "model" else fs.KIND_ASSET
                mounts += 1 if fs.membership_add(kind, oid, gid, source="remote",
                                                 item_id=item_id, pushed=1) else 0
        seen[cid] = tab
        new_cache[str(cid)] = {"u": ts, "m": tab["m"], "i": tab["i"]}
        debug(f"集合 {cid}「{name}」条目: 模型 {len(tab['m'])} 图 {len(tab['i'])} truncated={tr}")
    cache_store.kv_put(_COLITEMS_KEY, new_cache)
    info(f"集合下行完成: 分组 {g_n} · 新模型 {m_n} · 新图片 {i_n} · 新挂载 {mounts}"
         + (" · 枚举不完整" if any_tr else ""))
    return {"groups": g_n, "models_down": m_n, "images_down": i_n, "mounts": mounts,
            "seen": seen, "truncated": any_tr}


def _reconcile_down(seen_by_cid):
    """远端权威对账(挂载级,批1-4 下行半):本次完整枚举的集合里消失的挂载 → 硬摘;
    因此变孤儿的 remote 条目(曾挂载、现零挂载、无在途软删)落墓碑。
    软删挂载(本地移出待 removeFromCollection)不参与——在途本地改动优先。
    bg 线程执行;返回 {"removed": 摘除挂载数, "tombstoned": 墓碑数}。"""
    groups = {g["gid"]: g for g in fs.groups_list()}
    removed = 0
    touched = set()  # (kind, oid) 本轮摘过挂载的条目
    for mem in fs.memberships(include_deleted=False):
        g = groups.get(mem["gid"])
        cid = int(g["civitai_id"]) if g and g.get("civitai_id") else None
        tab = seen_by_cid.get(cid) if cid else None
        if tab is None:
            continue  # 集合本轮未完整枚举:不动
        if mem["source"] == "local" and not mem["pushed"]:
            continue  # 待上推的本地挂载:远端看不见属预期
        key = "m" if mem["kind"] == fs.KIND_MODEL else "i"
        if str(mem["oid"]) in (tab.get(key) or {}):
            continue
        if fs.membership_remove(mem["kind"], mem["oid"], mem["gid"], hard=True):
            removed += 1
            touched.add((mem["kind"], mem["oid"]))
            debug(f"对账摘除挂载: {mem['kind']} {mem['oid']} ← 集合 {cid}(远端已不存在)")
    tomb = 0
    for kind, oid in touched:
        it = fs.get_item(kind, oid)
        if not it or it["deleted"] or it["dirty"] or it["src"] != "remote":
            continue
        # 本轮摘的是"远端已不存在"的挂载;若条目仍有活动挂载(跨集合)或软删在途
        # (本地移出待上推)则保留,否则=站方已把它移出所有集合 → 墓碑退场
        if fs.memberships(kind, oid):
            continue
        if fs.memberships(kind, oid, include_deleted=True):
            continue
        fs.mark_remote_tombstone(kind, oid)
        tomb += 1
        debug(f"对账墓碑: {kind} {oid}(站方已移出全部集合)")
    info(f"远端对账完成: 摘除挂载 {removed} · 墓碑 {tomb}")
    return {"removed": removed, "tombstoned": tomb}


async def _upsync_models(result):
    """本地模型收藏上推:user.toggleFavorite(需 SocialWrite)."""
    dirty = [it for it in fs.list_items(include_deleted=True)
             if it["kind"] == fs.KIND_MODEL and it["dirty"]]
    info(f"模型★上推: 待同步 {len(dirty)} 条")
    for it in dirty:
        try:
            debug(f"★上推: model {it['oid']} setTo={not it['deleted']}")
            await civitai_client.trpc_mutation(
                "user.toggleFavorite",
                {"modelId": int(it["oid"]), "setTo": not it["deleted"]},
            )
            result["upsynced"] += 1
            fs.mark_synced(it["kind"], it["oid"], expected_updated=it["updated_at"])
        except civitai_client.TrpcScopeError as e:
            warn(f"★上推跳过(缺作用域,不中断): {e}")
            result["scope_hint"] = str(e)
            break
        except Exception as e:
            error(f"★上推失败: model {it['oid']}: {e}")
            result["upsync_failed"] += 1
            result["errors"].append(str(e)[:160])


async def _upsync_removals(result, groups):
    """挂载移除对账(批1-4):本地已摘、远端还在的挂载 → removeFromCollection。

    ⚠️ itemId 语义(2026-09-28 源码实证 collection.service.ts removeCollectionItem):
    站方按 CollectionItem."modelId"/."imageId" = itemId 匹配删除 — itemId 是
    模型/图片实体 id(= 本地 oid),不是 getAllCollectionItems 行的条目主键。
    "Item not found" 幂等化为成功:远端已无此条目时删除目标本已达成(站方删的/
    早前重复移除的),硬删本地软删行并计入 items_rm。"""
    for mem in fs.memberships(include_deleted=True):
        if not mem["deleted"] or not mem["pushed"]:
            continue
        g = groups.get(mem["gid"])
        if g and g.get("ctype") == "Bookmark":
            # 批4 F1:系统集合(Liked Models)成员归站方 ❤ 托管,removeFromCollection 会被站方
            # 按 ❤ 状态拉回(实测"移除了又回来")。本地行直接硬清,远端交给 toggleFavorite 闭环
            fs.membership_remove(mem["kind"], mem["oid"], mem["gid"], hard=True)
            continue
        if not g or not g.get("civitai_id"):
            fs.mark_membership_removed(mem["kind"], mem["oid"], mem["gid"])
            continue  # 组已删:远端无从对账,本地清账
        try:
            debug(f"移除对账: {mem['kind']} {mem['oid']} ← 集合 {g['civitai_id']}(itemId=实体id)")
            await civitai_client.trpc_mutation(
                "collection.removeFromCollection",
                {"collectionId": int(g["civitai_id"]), "itemId": int(mem["oid"])})
            fs.mark_membership_removed(mem["kind"], mem["oid"], mem["gid"])
            result["items_rm"] += 1
            await asyncio.sleep(_UPSYNC_DELAY * 0.6)
        except civitai_client.TrpcScopeError as e:
            warn(f"移除对账跳过(缺作用域): {e}")
            result["scope_hint"] = str(e)
            return
        except civitai_client.CivitaiError as e:
            if "not found" in str(e).lower():
                # 远端本就没有(站方移除/重复对账):目标状态已达成,幂等清账
                debug(f"移除对账幂等: {mem['kind']} {mem['oid']} ← 集合 {g['civitai_id']} 远端已无")
                fs.mark_membership_removed(mem["kind"], mem["oid"], mem["gid"])
                result["items_rm"] += 1
                continue
            error(f"移除对账失败: {mem['kind']} {mem['oid']} ← 集合 {g['civitai_id']}: {e}")
            result["items_rm_failed"] = result.get("items_rm_failed", 0) + 1
            result["errors"].append("移除对账: " + str(e)[:120])
        except Exception as e:
            error(f"移除对账失败: {mem['kind']} {mem['oid']} ← 集合 {g['civitai_id']}: {e}")
            result["items_rm_failed"] = result.get("items_rm_failed", 0) + 1
            result["errors"].append("移除对账: " + str(e)[:120])


async def _upsync_groups(result):
    """挂载上行(需 key 勾选 CollectionsWrite):
    - 已同步过的组改名 → collection.upsert {id, name}
    - 本地新建组:惰性建集——首条条目推送时才 upsert(按条目类型定 CollectionType)
    - 未推挂载 → collection.saveItem,成功记 pushed=1 + 集合条目主键
    - 软删挂载先走 _upsync_removals(先移后加,防同条目同集合闪推)"""
    kind_enum = {fs.KIND_ASSET: "Image", fs.KIND_MODEL: "Model"}

    async def ensure_collection(g, item_kind):
        if g.get("civitai_id"):
            return g["civitai_id"]
        data = await civitai_client.trpc_mutation(
            "collection.upsert", {"name": (g["name"] or "collection")[:30],
                                  "type": kind_enum[item_kind]})
        cid = int((data or {}).get("id") or 0) if isinstance(data, dict) else 0
        if not cid:
            # F-S2-2(低配版):建集响应缺 id(集合其实可能已建成)时按名回收既有集合,
            # 防"建成了却被判失败"每轮重复建集;比对名与建集同口径 [:30] 截断。
            try:
                cols = await civitai_client.trpc_query("collection.getAllUser", {})
                if isinstance(cols, dict):
                    cols = cols.get("collections") or cols.get("items") or []
                want = (g["name"] or "collection")[:30]
                for c in cols:
                    if not isinstance(c, dict) or c.get("type") == "Article":
                        continue  # 与下行同口径:文章书签集合与插件无关
                    if c.get("mode") == "Bookmark":
                        continue  # N-V1-2:站方系统集合(❤ 托管)不回收,防普通组被绑到 ❤ 集合
                    if str(c.get("name") or "")[:30] == want and c.get("id"):
                        cid = int(c.get("id"))
                        debug(f"建集响应缺 id,按名回收既有集合: 「{want}」 → {cid}")
                        break
            except Exception as e:  # 回收失败保持现行为:本轮放弃该组(cid=0)
                debug(f"按名回收集合失败(忽略): {e}")
        if cid:
            fs.mark_group_synced(g["gid"], cid)
            g["civitai_id"] = cid
            result["groups_up"] += 1
        return cid or 0

    groups = {g["gid"]: g for g in fs.groups_list()}
    for g in groups.values():
        if g["dirty"] and g["civitai_id"] and g.get("ctype") != "Bookmark":
            # F-S2-5:Bookmark 系统集合(名字站方托管)改名一律不上行,只读
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
    await _upsync_removals(result, groups)
    for it in fs.list_items(include_deleted=False):
        for mem in fs.memberships(it["kind"], it["oid"]):
            if mem["deleted"] or mem["pushed"]:
                continue
            g = groups.get(mem["gid"])
            if not g or g.get("ctype") == "Bookmark":
                continue  # F-S2-5:系统集合成员由站方 ❤ 托管,saveItem 会被 ❤ 状态打架
            try:
                cid = await ensure_collection(g, it["kind"])
                if not cid:
                    continue
                js = {"type": kind_enum[it["kind"]],
                      "collections": [{"collectionId": cid}]}
                js["imageId" if it["kind"] == fs.KIND_ASSET else "modelId"] = int(it["oid"])
                debug(f"条目上行: {it['kind']} {it['oid']} → 集合 {cid}")
                data = await civitai_client.trpc_mutation("collection.saveItem", js)
                rid = _extract_item_id(data)
                if rid is None:
                    debug(f"saveItem 响应未含条目主键(移除对账将走补查)")
                fs.mark_membership_pushed(it["kind"], it["oid"], mem["gid"], item_id=rid)
                result["items_up"] += 1
                await asyncio.sleep(_UPSYNC_DELAY)  # 限速:存量首推为逐条 POST,防撞 429
            except civitai_client.TrpcScopeError as e:
                warn(f"条目上行跳过(缺作用域): {e}")
                result["scope_hint"] = str(e)
                return
            except Exception as e:
                error(f"条目上行失败: {it['kind']} {it['oid']} → 集合 {g.get('civitai_id')}: {e}")
                result["items_up_failed"] = result.get("items_up_failed", 0) + 1
                result["errors"].append("条目上行: " + str(e)[:120])


async def sync_now():
    """全量同步入口(设置页按钮/自动同步);返回计数供 UI 展示.

    下行唯一通道 = collections(tRPC);REST favorites 双通道已退役(参数被站方忽略,
    拉回的是全站热门图)。Legacy 垃圾组与其未分组残留首次同步一次性清理。"""
    token = os.urandom(8).hex()
    if not cache_store.kv_putnx(_SYNC_LOCK_KEY, token, ttl=1800):  # 原子占位防 TOCTOU(评审R1 F2)
        return {"status": "busy"}
    result = {"groups_down": 0, "models_down": 0, "images_down": 0, "mounts": 0,
              "groups_up": 0, "items_up": 0, "items_rm": 0, "items_rm_failed": 0,
              "items_up_failed": 0, "upsynced": 0, "upsync_failed": 0, "scope_hint": "",
              "tombstoned": 0, "removed": 0,
              "truncated": False, "errors": [], "at": time.time()}
    _cfg = config.load()
    info(f"同步开始: mirror={_cfg.get('mirror') or '(默认)'}"
         f" proxy={'有' if _cfg.get('proxy') else '无'}"
         f" key={'有' if (_cfg.get('api_key') or '') else '无'}")
    hb_stopped = False

    def _heartbeat():
        # F-S2-8:锁心跳 — 大库首拉/逐条限速上推可能超过锁 TTL(30 分钟),各阶段间续期;
        # 值仍为本轮 token,finally 的持有核对删除不受影响。
        # N-V1-1:compare-and-set — 值仍是本轮 token 才续期;已被并发轮换走时盲覆写
        # 会把锁偷回来造成双轮并行,故 warn 一条并停止续期
        nonlocal hb_stopped
        if hb_stopped:
            return
        if cache_store.kv_get(_SYNC_LOCK_KEY) == token:
            cache_store.kv_put(_SYNC_LOCK_KEY, token, ttl=1800)
        else:
            hb_stopped = True
            warn("同步锁已被他人持有,本轮心跳停止(不再续期)")

    try:
        d = {"seen": {}, "truncated": True}
        try:
            d = await _down_groups(heartbeat=_heartbeat)
            result["groups_down"] = d["groups"]
            result["models_down"] = d["models_down"]
            result["images_down"] = d["images_down"]
            result["mounts"] = d["mounts"]
            if d["truncated"]:
                result["truncated"] = True  # 仅真实枚举不完整才提示
        except Exception as e:
            result["errors"].append("集合读取(本轮跳过缺席对账): " + str(e)[:160])
        if not d["truncated"]:
            # 对账门控:枚举不完整(截断/失败/空列表)绝不执行,防误杀(评审R1 D2-1/O1)
            try:
                rc = await bg.run_bg(_reconcile_down, d["seen"])
                result["removed"] = rc["removed"]
                result["tombstoned"] = rc["tombstoned"]
            except Exception as e:
                result["errors"].append("远端对账: " + str(e)[:160])
        _heartbeat()
        await _upsync_models(result)
        _heartbeat()
        await _upsync_groups(result)
        _heartbeat()
        await bg.run_bg(fs.purge_tombstones)
        result["status"] = "ok"
        info("同步结束: " + " ".join(
            f"{k}={result[k]}" for k in
            ("groups_down", "models_down", "images_down", "mounts", "items_up",
             "items_rm", "items_rm_failed", "items_up_failed", "upsynced",
             "upsync_failed", "removed", "tombstoned", "truncated")))
        for e in result["errors"]:
            error("同步错误项: " + e)
        if result["scope_hint"]:
            warn("作用域提示: " + result["scope_hint"])
    finally:
        if cache_store.kv_get(_SYNC_LOCK_KEY) == token:
            cache_store.kv_delete(_SYNC_LOCK_KEY)
    return result
