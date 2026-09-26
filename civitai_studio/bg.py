"""共享后台线程池 — sqlite 缓存 IO/索引扫描/SHA256 等阻塞活不挤占事件循环
与 ComfyUI 共享默认线程池。原 local_index 专属池升级为包级共用(阶段2 起
api_cache 的磁盘 kv 读写也走这里),max_workers 2→4 防长扫描堵死缓存路径。
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="civitai-studio")

_bg_tasks = set()


def spawn(coro):
    """fire-and-forget 持强引用(任务被 GC 掉会连 finally 都不执行)."""
    task = asyncio.ensure_future(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return task


async def run_bg(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(_EXECUTOR, fn, *args)
