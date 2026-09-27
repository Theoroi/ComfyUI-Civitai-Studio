"""进程内 LRU 缓存 — 全插件三处内存缓存(api_cache/civitai_client/routes 版本缓存)
的共享实现。条目 (写入时刻, expires_at|None, value);越界淘汰写入时刻最旧;
单条可选绝对过期。线程安全(sqlite 线程池线程与事件循环都会读写)。
"""

import threading
import time


class MemLru:
    def __init__(self, max_entries):
        self._max = max(1, int(max_entries))
        self._d = {}  # key -> (created, expires_at|None, value)
        self._lock = threading.Lock()

    def get(self, key):
        now = time.time()
        with self._lock:
            hit = self._d.get(key)
            if hit is None:
                return None
            created, expires_at, value = hit
            if expires_at is not None and expires_at <= now:
                del self._d[key]
                return None
            return value

    def put(self, key, value, expires_at=None):
        now = time.time()
        with self._lock:
            self._d[key] = (now, expires_at, value)
            while len(self._d) > self._max:
                oldest = min(self._d, key=lambda k: self._d[k][0])
                self._d.pop(oldest, None)

    def clear(self):
        with self._lock:
            self._d.clear()

    def __len__(self):
        with self._lock:
            return len(self._d)
