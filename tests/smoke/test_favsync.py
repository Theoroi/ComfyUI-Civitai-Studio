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

print("test_favsync.py OK")
