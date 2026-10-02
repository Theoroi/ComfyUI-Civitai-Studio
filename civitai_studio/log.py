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


class _SafeHandler(logging.StreamHandler):
    """stdout 是 ComfyUI app/logger.py 的包装流;其 flush 在 wsmgr 管道托管/重定向场景
    会抛 OSError Errno 22(logging 默认打 "--- Logging error ---"+全栈噪音且丢行,实测
    0.9.2 同步统计行触发)。容错:写/刷失败静默丢行,不打断业务线程."""

    def emit(self, record):
        try:
            self.stream.write(self.format(record) + self.terminator)
            self.flush()
        except (OSError, ValueError, AttributeError):
            pass  # 管道失效/解释器退出中:静默

    def flush(self):
        try:
            super().flush()
        except (OSError, ValueError):
            pass


_FMT_TS = "[%(asctime)s] [%(levelname)s] [Civitai-Studio:%(module)s] %(message)s"
_FMT_NO_TS = "[%(levelname)s] [Civitai-Studio:%(module)s] %(message)s"


def _make_handler(ts=False):
    h = _SafeHandler(sys.stdout)
    h.setFormatter(logging.Formatter(_FMT_TS if ts else _FMT_NO_TS, datefmt="%Y-%m-%d %H:%M:%S"))
    return h


log.addHandler(_make_handler())
log.setLevel(logging.INFO)  # 默认 INFO;apply_debug 提到 DEBUG(0.9.2 回归:logger 层门缺失致 debug 全灭)
log.propagate = False  # 批5 E2E e:时间戳+模块前缀自管,不再依赖 ComfyUI 根 formatter


def apply_debug(on, timestamp=None):
    """配置 log_debug 开关(启动时与设置页保存后都会调):on → logger+handler 提到 DEBUG,
    http outbound/tRPC/同步逐条决策可见;off → INFO 起。必须同时调 logger.setLevel —
    logger 层 NOTSET 会继承 ComfyUI root 的 INFO 门,debug 记录到不了 handler(0.9.2 实测回归).
    timestamp(None=不动;True/False)=带/不带时间戳前缀(批6 a:log_timestamp 设置,默认关)."""
    level = logging.DEBUG if on else logging.INFO
    log.setLevel(level)
    for h in log.handlers:
        h.setLevel(level)
    if timestamp is not None:
        f = logging.Formatter(_FMT_TS if timestamp else _FMT_NO_TS, datefmt="%Y-%m-%d %H:%M:%S")
        for h in log.handlers:
            h.setFormatter(f)


def debug(msg, *args):
    log.debug(_fmt(msg, args), stacklevel=2)


def dbg_json(label, data):
    """出站/响应体 debug 记录:统一截断,防大响应刷屏."""
    import json as _json
    try:
        body = _json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data
    except Exception:
        body = repr(data)
    log.debug(_fmt(f"{label}: ") + _trunc(body), stacklevel=2)


def info(msg, *args):
    log.info(_fmt(msg, args), stacklevel=2)


def warn(msg, *args):
    log.warning(_fmt(msg, args), stacklevel=2)


def error(msg, *args):
    log.error(_fmt(msg, args), stacklevel=2)
