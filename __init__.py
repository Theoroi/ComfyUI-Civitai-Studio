"""ComfyUI-Civitai-Studio — Civitai 模型浏览器 + 本地模型管理器(纯 UI 插件,无自定义节点)."""

VERSION = "0.1.0"

print(f"[Civitai-Studio] v{VERSION} 加载中...")

from .civitai_studio import civitai_client  # noqa: E402
from .civitai_studio import config  # noqa: E402
from .civitai_studio import downloader  # noqa: E402
from .civitai_studio import local_index  # noqa: E402
from .civitai_studio import routes  # noqa: E402

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[Civitai-Studio] 加载完成 — 侧边栏面板「Civitai」(在线浏览 / 本地库 / 下载队列)")
