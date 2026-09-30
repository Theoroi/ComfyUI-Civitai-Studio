import os, sys, tempfile, types

tmp = tempfile.mkdtemp(prefix="cs_media_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store

# store → lookup 往返
assert cache_store.media_store("https://x/img.png", "image/png", b"\x89PNG" + b"0" * 100)
hit = cache_store.media_lookup("https://x/img.png")
assert hit and hit[1] == "image/png" and os.path.isfile(hit[0])
assert cache_store.media_lookup("https://x/other.png") is None
assert cache_store.usage() >= os.path.getsize(hit[0])

# 超 20MB 拒写
assert cache_store.media_store("https://x/big.mp4", "video/mp4", b"0" * (21 * 1024 * 1024)) is None
assert cache_store.media_lookup("https://x/big.mp4") is None

# 覆盖写:同 URL 新内容
cache_store.media_store("https://x/img.png", "image/jpeg", b"JPG" * 10)
hit2 = cache_store.media_lookup("https://x/img.png")
assert hit2[1] == "image/jpeg" and os.path.getsize(hit2[0]) == 30

# evict:限额 5B → 全删,kv 元数据同步消失
cache_store.media_store("https://x/a.png", "image/png", b"aaaaa")
n_files = len(os.listdir(cache_store.media_dir()))
assert n_files == 2, n_files  # img.png + a.png
cache_store.media_evict(4)
assert cache_store.media_lookup("https://x/img.png") is None
assert cache_store.media_lookup("https://x/a.png") is None
assert not os.path.isdir(cache_store.media_dir()) or not [f for f in os.listdir(cache_store.media_dir()) if f.endswith(".bin")]

# clear_cache 连媒体一起清
cache_store.media_store("https://x/b.png", "image/png", b"bbb")
cache_store.clear_cache()
assert cache_store.media_lookup("https://x/b.png") is None
assert cache_store.kv_get("media:" + __import__("hashlib").sha1(b"https://x/b.png").hexdigest()) is None

# tmp 残留清理
os.makedirs(cache_store.media_dir(), exist_ok=True)
open(os.path.join(cache_store.media_dir(), "junk.bin.tmp"), "wb").close()
cache_store.media_evict(0)
assert not os.path.exists(os.path.join(cache_store.media_dir(), "junk.bin.tmp"))
print("媒体缓存冒烟全过")

# usage() 递归统计 media/ 子目录(P0 修复验证)
cache_store.media_store("https://x/c.png", "image/png", b"c" * 1000)
u = cache_store.usage()
assert u >= 1000, u
# 配额联动(行为断言):注入 0 配额 → _enforce_quota 必须真实调用 media_evict 清掉媒体文件
_orig_max_mb = cache_store._max_mb
cache_store._max_mb = lambda: 0  # 下限钳制 50MB 无法触发,直接注入 0 配额
try:
    cache_store.kv_put("quota_probe", 1)  # kv_put 后置配额检查 → 连带媒体淘汰
    leftover = ([f for f in os.listdir(cache_store.media_dir()) if f.endswith(".bin")]
                if os.path.isdir(cache_store.media_dir()) else [])
    assert leftover == [], "超额后媒体 .bin 未被配额淘汰: %r" % leftover
    assert cache_store.media_lookup("https://x/c.png") is None, "超额后媒体元数据未被淘汰"
finally:
    cache_store._max_mb = _orig_max_mb
print("usage 递归统计 OK:", u)
print("ALL MEDIA PASS 2")
