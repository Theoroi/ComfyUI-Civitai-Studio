"""本地模型扫描 + Civitai 元数据 sidecar(<模型文件名>.civitai.json).

不做文件哈希(太慢):已安装判断 = sidecar 里的 version_id 精确匹配,
或文件名与 Civitai 文件名一致。
"""

import asyncio
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import folder_paths

from . import cache_store

# 专用线程池:scan/sha256 等重活不挤占 ComfyUI 共享默认线程池
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="civitai-studio")


def run_bg(fn, *args):
    return asyncio.get_running_loop().run_in_executor(_EXECUTOR, fn, *args)

# Civitai 模型类型 -> ComfyUI 模型目录 key(按优先级排列)
TYPE_TO_FOLDERS = {
    "Checkpoint": ["checkpoints", "diffusion_models", "unet"],
    "LORA": ["loras"],
    "LoCon": ["loras"],
    "DoRA": ["loras"],
    "TextualInversion": ["embeddings"],
    "VAE": ["vae"],
    "Controlnet": ["controlnet"],
    "Upscaler": ["upscale_models"],
    "Hypernetwork": ["hypernetworks"],
    "Motion": ["animatediff_models"],
}

MODEL_EXTS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".sft", ".onnx"}
SIDECAR_SUFFIX = ".civitai.json"
MAX_FILES = 20000
SCAN_TTL = 30.0

_lock = threading.Lock()
_cache = None  # 索引快照(dict):整体原子替换,读端拿到的引用永远自洽


def categories():
    keys = set()
    for ks in TYPE_TO_FOLDERS.values():
        keys.update(ks)
    return [k for k in folder_paths.folder_names_and_paths.keys() if k in keys]


def roots_for(key):
    try:
        return [r for r in folder_paths.get_folder_paths(key) if r and os.path.isdir(r)]
    except Exception:
        return []


def sidecar_path(model_path):
    return model_path + SIDECAR_SUFFIX


def read_sidecar(model_path):
    try:
        with open(sidecar_path(model_path), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_sidecar(model_path, meta):
    try:
        with open(sidecar_path(model_path), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        cache_store.forget_fingerprint(model_path)  # sidecar 变了,指纹作废强制重读
        return True
    except OSError:
        return False


def _sidecar_blob(meta):
    return json.dumps(meta, ensure_ascii=False) if meta is not None else None


def _scan_unlocked(deep=False):
    """指纹增量化:未变的文件直接复用上次 sidecar 解析结果,不重读磁盘 sidecar."""
    global _cache
    t0 = time.time()
    fp = {} if deep else cache_store.fingerprints()
    if deep:
        cache_store.clear_fingerprints()
    models = []
    seen = set()  # item_id 去重
    alive = set()  # 成功入索引的完整路径(同步指纹表用)
    changed = []  # (path, size, mtime, sidecar_json|None) 待写回指纹表
    reused = 0
    truncated = False
    for key in categories():
        for root in roots_for(key):
            root_norm = os.path.normpath(root)
            for dirpath, dirnames, filenames in os.walk(root_norm):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                for fn in sorted(filenames):
                    if len(models) >= MAX_FILES:
                        truncated = True
                        break
                    if os.path.splitext(fn)[1].lower() not in MODEL_EXTS:
                        continue
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, root_norm).replace("\\", "/")
                    item_id = key + "/" + rel
                    if item_id in seen:
                        continue
                    seen.add(item_id)
                    try:
                        st = os.stat(full)
                    except OSError:
                        continue
                    hit = fp.get(full)
                    if (hit is not None and hit[0] == st.st_size
                            and hit[1] == st.st_mtime):
                        try:
                            civitai = json.loads(hit[2]) if hit[2] is not None else None
                            reused += 1
                        except ValueError:
                            civitai = read_sidecar(full)
                            changed.append((full, st.st_size, st.st_mtime, _sidecar_blob(civitai)))
                    else:
                        civitai = read_sidecar(full)
                        changed.append((full, st.st_size, st.st_mtime, _sidecar_blob(civitai)))
                    alive.add(full)
                    models.append({
                        "id": item_id,
                        "category": key,
                        "root": root_norm,
                        "rel": rel,
                        "name": fn,
                        "path": full,
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                        "civitai": civitai,
                    })
                if truncated:
                    break
            if truncated:
                break
        if truncated:
            break
    cache_store.sync_fingerprints(changed, alive)
    by_version = {}
    by_name = {}
    by_id = {}
    for m in models:
        by_id[m["id"]] = m
        meta = m.get("civitai")
        if meta:
            vid = str(meta.get("version_id") or "")
            if vid:
                by_version.setdefault(vid, m)
        by_name.setdefault(m["name"].lower(), []).append(m)
    # ts 取扫描完成时刻(慢盘上扫描耗时不计入 TTL);整体原子替换快照
    _cache = {"models": models, "by_version": by_version, "by_name": by_name,
              "by_id": by_id, "ts": time.time(), "truncated": truncated,
              "stats": {"total": len(models), "reused": reused, "read": len(changed),
                        "dur": round(time.time() - t0, 2), "deep": bool(deep)}}
    return _cache


def scan(force=False, deep=False):
    global _cache
    with _lock:
        if _cache is not None and not force and not deep and time.time() - _cache["ts"] < SCAN_TTL:
            return _cache  # 空库同样受 TTL 保护,避免每请求全扫
        return _scan_unlocked(deep)


_rescan_dirty = False
_rescan_handle = None


def schedule_rescan(delay=2.0):
    """下载完成后的重扫:去抖合并,2s 窗口内多个完成只触发一次全扫."""
    global _rescan_dirty, _rescan_handle
    _rescan_dirty = True
    if _rescan_handle is not None:
        return

    def _fire():
        global _rescan_handle, _rescan_dirty
        _rescan_handle = None
        if _rescan_dirty:
            _rescan_dirty = False
            asyncio.ensure_future(run_bg(scan, True))

    _rescan_handle = asyncio.get_running_loop().call_later(delay, _fire)


def truncate_desc(html):
    """说明落盘用:空返回 None;超长截断(默认上限 51200 字符)."""
    t = str(html or "")
    if not t:
        return None
    return t[:51200]


def resolve(category, rel):
    item_id = str(category) + "/" + str(rel).replace("\\", "/")
    item = scan().get("by_id", {}).get(item_id)
    return item["path"] if item else None
