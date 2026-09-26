import os, sqlite3, sys, tempfile, types
tmp = tempfile.mkdtemp(prefix="cs_mig_")
os.makedirs(tmp + "/civitai_studio/cache", exist_ok=True)
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
db = tmp + "/civitai_studio/cache/cache.sqlite"
conn = sqlite3.connect(db)
conn.executescript("""
CREATE TABLE kv_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL, last_access REAL NOT NULL);
CREATE TABLE local_files (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, sidecar TEXT, cached_at REAL NOT NULL);
""")
conn.commit(); conn.close()
from civitai_studio import cache_store
cache_store.sync_fingerprints([("x", 1, 1.0, None, None, None)], {"x"})
assert cache_store.fingerprints()["x"] == (1, 1.0, None, None)
print("旧 schema 迁移 OK")
