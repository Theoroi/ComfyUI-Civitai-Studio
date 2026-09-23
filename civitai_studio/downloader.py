"""下载队列 — 串行 worker(可配并发)、断点续传、SHA256 校验、进度跟踪.

评审 R1 加固点:
- 同一版本已有进行中的任务时拒绝重复入队;临时文件按 job id 独占,防并发交错写。
- subfolder 逐段剥离尾随点/空格 + Windows 保留名过滤 + realpath 越界断言。
- 服务器忽略 Range 回 200 时计数归零;206 校验 Content-Range 起点。
- SHA256 校验阶段响应取消;下载网络错误走统一中文提示;sidecar 写失败可见。
"""

import asyncio
import hashlib
import os
import re
import time
import urllib.parse
import uuid

import aiohttp

from . import civitai_client, config, local_index

_jobs = {}
_queue = asyncio.Queue()
_worker_tasks = []
_cancel_flags = set()
MAX_FINISHED_KEPT = 100

ACTIVE_STATUSES = ("queued", "downloading", "verifying")

JOB_PUBLIC_FIELDS = (
    "id", "model_id", "version_id", "model_name", "version_name", "type",
    "base_model", "category", "filename", "dest", "status", "error", "warning",
    "received", "total", "speed", "progress", "verified", "created", "finished",
)

_WIN_RESERVED = re.compile(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$")


def sanitize_filename(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name or "")).strip().rstrip(" .")
    name = re.sub(r"\s+", " ", name)[:160].rstrip(" .")  # 截断后再收一次尾,防截断点落在点号上
    if not name:
        return "model.bin"
    if name in (".", "..") or _WIN_RESERVED.match(name):
        name = "_" + name
    return name


def sanitize_subfolder(sub):
    """逐段消毒:剥非法字符与尾随点/空格,滤掉相对段与 Windows 保留名."""
    parts = []
    for raw in re.split(r"[\\/]+", str(sub or "")):
        p = re.sub(r'[<>:"|?*\x00-\x1f]', "_", raw).strip().rstrip(" .")
        if p in ("", ".", "..") or _WIN_RESERVED.match(p):
            continue
        parts.append(p[:120])
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


def _active_same_task(version_id, file_index):
    return any(
        str(j.get("version_id")) == str(version_id)
        and int(j.get("file_index", 0) or 0) == int(file_index)
        and j.get("status") in ACTIVE_STATUSES
        for j in _jobs.values()
    )


def get_state():
    return [{k: j.get(k) for k in JOB_PUBLIC_FIELDS} for j in _jobs.values()]


def enqueue(payload):
    version_id = payload.get("version_id")
    if not version_id:
        raise ValueError("缺少 version_id")
    try:
        file_index = max(0, int(payload.get("file_index", 0) or 0))
    except (TypeError, ValueError):
        raise ValueError("file_index 必须是整数")
    if _active_same_task(version_id, file_index):
        raise ValueError("该模型版本的同名文件已在下载队列中,请勿重复添加")
    root = _validate_root(payload.get("root"))
    if root is None:
        raise ValueError("目标目录不在已注册的模型目录内")
    sub = sanitize_subfolder(payload.get("subfolder"))
    # 越界断言:即使消毒有漏,也保证最终目录不逃出注册根
    dest_dir_check = os.path.join(root, sub) if sub else root
    real_root = os.path.realpath(root)
    real_dest = os.path.realpath(dest_dir_check)
    if real_dest != real_root and not real_dest.lower().startswith(real_root.lower() + os.sep):
        raise ValueError("子文件夹越出目标目录,已拒绝")
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
        "file_index": file_index,
        "filename": filename,
        "subfolder": sub,
        "root": root,
        "dest": "",
        "status": "queued",
        "error": "",
        "warning": "",
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


_slot_sem = None
_slot_want = None


def _slot():
    """并发闸门:worker 池常驻,实际并发由信号量实时对齐 max_concurrent 配置."""
    global _slot_sem, _slot_want
    try:
        want = int(config.load().get("max_concurrent", 1))
    except (TypeError, ValueError):
        want = 1
    want = max(1, min(4, want))
    global _slot_sem, _slot_want
    if _slot_sem is None or _slot_want != want:
        _slot_sem = asyncio.Semaphore(want)
        _slot_want = want
    return _slot_sem


async def _worker():
    while True:
        job_id = await _queue.get()
        job = _jobs.get(job_id)
        if job is None or job["status"] == "cancelled":
            continue
        async with _slot():
            if job["status"] == "cancelled":
                _cancel_flags.discard(job_id)
                job["finished"] = time.time()
                continue
            job["status"] = "downloading"
            try:
                await _run_job(job)
            except asyncio.CancelledError:
                job["status"] = "cancelled"
            except civitai_client.CivitaiError as e:
                job["status"] = "error"
                job["error"] = str(e)
            except (asyncio.TimeoutError, aiohttp.ClientError) as e:
                job["status"] = "error"
                job["error"] = civitai_client.net_error_message(e)
            except Exception as e:
                job["status"] = "error"
                job["error"] = f"下载失败: {e}(请检查磁盘空间/权限后重试)"
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


def _content_range_start(resp):
    """从 Content-Range: bytes 123-456/789 里取起点;解析失败返回 None."""
    cr = resp.headers.get("Content-Range") or ""
    m = re.match(r"bytes\s+(\d+)-", cr, re.I)
    return int(m.group(1)) if m else None


class _DownloadStatusError(Exception):
    """下载返回鉴权类状态(401/403):换源(带 token / 换官方域)重试."""

    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status = status


async def _download_candidates(url):
    """下载地址候选:原 URL → 原URL+token → 官方域 → 官方域+token(去重)."""
    key = (config.load().get("api_key") or "").strip()
    out = [url]
    if key:
        out.append(url + ("&" if "?" in url else "?") + "token=" + urllib.parse.quote(key))
    com = re.sub(r"(?<=://)[^/]+", "civitai.com", url, count=1)
    if com != url:
        out.append(com)
        if key:
            out.append(com + ("&" if "?" in com else "?") + "token=" + urllib.parse.quote(key))
    seen, dedup = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            dedup.append(c)
    return dedup


async def _download_to_tmp(job, attempt_url, tmp, dl_timeout, started):
    """对单个候选地址完成流式下载(含断点续传);401/403 抛 _DownloadStatusError."""
    extra_headers = {"Accept": "*/*", "Accept-Encoding": "identity"}
    resume_from = 0
    if os.path.exists(tmp):
        resume_from = os.path.getsize(tmp)
        if resume_from > 0:
            extra_headers["Range"] = f"bytes={resume_from}-"
    received = 0
    job["received"] = received
    async with civitai_client.open_isolated_stream(
        attempt_url, extra_headers=extra_headers, timeout=dl_timeout
    ) as resp:
        if resp.status == 416:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise ValueError("断点文件与服务器不匹配,已清除 .part 临时文件,请重试")
        if resp.status in (401, 403):
            raise _DownloadStatusError(resp.status)
        if resp.status not in (200, 206):
            raise ValueError(f"下载失败 HTTP {resp.status}")
        if (resp.content_type or "").startswith("text/html"):
            raise ValueError("下载被拦截(服务器返回的是网页)— 可能是 WAF 校验,换个代理节点后重试")
        try:
            content_length = int(resp.headers.get("Content-Length") or 0)
        except ValueError:
            content_length = 0
        append_mode = resp.status == 206 and resume_from > 0
        if append_mode:
            start = _content_range_start(resp)
            if start is None or start != resume_from:
                # 起点缺失/不符都不盲续:206 而无 Content-Range 同样从头下
                append_mode = False
        received = resume_from if append_mode else 0
        job["received"] = received
        if content_length:
            job["total"] = content_length + received
        with open(tmp, "ab" if append_mode else "wb") as f:
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
    return received


async def _run_job(job):
    data = await civitai_client.get_json(f"/model-versions/{job['version_id']}")
    if not job.get("version_name"):
        job["version_name"] = data.get("name") or ""
    if not job.get("model_id") and data.get("modelId"):
        job["model_id"] = data["modelId"]
    files = data.get("files") or []
    if not files:
        raise ValueError("该版本没有可下载文件")
    idx = max(0, min(job.get("file_index", 0), len(files) - 1))
    file = files[idx]
    url = file.get("downloadUrl") or data.get("downloadUrl")
    if not url:
        url = f"{civitai_client.base_url()}/api/download/models/{job['version_id']}"
    if url.startswith("/"):
        url = civitai_client.base_url() + url

    dest_dir = os.path.join(job["root"], job["subfolder"]) if job["subfolder"] else job["root"]
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, job["filename"] or sanitize_filename(file.get("name")))
    # 临时文件名由目标+下载地址哈希决定(确定名):跨任务/跨重启都能命中同一 .part 断点续传;
    # 并发同版本已被入队去重挡住,不会被两个 worker 同时写
    part_tag = hashlib.sha1((str(dest) + "|" + str(url)).encode("utf-8")).hexdigest()[:12]
    tmp = dest + f".{part_tag}.part"
    job["filename"] = os.path.basename(dest)
    job["dest"] = dest
    job["total"] = int((file.get("sizeKB") or 0) * 1024)

    # 流式下载:不限总时长,只限单次读超时;用独立会话,不受共享会话退役影响;
    # 401/403 时依次换源重试(带 token / 换官方域)
    dl_timeout = aiohttp.ClientTimeout(total=None, connect=20, sock_read=90)
    started = time.time()
    candidates = await _download_candidates(url)
    last_status = None
    used_url = url
    for cand in candidates:
        try:
            await _download_to_tmp(job, cand, tmp, dl_timeout, started)
            used_url = cand
            break
        except _DownloadStatusError as e:
            last_status = e.status
            continue
    else:
        raise ValueError(
            f"下载失败 HTTP {last_status}(该模型可能需要登录或为 Early Access:"
            "请在设置里配置 API Key,或在浏览器打开模型页确认可下载)"
        )
    received = job.get("received", 0)

    expected = (file.get("hashes") or {}).get("SHA256")
    if config.load().get("verify_hash", True) and expected:
        if job["id"] in _cancel_flags:
            raise asyncio.CancelledError()
        job["status"] = "verifying"
        loop = asyncio.get_running_loop()
        actual = await loop.run_in_executor(local_index._EXECUTOR, _sha256_file, tmp)
        if job["id"] in _cancel_flags:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise asyncio.CancelledError()
        if actual.lower() != str(expected).lower():
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise ValueError(f"SHA256 校验失败(期望 {str(expected)[:12]}…,实际 {actual[:12]}…),已删除损坏文件")
        job["verified"] = True
    else:
        job["verified"] = None

    # 目标名可能被并发任务占掉,落盘前最后再排重;此时再响应一次取消
    if job["id"] in _cancel_flags:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise asyncio.CancelledError()
    final = _unique_dest(dest)
    os.replace(tmp, final)
    job["dest"] = final
    job["filename"] = os.path.basename(final)
    job["status"] = "done"
    job["progress"] = 1.0
    meta = {
        "source": "civitai",
        "model_id": job.get("model_id"),
        "version_id": str(job.get("version_id")),
        "model_name": job.get("model_name"),
        "version_name": job.get("version_name") or data.get("name"),
        "base_model": job.get("base_model") or data.get("baseModel"),
        "type": job.get("type"),
        "file_name": os.path.basename(final),
        "sha256": expected,
        "download_url": url.split("?", 1)[0],  # 剥掉可能带 token 的查询串再落盘
        "trained_words": data.get("trainedWords") or [],
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    if config.load().get("persist_description") and job.get("model_id"):
        # 说明落盘(默认关):拉模型级描述/标签/封面写进 sidecar;失败不影响下载结果
        try:
            mdata = await civitai_client.get_model_cached(job["model_id"])
            meta["description_html"] = local_index.truncate_desc(mdata.get("description"))
            meta["tags"] = mdata.get("tags") or []
            meta["cover_url"] = next(
                (i.get("url") for v in (mdata.get("modelVersions") or [])
                 for i in (v.get("images") or []) if i.get("url")), None)
        except Exception:
            pass
    if not local_index.write_sidecar(final, meta):
        job["warning"] = "模型已下载,但写入 .civitai.json 元数据失败(权限/磁盘?),本地库将无法关联该版本"
    local_index.schedule_rescan()  # 去抖合并:2s 窗口内多个完成只触发一次重扫


def cancel(job_id):
    job = _jobs.get(job_id)
    if not job:
        return False
    if job["status"] == "queued":
        job["status"] = "cancelled"
        return True
    if job["status"] in ACTIVE_STATUSES[1:]:
        _cancel_flags.add(job_id)
        return True
    return False


def clear_finished():
    for jid in [jid for jid, j in _jobs.items() if j["status"] in ("done", "error", "cancelled")]:
        _jobs.pop(jid, None)
