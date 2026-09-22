"""Civitai API v1 客户端 — 服务端代理,统一鉴权/代理(HTTP 与 SOCKS)/错误分类.

设计要点(评审 R1 后确定):
- API 根路径 = base + /api/v1,所有 get_json 的 path 相对它。
- API Key 只对官方域(civitai.com/civitai.green)下发,且按"实际请求 URL 的主机"
  逐请求决定,镜像站(civitai.red 等)带 Bearer 会被拒成 403 网页(实测)。
- session 换代采用"延迟退役":旧 session 不就地 close,避免切断在途下载/图片流。
- open_stream 默认不跟随重定向;需要跟随的调用方显式开启(image 代理逐跳校验白名单)。
"""

import asyncio
import urllib.parse
from contextlib import asynccontextmanager

import aiohttp

from . import config

# 主站用 civitai.red(与 docs/civitai/civitai_pull.py 实测一致):
# API 与下载端点齐全,且不被 Cloudflare 盯;civitai.com 对代理出口 IP 经常弹网页挑战
DEFAULT_BASE = "https://civitai.red"

# 只有官方域才认识 civitai.com 签发的 API Key
_OFFICIAL_HOSTS = ("civitai.com", "civitai.green")
# 图片代理允许的主机白名单(精确域或子域)
_IMAGE_HOSTS = ("civitai.com", "civitai.red", "civitai.green", "civitai.work")

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_session = None
_session_key = None
_session_lock = asyncio.Lock()
_retire_handles = set()

try:
    from aiohttp_socks import ProxyConnector
    SOCKS_AVAILABLE = True
except ImportError:
    ProxyConnector = None
    SOCKS_AVAILABLE = False


class CivitaiError(Exception):
    pass


class HtmlChallengeError(CivitaiError):
    """Civitai 返回网页而非 JSON(WAF 拦截/限流),值得重试;delay 为建议退避秒数."""

    def __init__(self, msg, delay=0.8):
        super().__init__(msg)
        self.delay = delay


def normalize_base(raw):
    """站点地址归一化:裸域名自动补 https://."""
    p = (raw or "").strip()
    if not p:
        return ""
    if "://" not in p:
        p = "https://" + p
    return p.rstrip("/")


def normalize_proxy(raw):
    """裸地址自动补 http:// 前缀;localhost 强制换 127.0.0.1(避免解析到 IPv6 ::1)."""
    p = (raw or "").strip()
    if not p:
        return None
    if "://" not in p:
        p = "http://" + p
    p = p.replace("://localhost:", "://127.0.0.1:")
    return p


def base_url():
    return normalize_base(config.load().get("mirror")) or DEFAULT_BASE


def api_root():
    """API 根路径 — get_json 的 path(/models、/model-versions/...)相对它."""
    return base_url().rstrip("/") + "/api/v1"


def _proxy():
    return normalize_proxy(config.load().get("proxy"))


def _is_socks(p):
    return bool(p) and p.lower().startswith(("socks4://", "socks5://", "socks5h://", "socks://"))


def host_of(url):
    return (urllib.parse.urlparse(url).hostname or "").lower()


def _host_match(host, domains):
    return any(host == d or host.endswith("." + d) for d in domains)


def is_official_host(url):
    return _host_match(host_of(url), _OFFICIAL_HOSTS)


def host_allowed_image(url, extra_domain=""):
    """图片代理白名单:静态域 + 当前 API 站点主机(自定义镜像时其图片域也放行)."""
    domains = list(_IMAGE_HOSTS)
    mirror_host = host_of(base_url())
    if mirror_host:
        domains.append(mirror_host)
    if extra_domain:
        domains.append(extra_domain.lower().lstrip("."))
    return _host_match(host_of(url), tuple(domains))


def append_official_token(url):
    """官方域受限模型下载用 ?token= 传递鉴权(跨域重定向会剥 Authorization 头)."""
    key = (config.load().get("api_key") or "").strip()
    if not key or not is_official_host(url):
        return url
    return url + ("&" if "?" in url else "?") + "token=" + urllib.parse.quote(key)


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


def _headers_for(url, extra=None):
    # 只发浏览器 UA(与 docs/civitai/civitai_pull.py 实测一致),勿加自定义 Accept 头。
    # Bearer 按"本次请求目标主机"决定,且仅官方域下发。
    headers = {"User-Agent": _UA}
    key = (config.load().get("api_key") or "").strip()
    if key and is_official_host(url):
        headers["Authorization"] = "Bearer " + key
    if extra:
        headers.update(extra)
    return headers


def _make_connector(proxy):
    if proxy.lower().startswith("socks5h://"):
        return ProxyConnector.from_url("socks5://" + proxy[len("socks5h://"):], rdns=True)
    if proxy.lower().startswith("socks://"):
        return ProxyConnector.from_url("socks5://" + proxy[len("socks://"):])
    return ProxyConnector.from_url(proxy)


def _retire_session_later(sess):
    """延迟关闭旧 session,给在途请求留出收尾时间(句柄可被 close_all 取消)."""
    if sess is None or sess.closed:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    def _fire():
        _retire_handles.discard((h, sess))
        asyncio.ensure_future(_close_quiet(sess))

    h = loop.call_later(90, _fire)
    _retire_handles.add((h, sess))


async def _close_quiet(sess):
    try:
        await sess.close()
    except Exception:
        pass


async def get_session():
    """返回 (session, via_connector)。SOCKS 代理由连接器承载,请求不可再传 proxy 参数."""
    global _session, _session_key
    p = _proxy()
    via_connector = bool(p and _is_socks(p) and SOCKS_AVAILABLE)
    key = (p or "", via_connector)
    if _session is not None and not _session.closed and _session_key == key:
        return _session, via_connector
    async with _session_lock:
        if _session is not None and not _session.closed and _session_key == key:
            return _session, via_connector
        if _session is not None and not _session.closed:
            _retire_session_later(_session)
        if via_connector:
            _session = aiohttp.ClientSession(
                connector=_make_connector(p), timeout=aiohttp.ClientTimeout(total=120, connect=20)
            )
        else:
            _session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120, connect=20))
        _session_key = key
    return _session, via_connector


async def close_session():
    """重置 session 引用并延迟关闭旧实例(不切断在途流)."""
    global _session, _session_key
    async with _session_lock:
        old = _session
        _session = None
        _session_key = None
    _retire_session_later(old)


async def open_stream(url, extra_headers=None, timeout=None, allow_redirects=False):
    """发起 GET,返回响应上下文:async with await open_stream(...) as resp.

    鉴权头按目标 url 的主机逐请求决定;默认不跟随重定向(调用方按需开启或手动逐跳)。
    """
    sess, via_connector = await get_session()
    p = _proxy()
    if not via_connector and p and _is_socks(p):
        # 装了代理却没装 socks 库:别把 socks:// 塞给 aiohttp 原生 proxy
        raise CivitaiError(net_error_message(ValueError("Only http proxies are supported")))
    kwargs = {"headers": _headers_for(url, extra_headers), "allow_redirects": allow_redirects}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if not via_connector:
        kwargs["proxy"] = p or None
    return await sess.get(url, **kwargs)


@asynccontextmanager
async def open_isolated_stream(url, extra_headers=None, timeout=None):
    """长下载专用:一次性独立会话,不受共享 session 退役/换代影响;用完即关."""
    p = _proxy()
    via_connector = bool(p and _is_socks(p) and SOCKS_AVAILABLE)
    if not via_connector and p and _is_socks(p):
        raise CivitaiError(net_error_message(ValueError("Only http proxies are supported")))
    kwargs = {"connector": _make_connector(p)} if via_connector else {}
    sess = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, connect=20), **kwargs)
    try:
        req_kwargs = {"headers": _headers_for(url, extra_headers), "allow_redirects": True}
        if timeout is not None:
            req_kwargs["timeout"] = timeout
        if not via_connector:
            req_kwargs["proxy"] = p or None
        async with sess.get(url, **req_kwargs) as resp:
            yield resp
    finally:
        await _close_quiet(sess)


_RETRYABLE_STATUS = (429, 500, 502, 503, 504)


async def get_json(path, params=None, timeout=None):
    url = api_root() + path
    if timeout is None:
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
    last_error = None
    for attempt in range(3):  # WAF 拦截/限流/网络抖动:换连接重试
        try:
            async with await open_stream(url, timeout=timeout, allow_redirects=True) as resp:
                # 状态码先判,网关故障的空/HTML 响应体不必解析
                if resp.status in _RETRYABLE_STATUS:
                    try:
                        ra = float(resp.headers.get("Retry-After") or 0)
                    except ValueError:
                        ra = 0
                    raise HtmlChallengeError(f"HTTP {resp.status}(服务端限流/网关抖动,自动重试)",
                                             delay=min(ra, 5) + 0.8)
                if resp.status != 200:
                    try:
                        data = await resp.json(content_type=None)
                    except Exception:
                        data = None
                    msg = None
                    if isinstance(data, dict):
                        err = data.get("error")
                        if isinstance(err, dict):
                            msg = err.get("message")
                    hint = ""
                    if resp.status in (401, 403) and (config.load().get("api_key") or "").strip():
                        hint = "(已配置 API Key:官方站点报 401/403 通常是 Key 失效;镜像站不下发 Key)"
                    raise CivitaiError(f"HTTP {resp.status}: {msg or str(data)[:200]}{hint}")
                try:
                    data = await resp.json(content_type=None)
                except (asyncio.TimeoutError, aiohttp.ClientError):
                    raise HtmlChallengeError("响应体读取中断,自动重试", delay=0.8)
                except Exception:
                    text = await resp.text()
                    if text.lstrip().startswith("<"):
                        raise HtmlChallengeError(
                            "Civitai 返回了网页而非 API 数据(HTTP "
                            f"{resp.status})— 多半被拦截或代理节点异常,换个节点/稍后重试"
                        )
                    raise CivitaiError(f"Civitai 返回非 JSON 数据 (HTTP {resp.status}): {text[:200]}")
                return data
        except HtmlChallengeError as e:
            last_error = e
            await close_session()  # 强制换新连接,负载均衡场景下换一个出口
            await asyncio.sleep(e.delay)
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            last_error = CivitaiError(net_error_message(e))
            await close_session()
            await asyncio.sleep(0.8)
        except Exception as e:
            if "Proxy" in type(e).__name__:
                raise CivitaiError(net_error_message(e)) from e
            raise
    if last_error is None:
        raise CivitaiError("请求失败")
    if isinstance(last_error, HtmlChallengeError):
        raise CivitaiError(f"{last_error}(已连续 3 次失败,请稍后重试或更换代理节点)")
    raise last_error


async def close_all():
    """测试/进程退出用:取消延迟退役任务,把当前与退役中的会话一并立即关闭."""
    olds = [sess for _, sess in _retire_handles]
    for h, _sess in list(_retire_handles):
        h.cancel()
    _retire_handles.clear()
    global _session, _session_key
    async with _session_lock:
        old = _session
        _session = None
        _session_key = None
    if old is not None:
        olds.append(old)
    await asyncio.gather(*(_close_quiet(s) for s in olds), return_exceptions=True)
