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
    "tag_scrape": True,     # 是否读取非公开 API 抓取图片分类标签
    "cache_max_mb": 500,    # 磁盘缓存上限 MB(50~2000),见 docs/plans/completed/cache-design.md
    "fav_autosync": False,  # 收藏与 Civitai 账号自动同步(开面板时触发,冲突按最新时间覆盖)
    "px_cover": 320,        # 模型卡片封面缩略档位(批10;批11.3 改真实 CDN 档位,见 PX_TIERS)
    "px_media": 320,        # 轮播与详情展示图缩略档位(批10;批11.3 改真实 CDN 档位)
    "carousel_interval": 3,  # 模型卡片悬停轮播换图间隔秒(1~10,批12-b)
    "carousel_video": False,  # 轮播切到视频时自动播放(默认关,批12-a)
    "fav_sync": True,   # 收藏与站方同步引擎(非公开 tRPC;实验总闸,批12-g)
    "gen_data": True,   # 生成参数回退(非公开 tRPC;实验,批12-g)
    "log_timestamp": False,  # 日志带时间戳前缀(批6 a,默认关)
    "log_debug": False,     # 调试日志:出站请求/响应/同步逐条决策落控制台(等效 --verbose,免启动参数)
    "nsfw_blur": [4, 8, 16],  # NSFW 模糊遮罩:命中的分级位(PG=1,PG13=2,R=4,X=8,XXX=16)图片加模糊,默认 X/XXX
}


# 站方 CDN 缩略档位(实测):请求值向上取到最近档位;图片 96/320/450/512/800/1200…,
# 视频同族 96/320/450/512。设置项只暴露 <=512 的四档(再大对侧边栏缩略图无意义)
PX_TIERS = (96, 320, 450, 512)


def _snap_px(value, fallback=320):
    """缩略宽度吸附到真实档位(向上取,与 CDN 行为一致;旧配置 128/256 一并归到 320)."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return fallback
    for t in PX_TIERS:
        if v <= t:
            return t
    return PX_TIERS[-1]


def _normalize_locked(cfg):
    """数值字段统一钳制(读盘与 update 合并后都走这里)."""
    try:
        cfg["nsfw"] = int(cfg.get("nsfw", 1))
    except (TypeError, ValueError):
        cfg["nsfw"] = 1
    try:
        cfg["max_concurrent"] = max(1, min(4, int(cfg.get("max_concurrent", 1))))
    except (TypeError, ValueError):
        cfg["max_concurrent"] = 1
    try:
        cfg["cache_max_mb"] = max(50, min(2000, int(cfg.get("cache_max_mb", 500))))
    except (TypeError, ValueError):
        cfg["cache_max_mb"] = 500
    try:
        cfg["carousel_interval"] = max(1, min(10, int(cfg.get("carousel_interval", 3))))
    except (TypeError, ValueError):
        cfg["carousel_interval"] = 3
    for k in ("px_cover", "px_media"):
        cfg[k] = _snap_px(cfg.get(k))
    return cfg


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
    _CACHE = _normalize_locked(cfg)
    return _CACHE


def _save_locked(cfg):
    global _CACHE
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    from . import cache_store as _cs
    _cs.atomic_write(_CONFIG_FILE, json.dumps(cfg, ensure_ascii=False, indent=2))
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
            _normalize_locked(cfg)
            _save_locked(cfg)
        return cfg
