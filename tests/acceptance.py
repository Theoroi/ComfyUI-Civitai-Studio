"""真机验收一键脚本 — 重启 ComfyUI 后运行:

    python tests/acceptance.py

自动输出:
  1. 新端点存活检查(404 = 还没重启后端)
  2. 增量扫描耗时×2 + scan_stats(对照 <2s;真实库太小则对照 tests/smoke/test_run.py 的 10k 合成库结论)
  3. 收藏同步结果(资产/模型下行数、上行数、作用域提示)
面板二次打开耗时需要浏览器侧观察:开面板 → 切走 → 切回,应瞬时无转圈。
"""

import json
import urllib.request

BASE = "http://127.0.0.1:8188"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    # localhost 必须绕过系统代理,否则 502
    return json.load(urllib.request.build_opener(urllib.request.ProxyHandler({})).open(r, timeout=120))


def timed(method, path):
    import time
    t0 = time.time()
    d = req(method, path)
    return time.time() - t0, d


def main():
    print("== 1) 新端点存活(404 = 后端未重启,请先重启 ComfyUI 再跑本脚本)")
    try:
        d = req("GET", "/civitai_studio/cache_usage")
    except Exception as e:
        print("   FAIL:", e)
        print("   → 请重启 ComfyUI Desktop 后重新运行本脚本")
        return
    print(f"   OK cache_usage: {d}")

    print("== 2) 增量扫描(对照 <2s;真实库较小则秒级为正常,10k 结论见 tests/smoke)")
    for i in (1, 2):
        dt, d = timed("GET", "/civitai_studio/local?force=1")
        stats = d.get("scan_stats") or {}
        print(f"   第{i}次 force 扫描: {dt:.2f}s  total={stats.get('total')} "
              f"reused={stats.get('reused')} read={stats.get('read')} dur={stats.get('dur')}s"
              f"  → {'PASS' if dt < 2 else 'FAIL'}")

    print("== 3) 收藏同步(下行为只读;模型上推需 Key 含 SocialWrite/CollectionsWrite)")
    try:
        dt, d = timed("POST", "/civitai_studio/favorites/sync")
        print(f"   {dt:.1f}s:", json.dumps({k: d.get(k) for k in
              ("status", "assets_down", "models_down", "groups_down", "groups_up",
               "items_up", "upsynced", "upsync_failed", "scope_hint", "truncated", "errors")},
              ensure_ascii=False))
    except Exception as e:
        print("   FAIL:", e)
    print("== 4) 面板二次打开(浏览器观察):开面板 → 切走 → 切回,应瞬时无转圈(硬刷新后测)")


if __name__ == "__main__":
    main()
