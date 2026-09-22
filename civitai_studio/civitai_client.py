"""Civitai API v1 客户端 — 服务端代理,统一鉴权/代理(HTTP 与 SOCKS)/错误分类."""

import asyncio
import urllib.parse

import aiohttp

from . import config

# 主站用 civitai.red(与 docs/civitai/civitai_pull.py 实测一致):
# API 与下载端点齐全,且不被 Cloudflare 盯;civitai.com 对代理出口 IP 经常弹网页挑战
DEFAULT_BASE = "https://civitai.red"

# 只有官方域才认识 civitai.com 签发的 API Key;镜像站收到 Bearer 头会直接 403 网页
_OFFICIAL_HOSTS = ("civitai.com", "civitai.green")
_session = None
_session_key = None

try:
    from aiohttp_socks import ProxyConnector
    SOCKS_AVAILABLE = True
except ImportError:
    ProxyConnector = None
    SOCKS_AVAILABLE = False


class CivitaiError(Exception):
    pass


class HtmlChallengeError(CivitaiError):
    """Civitai 返回网页而非 JSON(Cloudflare 拦截/节点切换瞬间),值得重试."""


def base_url():
    mirror = (config.load().get("mirror") or "").strip()
    return mirror.rstrip("/") if mirror else DEFAULT_BASE


def api_root():
    """API 根路径 — 所有 get_json 的 path 都是相对它(/models、/model-versions/...)."""
    return base_url().rstrip("/") + "/api/v1"


def _send_api_key():
    host = (urllib.parse.urlparse(base_url()).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in _OFFICIAL_HOSTS)


def _headers(extra=None):
    # 只发浏览器 UA(与 docs/civitai/civitai_pull.py 实测一致),勿加自定义 Accept 头。
    # API Key 只下发给官方域:镜像站(civitai.red 等)不认 civitai.com 的 Key,
    # 带 Bearer 头会被拒成 403 网页(实测)。
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
    }
    key = (config.load().get("api_key") or "").strip()
    if key and _send_api_key():
        headers["Authorization"] = "Bearer " + key
    if extra:
        headers.update(extra)
    return headers


def normalize_proxy(raw):
    """裸地址自动补 http:// 前缀;localhost 强制换 127.0.0.1(避免解析到 IPv6 ::1 而代理只绑 IPv4)."""
    p = (raw or "").strip()
    if not p:
        return None
    if "://" not in p:
        p = "http://" + p
    p = p.replace("://localhost:", "://127.0.0.1:")
    return p


def _proxy():
    return normalize_proxy(config.load().get("proxy"))


def _is_socks(p):
    return bool(p) and p.lower().startswith(("socks4://", "socks5://", "socks5h://", "socks://"))


def net_error_message(e):
    """把底层网络异常翻译成可操作的中文提示."""
    proxy = _proxy()
    name = type(e).__name__
    if isinstance(e, asyncio.TimeoutError) or name == "ProxyTimeoutError":
        if proxy:
            return f"通过代理 {proxy} 访问 Civitai 超时 — 确认代理可用、节点能访问国际网络"
        return ("直连 Civitai 站点超时(国内网络直连不通属正常现象)— "
                "请在 ⚙ 设置里配置代理,例如 http://127.0.0.1:10808(v2rayN 混合端口)或 socks5://127.0.0.1:10808")
    if isinstance(e, aiohttp.ClientProxyConnectionError) or "Proxy" in name:
        if _is_socks(proxy) and not SOCKS_AVAILABLE:
            return (f"SOCKS 代理 {proxy} 需要 aiohttp-socks 库(当前环境未安装)— "
                    "改用 HTTP 端口(如 http://127.0.0.1:10808),或在 ComfyUI 环境中执行 pip install aiohttp-socks")
        return (f"无法连接代理 {proxy} — 确认代理软件正在运行、协议与端口匹配"
                "(地址写 127.0.0.1 而非 localhost;v2rayN 混合端口可直接填 http://127.0.0.1:10808)")
    if isinstance(e, aiohttp.ClientConnectorError):
        return "无法建立网络连接 — 若无法直连 Civitai,请在 ⚙ 设置里配置代理"
    return f"网络错误: {e}(检查网络/代理设置)"


async def get_session():
    """返回 (session, via_connector)。SOCKS 代理由连接器承载,请求不可再传 proxy 参数."""
    global _session, _session_key
    p = _proxy()
    via_connector = bool(p and _is_socks(p) and SOCKS_AVAILABLE)
    key = (p or "", via_connector)
    if _session is None or _session.closed or _session_key != key:
        if _session is not None and not _session.closed:
            await _session.close()
        if via_connector:
            if p.lower().startswith("socks5h://"):
                connector = ProxyConnector.from_url("socks5://" + p[len("socks5h://"):], rdns=True)
            elif p.lower().startswith("socks://"):
                connector = ProxyConnector.from_url("socks5://" + p[len("socks://"):])
            else:
                connector = ProxyConnector.from_url(p)
            _session = aiohttp.ClientSession(
                connector=connector, timeout=aiohttp.ClientTimeout(total=120, connect=20)
            )
        else:
            _session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120, connect=20))
        _session_key = key
    return _session, via_connector


async def open_stream(url, extra_headers=None, timeout=None):
    """发起 GET,返回响应上下文:async with await open_stream(...) as resp."""
    sess, via_connector = await get_session()
    kwargs = {"headers": _headers(extra_headers)}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if not via_connector:
        kwargs["proxy"] = _proxy() or None
    return await sess.get(url, **kwargs)


async def get_json(path, params=None, timeout=None):
    url = api_root() + path
    if timeout is None:
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
    html_error = None
    for attempt in range(3):  # 偶发 Cloudflare 拦截:重建连接换出口 IP 重试
        try:
            async with await open_stream(url, timeout=timeout) as resp:
                try:
                    data = await resp.json(content_type=None)
                except Exception:
                    text = await resp.text()
                    if text.lstrip().startswith("<"):
                        raise HtmlChallengeError(
                            "Civitai 返回了网页而非 API 数据(HTTP "
                            f"{resp.status})— 多半被 Cloudflare 拦截或代理节点异常,换个节点/稍后重试"
                        )
                    raise CivitaiError(f"Civitai 返回非 JSON 数据 (HTTP {resp.status}): {text[:200]}")
                if resp.status != 200:
                    msg = None
                    if isinstance(data, dict):
                        err = data.get("error")
                        if isinstance(err, dict):
                            msg = err.get("message")
                    hint = ""
                    if resp.status in (401, 403) and (config.load().get("api_key") or "").strip():
                        hint = "(已配置 API Key:官方站点报 401/403 通常是 Key 失效;镜像站不下发 Key)"
                    raise CivitaiError(f"HTTP {resp.status}: {msg or str(data)[:200]}{hint}")
                return data
        except HtmlChallengeError as e:
            html_error = e
            await close_session()  # 强制新建连接,负载均衡场景下换一个出口 IP
            await asyncio.sleep(0.6)
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            raise CivitaiError(net_error_message(e)) from e
        except Exception as e:
            if "Proxy" in type(e).__name__:
                raise CivitaiError(net_error_message(e)) from e
            raise
    raise html_error


async def close_session():
    global _session, _session_key
    if _session is not None and not _session.closed:
        await _session.close()
    _session = None
    _session_key = None
