# tests/

离线冒烟测试：全部自带 `folder_paths` 桩（临时 user 目录），不依赖运行中的 ComfyUI。
`test_mmeta.py` 的 PNG 用例需要 Pillow（系统 python 没有就自动跳过，ComfyUI venv 全过）。

```bash
# 逐个跑
python tests/smoke/test_fav.py         # 收藏数据面（墓碑/冲突裁决/分组上行标记）
python tests/smoke/test_run.py         # 存储层+索引增量化+损坏自愈
python tests/smoke/test_media.py       # 媒体磁盘缓存+配额
python tests/smoke/test_apicache.py    # API 单飞/SWR
python tests/smoke/test_mmeta.py       # 内嵌元数据解析
python tests/smoke/test_migrate.py     # 旧 schema 迁移
python tests/smoke/test_asset.py       # 导入为资产命名/去重
python tests/smoke/test_route_meta.py  # embedded_meta 寻址/穿越拦截

# 全部
for f in tests/smoke/test_*.py; do python "$f" || exit 1; done
```

覆盖不到、需真机验证的：网络相关路径（真实 Civitai 请求）、aiohttp 路由注册、
前端 JS（浏览器 IndexedDB）。
