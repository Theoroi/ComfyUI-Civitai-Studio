"""ComfyUI-Civitai-Studio — Civitai 模型浏览器 + 本地模型管理器(纯 UI 插件)."""

from .civitai_studio import civitai_client  # noqa: E402
from .civitai_studio import config  # noqa: E402
from .civitai_studio import downloader  # noqa: E402
from .civitai_studio import local_index  # noqa: E402
from .civitai_studio import routes  # noqa: E402
from .civitai_studio.nodes import NODE_CLASS_MAPPINGS as trigger_mappings  # noqa: E402
from .civitai_studio.nodes import NODE_DISPLAY_NAME_MAPPINGS as display_mappings  # noqa: E402
from .civitai_studio.version import VERSION  # noqa: E402

NODE_CLASS_MAPPINGS = {**trigger_mappings}
NODE_DISPLAY_NAME_MAPPINGS = {**display_mappings}
WEB_DIRECTORY = "./js"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print(f"[Civitai-Studio] v{VERSION} 加载完成 — 侧边栏面板「Civitai」(在线浏览 / 本地库 / 下载队列)")
