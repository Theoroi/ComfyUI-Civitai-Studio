"""下载队列 — 串行 worker(可配并发)、断点续传、SHA256 校验、进度跟踪."""

import asyncio
import hashlib
import os
import re
import time
import uuid

import aiohttp

from . import civitai_client, config, local_index

_jobs = {}
_queue = asyncio.Queue()
_worker_tasks = []
_cancel_flags = set()
MAX_FINISHED_KEPT = 100

JOB_PUBLIC_FIELDS = (
    "id", "model_id", "version_id", "model_name", "version_name", "type",
    "base_model", "category", "filename", "dest", "status", "error",
    "received", "total", "speed", "progress", "verified", "created", "finished",
)


def sanitize_filename(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name or "")).strip()
    name = re.sub(r"\s+", " ", name)
    return name[:160] or "model.bin"


def sanitize_subfolder(sub):
    parts = [p for p in re.split(r"[\\/]+", str(sub or "")) if p not in ("", ".", "..")]
    return os.path.join(*parts) if parts else ""


def _validate_root(root):
    target = os.path.normpath(str(root or ""))
    for key in local_index.categories():
        for r in local_index.roots_for(key):
            if os.path.normpath(r) == target:
                return target
    return None


def _unique_dest(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    for i in range(1, 500):
        cand = f"{base} ({i}){ext}"
        if not os.path.exists(cand):
            return cand
    return path + f".{int(time.time())}.bin"


def get_state():
    return [{k: j.get(k) for k in JOB_PUBLIC_FIELDS} for j in _jobs.values()]


def enqueue(payload):
    version_id = payload.get("version_id")
    if not version_id:
        raise ValueError("缺少 version_id")
    root = _validate_root(payload.get("root"))
    if root is None:
        raise ValueError("目标目录不在已注册的模型目录内")
    filename = sanitize_filename(payload.get("filename"))
    job = {
        "id": uuid.uuid4().hex[:12],
        "model_id": payload.get("model_id"),
        "version_id": version_id,
        "model_name": payload.get("model_name") or "",
        "version_name": payload.get("version_name") or "",
        "type": payload.get("type") or "",
        "base_model": payload.get("base_model") or "",
        "category": payload.get("category") or "",
        "file_index": int(payload.get("file_index", 0) or 0),
        "filename": filename,
        "subfolder": sanitize_subfolder(payload.get("subfolder")),
        "root": root,
        "dest": "",
        "status": "queued",
        "error": "",
        "received": 0,
        "total": 0,
        "speed": 0,
        "progress": 0,
        "verified": None,
        "created": time.time(),
        "finished": None,
    }
    _jobs[job["id"]] = job
    _queue.put_nowait(job["id"])
    _ensure_workers()
    _trim_finished()
    return {k: job.get(k) for k in JOB_PUBLIC_FIELDS}


def _ensure_workers():
    try:
        want = int(config.load().get("max_concurrent", 1))
    except (TypeError, ValueError):
        want = 1
    want = max(1, min(4, want))
    global _worker_tasks
    _worker_tasks = [t for t in _worker_tasks if not t.done()]
    while len(_worker_tasks) < want:
        _worker_tasks.append(asyncio.get_running_loop().create_task(_worker()))


def _trim_finished():
    finished_ids = [jid for jid, j in _jobs.items() if j["status"] in ("done", "error", "cancelled")]
    overflow = len(finished_ids) - MAX_FINISHED_KEPT
    for jid in finished_ids[:max(0, overflow)]:
        _jobs.pop(jid, None)


async def _worker():
    while True:
        job_id = await _queue.get()
        job = _jobs.get(job_id)
        if job is None or job["status"] == "cancelled":
            continue
        job["status"] = "downloading"
        try:
            await _run_job(job)
        except asyncio.CancelledError:
            job["status"] = "cancelled"
        except Exception as e:
            job["status"] = "error"
            job["error"] = str(e)
        finally:
            _cancel_flags.discard(job_id)
            job["finished"] = time.time()


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(4 * 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


async def _run_job(job):
    data = await civitai_client.get_json(f"/model-versions/{job['version_id']}")
    if not job.get("version_name"):
        job["version_name"] = data.get("name") or ""
    if not job.get("model_id") and data.get("modelId"):
        job["model_id"] = data["modelId"]
    files = data.get("files") or []
    if not files:
        raise ValueError("该版本没有可下载文件")
    idx = min(job.get("file_index", 0), len(files) - 1)
    file = files[idx]
    url = file.get("downloadUrl") or data.get("downloadUrl")
    if not url:
        url = f"{civitai_client.base_url()}/api/download/models/{job['version_id']}"
    if url.startswith("/"):
        url = civitai_client.base_url() + url

    dest_dir = os.path.join(job["root"], job["subfolder"]) if job["subfolder"] else job["root"]
    os.makedirs(dest_dir, exist_ok=True)
    dest = _unique_dest(os.path.join(dest_dir, job["filename"] or sanitize_filename(file.get("name"))))
    job["filename"] = os.path.basename(dest)
    tmp = dest + ".part"
    job["dest"] = dest
    job["total"] = int((file.get("sizeKB") or 0) * 1024)

    extra_headers = {"Accept": "*/*"}
    resume_from = 0
    if os.path.exists(tmp):
        resume_from = os.path.getsize(tmp)
        if resume_from > 0:
            extra_headers["Range"] = f"bytes={resume_from}-"
    # 下载流式传输:不限总时长,只限制单次读超时,避免大文件被全局超时杀掉
    dl_timeout = aiohttp.ClientTimeout(total=None, connect=20, sock_read=90)
    received = resume_from
    started = time.time()
    job["received"] = received
    async with await civitai_client.open_stream(
        url, extra_headers=extra_headers, timeout=dl_timeout
    ) as resp:
        if resp.status == 416:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise ValueError("断点文件与服务器不匹配,已清除 .part 临时文件,请重试")
        if resp.status not in (200, 206):
            raise ValueError(f"下载失败 HTTP {resp.status}")
        if (resp.content_type or "").startswith("text/html"):
            raise ValueError("下载被拦截(服务器返回的是网页)— 可能是 Cloudflare 校验,换个代理节点后重试")
        try:
            content_length = int(resp.headers.get("Content-Length") or 0)
        except ValueError:
            content_length = 0
        if content_length:
            job["total"] = content_length + (resume_from if resp.status == 206 else 0)
        mode = "ab" if (resp.status == 206 and resume_from) else "wb"
        with open(tmp, mode) as f:
            async for chunk in resp.content.iter_chunked(512 * 1024):
                if job["id"] in _cancel_flags:
                    raise asyncio.CancelledError()
                f.write(chunk)
                received += len(chunk)
                elapsed = max(time.time() - started, 1e-6)
                job["received"] = received
                job["speed"] = received / elapsed
                if job["total"]:
                    job["progress"] = min(1.0, received / job["total"])

    if config.load().get("verify_hash", True):
        expected = (file.get("hashes") or {}).get("SHA256")
        if expected:
            job["status"] = "verifying"
            loop = asyncio.get_running_loop()
            actual = await loop.run_in_executor(None, _sha256_file, tmp)
            if actual.lower() != str(expected).lower():
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise ValueError(f"SHA256 校验失败(期望 {str(expected)[:12]}…,实际 {actual[:12]}…),已删除损坏文件")
            job["verified"] = True
        else:
            job["verified"] = None

    os.replace(tmp, dest)
    job["status"] = "done"
    job["progress"] = 1.0
    local_index.write_sidecar(dest, {
        "source": "civitai",
        "model_id": job.get("model_id"),
        "version_id": str(job.get("version_id")),
        "model_name": job.get("model_name"),
        "version_name": job.get("version_name") or data.get("name"),
        "base_model": job.get("base_model") or data.get("baseModel"),
        "type": job.get("type"),
        "file_name": os.path.basename(dest),
        "sha256": (file.get("hashes") or {}).get("SHA256"),
        "download_url": url,
        "trained_words": data.get("trainedWords") or [],
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    })
    asyncio.get_running_loop().run_in_executor(None, local_index.scan, True)


def cancel(job_id):
    job = _jobs.get(job_id)
    if not job:
        return False
    if job["status"] == "queued":
        job["status"] = "cancelled"
        return True
    if job["status"] in ("downloading", "verifying"):
        _cancel_flags.add(job_id)
        return True
    return False


def clear_finished():
    for jid in [jid for jid, j in _jobs.items() if j["status"] in ("done", "error", "cancelled")]:
        _jobs.pop(jid, None)
