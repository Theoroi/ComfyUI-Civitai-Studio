"""ComfyUI-Civitai-Studio — Civitai 模型浏览器 + 本地模型管理器(纯 UI 插件)."""

from .civitai_studio import civitai_client  # noqa: E402
from .civitai_studio import config  # noqa: E402
from .civitai_studio import downloader  # noqa: E402
from .civitai_studio import local_index  # noqa: E402
from .civitai_studio import routes  # noqa: E402
from .civitai_studio.nodes import NODE_CLASS_MAPPINGS as trigger_mappings  # noqa: E402
from .civitai_studio.nodes import NODE_DISPLAY_NAME_MAPPINGS as display_mappings  # noqa: E402
from .civitai_studio.log import info as _log_info  # noqa: E402
from .civitai_studio.version import VERSION  # noqa: E402

NODE_CLASS_MAPPINGS = {**trigger_mappings}
NODE_DISPLAY_NAME_MAPPINGS = {**display_mappings}
WEB_DIRECTORY = "./js"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

# 走 logging(ComfyUI root handler 自动加 [LEVEL] 前缀),不再用 print(E2E r3-26)
# 调试日志开关(config.log_debug):等效 --verbose 但只对本插件生效,免启动参数
from .civitai_studio import log as _cs_log  # noqa: E402
try:
    _cs_log.apply_debug(bool(config.load().get("log_debug")))
    if config.load().get("log_debug"):
        _log_info("调试日志已开启(log_debug=true)— 出站请求/响应/同步决策将以 DEBUG 落控制台")
except Exception:  # 配置不可读不挡加载
    pass

_log_info(f"[Civitai-Studio] v{VERSION} 加载完成 — 侧边栏面板「Civitai」(在线浏览 / 本地库 / 下载队列)")
