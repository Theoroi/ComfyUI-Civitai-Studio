# -*- coding: utf-8 -*-
"""fav_sync 解析层桩测试(refine R1 D5-5):_trpc_paged/_down_groups 增量与截断/
sync_now 缺席对账门控/ensure_legacy_group 收编守卫/import src 归一。
离线运行:civitai_client.trpc_query/get_json 全部打桩,存储层走真 sqlite(tmp)。"""
import asyncio, json, os, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_favsync_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store, config, fav_sync, favorites_store as fs
from civitai_studio.civitai_client import CivitaiError

ISO = "2026-09-28T00:00:00Z"

_STATE = {"trpc": {}, "get_json": None, "items_calls": []}


def _set_trpc(payloads):
    """payloads: proc → callable(js) → 未解包 json 值(trpc_query 已负责解信封)."""
    _STATE["trpc"] = payloads

    async def fake_trpc(proc, js):
        fn = _STATE["trpc"].get(proc)
        if fn is None:
            raise CivitaiError("stub: unexpected proc " + proc)
        return fn(js)
    fav_sync.civitai_client.trpc_query = fake_trpc


_MUTATIONS = []


async def fake_mutation(proc, js):
    _MUTATIONS.append(proc)
    return {"id": 1}


fav_sync.civitai_client.trpc_mutation = fake_mutation  # 上行打桩:测试保持离线


def _set_get_json(fn):
    _STATE["get_json"] = fn

    async def fake_get_json(path, params=None):
        return fn(path, params)
    fav_sync.civitai_client.get_json = fake_get_json


def _cols_payload(bump111=False):
    iso111 = "2026-09-28T01:00:00Z" if bump111 else ISO
    return [
        {"id": 111, "name": "mcol", "type": "Model", "updatedAt": iso111, "createdAt": ISO},
        {"id": 222, "name": "icol", "type": "Image", "updatedAt": ISO, "createdAt": ISO},
        {"id": 333, "name": "arts", "type": "Article", "updatedAt": ISO, "createdAt": ISO},
    ]


def _items_payload(js):
    _STATE["items_calls"].append(js["collectionId"])
    cid = js["collectionId"]
    if cid == 111:
        return {"nextCursor": None, "collectionItems": [
            {"id": 1, "type": "model", "createdAt": ISO,
             "data": {"id": 9001, "name": "M1", "type": "Checkpoint",
                      "images": [{"url": "uuid-m1"}], "lastVersionAt": ISO,
                      "baseModels": ["SDXL 1.0"]}},
            {"id": 2, "type": "image", "createdAt": ISO,
             "data": {"id": 8002, "url": "uuid-i2", "modelVersionIds": [7]}},
        ]}
    if cid == 222:
        return {"nextCursor": None, "collectionItems": [
            {"id": 3, "type": "image", "createdAt": ISO,
             "data": {"id": 8001, "url": "uuid-i1", "modelVersionIdsManual": [5]}},
        ]}
    return {"nextCursor": None, "collectionItems": []}


_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(),
    "collection.getAllCollectionItems": _items_payload,
})

# ---- 1) _down_groups 全量首拉:分组/ctype/条目入库/Article 跳过 ----
d = asyncio.run(fav_sync._down_groups())
assert d["groups"] == 2 and d["images"] == 2, d
assert d["model_ids"] == {"9001"} and d["truncated"] is False, d
assert _STATE["items_calls"] == [111, 222], "Article 集合不应触发条目拉取"
gs = {g["name"]: g for g in fs.groups_list()}
assert gs["mcol"]["ctype"] == "Model" and gs["icol"]["ctype"] == "Image", gs
m = fs.get_item(fs.KIND_MODEL, "9001")
assert m and m["group_id"] == gs["mcol"]["gid"], m
a1 = fs.get_item(fs.KIND_ASSET, "8001")
assert a1 and a1["group_id"] == gs["icol"]["gid"] and a1["cover"].endswith("uuid-i1.jpeg"), a1
assert cache_store.kv_get(fav_sync._COLMODELS_KEY), "首拉应写模型 id 缓存"

# ---- 2) 增量:集合未变 → 零条目请求;单集合变更 → 只拉它 ----
_STATE["items_calls"] = []
d2 = asyncio.run(fav_sync._down_groups())
assert _STATE["items_calls"] == [], "集合未变时不应重拉条目(评审R1 P1)"
assert d2["model_ids"] == {"9001"}, d2
_set_trpc({
    "collection.getAllUser": lambda js: _cols_payload(bump111=True),
    "collection.getAllCollectionItems": _items_payload,
})
_STATE["items_calls"] = []
d3 = asyncio.run(fav_sync._down_groups())
assert _STATE["items_calls"] == [111], "只应变更的集合重拉"
assert d3["model_ids"] == {"9001"}, d3

# ---- 2b) 失败/截断不写缓存:下轮同 updatedAt 仍强制重拉(窄域复审 H1) ----
_calls2b = []


async def trpc_111_fails_first(proc, js):
    if proc == "collection.getAllUser":
        return _cols_payload()
    if proc == "collection.getAllCollectionItems":
        if js["collectionId"] == 111 and len(_calls2b) == 0:
            _calls2b.append(js["collectionId"])
            raise CivitaiError("first burst")
        _calls2b.append(js["collectionId"])
        return _items_payload(js)
    raise CivitaiError(proc)


fav_sync.civitai_client.trpc_query = trpc_111_fails_first
cache_store.kv_delete(fav_sync._COLMODELS_KEY)
dA = asyncio.run(fav_sync._down_groups())
assert dA["truncated"] is True, dA
dB = asyncio.run(fav_sync._down_groups())
assert dB["truncated"] is False and dB["model_ids"] == {"9001"}, dB
assert [c for c in _calls2b if c == 111] == [111, 111], "失败集合下轮必须重拉(H1)"

# ---- 3) _trpc_paged:条目键缺失 → truncated;页数上限 → truncated ----
async def _fake_nokey(proc, js):
    return {"nextCursor": None}  # 无条目键(站方改键名场景)


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

# ---- 4) sync_now 缺席对账门控:REST 失败 → 跳过(防误杀);双通道完整 → 执行 ----
_absent_calls = []
_real_absent = fs.mark_remote_absent


def _spy_absent(kind, seen, now=None):
    _absent_calls.append(set(seen))
    return _real_absent(kind, seen, now)
fs.mark_remote_absent = _spy_absent
fs.upsert_remote(fs.KIND_MODEL, "777", name="star", remote_updated=1.0)
fs.upsert_remote(fs.KIND_MODEL, "888", name="will-die", remote_updated=1.0)

# O1 守卫后"空集合列表"按不完整处理;这里给一个真实存在但无条目的集合,让两通道完整
_set_trpc({"collection.getAllUser": lambda js: [
               {"id": 444, "name": "tmp", "type": "Model", "updatedAt": ISO, "createdAt": ISO}],
           "collection.getAllCollectionItems": _items_payload})
_set_get_json(lambda path, params: {"items": [{"id": 777, "name": "star"}], "metadata": {}})
r = asyncio.run(fav_sync.sync_now())
assert r["status"] == "ok" and len(_absent_calls) == 1 and _absent_calls[0] == {"777"}, (r, _absent_calls)
assert fs.get_item(fs.KIND_MODEL, "777") and not fs.get_item(fs.KIND_MODEL, "777")["deleted"]
assert fs.get_item(fs.KIND_MODEL, "888")["deleted"] == 1, "缺席模型应落墓碑"


def _boom(path, params):
    raise CivitaiError("429 burst")


fs.upsert_remote(fs.KIND_MODEL, "999", name="must-survive", remote_updated=1.0)
_set_get_json(_boom)
r2 = asyncio.run(fav_sync.sync_now())
assert any("跳过缺席对账" in e for e in r2["errors"]), r2["errors"]
assert _absent_calls.__len__() == 1, "REST 失败时对账不得执行(评审R1 D2-1)"
it999 = fs.get_item(fs.KIND_MODEL, "999")
assert it999 and not it999["deleted"], "失败路径不得误杀 ★ 模型"
fs.mark_remote_absent = _real_absent

# ---- 5) 锁原子性:kv_putnx 二次占位失败 ----
assert cache_store.kv_putnx("t:lock", "a", ttl=60) is True
assert cache_store.kv_putnx("t:lock", "b", ttl=60) is False
assert cache_store.kv_get("t:lock") == "a"

# ---- 6) ensure_legacy_group 收编守卫:dirty 同名组不收编 ----
dirty_gid = fs.upsert_group("Legacy", dirty=1)["gid"]
lg = fs.ensure_legacy_group()
assert lg != dirty_gid, "dirty 同名组不得被收编(评审R1 F4)"
row = [x for x in fs.groups_list() if x["gid"] == dirty_gid][0]
assert row["ctype"] is None and row["dirty"] == 1, row

# ---- 7) import src 归一:未分组 remote 资产改 local(评审R1 F3) ----
payload = {"version": 2, "groups": [], "items": [
    {"kind": "asset", "oid": "7001", "src": "remote", "group_id": None,
     "added_at": 1.0, "updated_at": 1.0, "deleted": 0, "dirty": 0},
]}
fs.import_json(payload, replace=False)
row = fs.get_item(fs.KIND_ASSET, "7001")
assert row["src"] == "local", row
n = fs.purge_legacy_ungrouped()
assert fs.get_item(fs.KIND_ASSET, "7001") is not None, "导入行不得被 legacy 清理吞掉"

print("test_favsync.py OK")
