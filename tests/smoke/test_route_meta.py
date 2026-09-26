import asyncio, json, os, struct, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_rt_")
os.makedirs(tmp + "/out", exist_ok=True)
os.makedirs(tmp + "/models/checkpoints", exist_ok=True)
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
fp.get_output_directory = lambda: tmp + "/out"
fp.get_input_directory = lambda: tmp + "/in"
fp.get_temp_directory = lambda: tmp + "/tmp"
fp.folder_names_and_paths = {"checkpoints": ([tmp + "/models/checkpoints"], {".safetensors"})}
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import routes, media_meta

roots = routes._meta_roots()
assert any(r.endswith("out") for r in roots), roots
assert any("checkpoints" in r for r in roots), roots

def contained(p):
    real = os.path.realpath(p)
    return any(real == r or real.startswith(r + os.sep) for r in roots)

# 允许目录内
ok_file = os.path.join(tmp, "out", "a.png")
open(ok_file, "wb").write(b"x")
assert contained(ok_file)
# 目录穿越(Live 重定向/符号路径被 realpath 归一)
evil = os.path.join(tmp, "out", "..", "secret.png")
open(os.path.join(tmp, "secret.png"), "wb").write(b"x")
assert not contained(evil), "穿越路径被误放行"
# 扩展名白名单
assert os.path.splitext("/x/y.txt")[1].lower() not in routes._META_EXTS

# 端到端:在允许目录造一个真 PNG(venv 有 PIL)走 get_embedded
try:
    from PIL import Image, PngImagePlugin
    img = Image.new("RGB", (2, 2))
    info = PngImagePlugin.PngInfo()
    info.add_text("workflow", json.dumps({"rev": 1}))
    img.save(ok_file, pnginfo=info)
    meta = media_meta.get_embedded(ok_file)
    assert meta and meta["workflow"]["rev"] == 1, meta
except ImportError:
    print("(无 PIL,跳过端到端 PNG)")

# .mov 无 fullbox 变体回退:meta 不带 4B version/flags
def _box(typ, *payloads):
    body = b"".join(payloads)
    return struct.pack(">I", 8 + len(body)) + typ + body
IDX = lambda n: struct.pack(">I", n)
DATAH = bytes([0, 0, 0, 1, 0, 0, 0, 0])
keys = _box(b"keys", _box(b"mdta", IDX(1), b"workflow"))
ilst = _box(b"ilst", _box(IDX(1), _box(b"data", DATAH, b'{"v":2}')))
meta_atom = _box(b"meta", keys, ilst)  # Apple 原生:无 fullbox 4B
mov = _box(b"ftyp", b"qt  ") + _box(b"moov", _box(b"udta", meta_atom))
p_mov = os.path.join(tmp, "out", "a.mov")
open(p_mov, "wb").write(mov)
got = media_meta.extract_mp4_file(p_mov)
assert got and got["workflow"]["v"] == 2, got
print("route_meta 冒烟全过")
