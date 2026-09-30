"""统一日志 — logging.getLogger("civitai-studio"),前缀由 ComfyUI 根 formatter 提供.

级别语义:error=功能受损/数据失败;warning=降级但自愈/配置指引;
info=生命周期/统计/UI 弹窗回传;debug=全部出站请求与响应、同步逐条决策(默认关,
ComfyUI 设置日志级别到 DEBUG 后可见 — 用户排障通道,E2E #26)。
ComfyUI 根 logger 的 ColoredFormatter 自动加 [LEVEL] [logger名] 前缀(用户实测
logger 名渲染为 [Civitai-Studio]),本模块不再拼任何前缀;历史调用点消息里手写的
"[Civitai-Studio] "在此统一剥除,防出现 [Civitai-Studio] [Civitai-Studio] 双写。
独立运行(无 ComfyUI handler)时无等级前缀,可接受。
"""

import logging

log = logging.getLogger("civitai-studio")

# 历史调用点把前缀写进了消息正文;在此剥除而不是改几十个调用点
_LEGACY_PREFIX = "[Civitai-Studio] "

_DEBUG_TRUNC = 800  # debug 日志单条正文截断(响应体可能几十 KB)


def _fmt(msg, args=None):
    # print 风格迁移:msg 不带 % 占位符时把剩余参数拼进正文(防 logging % 格式化炸)
    if args:
        msg = msg + " " + " ".join(str(a) for a in args)
    if msg.startswith(_LEGACY_PREFIX):
        msg = msg[len(_LEGACY_PREFIX):]
    return msg


def _trunc(text):
    text = str(text)
    if len(text) > _DEBUG_TRUNC:
        return text[:_DEBUG_TRUNC] + f"…(截断,全长 {len(text)})"
    return text


_dbg_handler = None


def apply_debug(on):
    """配置 log_debug 开关(设置页保存后即时生效):
    on=True → 专属 DEBUG handler(stdout)+propagate=False(防 ComfyUI INFO handler 双写);
    on=False → 摘 handler 还原 propagate,走 ComfyUI 原生级别门。"""
    global _dbg_handler
    import sys
    h = _dbg_handler
    if on and h is None:
        h = logging.StreamHandler(sys.stdout)
        h.setLevel(logging.DEBUG)
        h.setFormatter(logging.Formatter("[%(levelname)s] [Civitai-Studio] %(message)s"))
        log.addHandler(h)
        log.setLevel(logging.DEBUG)
        log.propagate = False
        _dbg_handler = h
    elif not on and h is not None:
        log.removeHandler(h)
        log.setLevel(logging.NOTSET)
        log.propagate = True
        _dbg_handler = None


def debug(msg, *args):
    log.debug(_fmt(msg, args))


def dbg_json(label, data):
    """出站/响应体 debug 记录:统一截断,防大响应刷屏."""
    import json as _json
    try:
        body = _json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data
    except Exception:
        body = repr(data)
    log.debug(_fmt(f"{label}: ") + _trunc(body))


def info(msg, *args):
    log.info(_fmt(msg, args))


def warn(msg, *args):
    log.warning(_fmt(msg, args))


def error(msg, *args):
    log.error(_fmt(msg, args))
