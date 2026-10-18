# -*- coding: utf-8 -*-
"""fav_sync 批1 重构桩测试:下行全走集合条目/跨集合挂组/挂载级缺席对账/
removeFromCollection 上行对账/Legacy 一次性整组清理/真实计数口径。
夹具 = 用户账号实测数据形状(base/checkpoint/encoder+pending 双挂/Images,其余空)。
离线运行:civitai_client trpc 全部打桩,存储层走真 sqlite(tmp)。"""
import asyncio, json, os, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_favsync_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store, config, fav_sync, favorites_store as fs
from civitai_studio.civitai_client import CivitaiError

ISO = "2026-09-28T00:00:00Z"

_STATE = {"trpc": {}, "items_calls": []}
_MUTS = []


def _set_trpc(payloads):
    _STATE["trpc"] = payloads

    async def fake_trpc(proc, js):
        fn = _STATE["trpc"].get(proc)
        if fn is None:
            raise CivitaiError("stub: unexpected proc " + proc)
        return fn(js)
    fav_sync.civitai_client.trpc_query = fake_trpc


async def fake_mutation(proc, js):
    _MUTS.append((proc, js))
    if proc == "collection.upsert":
        return {"id": 900 + len(_MUTS)}
    if proc == "collection.saveItem":
        return {"id": 5000 + len(_MUTS)}
    return {}


fav_sync.civitai_client.trpc_mutation = fake_mutation


# ---- 夹具:用户账号实测集合形状 ----
def _cols_payload(bump=None):
    """bump=(cid, hour):把该集合 updatedAt 拨快到第 hour 小时,触发增量重拉."""
    def u(cid):
        return f"2026-09-28T0{bump[1]}:00:00Z" if bump and bump[0] == cid else ISO
    return [
        {"id": 101, "name": "base", "type": "Model",
         "updatedAt": u(101), "createdAt": ISO},
        {"id": 102, "name": "checkpoint", "type": "Model", "updatedAt": ISO, "createdAt": ISO},
        {"id": 103, "name": "encoder", "type": "Model", "updatedAt": u(103), "createdAt": ISO},
        {"id": 104, "name": "pending", "type": "Model", "updatedAt": ISO, "createdAt": ISO},
        {"id": 105, "name": "Images", "type": "Image", "updatedAt": ISO, "createdAt": ISO},
        {"id": 106, "name": "Liked Models", "type": "Model", "updatedAt": ISO, "createdAt": ISO},
        {"id": 107, "name": "Bookmarked Articles", "type": "Article", "updatedAt": ISO, "createdAt": ISO},
    ]


def _m(i, oid):
    return {"id": i, "type": "model", "createdAt": ISO,
            "data": {"id": oid, "name": f"M{oid}", "type": "Checkpoint",
                     "images": [{"url": f"uuid-{oid}"}], "lastVersionAt": ISO,
                     "baseModels": ["SDXL 1.0"]}}


def _img(i, oid):
    return {"id": i, "type": "image", "createdAt": ISO,
            "data": {"id": oid, "url": f"uuid-{oid}", "modelVersionIds": [7]}}


def _items_payload(js):
    _STATE["items_calls"].append(js["collectionId"])
    cid = js["collectionId"]
    out = {"nextCursor": None, "collectionItems": []}
    if cid == 101:  # base:2 模型
        out["collectionItems"] = [_m(1, 2458426), _m(2, 257749)]
    elif cid == 103:  # encoder:2 模型
        out["collectionItems"] = [_m(3, 2662833), _m(4, 2650573)]
    elif cid == 104:  # pending:与 encoder 相同的 2 模型(跨集合重复挂组)
        out["collectionItems"] = [_m(5, 2662833), _m(6, 2650573)]
    elif cid == 105:  # Images:2 图
        out["collectionItems"] = [_img(7, 81913821), _img(8, 37414606)]
    # 102 checkpoint / 106 Liked Models:空集合
    return out


def _ts_of(iso):
    from datetime import datetime as _dt
    return _dt.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(),
    "collection.getAllCollectionItems": _items_payload,
})

# ---- 1) 首拉:分组/条目/跨集合双挂/Article 跳过/真实计数 ----
d = asyncio.run(fav_sync._down_groups())
assert d["groups"] == 6 and d["models_down"] == 4 and d["images_down"] == 2, d  # 6 集合全为新增
assert d["mounts"] == 8, d  # base2 + encoder2 + pending2 + images2
assert d["truncated"] is False, d
assert [c for c in _STATE["items_calls"] if c == 107] == [], "Article 集合不应触发条目拉取"
gs = {g["name"]: g for g in fs.groups_list()}
assert gs["base"]["ctype"] == "Model" and gs["Images"]["ctype"] == "Image", gs
# 跨集合:2662833 同时在 encoder+pending 两个组(group_ids 多挂)
m = fs.get_item(fs.KIND_MODEL, "2662833")
gids = set(m["group_ids"])
assert gs["encoder"]["gid"] in gids and gs["pending"]["gid"] in gids, (m, gs)
assert m["group_id"] in gids, "主组字段须是挂载之一"
# 同一模型在两组筛选下都能被查到
assert len(fs.list_items(fs.KIND_MODEL, gs["encoder"]["gid"])) == 2
assert len(fs.list_items(fs.KIND_MODEL, gs["pending"]["gid"])) == 2
a = fs.get_item(fs.KIND_ASSET, "81913821")
assert a and a["cover"].endswith("uuid-81913821.jpeg"), a
assert cache_store.kv_get(fav_sync._COLITEMS_KEY), "首拉应写条目主键缓存"

# ---- 2) 增量:集合未变 → 零条目请求;计数全零 ----
_STATE["items_calls"] = []
d2 = asyncio.run(fav_sync._down_groups())
assert _STATE["items_calls"] == [], "集合未变时不应重拉条目"
assert d2["models_down"] == 0 and d2["images_down"] == 0 and d2["mounts"] == 0, d2
_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(bump=(101, 1)),
    "collection.getAllCollectionItems": _items_payload,
})
_STATE["items_calls"] = []
d3 = asyncio.run(fav_sync._down_groups())
assert sorted(_STATE["items_calls"]) == [101], "只应变更的集合重拉"
assert d3["models_down"] == 0 and d3["mounts"] == 0 and d3["groups"] == 0, "重拉同条目不新增;未变集合不计新增组(E2E #6)"

# ---- 2b) 陈旧缓存锚定回归(批A):组行 updated_at 被失败轮锚新值,缓存 u 仍旧 → 必须重拉 ----
_STATE["items_calls"] = []
# 模拟失败轮:直接把 base 组行 updated_at 拨到远端新值,但缓存仍是首拉内容
import sqlite3 as _sq2
_conn2 = cache_store._CONN
_conn2.execute("UPDATE fav_groups SET updated_at=? WHERE civitai_id=101", (_ts_of("2026-09-28T09:00:00Z"),))
_conn2.commit()
_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(bump=(101, 9)),
    "collection.getAllCollectionItems": _items_payload,
})
d2c = asyncio.run(fav_sync._down_groups())
assert sorted(_STATE["items_calls"]) == [101], "缓存 u ≠ 远端 ts 时必须全量重拉(不得信组行 ts)"
assert d2c["mounts"] == 0, "重拉同条目不新增"

# ---- 3) 挂载级缺席对账:站方移除 base 里的 257749 → 挂载摘除+条目墓碑 ----
def _items_after_rm(js):
    r = _items_payload(js)
    if js["collectionId"] == 101:
        r["collectionItems"] = [_m(1, 2458426)]  # 257749 被站方移出
    return r


_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(bump=(101, 2)),
    "collection.getAllCollectionItems": _items_after_rm,
})
d4 = asyncio.run(fav_sync._down_groups())
# 批13:读滞后宽限期会护住"测试刚建的挂载"(added_at=now 在 15min 窗内)——
# 本用例语义是"站方早已移除",把 added_at 回拨出窗再对账
_conn2.execute("UPDATE fav_item_groups SET added_at = added_at - 3600")
_conn2.commit()
rc = fav_sync._reconcile_down(d4["seen"])
assert rc["removed"] == 1 and rc["tombstoned"] == 1, rc
assert fs.get_item(fs.KIND_MODEL, "257749")["deleted"] == 1, "孤儿 remote 条目应落墓碑"
assert fs.get_item(fs.KIND_MODEL, "2458426")["deleted"] == 0, "在场条目不动"
# 跨集合条目只摘一个挂载不落墓碑:把 2662833 移出 encoder(pending 还挂着)
def _items_rm_enc(js):
    r = _items_payload(js)
    if js["collectionId"] == 103:
        r["collectionItems"] = [_m(4, 2650573)]
    return r


_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(bump=(103, 3)),
    "collection.getAllCollectionItems": _items_rm_enc,
})
d5 = asyncio.run(fav_sync._down_groups())
rc2 = fav_sync._reconcile_down(d5["seen"])
assert rc2["removed"] == 1 and rc2["tombstoned"] == 0, rc2
m = fs.get_item(fs.KIND_MODEL, "2662833")
assert not m["deleted"] and gs["pending"]["gid"] in m["group_ids"], m

# ---- 5) sync_now 全流程:上行/对账(legacy 机制已退役,批A) ----
r = asyncio.run(fav_sync.sync_now())
assert r["status"] == "ok" and "legacy_purged" not in r, r
r2 = asyncio.run(fav_sync.sync_now())

# 上行:本地新★模型 + 指定组 → toggleFavorite + upsert + saveItem,挂载记主键
gid_new = fs.upsert_group("localcol", dirty=1)["gid"]
fs.toggle(fs.KIND_MODEL, "777", {"name": "star777", "group_id": gid_new})
_MUTS.clear()
r3 = asyncio.run(fav_sync.sync_now())
procs = [p for p, _ in _MUTS]
assert "user.toggleFavorite" in procs, _MUTS
tf = [js for p, js in _MUTS if p == "user.toggleFavorite"][0]
assert tf == {"modelId": 777, "setTo": True}, tf
si = [js for p, js in _MUTS if p == "collection.saveItem"]
assert si and si[0]["modelId"] == 777 and si[0]["collections"][0]["collectionId"] >= 900, si
mem = [x for x in fs.memberships(fs.KIND_MODEL, "777") if x["gid"] == gid_new][0]
assert mem["pushed"] == 1 and mem["item_id"] and mem["item_id"] >= 5000, mem
assert r3["items_up"] >= 1, r3

# 上行移除对账:本地移出分组 → removeFromCollection {collectionId, itemId}
fs.set_group(fs.KIND_MODEL, "777", None)
assert fs.memberships(fs.KIND_MODEL, "777", include_deleted=True)[0]["deleted"] == 1
_MUTS.clear()
r4 = asyncio.run(fav_sync.sync_now())
rc_muts = [(p, js) for p, js in _MUTS if p == "collection.removeFromCollection"]
assert rc_muts, _MUTS
rmjs = rc_muts[0][1]
assert rmjs["itemId"] == 777, f"itemId 必须是实体 id(model id),不是集合条目主键: {rmjs}"
assert not fs.memberships(fs.KIND_MODEL, "777", include_deleted=True), "对账成功后软删行应硬删"

# ---- 5b) 移除对账幂等:远端 Item not found = 目标已达成,硬删清账计 items_rm ----
_real_mutation = fav_sync.civitai_client.trpc_mutation


async def mutation_notfound(proc, js):
    _MUTS.append((proc, js))
    if proc == "collection.removeFromCollection":
        raise CivitaiError("tRPC collection.removeFromCollection: Item not found")
    return {"id": 6000}


fs.toggle(fs.KIND_MODEL, "778", {"name": "star778", "group_id": gid_new})
# 直接收尾:778 的挂载置为已推送,再走移除路径
fav_sync.civitai_client.trpc_mutation = mutation_notfound
fs.mark_membership_pushed(fs.KIND_MODEL, "778", gid_new, item_id=6001)
fs.set_group(fs.KIND_MODEL, "778", None)
_MUTS.clear()
r5b = asyncio.run(fav_sync.sync_now())
assert not fs.memberships(fs.KIND_MODEL, "778", include_deleted=True), "幂等后软删行应硬删"
assert r5b["items_rm"] >= 1 and r5b["items_rm_failed"] == 0, r5b
fav_sync.civitai_client.trpc_mutation = _real_mutation

# ---- 6) 对账门控:集合枚举失败 → 不执行(防误杀) ----
fs.upsert_remote(fs.KIND_MODEL, "888", name="must-survive", remote_updated=1.0)


async def trpc_boom(proc, js):
    raise CivitaiError("429 burst")


fav_sync.civitai_client.trpc_query = trpc_boom
r5 = asyncio.run(fav_sync.sync_now())
assert any("跳过缺席对账" in e for e in r5["errors"]), r5["errors"]
it888 = fs.get_item(fs.KIND_MODEL, "888")
assert it888 and not it888["deleted"], "失败路径不得误杀条目"
# 空集合列表同样按不完整处理(O1)
async def trpc_empty(proc, js):
    return [] if proc == "collection.getAllUser" else {"nextCursor": None, "collectionItems": []}


fav_sync.civitai_client.trpc_query = trpc_empty
r6 = asyncio.run(fav_sync.sync_now())
assert it888 and not fs.get_item(fs.KIND_MODEL, "888")["deleted"], "空列表不得对账误杀"

# ---- 7) _trpc_paged:条目键缺失 → truncated;页数上限 → truncated ----
async def _fake_nokey(proc, js):
    return {"nextCursor": None}


fav_sync.civitai_client.trpc_query = _fake_nokey
items, tr = asyncio.run(fav_sync._trpc_paged("p", {}, "collectionItems"))
assert items == [] and tr is True, (items, tr)


class _Ret:
    def __init__(self, v):
        self.v = v

    def __await__(self):
        if False:
            yield
        return self.v


old_max = fav_sync._MAX_PAGES
fav_sync._MAX_PAGES = 2
fav_sync.civitai_client.trpc_query = lambda proc, js: _Ret({"nextCursor": "c", "items": [1]})
items, tr = asyncio.run(fav_sync._trpc_paged("paged", {}, "items"))
fav_sync._MAX_PAGES = old_max
assert items == [1, 1] and tr is True, (items, tr)

# ---- 8) 锁原子性 ----
assert cache_store.kv_putnx("t:lock", "a", ttl=60) is True
assert cache_store.kv_putnx("t:lock", "b", ttl=60) is False
assert cache_store.kv_get("t:lock") == "a"

# ---- 9) import src 归一 + 残留清理(函数恢复回归) ----
payload = {"version": 2, "groups": [], "items": [
    {"kind": "asset", "oid": "7001", "src": "remote", "group_id": None,
     "added_at": 1.0, "updated_at": 1.0, "deleted": 0, "dirty": 0},
]}
fs.import_json(payload, replace=False)
row = fs.get_item(fs.KIND_ASSET, "7001")
assert row["src"] == "remote", "归一只补缺省,不再强改 local(legacy 清理已退役)"

# ---- 10) 会员表迁移:旧 gpushed/group_id → 挂载行 ----
import sqlite3 as _sq
conn = cache_store._CONN
conn.execute("INSERT OR REPLACE INTO fav_items(kind, oid, group_id, name, cover, added_at,"
             " updated_at, src, dirty, deleted, extra, gpushed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
             ("model", "555", "g_manual", "old", None, 1.0, 1.0, "local", 0, 0, None,
              json.dumps(["g_pushed"])))
conn.commit()
fs._FIG_MIGRATED = False
cache_store.kv_delete("fav:fig_migrated_v1")
fs._conn()
ms = fs.memberships(fs.KIND_MODEL, "555")
assert {m["gid"] for m in ms} == {"g_manual", "g_pushed"}, ms
pushed = {m["gid"]: m["pushed"] for m in ms}
assert pushed == {"g_manual": 0, "g_pushed": 1}, pushed

# ---- 11) reset_all 全清(批A,用户拍板 A) ----
assert fs.get_item(fs.KIND_MODEL, "555") is not None
fs.reset_all()
assert fs.groups_list() == [] and fs.list_items(include_deleted=True) == []
assert fs.memberships(include_deleted=True) == []
assert cache_store.kv_get(fav_sync._COLITEMS_KEY) is None, "同步缓存应一并清除"
# 清空后首拉应重新全量入库
_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(),
    "collection.getAllCollectionItems": _items_payload,
})
d10 = asyncio.run(fav_sync._down_groups())
assert d10["models_down"] == 4 and d10["images_down"] == 2 and d10["mounts"] == 8, d10

# ---- 12) 批4:Bookmark 系统集合只读 + 视频封面 + 同名未绑定组合并 ----
# 12a) 下行:mode=Bookmark → ctype=Bookmark;视频实体 cover 走 .mp4;模型封面跳过视频首图
_MUTS.clear()


def _cols12(js):
    return [
        {"id": 201, "name": "Liked Models", "type": "Model", "mode": "Bookmark",
         "updatedAt": ISO, "createdAt": ISO},
        {"id": 202, "name": "Vids", "type": "Image", "updatedAt": ISO, "createdAt": ISO},
    ]


def _items12(js):
    cid = js["collectionId"]
    out = {"nextCursor": None, "collectionItems": []}
    if cid == 201:  # 系统集合:1 模型(首图 video + 次图 image → cover 取次图 .jpeg)
        out["collectionItems"] = [{
            "id": 11, "type": "model", "createdAt": ISO,
            "data": {"id": 7001, "name": "MV", "type": "Checkpoint", "lastVersionAt": ISO,
                     "images": [{"url": "uuid-v1", "type": "video"},
                                {"url": "uuid-p1", "type": "image"}]},
        }]
    elif cid == 202:  # 图片集合:1 视频实体 → cover 应为 .mp4 交付名
        out["collectionItems"] = [{
            "id": 12, "type": "image", "createdAt": ISO,
            "data": {"id": 7002, "url": "uuid-vid2", "type": "video",
                     "nsfwLevel": 4, "baseModel": "MiniMax H3", "width": 704, "height": 960},
        }]
    return out


_set_trpc({"collection.getAllUser": lambda js: _cols12(js),
           "collection.getAllCollectionItems": _items12})
d12 = asyncio.run(fav_sync._down_groups())
gs12 = {g["name"]: g for g in fs.groups_list()}
assert gs12["Liked Models"]["ctype"] == "Bookmark", gs12
mv = fs.get_item(fs.KIND_MODEL, "7001")
assert mv["cover"].endswith("uuid-p1.jpeg"), mv  # 静态图优先
mv_ms = fs.memberships(fs.KIND_MODEL, "7001")
assert len(mv_ms) == 1 and mv_ms[0]["pushed"] == 1, mv_ms
va = fs.get_item(fs.KIND_ASSET, "7002")
assert va["cover"].endswith("uuid-vid2.mp4"), va  # 视频交付名
assert va["extra"].get("type") == "video" and va["extra"].get("baseModel") == "MiniMax H3", va

# 12b) UI 对齐保护:set_memberships 不得摘系统集合挂载
fs.set_memberships(fs.KIND_MODEL, "7001", [])
assert fs.memberships(fs.KIND_MODEL, "7001"), "Bookmark 挂载不应被 UI 对齐摘除"

# 12c) 上行移除对账:Bookmark 软删挂载不发生 removeFromCollection,直接本地硬清
sys_gid = gs12["Liked Models"]["gid"]
assert fs.membership_remove(fs.KIND_MODEL, "7001", sys_gid), "软删一行以模拟待对账"
_MUTS.clear()
r12 = asyncio.run(fav_sync._upsync_removals({"errors": []}, {g["gid"]: g for g in fs.groups_list()}))
assert not [1 for p, _ in _MUTS if p == "collection.removeFromCollection"], _MUTS
assert fs.memberships(fs.KIND_MODEL, "7001", include_deleted=True) == [], "软删行应硬清"

# 12d) 同名未绑定组:下行同名集合落地时合并 gid,不再分叉
fs.upsert_group("MyCol", dirty=1)  # 本地新建待上行(路由建组即 dirty=1,civitai_id NULL)
gloc = {g["name"]: g for g in fs.groups_list()}["MyCol"]
assert gloc["dirty"] == 1 and not gloc["civitai_id"], gloc
gmerged = fs.upsert_group("MyCol", civitai_id=4242)
assert gmerged["gid"] == gloc["gid"], (gmerged, gloc)  # 同名合并,防"同名不同 id"

# ---- 13) 审计 F-S2 批回归 ----
ts13 = _ts_of(ISO)

# 13a) F-S2-1:墓碑复活门控 — 仅 dirty=0(站方权威墓碑,mark_remote_tombstone 产物)
# 可随远端重新出现而复活;dirty=1(本地取消在途)一律终局。
# ⚠️ 改判说明(审计红线索引 F-S2-1 指令):旧门控允许 dirty=1 资产墓碑随远端复活
# (为旧引擎遗留脏墓碑兜底),但会把"用户刚取消而远端集合仍挂着"悄悄回滚成已收藏;
# 新语义下旧引擎遗留脏墓碑不再自动复活,此处按新语义直接断言 blocked。
fs.toggle(fs.KIND_ASSET, "6101", {"name": "fresh"})
fs.toggle(fs.KIND_ASSET, "6101")  # 用户取消 → 墓碑 deleted=1 dirty=1(本地取消在途)
st = fs.upsert_remote(fs.KIND_ASSET, "6101", name="pullback",
                      remote_updated=ts13 + 99, resurrect=True)
assert st == "blocked", st
it6101 = fs.get_item(fs.KIND_ASSET, "6101")
assert it6101["deleted"] == 1 and it6101["dirty"] == 1, it6101
# dirty=0 远端墓碑 + 远端重新出现 → 复活
fs.upsert_remote(fs.KIND_ASSET, "6102", name="rt", remote_updated=ts13)
fs.mark_remote_tombstone(fs.KIND_ASSET, "6102")
assert fs.get_item(fs.KIND_ASSET, "6102")["deleted"] == 1
st = fs.upsert_remote(fs.KIND_ASSET, "6102", name="rt-revived",
                      remote_updated=ts13 + 99, resurrect=True)
assert st == "updated", st
it6102 = fs.get_item(fs.KIND_ASSET, "6102")
assert not it6102["deleted"] and not it6102["dirty"] and it6102["name"] == "rt-revived", it6102

# 13b) F-S2-5:Bookmark 系统集合只读 — 改名不上行、挂载不 saveItem
sys_gid = gs12["Liked Models"]["gid"]
fs.upsert_group("Liked Models Renamed", gid=sys_gid, dirty=1)  # 本地改名(绑定与 ctype 保留)
gsb = {g["gid"]: g for g in fs.groups_list()}[sys_gid]
assert gsb["dirty"] == 1 and gsb["ctype"] == "Bookmark" and gsb["civitai_id"] == 201, gsb
fs.toggle(fs.KIND_MODEL, "7100", {"name": "in-sys", "group_id": sys_gid})  # 手动挂进系统集合
_MUTS.clear()
asyncio.run(fav_sync._upsync_groups({"groups_up": 0, "items_up": 0, "items_rm": 0, "errors": []}))
procs13 = [p for p, _ in _MUTS]
# 系统集合(201)改名不上行;MyCol(4242,普通组,12d 合并后仍 dirty=1)照常上行,不在此断言内
assert not [1 for p, js in _MUTS
            if p == "collection.upsert" and js.get("id") == 201], _MUTS
assert not [1 for p, js in _MUTS
            if p == "collection.saveItem" and js.get("modelId") == 7100], _MUTS  # 挂载不 saveItem

# 13c) F-S2-6:非数字 oid 拒收 — assign 路由 400;import_json 整单 ValueError(走既有 400 路径)
fp.folder_names_and_paths = {"loras": ([os.path.join(tmp, "loras")], {".safetensors"})}
fp.get_folder_paths = lambda key: [os.path.join(tmp, "loras")] if key == "loras" else []
from civitai_studio.routes import favorites as fav_routes


class _Req13:
    def __init__(self, body):
        self._b = body

    async def json(self):
        return self._b


resp = asyncio.run(fav_routes.favorites_assign(
    _Req13({"kind": "asset", "oid": "12ab", "group_ids": ["g_x"]})))
assert resp.status == 400, resp
resp = asyncio.run(fav_routes.favorites_assign(_Req13({"kind": "asset", "oid": ""})))
assert resp.status == 400, resp
rejected = False
try:
    fs.import_json({"groups": [], "items": [{"kind": "asset", "oid": "abc", "name": "bad-oid"}]})
except ValueError:
    rejected = True
assert rejected, "非数字 oid 的导入条目应拒收(ValueError→路由 400)"

# 13d) F-S2-2:建集响应缺 id → 按名回收既有集合 id;仍找不到才放弃
fs.upsert_group("RecycleCol", dirty=1)
grid = {g["name"]: g for g in fs.groups_list()}["RecycleCol"]["gid"]
fs.toggle(fs.KIND_MODEL, "7200", {"name": "rc", "group_id": grid})


async def mutation_noid(proc, js):
    _MUTS.append((proc, js))
    if proc == "collection.upsert":
        return {"ok": True}  # 响应缺 id(触发按名回收)
    if proc == "collection.saveItem":
        return {"id": 5300}
    return {}


fav_sync.civitai_client.trpc_mutation = mutation_noid
_set_trpc({"collection.getAllUser": lambda js: {"collections": [
    {"id": 777, "name": "RecycleCol", "type": "Model"},
    {"id": 778, "name": "NoWhere", "type": "Model"},
]}})
_MUTS.clear()
asyncio.run(fav_sync._upsync_groups({"groups_up": 0, "items_up": 0, "items_rm": 0, "errors": []}))
grec = {g["name"]: g for g in fs.groups_list()}["RecycleCol"]
assert grec["civitai_id"] == 777 and grec["dirty"] == 0, grec  # 回收 id 并绑定
si13 = [js for p, js in _MUTS if p == "collection.saveItem" and js.get("modelId") == 7200]
assert si13 and si13[0]["collections"][0]["collectionId"] == 777, _MUTS  # 回收 id 直接用于 saveItem
assert [m for m in fs.memberships(fs.KIND_MODEL, "7200")][0]["pushed"] == 1
# 仍找不到同名 → 放弃(cid=0),组保持未绑定
fs.upsert_group("GhostCol", dirty=1)
ggid = {g["name"]: g for g in fs.groups_list()}["GhostCol"]["gid"]
fs.toggle(fs.KIND_MODEL, "7300", {"name": "gh", "group_id": ggid})
_MUTS.clear()
asyncio.run(fav_sync._upsync_groups({"groups_up": 0, "items_up": 0, "items_rm": 0, "errors": []}))
ggh = {g["name"]: g for g in fs.groups_list()}["GhostCol"]
assert not ggh["civitai_id"] and ggh["dirty"] == 1, ggh
fav_sync.civitai_client.trpc_mutation = _real_mutation

# ---- 14) 全量复检 V1:N-V1-2 按名回收排除系统集合 + N-V1-1 锁心跳 CAS ----
# 14a) 建集响应缺 id → 按名回收:同名 Bookmark(mode) 系统集合不得被绑,只绑普通集合
fs.upsert_group("BMCol", dirty=1)
gbm = {g["name"]: g for g in fs.groups_list()}["BMCol"]["gid"]
fs.toggle(fs.KIND_MODEL, "7400", {"name": "bm", "group_id": gbm})


async def mutation_noid14(proc, js):
    _MUTS.append((proc, js))
    if proc == "collection.upsert":
        return {"ok": True}  # 缺 id → 触发按名回收
    if proc == "collection.saveItem":
        return {"id": 5400}
    return {}


fav_sync.civitai_client.trpc_mutation = mutation_noid14
_set_trpc({"collection.getAllUser": lambda js: {"collections": [
    {"id": 811, "name": "BMCol", "type": "Model", "mode": "Bookmark"},
    {"id": 812, "name": "BMCol", "type": "Model"},
]}})
_MUTS.clear()
asyncio.run(fav_sync._upsync_groups({"groups_up": 0, "items_up": 0, "items_rm": 0, "errors": []}))
gbm2 = {g["name"]: g for g in fs.groups_list()}["BMCol"]
assert gbm2["civitai_id"] == 812 and gbm2["dirty"] == 0, gbm2  # 绑普通集合而非 811
si14 = [js for p, js in _MUTS if p == "collection.saveItem" and js.get("modelId") == 7400]
assert si14 and si14[0]["collections"][0]["collectionId"] == 812, _MUTS
fav_sync.civitai_client.trpc_mutation = _real_mutation

# 14b) 锁心跳 compare-and-set:本轮 token → 续期;被并发轮换走 → 不覆写不删除
def _kvrow14():
    return cache_store._CONN.execute(
        "SELECT value, expires_at FROM kv_cache WHERE key=?",
        (fav_sync._SYNC_LOCK_KEY,)).fetchone()


# 正例:下行进行中心跳把 expires_at 顶到新值、值保持为本轮 token
_snap14 = {}


def _getalluser14b(js):
    _snap14["base"] = _kvrow14()  # 占锁后、首个心跳前
    return _cols_payload()


def _items14b(js):
    _snap14.setdefault("hb", _kvrow14())  # 首个条目拉取前至少已跑过一轮集合心跳
    return _items_payload(js)


_set_trpc({"collection.getAllUser": _getalluser14b,
           "collection.getAllCollectionItems": _items14b})
r14b = asyncio.run(fav_sync.sync_now())
assert r14b["status"] == "ok", r14b
assert cache_store.kv_get(fav_sync._SYNC_LOCK_KEY) is None, "正常轮 finally 应释放锁"
assert _snap14["hb"] and _snap14["hb"][0] == _snap14["base"][0], _snap14  # 值保持
assert _snap14["hb"][1] >= _snap14["base"][1], _snap14  # expires_at 已续期

# 负例:下行中锁被"并发轮"换走 → 心跳不覆写,finally 不误删他人 token
def _steal14(js):
    cache_store.kv_put(fav_sync._SYNC_LOCK_KEY, "thief", ttl=1800)
    return _cols_payload()


_set_trpc({"collection.getAllUser": _steal14,
           "collection.getAllCollectionItems": _items_payload})
r14c = asyncio.run(fav_sync.sync_now())
assert r14c["status"] == "ok", r14c  # 锁被换走只停续期,不中断本轮
assert cache_store.kv_get(fav_sync._SYNC_LOCK_KEY) == "thief", "心跳/收尾不得覆写或删除他人 token"
cache_store.kv_delete(fav_sync._SYNC_LOCK_KEY)  # 清理,不留脏锁

# ---- 15) 批13:手动同步 force=True 绕过增量捷径强制全量枚举 ----
_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(),
    "collection.getAllCollectionItems": _items_payload,
})
_STATE["items_calls"] = []
d15a = asyncio.run(fav_sync._down_groups())
assert _STATE["items_calls"] == [], "未变集合走增量捷径,零条目请求"
_STATE["items_calls"] = []
d15b = asyncio.run(fav_sync._down_groups(force=True))
assert sorted(_STATE["items_calls"]) == [101, 102, 103, 104, 105, 106], \
    f"force 必须全量枚举全部非 Article 集合: {_STATE['items_calls']}"
assert d15b["mounts"] == 0 and d15b["models_down"] == 0, "重拉同条目不新增"
_STATE["items_calls"] = []
asyncio.run(fav_sync.sync_now(force=True))
assert sorted(_STATE["items_calls"]) == [101, 102, 103, 104, 105, 106], "sync_now 须把 force 传到 _down_groups"

# ---- 16) 批13:对账读滞后宽限期 —— 窗内缺席只记日志不硬摘,窗外才摘 ----
# 15 节 force 全量把挂载重建为 added_at=now(窗内):base 里 2458426 "缺席"也不得摘
seen16 = {101: {"m": {"257749": 1}, "i": {}}}  # 只有 257749 在场,2458426 缺席
rc16a = fav_sync._reconcile_down(seen16)
assert rc16a["removed"] == 0 and rc16a["tombstoned"] == 0, rc16a
m16 = fs.memberships(fs.KIND_MODEL, "2458426")
assert m16, "宽限窗内的挂载不得被摘除"
assert not fs.get_item(fs.KIND_MODEL, "2458426")["deleted"], "宽限窗内不得落墓碑"
# 回拨出窗(pushed_at 为 NULL 的远端镜像按 added_at 判窗)→ 缺席即摘
_conn2.execute("UPDATE fav_item_groups SET added_at = added_at - 3600")
_conn2.commit()
rc16b = fav_sync._reconcile_down(seen16)
assert rc16b["removed"] == 1 and rc16b["tombstoned"] == 1, rc16b
assert not fs.memberships(fs.KIND_MODEL, "2458426"), "出窗后缺席应硬摘"

# ---- 17) 批14 B1-1:条目级+分组级缺席对账(两轮 + ≥5min 时间差才终局) ----
# 17a) 门控:枚举截断/失败轮 → kv 原样(不计轮不清零)
import time as _t17
cache_store.kv_put(fav_sync._ABSENCE_KEY, {"item:model:888": {"first": 1.0, "rounds": 9}})


async def trpc_boom17(proc, js):
    raise CivitaiError("429 burst")


fav_sync.civitai_client.trpc_query = trpc_boom17
asyncio.run(fav_sync.sync_now())
assert cache_store.kv_get(fav_sync._ABSENCE_KEY) == {"item:model:888": {"first": 1.0, "rounds": 9}}, \
    "截断轮不得动缺席计数"

# 17b) 条目级:两轮 + 时间差满足 → 墓碑;终局后清计数;远端重现可复活(既有机制)
_set_trpc({"collection.getAllUser": lambda js: _cols_payload(),
           "collection.getAllCollectionItems": _items_payload})
fs.upsert_remote(fs.KIND_MODEL, "888", name="must-vanish", remote_updated=1.0)  # 零挂载(11 节重置后重建)
cache_store.kv_put(fav_sync._ABSENCE_KEY, {"item:model:888": {"first": _t17.time() - 3600, "rounds": 1}})
r17b = asyncio.run(fav_sync.sync_now())
assert fs.get_item(fs.KIND_MODEL, "888")["deleted"] == 1, "两轮+时间差满足应落墓碑"
assert r17b["absent_removed"] >= 1, r17b
assert "item:model:888" not in (cache_store.kv_get(fav_sync._ABSENCE_KEY) or {}), "终局后清计数"
st17 = fs.upsert_remote(fs.KIND_MODEL, "888", name="back-again",
                        remote_updated=_t17.time() + 99, resurrect=True)
assert st17 == "blocked" and fs.get_item(fs.KIND_MODEL, "888")["deleted"] == 1, st17
# 模型墓碑终局(复活门控仅对资产开放,F-S2-1:模型的远端闭环走 ❤ 上推,见 13a 资产复活用例)

# 17c) 嫌疑期(时间差不足)只计轮不删
fs.upsert_remote(fs.KIND_MODEL, "889", name="suspect", remote_updated=1.0)
cache_store.kv_put(fav_sync._ABSENCE_KEY, {"item:model:889": {"first": _t17.time(), "rounds": 1}})
r17c = asyncio.run(fav_sync.sync_now())
kv17c = cache_store.kv_get(fav_sync._ABSENCE_KEY)
assert kv17c["item:model:889"]["rounds"] == 2, kv17c
assert not fs.get_item(fs.KIND_MODEL, "889")["deleted"], "时间差不足不得终局"

# 17d) 在场条目清零:有挂载的条目即便有历史计数也会清;墓碑条目的陈旧键一并作废
cache_store.kv_put(fav_sync._ABSENCE_KEY, {
    "item:model:2662833": {"first": 1.0, "rounds": 5},   # 在场(有 pending 挂载)
    "item:model:2458426": {"first": 1.0, "rounds": 5},   # 已墓碑(16 节)→ 陈旧键
})
asyncio.run(fav_sync.sync_now())
kv17d = cache_store.kv_get(fav_sync._ABSENCE_KEY)
assert "item:model:2662833" not in kv17d and "item:model:2458426" not in kv17d, kv17d

# 17e) 分组级:绑定远端集合的本地组连续两轮+时间差不在 getAllUser → 删组保条目
g17 = fs.upsert_group("GoneCol", civitai_id=31337)
g17gid = g17["gid"]
fs.upsert_remote(fs.KIND_MODEL, "890", name="in-gone", remote_updated=1.0)
fs.membership_add(fs.KIND_MODEL, "890", g17gid, source="local", pushed=0)
cache_store.kv_put(fav_sync._ABSENCE_KEY, {"grp:" + g17gid: {"first": _t17.time() - 3600, "rounds": 1}})
r17e = asyncio.run(fav_sync.sync_now())
assert r17e["groups_absent_removed"] >= 1, r17e
assert not any(g["gid"] == g17gid for g in fs.groups_list()), "缺席组应删除"
it890 = fs.get_item(fs.KIND_MODEL, "890")
assert it890 and not it890["deleted"] and not fs.memberships(fs.KIND_MODEL, "890"), \
    "删组不删条目:回未分组"

# ---- 18) 批14.1:force(手动同步)立即对齐——用户实测"点同步就该删" ----
# 18a) 挂载宽限:下行镜像挂载(pushed_at NULL)force 轮不保护;刚上推的(pushed_at)仍保护
base_gid18 = {g["name"]: g for g in fs.groups_list()}["base"]["gid"]
fs.upsert_remote(fs.KIND_MODEL, "999", name="mirror", remote_updated=1.0)
fs.membership_add(fs.KIND_MODEL, "999", base_gid18, source="remote", pushed=1)  # 镜像:pushed_at=NULL
fs.upsert_remote(fs.KIND_MODEL, "997", name="just-pushed", remote_updated=1.0)
fs.membership_add(fs.KIND_MODEL, "997", base_gid18, source="local", pushed=0)
fs.mark_membership_pushed(fs.KIND_MODEL, "997", base_gid18, item_id=777001)  # pushed_at=now
seen18 = {101: {"m": {}, "i": {}}}  # base 完整枚举但两者都缺席
rc18a = fav_sync._reconcile_down(seen18, force=True)
assert not fs.memberships(fs.KIND_MODEL, "999"), "镜像挂载 force 轮应立即摘(读滞后保护不覆盖)"
assert fs.memberships(fs.KIND_MODEL, "997"), "刚上推挂载 force 轮仍受宽限保护"
_conn2.execute("UPDATE fav_item_groups SET pushed_at = pushed_at - 3600 WHERE oid='997'")
_conn2.commit()
rc18a2 = fav_sync._reconcile_down(seen18, force=True)
assert not fs.memberships(fs.KIND_MODEL, "997"), "上推宽限到期后 force 轮可摘"
# 清理 999/997,防影响后续
_conn2.execute("DELETE FROM fav_items WHERE oid IN ('999','997')")
_conn2.commit()

# 18b) 缺席条目 force 一轮即终局(无需两轮/时间差)
fs.upsert_remote(fs.KIND_MODEL, "998", name="force-vanish", remote_updated=1.0)  # 零挂载
cache_store.kv_put(fav_sync._ABSENCE_KEY, {})
r18b = asyncio.run(fav_sync.sync_now(force=True))
assert fs.get_item(fs.KIND_MODEL, "998")["deleted"] == 1, "force 轮一轮即墓碑"
assert r18b["absent_removed"] >= 1, r18b

# 18c) 分组级 force 一轮删组
g18 = fs.upsert_group("GoneForceCol", civitai_id=55555)
r18c = asyncio.run(fav_sync.sync_now(force=True))
assert r18c["groups_absent_removed"] >= 1, r18c
assert not any(g["name"] == "GoneForceCol" for g in fs.groups_list()), "force 一轮应删组"

print("test_favsync.py OK")
