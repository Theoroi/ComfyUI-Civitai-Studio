"""HTTP 路由包 — 由 common 提供 _get/_post 装饰器,各子模块 import 时注册.

URL 全部保持与拆分前一致(契约快照 tests/smoke/test_routes_contract.py 兜底)。
"""
from .common import (  # noqa: F401 — 老引用面(routes._X)兼容
    _parse_model_ref, _json_error, _ok, _read_json_dict, _scan_async,
    _ENUMS_TTL, _enums_cache, _VERSION_CACHE, _VERSION_TTL,
    _annotate_version, _annotate_items, _get, _post, ROUTES,
)
from . import (  # noqa: F401 — import 即注册(顺序:无相互依赖,仅 ROUTES 收集)
    cfg, browse, media, asset_extract, download, local_mod, favorites,
)
from .cfg import _load_tag_mapping, _save_tag_pairs  # noqa: F401 — 测试引用
from .asset_extract import _asset_save  # noqa: F401 — 测试引用
from .media import _meta_roots, _META_EXTS  # noqa: F401 — 测试引用

from aiohttp import web  # noqa: E402 — 尾部路由需要
import os  # noqa: E402 — 尾部路由需要
from .common import _routes  # noqa: E402
from ..log import warn  # noqa: E402

if _routes is None:
    warn("[Civitai-Studio] 警告: PromptServer 不可用,HTTP 路由未注册")
else:
    # 防缓存:覆盖 ComfyUI 静态路由,始终返回最新 JS 并发 no-cache 头。
    # 没有这段,Desktop webview 会启发式缓存旧版 JS,导致更新后侧边栏消失。
    # (契约快照不覆盖此直挂路由——改动请同步人工核对)
    @_routes.get("/extensions/ComfyUI-Civitai-Studio/{filename}")
    async def serve_extension_js(request):
        filename = request.match_info["filename"]
        if "/" in filename or "\\" in filename or ".." in filename or ":" in filename:
            return web.Response(status=404)
        js_root = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..", "js"))
        fp = os.path.realpath(os.path.join(js_root, filename))
        # realpath 归一化后必须仍落在 js 目录内(防盘符相对路径等穿越)
        if not fp.startswith(js_root + os.sep) or not os.path.isfile(fp):
            return web.Response(status=404)
        with open(fp, "r", encoding="utf-8") as f:
            content = f.read()
        return web.Response(text=content, content_type="application/javascript",
                            headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
