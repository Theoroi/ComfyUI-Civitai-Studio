"""civitai_client GET 的缓存编排 — 内存 LRU + 磁盘 kv SWR + singleflight.

分层(docs/plans/completed/cache-design.md L2/L3):
- 内存:进程内 dict,TTL 按端点传参,全局上限 _MEM_MAX 条(超限淘汰最旧)
- 磁盘:cache_store kv,key 前缀 "api:";payload {"ts": 取数时刻, "data": ...};
  kv 硬过期 = ttl_disk + _SWR_CAP(纯 GC);新鲜度由 ts 自判:
  age < ttl_disk 直接用;swr=True 且 age < _SWR_CAP 先回旧值再后台刷新
- singleflight:同 key 同事件循环并发回源只打一次;节点侧另起的 loop 各自独立,
  跨进程靠磁盘层兜底
- 隐私:只缓存响应 JSON,API key/请求头永不入库
sqlite 读写经 bg 线程池执行,不阻塞事件循环;cache_store 自身异常静默降级为直连。
"""

import asyncio
import time

from . import bg, cache_store
from .log import info, warn, error  # 统一日志(E2)
from .mem_lru import MemLru

_SWR_CAP = 7 * 86400.0  # 磁盘旧值最多还能当 SWR 底牌 7 天
_inflight = {}  # (id(loop), key) -> Task(当前全插件单主事件循环;loop 死亡残留属理论场景)
_refreshing = set()  # SWR 后台刷新在途的 key
_MEM = MemLru(200)  # 内存层(C-1:共享 MemLru;条目按 ttl_mem 定 expires_at)
spawn = bg.spawn  # C-2:fire-and-forget 统一走 bg.spawn


def clear_mem():
    """「清空缓存」用:bypass 内存层(设计:强制刷新穿透全部层)."""
    _MEM.clear()


def _mem_put(key, data, ttl=None):
    _MEM.put(key, data, expires_at=time.time() + ttl if ttl else None)


async def _singleflight(key, fetch):
    loop = asyncio.get_running_loop()
    sk = (id(loop), key)
    fut = _inflight.get(sk)
    if fut is not None:
        return await asyncio.shield(fut)  # 共享领导者的结果
    fut = loop.create_task(fetch())
    _inflight[sk] = fut
    try:
        # 领导者也 shield:自己被取消(客户端断连/批量超时)不打断共享中的回源
        return await asyncio.shield(fut)
    finally:
        _inflight.pop(sk, None)


def _kick_refresh(key, fetch, ttl_disk, ttl_mem):
    if key in _refreshing:
        return

    async def _run():
        try:
            data = await _singleflight(key, fetch)  # 已有在途回源则直接共享
            if ttl_mem > 0:
                _mem_put(key, data, ttl_mem)
            await bg.run_bg(cache_store.kv_put, "api:" + key,
                            {"ts": time.time(), "data": data}, ttl_disk + _SWR_CAP)
        except Exception as e:  # 刷新失败保留旧值,不打扰用户
            error("[Civitai-Studio] SWR 后台刷新失败(继续用旧值):", e)
        finally:
            _refreshing.discard(key)

    _refreshing.add(key)
    spawn(_run())


async def cached_json(key, fetch, ttl_mem=0.0, ttl_disk=None, swr=True):
    """取 key 的 JSON:内存 TTL → 磁盘(新鲜直用/SWR 回旧+后台刷) → 单飞回源.

    fetch: 无参协程工厂(回源).ttl_disk=None 表示不落盘(搜索页类).
    """
    now = time.time()
    hit = _MEM.get(key)
    if hit is not None:
        return hit  # MemLru 条目写入时已按 ttl_mem 定 expires_at,过期取不到
    disk_key = "api:" + key
    rec = None
    if ttl_disk:
        try:
            rec = await bg.run_bg(cache_store.kv_get, disk_key)
        except Exception:
            rec = None
    if isinstance(rec, dict) and isinstance(rec.get("ts"), (int, float)) and rec.get("data") is not None:
        age = now - rec["ts"]
        data = rec["data"]
        if age < ttl_disk:
            if ttl_mem > 0:
                _mem_put(key, data, ttl_mem)
            return data
        if swr and age < _SWR_CAP:
            if ttl_mem > 0:
                _mem_put(key, data, ttl_mem)
            _kick_refresh(key, fetch, ttl_disk, ttl_mem)
            return data
    data = await _singleflight(key, fetch)
    if ttl_mem > 0:  # ttl_mem=0 表示调用方自管内存层(如 _model_cache),别双份驻留
        _mem_put(key, data, ttl_mem)
    if ttl_disk:
        try:
            await bg.run_bg(cache_store.kv_put, disk_key,
                            {"ts": time.time(), "data": data}, ttl_disk + _SWR_CAP)
        except Exception:
            pass
    return data


def prime(key, data, ttl_disk=None, ttl_mem=True):
    """外部拿到新数据后回填(内存即时;磁盘尽量异步,无 loop 时同步兜底).

    ttl_mem=False:调用方自管内存层(如 _model_cache),别往 _MEM 塞死条目.
    """
    if ttl_mem:
        _mem_put(key, data)  # prime:无过期(纯 LRU 驻留)
    if not ttl_disk:
        return
    payload = {"ts": time.time(), "data": data}
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        cache_store.kv_put("api:" + key, payload, ttl_disk + _SWR_CAP)
        return
    spawn(bg.run_bg(cache_store.kv_put, "api:" + key, payload, ttl_disk + _SWR_CAP))
