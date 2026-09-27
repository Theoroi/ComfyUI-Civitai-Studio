"""统一日志 — logging.getLogger("civitai-studio"),格式自带 [Civitai-Studio] 前缀。

级别语义:error=功能受损/数据失败;warning=降级但自愈/配置指引;info=生命周期与统计。
跟随 ComfyUI 根 logger 的级别与 handler,不自行 basicConfig。
"""

import logging

log = logging.getLogger("civitai-studio")


def _fmt(msg, args):
    # print 风格迁移:msg 不带 % 占位符时把剩余参数拼进正文(防 logging % 格式化炸)
    if args:
        return msg + " " + " ".join(str(a) for a in args)
    return msg


def info(msg, *args):
    # 等级字段在前(E2E 18):[INFO] [Civitai-Studio] 消息
    log.info("[INFO] [Civitai-Studio] " + _fmt(msg, args))


def warn(msg, *args):
    log.warning("[WARNING] [Civitai-Studio] " + _fmt(msg, args))


def error(msg, *args):
    log.error("[ERROR] [Civitai-Studio] " + _fmt(msg, args))
