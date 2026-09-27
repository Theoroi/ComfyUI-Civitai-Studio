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
