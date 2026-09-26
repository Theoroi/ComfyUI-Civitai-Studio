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
    "api_key": "",          # Civitai API Key(下载受限模型/提高限额;只发给官方域)
    "proxy": "",            # 例如 http://127.0.0.1:10808(SOCKS 写 socks5://)
    "mirror": "",           # API 站点覆盖,留空 = https://civitai.com
    "nsfw": 1,              # 默认搜索 NSFW 级别 0/1/2
    "proxy_images": False,  # 预览图是否经服务端中转
    "verify_hash": True,    # 下载完成后校验 SHA256
    "max_concurrent": 1,    # 并发下载数 1-4
    "persist_description": False,  # 说明/标签/封面落盘到 .civitai.json(默认关)
    "tag_scrape": True,     # 是否读取非公开 API 抓取图片分类标签
    "tag_and_mode": False,  # 实验选项:多标签筛选改漏斗式 AND(默认 OR,API 原生语义)
}


def _load_locked():
    global _CACHE
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


def _save_locked(cfg):
    global _CACHE
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    tmp = _CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _CONFIG_FILE)
    try:
        # key 明文落盘,收紧文件权限(POSIX 生效;Windows 仅去全局读,聊胜于无)
        os.chmod(_CONFIG_FILE, 0o600)
    except OSError:
        pass
    _CACHE = cfg


def load():
    with _LOCK:
        return _load_locked()


def update(partial):
    """合并更新部分字段,返回最新配置(读-改-写全程持锁)."""
    with _LOCK:
        cfg = _load_locked()
        changed = False
        for key, value in (partial or {}).items():
            if key in DEFAULTS and cfg.get(key) != value:
                cfg[key] = value
                changed = True
        if changed:
            _save_locked(cfg)
        return cfg
