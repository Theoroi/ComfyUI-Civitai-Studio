"""统一日志 — logging.getLogger("civitai-studio"),自管 stdout handler(批5 E2E e).

格式:[时间] [级别] [Civitai-Studio:模块名] 正文 — 时间戳与模块前缀应 E2E 反馈新增;
propagate=False(不走 ComfyUI 根 formatter,防双写;根 formatter 的 INFO 门不再约束本插件)。
级别语义:error=功能受损/数据失败;warning=降级但自愈/配置指引;
info=生命周期/统计/UI 弹窗回传;debug=全部出站请求与响应、同步逐条决策(默认关,
设置页 log_debug 开关即时生效 — apply_debug)。
历史调用点消息里手写的 "[Civitai-Studio] "在此统一剥除,防双写。
"""

import logging
import sys

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


def _make_handler():
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [Civitai-Studio:%(module)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"))
    return h


log.addHandler(_make_handler())
log.propagate = False  # 批5 E2E e:时间戳+模块前缀自管,不再依赖 ComfyUI 根 formatter


def apply_debug(on):
    """配置 log_debug 开关(设置页保存后即时生效):on=True → DEBUG 可见;on=False → INFO 起."""
    for h in log.handlers:
        h.setLevel(logging.DEBUG if on else logging.INFO)


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
