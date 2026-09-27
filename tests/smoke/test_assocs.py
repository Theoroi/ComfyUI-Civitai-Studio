"""assocs 关联表(主存储,阶段2)离线测试:DB 真值/快照补源/对账豁免/durable 域/删库重建."""
import json, os, sys, tempfile, time, types

tmp = tempfile.mkdtemp(prefix="cs_assocs2_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
MODELS_DIR = os.path.join(tmp, "models", "loras")
os.makedirs(MODELS_DIR, exist_ok=True)
fp.folder_names_and_paths = {"loras": ([MODELS_DIR], {".safetensors"})}
fp.get_folder_paths = lambda key: [MODELS_DIR] if key == "loras" else []
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store, local_index

P1 = os.path.join(MODELS_DIR, "a_v1.safetensors")
P2 = os.path.join(MODELS_DIR, "b.safetensors")
for p in (P1, P2):
    open(p, "wb").write(b"x")

# 1) 写入(含完整 meta JSON) + 单查 + 按 version 查
M1 = json.dumps({"source": "civitai", "model_id": 100, "version_id": "1001",
                 "model_name": "模型甲", "base_model": "SDXL", "trained_words": ["kw"]},
                ensure_ascii=False)
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", "http://c/1.jpg", M1)])
a = cache_store.get_assoc(P1)
assert a and a["model_id"] == "100" and a["version_id"] == "1001" and a["name"] == "模型甲", a
assert json.loads(a["meta"])["trained_words"] == ["kw"], a
v = cache_store.assoc_by_version("1001")
assert v and os.path.normpath(P1) == v["path"], v
assert cache_store.assoc_by_version("9999") is None

# 2) 阶段2 核心语义:sidecar 缺席 ≠ 取消关联 —— 无 sidecar 的文件扫描后行保留,
#    且快照从 DB meta 补源(「已安装」/节点匹配不依赖 sidecar 在盘)
local_index.scan(force=True, deep=True)
a = cache_store.get_assoc(P1)
assert a and a["version_id"] == "1001", "DB 行被 sidecar 缺席误清(旧语义残留)"
snap = local_index.scan(force=True)  # 强制新扫描,不吃 TTL 缓存(真实验证补源路径)
m1 = next(m for m in snap["models"] if m["path"] == os.path.normpath(P1))
assert (m1.get("civitai") or {}).get("trained_words") == ["kw"], "快照未从 DB meta 补源"
assert snap["by_version"].get("1001") is m1, "by_version 未含 DB 补源条目"
assert cache_store.assoc_by_version("1001")["path"] == m1["path"]

# 3) alive 对账:文件消失行清;sidecar 在盘的行照常刷新(含 meta);swept_before 豁免
SIDE2 = json.dumps({"source": "civitai", "model_id": 200, "version_id": "2001",
                    "model_name": "模型乙"}, ensure_ascii=False)
json.dump(json.loads(SIDE2), open(P2 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True)
assert cache_store.get_assoc(P2)["model_id"] == "200"
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", None, M1)], [P1])  # P2 不在 alive
assert cache_store.get_assoc(P2) is None and cache_store.get_assoc(P1) is not None
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None, SIDE2)])
future = time.time() + 100
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", None, M1)], [P1], swept_before=future)
assert cache_store.get_assoc(P2) is None  # updated_at < future → 正常清
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None, SIDE2)])
past = time.time() - 100
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", None, M1)], [P1], swept_before=past)
assert cache_store.get_assoc(P2) is not None, "swept_before 豁免失效"

# 4) rename 平移 + 目标 PK 冲突覆盖 + sidecar 迁移失败标 pending(仍不丢关联/快照可用)
cache_store.rename_assoc(P1, P2)
assert cache_store.get_assoc(P1) is None
assert cache_store.get_assoc(P2)["version_id"] == "1001"
cache_store.rename_assoc(P2, P1, pending=True)  # 模拟 sidecar 迁移失败:P1 侧无 sidecar
a = cache_store.get_assoc(P1)
assert a and a["version_id"] == "1001", "平移后行内容错误"  # 1001 行随 rename 链回到 P1
local_index.scan(force=True)  # P1 无 sidecar:pending=1 行不得被对账清除
a = cache_store.get_assoc(P1)
assert a is not None and str(json.loads(a["meta"])["model_id"]) == "100", "pending 行被扫描清/快照未恢复"
# sidecar 补导成功 → 扫描后 pending 清零(硬断言:扫描分支的 pending_export=0 子句)
json.dump(json.loads(M1), open(P1 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True)
a = cache_store.get_assoc(P1)
assert a["version_id"] == "1001"
assert os.path.normpath(P1) not in cache_store.assoc_pending_paths(), "补导后 pending 未清零"

# 4c) 瘦 sidecar 不降级 DB 富元数据(字段级合并,sidecar 优先);无身份 sidecar 不翻转可见性
json.dump({"model_id": 100, "version_id": "1001"}, open(P1 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True)
snap = local_index.scan(force=True)
m1 = next(m for m in snap["models"] if m["path"] == os.path.normpath(P1))
assert (m1["civitai"].get("trained_words") == ["kw"]
        and m1["civitai"].get("model_name") == "模型甲"), "瘦 sidecar 降级了 DB 富元数据"
json.dump({"description": "外部描述,无身份"}, open(P1 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True)
a = cache_store.get_assoc(P1)
assert a and a["version_id"] == "1001", "无身份 sidecar 清掉了 DB 行"
snap = local_index.scan(force=True)
m1 = next(m for m in snap["models"] if m["path"] == os.path.normpath(P1))
assert (m1["civitai"] or {}).get("version_id") == "1001", "无身份 sidecar 翻转了关联可见性"
# 恢复有效 sidecar(为 test 6 删库重建提供重建源)
json.dump(json.loads(M1), open(P1 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True)

# 5) durable 域:clear_cache 清 kv/指纹/媒体,assocs 幸存
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", None, M1)])
cache_store.kv_put("k", "v")
cache_store.clear_cache()
assert cache_store.kv_get("k") is None
assert cache_store.get_assoc(P1) is not None, "关联表被 clear_cache 误清"

# 6) 删库重建(DB 丢失兜底):cache.sqlite 删除 → deep scan 从 sidecar 全量重建
dbf = cache_store.db_path()
cache_store.close()  # 释放 Windows 文件句柄
os.remove(dbf)
assert cache_store.get_assoc(P1) is None  # 库真没了(get_assoc 内部 init 重建空库)
local_index._cache = None  # 快照也作废,模拟彻底丢失
local_index.scan(force=True, deep=True)
a1 = cache_store.get_assoc(P1)
a2 = cache_store.get_assoc(P2)
assert a1 and a1["version_id"] == "1001", "删库后未从 sidecar 重建(P1)"
assert a2 and a2["version_id"] == "2001", "删库后未从 sidecar 重建(P2)"
snap = local_index.scan(force=True)
m2 = next(m for m in snap["models"] if m["path"] == os.path.normpath(P2))
assert (m2.get("civitai") or {}).get("model_name") == "模型乙", "重建后快照未含 sidecar 元数据"

print("PASS test_assocs")
