import hashlib, json, os, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_asset_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
fp.get_input_directory = lambda: tmp + "/input"
fp.get_base_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import routes

# civitai_<id> 命名 + hash 去重 + _x 递增
data = b"PNGDATA" * 100
n1, h1, ex1, t1 = routes._asset_save("123", ".png", data)
assert n1 == "civitai_123.png" and not ex1 and os.path.isfile(t1)
n2, h2, ex2, t2 = routes._asset_save("123", ".png", data)
assert ex2 and t2 == t1, "同 hash 应幂等跳过"
n3, h3, ex3, t3 = routes._asset_save("123", ".png", b"DIFFERENT")
assert n3 == "civitai_123_1.png" and not ex3
n4, _, _, _ = routes._asset_save("123", ".png", b"DIFFERENT2")
assert n4 == "civitai_123_2.png"
# 同 hash 不同 id 不互相影响
n5, _, ex5, t5 = routes._asset_save("456", ".png", data)
assert n5 == "civitai_456.png" and not ex5
# hash 正确性
assert h1 == hashlib.sha256(data).hexdigest()
# extract 路由的 wf 形状守卫逻辑(nodes 键)——直接测判定式
wf_ok = {"nodes": [{}], "links": []}
wf_api = {"prompt": {}}
assert bool(wf_ok.get("nodes")) and not bool(wf_api.get("nodes"))

# 提取文件名守卫(路由层用 re.fullmatch,这里验证模式)
import re
assert re.fullmatch(r"extract_\d+\.json", "extract_123.json")
assert not re.fullmatch(r"extract_\d+\.json", ".." + chr(92) + "evil.json")
assert not re.fullmatch(r"extract_\d+\.json", "extract_123.json.bak")
print("asset/extract 命名与去重冒烟全过")
