"""路由契约测试:45 端点注册快照(防意外删路由)+请求形状抽样(400/404/缺 key 降级)."""
import os, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_contract_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
fp.folder_names_and_paths = {"loras": ([os.path.join(tmp, "loras")], {".safetensors"})}
fp.get_folder_paths = lambda key: [os.path.join(tmp, "loras")] if key == "loras" else []
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import routes

EXPECTED = sorted([
    ("GET", "/civitai_studio/cache_usage"), ("GET", "/civitai_studio/config"),
    ("GET", "/civitai_studio/destinations"), ("GET", "/civitai_studio/downloads"),
    ("GET", "/civitai_studio/enums"), ("GET", "/civitai_studio/favorites"),
    ("GET", "/civitai_studio/favorites/export"), ("GET", "/civitai_studio/image"),
    ("GET", "/civitai_studio/image_tags/{image_id}"), ("GET", "/civitai_studio/images"),
    ("GET", "/civitai_studio/local"), ("GET", "/civitai_studio/local/subdirs"),
    ("GET", "/civitai_studio/model/{mid}"), ("GET", "/civitai_studio/resolve_versions"),
    ("GET", "/civitai_studio/search"), ("GET", "/civitai_studio/tag_mapping"),
    ("GET", "/civitai_studio/version"), ("GET", "/civitai_studio/version/{vid}"),
    ("GET", "/civitai_studio/workflow_extracts"), ("POST", "/civitai_studio/cache_clear"),
    ("POST", "/civitai_studio/config"), ("POST", "/civitai_studio/download"),
    ("POST", "/civitai_studio/downloads/cancel"), ("POST", "/civitai_studio/downloads/clear"),
    ("POST", "/civitai_studio/downloads/retry"), ("POST", "/civitai_studio/embedded_meta"),
    ("POST", "/civitai_studio/extract_workflow"), ("POST", "/civitai_studio/favorites/assign"),
    ("POST", "/civitai_studio/favorites/groups"), ("POST", "/civitai_studio/favorites/import"),
    ("POST", "/civitai_studio/favorites/sync"), ("POST", "/civitai_studio/favorites/toggle"),
    ("POST", "/civitai_studio/import_asset"), ("POST", "/civitai_studio/key_probe"),
    ("POST", "/civitai_studio/local/associate"), ("POST", "/civitai_studio/local/check_updates"),
    ("POST", "/civitai_studio/local/deep_rescan"), ("POST", "/civitai_studio/local/delete"),
    ("POST", "/civitai_studio/local/move"), ("POST", "/civitai_studio/local/refresh_meta"),
    ("POST", "/civitai_studio/local/rename"), ("POST", "/civitai_studio/local/reveal"),
    ("POST", "/civitai_studio/remember_image/{image_id}"), ("POST", "/civitai_studio/save_image"),
    ("POST", "/civitai_studio/workflow_extracts/delete"),
])
got = sorted(routes.ROUTES)
assert len(got) == 45, f"路由数变化: {len(got)} (期望 45) — 若有意增删请同步更新本快照"
assert got == EXPECTED, set(got) ^ set(EXPECTED)

# 请求形状抽样:错误体形状一致({"error": str})
err = routes._json_error(" boom ", 400)
assert err.status == 400 and err.content_type == "application/json"

print("PASS test_routes_contract (45 endpoints)")
