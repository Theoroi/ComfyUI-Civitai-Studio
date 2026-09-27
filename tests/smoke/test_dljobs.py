"""dl_jobs 测试:落库/恢复(杀进程语义)/trim 同步/legacy JSON 导入/durable 域."""
import json, os, sys, tempfile, types, time

tmp = tempfile.mkdtemp(prefix="cs_dljobs_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
os.makedirs(os.path.join(tmp, "civitai_studio", "cache"), exist_ok=True)
sys.modules["folder_paths"] = fp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from civitai_studio import cache_store, downloader

def mkjob(jid, status, extra=None):
    j = {k: None for k in downloader.JOB_PUBLIC_FIELDS}
    j.update({"id": jid, "status": status, "model_id": 1, "version_id": "11",
              "filename": "m.safetensors", "received": 5, "total": 10})
    j.update(extra or {})
    return j

# 1) 手工填内存 jobs → _persist 落库 → 清内存 → _load_persisted 恢复一致(杀进程语义)
downloader._jobs.clear()
downloader._jobs["j1"] = mkjob("j1", "done", {"payload": {"root": "loras"}, "root": "loras",
                                               "subfolder": "", "file_index": 0})
downloader._jobs["j2"] = mkjob("j2", "downloading")
downloader._persist()
downloader._jobs.clear()
downloader._load_persisted()
assert set(downloader._jobs) == {"j1", "j2"}, set(downloader._jobs)
j1 = downloader._jobs["j1"]
assert j1["payload"] == {"root": "loras"} and j1["root"] == "loras" and j1["file_index"] == 0
# 杀进程语义:中断任务标记 error + 续传文案
assert downloader._jobs["j2"]["status"] == "error"
assert "重启" in downloader._jobs["j2"]["error"] and "重试" in downloader._jobs["j2"]["error"]

# 2) trim 同步:内存删掉的 job → 下次 _persist 从 DB 移除
downloader._jobs.pop("j2")
downloader._persist()
assert set(j["id"] for j in cache_store.dl_jobs_all()) == {"j1"}

# 3) legacy JSON 导入:DB 清空 + 新址 JSON 存在 → _load_persisted 读入并恢复
downloader._jobs.clear()
cache_store._CONN.execute("DELETE FROM dl_jobs")
cache_store._CONN.commit()
legacy = os.path.join(tmp, "civitai_studio", "cache", "download_jobs.json")
rec = {k: None for k in downloader.JOB_PUBLIC_FIELDS}
rec.update({"id": "old1", "status": "queued", "payload": {}})
json.dump([rec], open(legacy, "w", encoding="utf-8"))
downloader._load_persisted()
assert downloader._jobs["old1"]["status"] == "error"  # queued → 中断标记
assert [j["id"] for j in cache_store.dl_jobs_all()] == ["old1"]  # 已导入 DB

# 4) durable 域:clear_cache 不清任务
cache_store.clear_cache()
assert [j["id"] for j in cache_store.dl_jobs_all()] == ["old1"], "dl_jobs 被 clear_cache 误清"

print("PASS test_dljobs")
