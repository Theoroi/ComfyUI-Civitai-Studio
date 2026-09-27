import json, os, sys, tempfile, types, time

tmp = tempfile.mkdtemp(prefix="cs_fav_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import favorites_store as fs, cache_store

# 旧 favorites.json 迁移
os.makedirs(tmp + "/civitai_studio", exist_ok=True)
json.dump(["111", "222"], open(tmp + "/civitai_studio/favorites.json", "w"))
items = fs.list_items()
assert {i["oid"] for i in items} == {"111", "222"}, items
assert cache_store.kv_get("fav:migrated_v1") is True
# 迁移幂等
fs.toggle(fs.KIND_ASSET, "111")  # 取消 111
fs2 = fs.list_items()
assert {i["oid"] for i in fs2} == {"222"}

# toggle 语义 + 墓碑
assert fs.toggle(fs.KIND_ASSET, "333", {"name": "三", "cover": "http://c/3"}) is True
it = fs.get_item(fs.KIND_ASSET, "333")
assert it and it["name"] == "三" and it["dirty"] == 1 and not it["deleted"]
assert fs.toggle(fs.KIND_ASSET, "333") is False
it = fs.get_item(fs.KIND_ASSET, "333")
assert it["deleted"] == 1 and it["dirty"] == 1  # 墓碑
assert fs.toggle(fs.KIND_ASSET, "333") is True  # 再收藏复活

# 远端 upsert:dirty 本地不被覆盖;墓碑较新不拉回
fs.upsert_remote(fs.KIND_ASSET, "333", name="远端名", remote_updated=time.time())
it = fs.get_item(fs.KIND_ASSET, "333")
assert it["dirty"] == 1, "dirty 本地被远端覆盖"
fs.toggle(fs.KIND_ASSET, "444")  # 建档
assert fs.toggle(fs.KIND_ASSET, "444") is False  # 再取消 → 墓碑
old_t = time.time() - 100
fs.upsert_remote(fs.KIND_ASSET, "444", remote_updated=old_t)  # 远端旧收藏
it = fs.get_item(fs.KIND_ASSET, "444")
assert it["deleted"] == 1 and it["dirty"] == 1, "旧远端收藏不应拉回"
fs.upsert_remote(fs.KIND_ASSET, "444", remote_updated=time.time() + 100)  # 远端再新也不复活(墓碑终局)
it = fs.get_item(fs.KIND_ASSET, "444")
assert it["deleted"] == 1 and it["dirty"] == 1, it

# 模型收藏 + 分组
assert fs.toggle(fs.KIND_MODEL, "900", {"name": "SomeModel"}) is True
g = fs.upsert_group("我的组")
fs.set_group(fs.KIND_MODEL, "900", g["gid"])
items = fs.list_items(kind=fs.KIND_MODEL, group_id=g["gid"])
assert len(items) == 1 and items[0]["oid"] == "900"
fs.delete_group(g["gid"])
assert fs.list_items(kind=fs.KIND_MODEL, group_id="_")[0]["oid"] == "900"  # 回到未分组
# 未分组过滤(_)
g2 = fs.upsert_group("组二")
fs.set_group(fs.KIND_MODEL, "900", g2["gid"])
assert fs.list_items(kind=fs.KIND_MODEL, group_id="_") == []
assert len(fs.list_items(kind=fs.KIND_MODEL, group_id=g2["gid"])) == 1

# mark_synced
fs.mark_synced(fs.KIND_MODEL, "900")
assert fs.get_item(fs.KIND_MODEL, "900")["dirty"] == 0
fs.toggle(fs.KIND_MODEL, "900")
fs.mark_synced(fs.KIND_MODEL, "900")
assert fs.get_item(fs.KIND_MODEL, "900") is None  # 墓碑同步后删除

# 导入/导出
exp = fs.export_json()
assert exp["version"] == 2 and exp["items"]
payload = json.loads(json.dumps(exp))
payload["items"].append({"kind": "asset", "oid": "777", "name": "导入件"})
n = fs.import_json(payload)
assert n["items"] >= 3
n2 = fs.import_json(payload, replace=True)
assert fs.get_item(fs.KIND_ASSET, "111")["deleted"] == 1  # replace 后按文件重建(含墓碑)
assert fs.get_item(fs.KIND_ASSET, "777") is not None
print("favorites_store 冒烟全过")

# ===== 审计修复批回归 =====
# 1) 墓碑终局:远端再新也不复活(P0/审计 P1-3)
fs.toggle(fs.KIND_ASSET, "444")  # 墓碑态 → 复活(仅本地显式★可复活)
fs.toggle(fs.KIND_ASSET, "444")  # 再取消 → 墓碑(dirty=1)
fs.upsert_remote(fs.KIND_ASSET, "444", remote_updated=time.time() + 999)
it444 = fs.get_item(fs.KIND_ASSET, "444")
assert it444["deleted"] == 1, "墓碑被远端复活"

# 2) purge 只清 dirty=0 墓碑;dirty 墓碑(资产取消)永不过期
cache_store.kv_put("t", 1)
conn = cache_store._CONN
conn.execute("INSERT OR REPLACE INTO fav_items VALUES('asset','888',NULL,NULL,NULL,0,0,'remote',0,1,NULL,NULL)")
conn.execute("UPDATE fav_items SET updated_at=0 WHERE oid='888'")
fs.purge_tombstones(older_than=1)
assert fs.get_item(fs.KIND_ASSET, "444") is not None, "dirty 墓碑被清"
assert fs.get_item(fs.KIND_ASSET, "888") is None, "dirty=0 老墓碑应被清"

# 3) mark_remote_absent:远端缺席模型落墓碑(dirty=0),在场的不动
fs.toggle(fs.KIND_MODEL, "700")          # 本地新收藏 dirty=1(非 remote)
fs.upsert_remote(fs.KIND_MODEL, "701", remote_updated=time.time())   # remote 活跃
fs.upsert_remote(fs.KIND_MODEL, "702", remote_updated=time.time())
fs.toggle(fs.KIND_MODEL, "702")  # 702 本地取消 → 墓碑(建档来自 upsert_remote,取消一次即成)
gone = fs.mark_remote_absent(fs.KIND_MODEL, {"701"})
it701 = fs.get_item(fs.KIND_MODEL, "701")
it702 = fs.get_item(fs.KIND_MODEL, "702")
assert it701 and not it701["deleted"] and it701["dirty"] == 0
assert it702["deleted"] == 1 and it702["dirty"] == 1  # 本地墓碑不被对账触碰
m700 = fs.get_item(fs.KIND_MODEL, "700")
assert m700 and not m700["deleted"] and m700["dirty"] == 1  # 本地行(src=local)不参与缺席对账
print("缺席对账 OK:", gone)

# 4) upsert_group 按 civitai_id 去重(P1-1)
g1 = fs.upsert_group("集合A", civitai_id=555)
g2 = fs.upsert_group("集合A 改名", civitai_id=555)
assert g1["gid"] == g2["gid"], (g1, g2)
assert [g for g in fs.groups_list() if g["civitai_id"] == 555].count(g2) == 1

# 5) mark_synced expected_updated 竞态守卫
fs.toggle(fs.KIND_MODEL, "901", {"name": "X"})
snap = fs.get_item(fs.KIND_MODEL, "901")
fs.set_group(fs.KIND_MODEL, "901", None)  # 假装快照后又被改(set_group 现在不改 updated_at——直接改之)
conn.execute("UPDATE fav_items SET updated_at=? WHERE kind='model' AND oid='901'", (snap["updated_at"] + 9,))
fs.mark_synced(fs.KIND_MODEL, "901", expected_updated=snap["updated_at"])
assert fs.get_item(fs.KIND_MODEL, "901")["dirty"] == 1, "竞态守卫失效"
fs.mark_synced(fs.KIND_MODEL, "901", expected_updated=fs.get_item(fs.KIND_MODEL, "901")["updated_at"])
assert fs.get_item(fs.KIND_MODEL, "901")["dirty"] == 0

# 6) 导入强制 dirty=1(活动行)
pay = {"version": 2, "groups": [], "items": [{"kind": "model", "oid": "950", "name": "imp", "src": "remote", "dirty": 0}]}
fs.import_json(pay)
it950 = fs.get_item(fs.KIND_MODEL, "950")
assert it950["dirty"] == 1, "导入活动行应强制 dirty=1"

# 7) 导入损坏 payload 回滚(整库不丢)
before = len(fs.list_items(include_deleted=True))
try:
    fs.import_json({"version": 2, "groups": [{"name": "G"}], "items": 12345}, replace=True)  # items 非列表:导入中途抛错
except Exception:
    pass
# raise 在 commit 前 → 回滚生效:原库还在
assert len(fs.list_items(include_deleted=True)) >= before - 1, "replace 失败未回滚"
print("审计修复批回归全过")

# ===== 分组上行数据面(upsert/saveItem 的本地侧闭环) =====
# gpushed 贯穿:toggle/upsert_remote/import 三个写入口都保留推送标记
g3 = fs.upsert_group("上行组")
fs.toggle(fs.KIND_ASSET, "960", {"name": "pushme"})
fs.set_group(fs.KIND_ASSET, "960", g3["gid"])
fs.mark_group_pushed(fs.KIND_ASSET, "960", g3["gid"])
assert (fs.get_item(fs.KIND_ASSET, "960") or {}).get("gpushed") == [g3["gid"]]
fs.upsert_remote(fs.KIND_ASSET, "960", name="renamed", remote_updated=time.time() + 999)
# dirty 行不被 upsert 触碰;这里 960 无 dirty(分组不置 dirty)→ upsert 会 REPLACE,应保留 gpushed
assert (fs.get_item(fs.KIND_ASSET, "960") or {}).get("gpushed") == [g3["gid"]], "upsert_remote 丢 gpushed"
# 同组二次推送被 gpushed 挡住(数据面判定)
it960 = fs.get_item(fs.KIND_ASSET, "960")
assert g3["gid"] in (it960.get("gpushed") or [])
# mark_group_synced 绑定 civitai_id 并清 dirty
g4 = fs.upsert_group("待上行", dirty=1)
fs.mark_group_synced(g4["gid"], 424242)
g4b = next(g for g in fs.groups_list() if g["gid"] == g4["gid"])
assert g4b["civitai_id"] == 424242 and g4b["dirty"] == 0
# 同 civitai_id 再 upsert 不新增行(分组膨胀修复)
fs.upsert_group("重名集合", civitai_id=424242)
assert len([g for g in fs.groups_list() if g["civitai_id"] == 424242]) == 1
print("分组上行数据面 OK")

# ===== 自愈重建后收藏功能不瘫痪(gpushed 进 _SCHEMA;审计 P1-1 回归) =====
cache_store._CONN.execute("PRAGMA wal_checkpoint(TRUNCATE)")
cache_store._CONN.close()
for s in ("", "-wal", "-shm"):
    try:
        os.remove(cache_store.db_path() + s)
    except OSError:
        pass
cache_store._CONN = None
import civitai_studio.favorites_store as _fs_mod
_fs_mod._gpushed_checked = False
_fs_mod._ctype_checked = False
cache_store.init()
assert fs.toggle(fs.KIND_ASSET, "9999", {"name": "post-heal"}) is True, "重建库缺 gpushed 列"
assert not (fs.get_item(fs.KIND_ASSET, "9999") or {}).get("deleted")
print("自愈后 gpushed 列 OK")

# ===== 守卫仅限下行路径:本地改名(civitai_id=None)不被 dirty 守卫吞掉 =====
g5 = fs.upsert_group("G1", dirty=1)
g5b = fs.upsert_group("G2", gid=g5["gid"], dirty=1)  # 本地改名(routes 语义:dirty=1)
assert g5b["name"] == "G2" and g5b["dirty"] == 1, g5b
# 下行落地远端组(带 civitai_id):dirty 行只补绑,不改名
g5c = fs.upsert_group("RemoteName", gid=g5["gid"], civitai_id=777, updated_at=time.time())
assert g5c["name"] == "G2" and g5c["civitai_id"] == 777 and g5c["dirty"] == 1, g5c
# dirty=0 后下行正常写名
fs.mark_group_synced(g5["gid"], 777)
g5d = fs.upsert_group("RemoteName2", gid=g5["gid"], civitai_id=777, updated_at=time.time())
assert g5d["name"] == "RemoteName2" and g5d["dirty"] == 0, g5d
print("改名守卫分流 OK")

# ---- E2E 批1:ctype 列 + Legacy 哨兵组 + legacy 残留清理 ----
g = fs.upsert_group("encoder", civitai_id=18036496, ctype="Model")
assert g["ctype"] == "Model"
g2 = fs.upsert_group("encoder-local-rename", gid=g["gid"])  # 不带 ctype 落地:须保留既有类型
assert g2["ctype"] == "Model", g2
lg = fs.ensure_legacy_group()
assert lg and fs.ensure_legacy_group() == lg, "Legacy 组应幂等"
lgrow = [x for x in fs.groups_list() if x["gid"] == lg][0]
assert lgrow["ctype"] == "Legacy"
fs.upsert_remote(fs.KIND_ASSET, "9001", name="legacy1", remote_updated=time.time())              # remote 未分组=残留
fs.upsert_remote(fs.KIND_ASSET, "9002", name="grp", group_id=g["gid"], remote_updated=time.time())  # remote 带组=集合条目
fs.toggle(fs.KIND_ASSET, "9003", {"name": "local-star"})                                          # local 未分组=用户★
n = fs.purge_legacy_ungrouped()
assert n >= 1, n
assert fs.get_item(fs.KIND_ASSET, "9001") is None, "remote 未分组资产应被清理"
assert fs.get_item(fs.KIND_ASSET, "9002") is not None, "集合条目不应被清理"
assert fs.get_item(fs.KIND_ASSET, "9003") is not None, "本地★不应被清理"
assert fs.purge_legacy_ungrouped() == 0, "清理应幂等"
print("test_fav.py OK")
