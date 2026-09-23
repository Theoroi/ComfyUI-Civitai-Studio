"""版本号单源(CalVer:按发布日期递增,同日多次修改共用同一版本).

后端 /civitai_studio/version 返回 {"version": VERSION, "build": <git 短哈希>};
前端 JS_VERSION 与 VERSION 保持一致,自检只比较版本号本身.
"""

import os
import subprocess
from functools import lru_cache

VERSION = "2026.9.23"


@lru_cache(maxsize=1)
def build() -> str:
    """当前 git 短哈希(非仓库环境返回 unknown)."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5, check=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"
