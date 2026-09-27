"""tag_map durable 表测试:文件迁移/增量 upsert/clear_cache 幸存."""
import json, os, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_tagmap_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
os.makedirs(os.path.join(tmp, "civitai_studio"), exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store, config

# 0.7.x 文件存在:首调迁移
legacy = os.path.join(tmp, "civitai_studio", "tag_mapping.json")
json.dump({"lora": 101, "nsfw": 222}, open(legacy, "w", encoding="utf-8"))
import civitai_studio.routes as routes
m = routes._load_tag_mapping()
assert m == {"lora": 101, "nsfw": 222}, m
# 幂等:文件改动后不再迁移
json.dump({"changed": 1}, open(legacy, "w", encoding="utf-8"))
assert routes._load_tag_mapping() == {"lora": 101, "nsfw": 222}
# 增量 upsert(覆盖 + 新增)
routes._save_tag_pairs([("lora", 999), ("new", 7)])
m = routes._load_tag_mapping()
assert m == {"lora": 999, "nsfw": 222, "new": 7}, m
# durable 域:clear_cache 幸存
cache_store.clear_cache()
assert cache_store.kv_get("tagmap:migrated_v1") is None  # 旗标在 kv,被清(正常)
m = routes._load_tag_mapping()  # 旗标没了但表非空 → 不重复迁移,直接返回
assert m == {"lora": 999, "nsfw": 222, "new": 7}, "tag_map 被 clear_cache 误清"
print("PASS test_tagmap")
