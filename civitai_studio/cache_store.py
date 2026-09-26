"""统一磁盘缓存层(sqlite, WAL) — 设计见 docs/cache-design.md.

目录:user/civitai_studio/cache/
  cache.sqlite        kv 端点缓存表 + 本地索引指纹表(local_files)
  download_jobs.json  下载队列(downloader 迁入,由 downloader 自管)

多实例共享同一 user 目录:WAL 允许并发读 + 单写,busy_timeout 化解写竞争。
单连接 + 线程锁串行化;任何 sqlite 异常都降级(损坏则删库重建一次),
绝不阻断插件加载/业务主流程。
"""

import json
import os
import sqlite3
import threading
import time

import folder_paths

from . import config

_LOCK = threading.RLock()
_CONN = None
_BROKEN = False  # sqlite 损坏且重建仍失败:此后所有操作静默降级为空实现

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL,
    last_access REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_expire ON kv_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_kv_access ON kv_cache(last_access);
CREATE TABLE IF NOT EXISTS local_files (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    sidecar TEXT,
    cached_at REAL NOT NULL
);
"""


def cache_dir():
    return os.path.join(folder_paths.get_user_directory(), "civitai_studio", "cache")


def db_path():
    return os.path.join(cache_dir(), "cache.sqlite")


def _max_mb():
    try:
        return max(50, min(2000, int(config.load().get("cache_max_mb", 500))))
    except Exception:
        return 500


def _heal(err):
    """损坏自愈:关连接→删库文件→重建一次;再失败进入永久降级."""
    global _CONN, _BROKEN
    print("[Civitai-Studio] 缓存库异常,尝试重建:", err)
    if _CONN is not None:
        try:
            _CONN.close()
        except Exception:
            pass
        _CONN = None
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(db_path() + suffix)
        except OSError:
            pass
    try:
        conn = sqlite3.connect(db_path(), timeout=5.0, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.executescript(_SCHEMA)
        conn.commit()
        _CONN = conn
    except (sqlite3.Error, OSError) as e:
        _BROKEN = True
        print("[Civitai-Studio] 缓存库重建失败,本会话禁用磁盘缓存:", e)


def init():
    global _CONN
    with _LOCK:
        if _CONN is not None or _BROKEN:
            return
        conn = None
        try:
            os.makedirs(cache_dir(), exist_ok=True)
            conn = sqlite3.connect(db_path(), timeout=5.0, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.executescript(_SCHEMA)
            conn.commit()
            _CONN = conn
            _CONN.execute(
                "DELETE FROM kv_cache WHERE expires_at IS NOT NULL AND expires_at < ?",
                (time.time(),),
            )
            _CONN.commit()
        except (sqlite3.Error, OSError) as e:
            if conn is not None:
                # Windows 上未关句柄会锁住损坏文件,_heal 的删库重建就删不掉
                try:
                    conn.close()
                except Exception:
                    pass
            _heal(e)


# ---------- kv 端点缓存(阶段2 的 GET 接入用;阶段1 先落地表与机制) ----------

def kv_get(key):
    init()
    if _CONN is None:
        return None
    with _LOCK:
        try:
            row = _CONN.execute(
                "SELECT value, expires_at, last_access FROM kv_cache WHERE key=?", (key,)
            ).fetchone()
            if not row:
                return None
            now = time.time()
            if row[1] is not None and row[1] < now:
                _CONN.execute("DELETE FROM kv_cache WHERE key=?", (key,))
                _CONN.commit()
                return None
            if now - row[2] > 60:  # LRU 触点限频:读多时别每次都写
                _CONN.execute(
                    "UPDATE kv_cache SET last_access=? WHERE key=?", (now, key)
                )
                _CONN.commit()
            return json.loads(row[0])
        except (sqlite3.Error, ValueError, OSError) as e:
            print("[Civitai-Studio] kv_get 失败:", e)
            return None


def kv_put(key, value, ttl=None):
    init()
    if _CONN is None:
        return
    now = time.time()
    with _LOCK:
        try:
            _CONN.execute(
                "INSERT OR REPLACE INTO kv_cache(key, value, created_at, expires_at, last_access)"
                " VALUES(?,?,?,?,?)",
                (key, json.dumps(value, ensure_ascii=False), now,
                 now + ttl if ttl else None, now),
            )
            _CONN.commit()
            _enforce_quota()
        except (sqlite3.Error, OSError, TypeError) as e:
            print("[Civitai-Studio] kv_put 失败:", e)


def kv_delete(key):
    init()
    if _CONN is None:
        return
    with _LOCK:
        try:
            _CONN.execute("DELETE FROM kv_cache WHERE key=?", (key,))
            _CONN.commit()
        except sqlite3.Error:
            pass


def _enforce_quota():
    """超限时先删过期再按 LRU 淘汰 kv 行(指纹表极小,不参与淘汰)."""
    try:
        if usage() <= _max_mb() * 1024 * 1024:
            return
        _CONN.execute(
            "DELETE FROM kv_cache WHERE expires_at IS NOT NULL AND expires_at < ?",
            (time.time(),),
        )
        while usage() > _max_mb() * 1024 * 1024:
            cur = _CONN.execute(
                "DELETE FROM kv_cache WHERE key IN "
                "(SELECT key FROM kv_cache ORDER BY last_access LIMIT 100)"
            )
            _CONN.commit()
            if cur.rowcount <= 0:
                break  # 只剩指纹表可保:不再硬删
    except (sqlite3.Error, OSError):
        pass


# ---------- 本地索引指纹表(local_index 增量化用) ----------

def _norm(path):
    """指纹键统一 normpath:walk 路径与调用方(可能混合斜杠)必须能对上."""
    return os.path.normpath(str(path))


def fingerprints():
    """{path: (size, mtime, sidecar_json|None)};不可用时返回 {} → 全量重读兜底."""
    init()
    if _CONN is None:
        return {}
    with _LOCK:
        try:
            return {
                _norm(r[0]): (r[1], r[2], r[3])
                for r in _CONN.execute(
                    "SELECT path, size, mtime, sidecar FROM local_files"
                )
            }
        except sqlite3.Error as e:
            print("[Civitai-Studio] 读取索引指纹失败(退化为全量重扫):", e)
            return {}


def sync_fingerprints(changed_rows, seen_paths):
    """增提交:changed_rows=[(path,size,mtime,sidecar_json|None)];删除库中已消失条目."""
    init()
    if _CONN is None:
        return
    now = time.time()
    with _LOCK:
        try:
            _CONN.executemany(
                "INSERT OR REPLACE INTO local_files(path, size, mtime, sidecar, cached_at)"
                " VALUES(?,?,?,?,?)",
                [(_norm(p), s, m, sc, now) for (p, s, m, sc) in changed_rows],
            )
            if seen_paths is not None:
                _CONN.execute("CREATE TEMP TABLE IF NOT EXISTS _seen(path TEXT PRIMARY KEY)")
                _CONN.execute("DELETE FROM _seen")
                _CONN.executemany(
                    "INSERT OR IGNORE INTO _seen VALUES(?)",
                    ((_norm(p),) for p in seen_paths),
                )
                _CONN.execute("DELETE FROM local_files WHERE path NOT IN (SELECT path FROM _seen)")
                _CONN.execute("DELETE FROM _seen")
            _CONN.commit()
        except sqlite3.Error as e:
            print("[Civitai-Studio] 写索引指纹失败(下次重扫补齐):", e)


def forget_fingerprint(path):
    """sidecar 被改写后作废该条指纹,下次扫描强制重读."""
    init()
    if _CONN is None:
        return
    with _LOCK:
        try:
            _CONN.execute("DELETE FROM local_files WHERE path=?", (_norm(path),))
            _CONN.commit()
        except sqlite3.Error:
            pass


def clear_fingerprints():
    init()
    if _CONN is None:
        return
    with _LOCK:
        try:
            _CONN.execute("DELETE FROM local_files")
            _CONN.commit()
        except sqlite3.Error:
            pass


# ---------- 设置页:占用与清空 ----------

def usage():
    """cache 目录字节总数(不含 download_jobs.json — 那是队列状态,不算缓存)."""
    total = 0
    try:
        for name in os.listdir(cache_dir()):
            p = os.path.join(cache_dir(), name)
            if os.path.isfile(p) and name != "download_jobs.json":
                total += os.path.getsize(p)
    except OSError:
        pass
    return total


def clear_cache():
    """清空缓存 = 清 kv 表 + 清指纹表(下次扫描转全量)+ checkpoint 回收磁盘."""
    init()
    if _CONN is None:
        return
    with _LOCK:
        try:
            _CONN.execute("DELETE FROM kv_cache")
            _CONN.execute("DELETE FROM local_files")
            _CONN.commit()
            _CONN.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error as e:
            print("[Civitai-Studio] 清空缓存失败:", e)


init()
