"""Civitai Studio — 用户配置持久化(存于 ComfyUI user 目录)."""

import json
import os
import threading

import folder_paths

_LOCK = threading.Lock()
_CACHE = None

_CONFIG_DIR = os.path.join(folder_paths.get_user_directory(), "civitai_studio")
_CONFIG_FILE = os.path.join(_CONFIG_DIR, "config.json")

DEFAULTS = {
    "api_key": "",          # Civitai API Key(下载受限模型/提高限额)
    "proxy": "",            # 例如 http://127.0.0.1:7890
    "mirror": "",           # 镜像站,留空 = https://civitai.com
    "nsfw": 1,              # 默认搜索 NSFW 级别 0/1/2
    "proxy_images": False,  # 预览图是否经服务端中转
    "verify_hash": True,    # 下载完成后校验 SHA256
    "max_concurrent": 1,    # 并发下载数 1-4
}


def load():
    global _CACHE
    with _LOCK:
        if _CACHE is not None:
            return _CACHE
        cfg = dict(DEFAULTS)
        try:
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
            if isinstance(stored, dict):
                for key in DEFAULTS:
                    if key in stored:
                        cfg[key] = stored[key]
        except (OSError, ValueError):
            pass
        try:
            cfg["nsfw"] = int(cfg.get("nsfw", 1))
        except (TypeError, ValueError):
            cfg["nsfw"] = 1
        try:
            cfg["max_concurrent"] = max(1, min(4, int(cfg.get("max_concurrent", 1))))
        except (TypeError, ValueError):
            cfg["max_concurrent"] = 1
        _CACHE = cfg
        return cfg


def save(cfg):
    global _CACHE
    with _LOCK:
        os.makedirs(_CONFIG_DIR, exist_ok=True)
        tmp = _CONFIG_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _CONFIG_FILE)
        _CACHE = cfg


def update(partial):
    """合并更新部分字段,返回最新配置."""
    cfg = load()
    changed = False
    for key, value in (partial or {}).items():
        if key in DEFAULTS and cfg.get(key) != value:
            cfg[key] = value
            changed = True
    if changed:
        save(cfg)
    return cfg
