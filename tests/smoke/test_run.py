import asyncio, json, os, sys, tempfile, types, time

tmp = tempfile.mkdtemp(prefix="cs_user_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
fp.folder_names_and_paths = {"checkpoints": ([tmp + "/models"], {".safetensors"})}
fp.get_folder_paths = lambda key: [tmp + "/models"]
sys.modules["folder_paths"] = fp

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store, local_index, config

os.makedirs(tmp + "/models", exist_ok=True)
assert cache_store._CONN is not None, "init failed"
mode = cache_store._CONN.execute("PRAGMA journal_mode").fetchone()[0]
assert mode == "wal", mode

# 1) kv + 指纹(新 4 元组/6 元组结构)
cache_store.kv_put("k1", {"a": 1}, ttl=60)
assert cache_store.kv_get("k1") == {"a": 1}
cache_store.kv_put("k2", {"b": 2}, ttl=0.05)
time.sleep(0.1)
assert cache_store.kv_get("k2") is None
cache_store.sync_fingerprints(
    [("p1", 10, 1.0, 5, 2.0, '{"v":1}'), ("p2", 20, 2.0, None, None, None)], {"p1", "p2"})
fps = cache_store.fingerprints()
assert fps["p1"] == (10, 1.0, 5, 2.0) and fps["p2"] == (20, 2.0, None, None)
assert cache_store.sidecar_blob("p1") == '{"v":1}' and cache_store.sidecar_blob("p2") is None
cache_store.sync_fingerprints([], {"p1"})
assert list(cache_store.fingerprints()) == ["p1"]
cache_store.forget_fingerprint("p1")
assert cache_store.fingerprints() == {}
print("sqlite 层 OK")

# 2) 索引增量化 + 外部改 sidecar 也能感知(P1-3)
mfile = os.path.normpath(tmp + "/models/a.safetensors")
open(mfile, "wb").write(b"x" * 8)
sidecar = {"version_id": "123", "model_name": "A"}
local_index.write_sidecar(mfile, sidecar)
s1 = local_index.scan(force=True)
assert s1["stats"]["read"] == 1 and s1["stats"]["reused"] == 0, s1["stats"]
# 外部改 sidecar(不经 write_sidecar)→ 指纹含 sidecar stat → 重读
time.sleep(0.02)
sidecar2 = dict(sidecar, model_name="B")
with open(mfile + ".civitai.json", "w", encoding="utf-8") as f:
    json.dump(sidecar2, f)
s2 = local_index.scan(force=True)
assert s2["stats"]["read"] == 1 and s2["stats"]["reused"] == 0, s2["stats"]
assert s2["models"][0]["civitai"]["model_name"] == "B"
# 不动任何文件 → 完全复用
s3 = local_index.scan(force=True)
assert s3["stats"]["reused"] == 1 and s3["stats"]["read"] == 0, s3["stats"]
# write_sidecar 作废指纹 → 重读
local_index.write_sidecar(mfile, dict(sidecar2, model_name="C"))
s4 = local_index.scan(force=True)
assert s4["models"][0]["civitai"]["model_name"] == "C"
# 删 sidecar → 重读;阶段2 主存储:元数据由 assocs.meta 补源,不随 sidecar 消失
os.remove(mfile + ".civitai.json")
s5 = local_index.scan(force=True)
assert s5["stats"]["read"] == 1
assert s5["models"][0]["civitai"] is not None and s5["models"][0]["civitai"]["model_name"] == "C",     "sidecar 缺席时快照应从 DB meta 补源(assocs 主存储语义)"
# 深度重扫 + 删文件清指纹
s6 = local_index.scan(force=True, deep=True)
assert s6["stats"]["deep"] is True
os.remove(mfile)
s7 = local_index.scan(force=True)
assert s7["stats"]["total"] == 0 and cache_store.fingerprints() == {}
print("索引增量化 OK(含外部 sidecar 感知):", s3["stats"])

# 3) config 钳制 + usage/clear(响应含 max_mb 由 routes 测,这里测底层)
config.update({"cache_max_mb": 9999})
assert config.load()["cache_max_mb"] == 2000
cache_store.kv_put("big", {"x": 1})
assert cache_store.usage() > 0
cache_store.clear_cache()
assert cache_store.kv_get("big") is None and cache_store.fingerprints() == {}
print("config/usage/clear OK")

# 4) 损坏自愈(重建后可用)
cache_store._CONN.execute("PRAGMA wal_checkpoint(TRUNCATE)")
cache_store._CONN.close()
open(cache_store.db_path(), "wb").write(b"garbage" * 100)
cache_store._CONN = None
cache_store.kv_put("after_heal", {"ok": 1})
assert cache_store.kv_get("after_heal") == {"ok": 1}, "自愈失败"
print("损坏自愈 OK")

# 4b) 锁竞争不得触发删库重建(P1-2):模拟 init 时 OperationalError
cache_store._CONN = None
orig_connect = cache_store.sqlite3.connect
def locked_connect(*a, **kw):
    raise cache_store.sqlite3.OperationalError("database is locked")
cache_store.sqlite3.connect = locked_connect
cache_store.init()
assert cache_store._CONN is None and not cache_store._BROKEN, "锁竞争被误判为损坏"
cache_store.sqlite3.connect = orig_connect
cache_store.init()
assert cache_store._CONN is not None, "锁过后未能恢复"
print("锁竞争降级(不误删共享库) OK")

# 5) downloader 迁移路径
from civitai_studio import downloader
assert os.path.dirname(downloader._state_path()) == cache_store.cache_dir()
assert downloader._legacy_state_path() == os.path.join(tmp, "civitai_studio", "download_jobs.json")
print("downloader 迁移路径 OK")
print("ALL SMOKE PASS")

# 6) 配额触发点接线(P1-1 闭环):把上限临时调到 50MB 下限仍难触发——直接验调用存在与低损耗
import inspect
src = inspect.getsource(cache_store.sync_fingerprints)
assert "_enforce_quota()" in src, "sync 后未接配额触发点"
t0 = time.time()
for _ in range(200):
    cache_store.sync_fingerprints([("q%d" % _, _, 1.0, None, None, None)], None)
dur = time.time() - t0
assert dur < 2.0, "sync 常态路径被配额检查拖慢: %.3fs" % dur
print("配额触发接线 OK(sync 200 次耗时 %.3fs)" % dur)
print("ALL SMOKE PASS 2")
