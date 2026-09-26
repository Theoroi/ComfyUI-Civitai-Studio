import asyncio, os, sys, tempfile, types, time

tmp = tempfile.mkdtemp(prefix="cs_api_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import api_cache, cache_store

calls = {"n": 0}
async def fetch():
    calls["n"] += 1
    await asyncio.sleep(0.05)
    return {"v": calls["n"]}

async def main():
    # 1) 内存 TTL 内不回源
    a = await api_cache.cached_json("k1", fetch, ttl_mem=60)
    b = await api_cache.cached_json("k1", fetch, ttl_mem=60)
    assert a == b and calls["n"] == 1, (a, b, calls)

    # 2) 单飞:并发 10 个同 key,只打一次源
    calls["n"] = 0
    rs = await asyncio.gather(*(api_cache.cached_json("k2", fetch, ttl_mem=0) for _ in range(10)))
    assert calls["n"] == 1 and len({r["v"] for r in rs}) == 1, (calls, rs)

    # 3) 磁盘层:清内存后 ttl_disk 内仍命中(fetch 不增)
    await api_cache.cached_json("k3", fetch, ttl_mem=0, ttl_disk=3600)
    n3 = calls["n"]
    api_cache._MEM.clear()
    await api_cache.cached_json("k3", fetch, ttl_mem=0, ttl_disk=3600)
    assert calls["n"] == n3, (calls, n3)

    # 4) SWR:磁盘过期但在 CAP 内 → 立即回旧值 + 后台刷新
    old = {"v": "stale"}
    cache_store.kv_put("api:k4", {"ts": time.time() - 7200, "data": old}, 86400)
    t0 = time.time()
    got = await api_cache.cached_json("k4", fetch, ttl_mem=0, ttl_disk=3600, swr=True)
    dt = time.time() - t0
    assert got == old and dt < 0.2, (got, dt)
    await asyncio.sleep(0.4)  # 等后台刷新落盘
    assert calls["n"] >= 1
    rec = cache_store.kv_get("api:k4")
    assert rec["data"]["v"] != "stale" and time.time() - rec["ts"] < 5, rec

    # 5) 超 SWR_CAP → 视为 miss 重取
    calls["n"] = 0
    cache_store.kv_put("api:k5", {"ts": time.time() - 8 * 86400, "data": old}, 30 * 86400)
    got = await api_cache.cached_json("k5", fetch, ttl_mem=0, ttl_disk=3600, swr=True)
    assert got["v"] == 1 and calls["n"] == 1, (got, calls)

    # 6) 不落盘模式:kv 无记录
    await api_cache.cached_json("k6", fetch, ttl_mem=0, ttl_disk=None)
    assert cache_store.kv_get("api:k6") is None

    # 7) prime 回填后免回源
    calls["n"] = 0
    api_cache.prime("k7", {"v": "primed"}, ttl_disk=3600)
    await asyncio.sleep(0.2)  # 磁盘写是后台任务
    got = await api_cache.cached_json("k7", fetch, ttl_mem=0, ttl_disk=3600)
    assert got == {"v": "primed"} and calls["n"] == 0, (got, calls)

    # 8) 降级:磁盘不可用时(kv 返回 None)仍能回源
    cache_store._CONN = None; cache_store._BROKEN = True
    calls["n"] = 0
    got = await api_cache.cached_json("k8", fetch, ttl_mem=0, ttl_disk=3600)
    assert got["v"] == 1 and calls["n"] == 1
    cache_store._BROKEN = False; cache_store._CONN = None; cache_store.init()
    print("api_cache 冒烟全过")

asyncio.run(main())
