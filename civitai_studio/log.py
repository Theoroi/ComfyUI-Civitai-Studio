"""统一日志 — logging.getLogger("civitai-studio"),格式自带 [Civitai-Studio] 前缀。

级别语义:error=功能受损/数据失败;warning=降级但自愈/配置指引;info=生命周期与统计。
跟随 ComfyUI 根 logger 的级别与 handler,不自行 basicConfig。
"""

import logging

log = logging.getLogger("civitai-studio")


def info(msg, *args):
    log.info("[Civitai-Studio] " + msg, *args)


def warn(msg, *args):
    log.warning("[Civitai-Studio] " + msg, *args)


def error(msg, *args):
    log.error("[Civitai-Studio] " + msg, *args)
