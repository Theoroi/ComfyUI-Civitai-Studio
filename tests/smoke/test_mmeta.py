import io, json, os, struct, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_mm_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import media_meta

# ---------- MP4:合成 mdta 标准结构(ilst 子 box 的 type = 键索引) ----------
def _box(typ, *payloads):
    body = b"".join(payloads)
    return struct.pack(">I", 8 + len(body)) + (typ if isinstance(typ, bytes) else typ) + body

wf = {"nodes": {"1": {"class_type": "KSampler"}}, "revision": 7}
IDX = lambda n: struct.pack(">I", n)
DATAH = bytes([0, 0, 0, 1, 0, 0, 0, 0])  # data box: 4B 类型指示 + 4B locale
keys = _box(b"keys",
            _box(b"mdta", IDX(1), b"workflow"),
            _box(b"mdta", IDX(2), b"prompt"),
            _box(b"mdta", IDX(3), b"encoder"))
e1 = _box(IDX(1), _box(b"data", DATAH, json.dumps(wf).encode()))
e2 = _box(IDX(2), _box(b"data", DATAH, "一只猫".encode()))
e3 = _box(IDX(3), _box(b"data", DATAH, b"ComfyUI"))
ilst = _box(b"ilst", e1, e2, e3)
meta = _box(b"meta", bytes([0, 0, 0, 0]), keys, ilst)  # fullbox: 4B version/flags
mp4_bytes = _box(b"ftyp", b"isom\x00\x00\x02\x00isomiso2") + _box(b"moov", _box(b"udta", meta)) + _box(b"free", b"")

parsed = media_meta.extract_mp4_bytes(mp4_bytes)
assert parsed and parsed["workflow"]["revision"] == 7 and parsed["prompt"] == "一只猫" and parsed["encoder"] == "ComfyUI", parsed

p_mp4 = os.path.join(tmp, "v.mp4")
open(p_mp4, "wb").write(mp4_bytes)
got = media_meta.extract_mp4_file(p_mp4)
assert got["workflow"]["revision"] == 7, got
assert media_meta.extract_mp4_bytes(b"\x00\x00\x00\x08moovgarbage") is None
assert media_meta.extract_mp4_file(p_mp4 + ".nonexist") is None

# ---------- PNG(PIL;无 PIL 环境跳过) ----------
try:
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo
    p_png = os.path.join(tmp, "i.png")
    img = Image.new("RGB", (4, 4), (255, 0, 0))
    info = PngInfo()
    info.add_text("prompt", json.dumps(wf))
    info.add_text("workflow", json.dumps(wf))
    info.add_text("parameters", "masterpiece, steps:20")
    img.save(p_png, pnginfo=info)
    got2 = media_meta.extract_png_file(p_png)
    assert got2["prompt"]["revision"] == 7 and got2["parameters"] == "masterpiece, steps:20", got2
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False
    print("(系统 python 无 PIL,跳过 PNG 实测 — ComfyUI venv 必有)")

# ---------- 缓存:命中/失效/删除 ----------
key_hits = {"n": 0}
orig_png = media_meta.extract_png_file
orig_mp4 = media_meta.extract_mp4_file
def counting_png(path):
    key_hits["n"] += 1
    return orig_png(path)
def counting_mp4(path):
    key_hits["n"] += 1
    return orig_mp4(path)
media_meta.extract_png_file = counting_png
media_meta.extract_mp4_file = counting_mp4
if HAVE_PIL:
    m1 = media_meta.get_embedded(p_png)
    assert key_hits["n"] == 1
    m2 = media_meta.get_embedded(p_png)  # 二次走缓存
    assert key_hits["n"] == 1 and m2["prompt"]["revision"] == 7
    img = Image.new("RGB", (5, 5), (0, 255, 0))
    img.save(p_png)  # 覆盖:无内嵌段
    st = os.stat(p_png)
    os.utime(p_png, (st.st_atime, st.st_mtime + 5))
    m3 = media_meta.get_embedded(p_png)
    assert key_hits["n"] == 2 and m3 is None, (key_hits, m3)
    os.remove(p_png)
    assert media_meta.get_embedded(p_png) is None
n0 = key_hits["n"]
media_meta.get_embedded(p_mp4)
assert key_hits["n"] == n0 + 1
media_meta.get_embedded(p_mp4)
assert key_hits["n"] == n0 + 1  # 缓存命中
print("media_meta 冒烟全过(HAVE_PIL=%s)" % HAVE_PIL)
