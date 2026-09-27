"""assocs 关联表(主存储)离线测试:写入/查询/清除对账/平移/durable 域."""
import json, os, sys, tempfile, types

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

# 3) alive 对账:文件消失的行被清,幸存行保留
cache_store.sync_assocs([(P2, "200", "2001", "模型乙", None)])
cache_store.sync_assocs([(P1, "100", "1001", "模型甲", None)], [P1])  # P2 不在 alive
assert cache_store.get_assoc(P2) is None and cache_store.get_assoc(P1) is not None

# 4) rename 平移
cache_store.rename_assoc(P1, P2)
assert cache_store.get_assoc(P1) is None
assert cache_store.get_assoc(P2)["version_id"] == "1001"
cache_store.rename_assoc(P2, P1)

# 5) durable 域:clear_cache 清 kv/指纹/媒体,assocs 幸存
cache_store.kv_put("k", "v")
cache_store.clear_cache()
assert cache_store.kv_get("k") is None
assert cache_store.get_assoc(P1) is not None, "关联表被 clear_cache 误清"

# 6) 扫描写链路:真实 sidecar → scan() → 关联入表;删 sidecar → 重扫 → 行清
side = {"source": "civitai", "model_id": 300, "version_id": "3001", "model_name": "模型丙"}
json.dump(side, open(P1 + ".civitai.json", "w", encoding="utf-8"))
local_index.scan(force=True, deep=True)
a = cache_store.get_assoc(P1)
assert a and a["version_id"] == "3001" and a["name"] == "模型丙", a
os.remove(P1 + ".civitai.json")
local_index.scan(force=True)
assert cache_store.get_assoc(P1) is None, "sidecar 删除后关联行未清除"
# 无 sidecar 的文件不产生幽灵行
assert cache_store.get_assoc(P2) is None

print("PASS test_assocs")
