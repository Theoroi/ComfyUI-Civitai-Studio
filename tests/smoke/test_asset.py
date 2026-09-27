import hashlib, json, os, struct, sys, tempfile, types, zlib

tmp = tempfile.mkdtemp(prefix="cs_asset_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
fp.get_input_directory = lambda: tmp + "/input"
fp.get_base_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import routes


def _png(rgba):
    # 真 1x1 PNG:_asset_save 现在带 PIL 解码校验(导入资产截断修复),假字节会被拒
    def chunk(typ, payload):
        return (struct.pack(">I", len(payload)) + typ + payload
                + struct.pack(">I", zlib.crc32(typ + payload) & 0xffffffff))
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(b"\x00" + bytes(rgba))) + chunk(b"IEND", b""))


# civitai_<id> 命名 + hash 去重 + _x 递增
data = _png((255, 0, 0, 255))
n1, h1, ex1, t1 = routes._asset_save("123", ".png", data)
assert n1 == "civitai_123.png" and not ex1 and os.path.isfile(t1)
n2, h2, ex2, t2 = routes._asset_save("123", ".png", data)
assert ex2 and t2 == t1, "同 hash 应幂等跳过"
n3, h3, ex3, t3 = routes._asset_save("123", ".png", _png((0, 0, 255, 255)))
assert n3 == "civitai_123_1.png" and not ex3
n4, _, _, _ = routes._asset_save("123", ".png", _png((0, 255, 0, 255)))
assert n4 == "civitai_123_2.png"
# 截断/伪 PNG 必须被解码校验挡下(半截文件不许落盘)
for junk in (b"PNGDATA" * 100, b"\x89PNG\r\n\x1a\ntruncated"):
    try:
        routes._asset_save("789", ".png", junk)
        raise AssertionError("伪 PNG 应被解码校验拒绝")
    except ValueError:
        pass
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
