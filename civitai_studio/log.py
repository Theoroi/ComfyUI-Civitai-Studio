"""统一日志 — logging.getLogger("civitai-studio"),消息自带 [Civitai-Studio] 前缀.

级别语义:error=功能受损/数据失败;warning=降级但自愈/配置指引;info=生命周期与统计。
跟随 ComfyUI 根 logger 的级别与 handler(app/logger.py 的 ColoredFormatter 会在每行
自动加 [LEVEL] 前缀),因此本模块不再自拼等级字段(E2E 26:用户看到 [INFO] 重复/缺失);
输出形如「[INFO] [Civitai-Studio] …」。独立运行(无 ComfyUI handler)时无等级前缀,可接受。
"""

import logging

log = logging.getLogger("civitai-studio")


def _fmt(msg, args):
    # print 风格迁移:msg 不带 % 占位符时把剩余参数拼进正文(防 logging % 格式化炸)
    if args:
        return msg + " " + " ".join(str(a) for a in args)
    return msg


def info(msg, *args):
    log.info("[Civitai-Studio] " + _fmt(msg, args))


def warn(msg, *args):
    log.warning("[Civitai-Studio] " + _fmt(msg, args))


def error(msg, *args):
    log.error("[Civitai-Studio] " + _fmt(msg, args))
