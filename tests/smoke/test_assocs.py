"""assocs 关联表(主存储)离线测试:写入/查询/清除对账/平移/durable 域."""
import json, os, sys, tempfile, time, types

tmp = tempfile.mkdtemp(prefix="cs_assocs_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
# 本地索引扫描桩:注册一个模型目录
MODELS_DIR = os.path.join(tmp, "models", "loras")
os.makedirs(MODELS_DIR, exist_ok=True)
fp.folder_names_and_paths = {"loras": ([MODELS_DIR], {".safetensors"})}
fp.get_folder_paths = lambda key: [MODELS_DIR] if key == "loras" else []
fp.get_save_image_path = None
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store, local_index

P1 = os.path.join(MODELS_DIR, "a_v1.safetensors")
P2 = os.path.join(MODELS_DIR, "b.safetensors")
for p in (P1, P2):
    open(p, "wb").write(b"x")

# 1) 写入 + 单查 + 按 version 查
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", "http://c/1.jpg")])
a = cache_store.get_assoc(P1)
assert a and a["model_id"] == "100" and a["version_id"] == "1001" and a["name"] == "模型甲", a
v = cache_store.assoc_by_version("1001")
assert v and v["path"] == os.path.normpath(P1), v
assert cache_store.assoc_by_version("9999") is None
assert cache_store.get_assoc(P2) is None

# 2) clear_paths:外部删 sidecar 后本轮确认无关联 → 删行
cache_store.sync_assocs([], None, [P2 + "_ghost"])  # 幽灵路径清除(无行也不报错)
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None)])
assert cache_store.get_assoc(P2) is not None
cache_store.sync_assocs([], None, [P2])
assert cache_store.get_assoc(P2) is None

# 3) alive 对账:文件消失的行被清,幸存行保留;swept_before 豁免新写入行(多实例保护)
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None)])
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", None)], [P1])  # P2 不在 alive
assert cache_store.get_assoc(P2) is None and cache_store.get_assoc(P1) is not None
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None)])
future = time.time() + 100
cache_store.sync_assocs([], [P1], swept_before=future)  # P2.updated_at < future → 正常清
assert cache_store.get_assoc(P2) is None
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None)])
past = time.time() - 100
cache_store.sync_assocs([], [P1], swept_before=past)  # P2.updated_at > past → 豁免保行
assert cache_store.get_assoc(P2) is not None, "swept_before 豁免失效"

# 4) rename 平移 + 目标 PK 冲突时以新行覆盖 + pending 标记
cache_store.rename_assoc(P1, P2)
assert cache_store.get_assoc(P1) is None
assert cache_store.get_assoc(P2)["version_id"] == "1001"
cache_store.rename_assoc(P2, P1)

# 4b) sidecar 导出失败场景(P0 核心承诺):pending=1 的行,扫描对账不得清除
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None)], pending=True)
assert cache_store.get_assoc(P2)["updated_at"]  # 直写生效
assert P2 in cache_store.assoc_pending_paths() or True  # normpath 后入集
assert os.path.normpath(P2) in cache_store.assoc_pending_paths()
local_index.scan(force=True)  # P2 无 sidecar:若无 pending 保护,行会被 assoc_clear 删掉
assert cache_store.get_assoc(P2) is not None, "pending 行被扫描对账误删(P0)"
assert os.path.normpath(P2) in cache_store.assoc_pending_paths()
# sidecar 恢复(补导出成功)→ 扫描后 pending 清零、字段刷新
json.dump({"source": "civitai", "model_id": 200, "version_id": "2001", "model_name": "模型乙"},
          open(P2 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True)
a2 = cache_store.get_assoc(P2)
assert a2 and a2["model_id"] == "200" and os.path.normpath(P2) not in cache_store.assoc_pending_paths(), a2

# 5) durable 域:clear_cache 清 kv/指纹/媒体,assocs 幸存
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", None)])  # 直写一行(应用路径)
cache_store.kv_put("k", "v")
cache_store.clear_cache()
assert cache_store.kv_get("k") is None
assert cache_store.get_assoc(P1) is not None, "关联表被 clear_cache 误清"

# 6) 扫描写链路:真实 sidecar → scan() → 关联入表;删 sidecar → 重扫 → 行清(无 pending 时)
side = {"source": "civitai", "model_id": 300, "version_id": "3001", "model_name": "模型丙"}
json.dump(side, open(P1 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True, deep=True)
a = cache_store.get_assoc(P1)
assert a and a["version_id"] == "3001" and a["name"] == "模型丙", a
os.remove(P1 + ".civitai.json")
local_index.scan(force=True)
assert cache_store.get_assoc(P1) is None, "sidecar 删除后关联行未清除"
# 幽灵行防护:P2 的 sidecar 一并删除 → 重扫后行清(无 sidecar 且非 pending = 无关联)
os.remove(P2 + ".civitai.json")
local_index.scan(force=True)
assert cache_store.get_assoc(P2) is None

print("PASS test_assocs")
