"""routes handler 离线直调(F-S3-6):make_mocked_request 直打 favorites 4 端点 +
serve_extension_js 穿越防护 + image 代理 URL 白名单,零网络零 PromptServer。

桩头照抄 test_routes_contract.py(folder_paths),另加 server.PromptServer 假实例:
serve_extension_js 只在生产注册分支(routes/__init__.py else 支)有定义,必须让
`from server import PromptServer` 成功且 instance 真值,注册落到假路由表后直调。
"""
import asyncio, json, os, sys, tempfile, types
from unittest import mock

tmp = tempfile.mkdtemp(prefix="cs_handlers_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: tmp
fp.folder_names_and_paths = {"loras": ([os.path.join(tmp, "loras")], {".safetensors"})}
fp.get_folder_paths = lambda key: [os.path.join(tmp, "loras")] if key == "loras" else []
sys.modules["folder_paths"] = fp


class _FakeRoutes:
    def __init__(self):
        self.registered = {}

    def get(self, path):
        def deco(fn):
            self.registered[("GET", path)] = fn
            return fn
        return deco

    def post(self, path):
        def deco(fn):
            self.registered[("POST", path)] = fn
            return fn
        return deco


class _FakeApp:
    def __init__(self):
        self.middlewares = []
        self.on_shutdown = []


class _FakePromptServer:
    instance = None

    def __init__(self):
        self.routes = _FakeRoutes()
        self.app = _FakeApp()


server_stub = types.ModuleType("server")
server_stub.PromptServer = _FakePromptServer
_FakePromptServer.instance = _FakePromptServer()  # 真值 → 生产注册分支生效
sys.modules["server"] = server_stub

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from aiohttp import web
from aiohttp.test_utils import make_mocked_request
from civitai_studio import cache_store, civitai_client, config
from civitai_studio import favorites_store as fs
from civitai_studio import routes
from civitai_studio.routes import favorites as fav_r, media as media_r


def _req(method, path, body=None, match_info=None):
    payload = None
    if body is not None:  # aiohttp 3.14 Request.read() 循环 readany() 到空块
        payload = mock.Mock()
        payload.readany = mock.AsyncMock(side_effect=[json.dumps(body).encode("utf-8"), b""])
    return make_mocked_request(method, path, payload=payload, match_info=match_info or {})


def _post(handler, body):
    return asyncio.run(handler(_req("POST", "/x", body=body)))


def _get(handler, path, match_info=None):
    return asyncio.run(handler(_req("GET", path, match_info=match_info)))


# ── 1) favorites/toggle:非数字 oid → 400(_json_error 形状) ──────────────────
for bad_oid in ("abc", "12ab", ""):
    r = _post(fav_r.favorites_toggle, {"kind": "asset", "oid": bad_oid})
    assert r.status == 400, (bad_oid, r.status)
    assert r.content_type == "application/json"
    assert isinstance(json.loads(r.text).get("error"), str), r.text

# ── 2) favorites/assign:oid 口径与 set_memberships 生效 ────────────────────
r = _post(fav_r.favorites_assign, {"kind": "asset", "oid": "12ab", "group_ids": []})
assert r.status == 400, r.status
gid_a = json.loads(_post(fav_r.favorites_groups, {"name": "Assign Target"}).text)["group"]["gid"]
r = _post(fav_r.favorites_assign, {"kind": "asset", "oid": "123", "group_ids": [gid_a]})
j = json.loads(r.text)
assert r.status == 200 and j["status"] == "ok" and j["changed"] == 1, (r.status, j)
j = json.loads(_post(fav_r.favorites_assign, {"kind": "asset", "oid": "123", "group_ids": [gid_a]}).text)
assert j["changed"] == 0, "重复赋值应对齐为 0 变更(set_memberships 幂等)"
rows = cache_store._CONN.execute(
    "SELECT gid FROM fav_item_groups WHERE kind='asset' AND oid='123' AND deleted=0").fetchall()
assert [x[0] for x in rows] == [gid_a], rows

# ── 3) favorites/groups:建组重名复用(existed=True,批4 分支)+ delete 缺 gid 400 ──
j1 = json.loads(_post(fav_r.favorites_groups, {"name": "Alpha"}).text)
assert j1["status"] == "ok" and j1["group"]["gid"] and "existed" not in j1, j1
gid1 = j1["group"]["gid"]
j2 = json.loads(_post(fav_r.favorites_groups, {"name": "Alpha"}).text)
assert j2.get("existed") is True, j2
assert j2["group"]["gid"] == gid1, "同名组必须复用既有 gid,不得分叉"
r = _post(fav_r.favorites_groups, {"delete": True})
assert r.status == 400, r.status
r = _post(fav_r.favorites_groups, {"gid": gid1, "delete": True})
assert r.status == 200 and json.loads(r.text)["remote_deleted"] is False, r.text
assert all(g["gid"] != gid1 for g in fs.groups_list()), "删组后 groups_list 不应再有 gid1"

# ── 4) favorites/reset:三表清空 ────────────────────────────────────────────
j = json.loads(_post(fav_r.favorites_toggle, {"kind": "asset", "oid": "777", "name": "T"}).text)
assert j["fav"] is True, j
assert fs.groups_list() and fs.list_items(), "前置:重置前应有组与条目"
r = _post(fav_r.favorites_reset, {})
j = json.loads(r.text)
assert r.status == 200 and j["status"] == "ok", (r.status, j)
assert fs.groups_list() == [], "reset 后 fav_groups 应清空"
assert fs.list_items() == [], "reset 后 fav_items 应清空"
n = cache_store._CONN.execute("SELECT COUNT(*) FROM fav_item_groups").fetchone()[0]
assert n == 0, "reset 后 fav_item_groups 应清空"

# ── 5) serve_extension_js:穿越 3 连 + 正例(源码语义:拒绝=404 空响应) ──────────
assert ("GET", "/extensions/ComfyUI-Civitai-Studio/{filename}") in \
    server_stub.PromptServer.instance.routes.registered, "扩展 JS 路由未挂到生产注册分支"
serve = routes.serve_extension_js
for bad in ("../pyproject.toml", "..\\pyproject.toml", "..", "C:win.ini"):
    r = _get(serve, "/x", match_info={"filename": bad})
    assert r.status == 404, (bad, r.status)
js_real = os.path.realpath(os.path.join(os.path.dirname(routes.__file__), "..", "..", "js",
                                        "civitai_studio_app.js"))
r = _get(serve, "/x", match_info={"filename": "civitai_studio_app.js"})
assert r.status == 200, r.status
assert r.text == open(js_real, encoding="utf-8").read(), "JS 内容与磁盘不一致"
assert r.headers["Cache-Control"].startswith("no-cache"), r.headers.get("Cache-Control")

# ── 6) image 代理 URL 白名单:handler 级(不触网)+ helper 级钉口径 ──────────────
assert civitai_client.host_allowed_image("https://evil-civitai.com/x") is False
assert civitai_client.host_allowed_image("https://image.civitai.com/x") is True
# proxy_images 关(默认):非白名单/缺 url → 400;白名单 → 302(HTTPFound),全程不触网
r = _get(media_r.image_proxy, "/civitai_studio/image?url=https%3A%2F%2Fevil-civitai.com%2Fx")
assert r.status == 400 and json.loads(r.text)["error"] == "不允许的图片地址", (r.status, r.text)
r = _get(media_r.image_proxy, "/civitai_studio/image")
assert r.status == 400, r.status
try:
    r = _get(media_r.image_proxy, "/civitai_studio/image?url=https%3A%2F%2Fimage.civitai.com%2Fx")
    raise AssertionError("白名单 URL 应 302 而非返回 %r" % r.status)
except web.HTTPFound as e:
    assert e.location == "https://image.civitai.com/x", e.location
# proxy_images 开:非白名单仍在触网前拒掉
config.update({"proxy_images": True})
r = _get(media_r.image_proxy, "/civitai_studio/image?url=https%3A%2F%2Fevil-civitai.com%2Fx")
assert r.status == 400 and json.loads(r.text)["error"] == "不允许的图片地址", (r.status, r.text)

print("PASS test_routes_handlers (favorites x4 + serve_extension_js + image 白名单)")
