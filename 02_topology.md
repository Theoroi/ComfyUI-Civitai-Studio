# 02_topology — 系统拓扑(现状态)

> origin: project-design@2026-10-04(逆向 full 档;证据等级 A=代码可证 file:line,B=git 可证 commit)。
> 验收线:能回答"改 X 波及谁";论断带 file:line,答不了的补读代码不许猜。
> 行号基于 commit 2da9fb9(2026-10-04);后续改动以 grep 复核为准。

## 1. 分层总图

```mermaid
graph TB
    subgraph 宿主["ComfyUI 宿主(PromptServer + frontend webview)"]
        PS["PromptServer.instance.routes<br/>+ on_shutdown + middleware"]
        FE["前端 frontend 1.52.7<br/>unimport 转译扩展模块"]
    end

    subgraph FRONT["前端(单文件,js/civitai_studio_app.js 6288 行)"]
        JSUI["侧边栏 5 tab(浏览/本地库/下载/收藏/设置)<br/>registerSidebarTab js:6252"]
        JSNODE["4 节点缩略图条/交互<br/>app.registerExtension js:6211"]
    end

    subgraph HTTP["HTTP 路由层(civitai_studio/routes/,49 端点)"]
        RCOM["common.py 装饰器工厂/中间件/共享状态"]
        RBROWSE["browse(6)"] RLOCAL["local_mod(10)"] RDL["download(7)"]
        RFAV["favorites(9)"] RMEDIA["media(5)"] RCFG["cfg(8)"] RASSET["asset_extract(4)"]
    end

    subgraph CORE["服务核心(civitai_studio/)"]
        CLIENT["civitai_client(508)"]
        APIC["api_cache(127)"]
        DL["downloader(565)"]
        FSYNC["fav_sync(498)"]
        FSTORE["favorites_store(870)"]
        LIDX["local_index(274)"]
        NODES["nodes(440)"]
        MMETA["media_meta(207)"]
    end

    subgraph INFRA["基础设施(零内部依赖)"]
        CS["cache_store(841)<br/>sqlite 单连接+RLock"]
        CFG["config(120)"] LOG["log(110)"] BG["bg(23)<br/>ThreadPool×4"]
        MLRU["mem_lru(42)"] VER["version(25)"]
    end

    JSUI -->|"apiGet/apiJson (fetch)"| HTTP
    JSNODE --> HTTP
    HTTP --> CORE
    CLIENT --> APIC
    DL --> LIDX
    FSYNC --> FSTORE
    CORE --> INFRA
    CS -->|"from . import config"| CFG
```

## 2. 文本树(与上图同源,供 grep 导航)

```
ComfyUI-Civitai-Studio/
├── __init__.py                     ComfyUI 插件入口:导入即注册节点+路由+日志开关(__init__.py:2-27)
├── civitai_studio/
│   ├── nodes.py                    4 节点实现,NODE_CLASS_MAPPINGS(nodes.py:428,CivitaiStudio_ 前缀)
│   ├── routes/                     HTTP 层:49 端点,import 即注册(routes/__init__.py:10)
│   │   ├── __init__.py             装配+JS 直挂路由(防 webview 缓存,routes/__init__.py:28-45)
│   │   ├── common.py               _get/_post 装饰器工厂(common.py:55-58 生产)+no-cache 中间件(:36-41)
│   │   │                           +on_shutdown 关共享 session(:43-47)+PromptServer 缺席测试桩(:60-68)
│   │   ├── browse.py               搜索/模型/版本/画廊图片/enums(browse.py:28-198)
│   │   ├── local_mod.py            本地库 10 端点:扫描/删除/移动/重命名/关联/查新(local_mod.py:28-382)
│   │   ├── download.py             下载队列 7 端点+destinations+save_image(download.py:53-126)
│   │   ├── favorites.py            收藏 9 端点:toggle/assign/groups/导出导入/同步/backfill(favorites.py:28-188)
│   │   ├── media.py                图片代理/内嵌元数据/缓存管理/生成数据回退(media.py:29-190)
│   │   ├── cfg.py                  版本/配置/ui_log/tag 映射/key_probe(cfg.py:28-265)
│   │   └── asset_extract.py        导入为资产/工作流提取(asset_extract.py:119-240)
│   ├── civitai_client.py           出站唯一通道:session 管理/白名单/重试(civitai_client.py:417-437)
│   ├── api_cache.py                GET 单飞+SWR 磁盘缓存(api_cache.py,依赖 bg/cache_store)
│   ├── downloader.py               断点续传+SHA256+任务持久化(downloader.py:255,337-341,435)
│   ├── fav_sync.py                 收藏同步引擎:下行镜像→缺席对账→上行(fav_sync.py:426 sync_now)
│   ├── favorites_store.py          收藏数据面:三表 CRUD/墓碑/导出导入(favorites_store.py:25 锁)
│   ├── local_index.py              本地模型索引/增量扫描/关联主存储(local_index.py:234 scan)
│   ├── cache_store.py              sqlite 单文件:连接/RLock/配额/durable 表(cache_store.py:26,28,293)
│   ├── media_meta.py               PNG tEXt/MP4 mdta 内嵌生成数据解析
│   ├── config.py                   配置单源:DEFAULTS/钳制/原子写(config.py:16-31)
│   ├── bg.py                       共享线程池×4:spawn/run_bg(bg.py:9-23)
│   ├── log.py                      自管日志:级别/模块归因/时间戳开关(log.py)
│   ├── mem_lru.py                  内存 LRU(三处合一)(mem_lru.py:10)
│   └── version.py                  版本单源:VERSION+git 短哈希(version.py:11)
├── js/civitai_studio_app.js        前端单文件(6288 行,无构建;js-modular 负结论见 01)
└── tests/smoke/test_*.py           14 份离线冒烟(自带 folder_paths 桩,共 1684 行)
```

## 3. 依赖方向不变量(全部 A 级)

1. **基础设施零内部依赖**:`log.py`/`mem_lru.py`/`bg.py`/`version.py` 无任何 `from .` import;`config.py` 只被依赖不依赖他人。反向 import 一律视为破坏分层。
2. **cache_store 是依赖枢纽**:被 api_cache/favorites_store/local_index/media_meta/downloader/fav_sync 依赖(各文件 `from . import cache_store`),自身只依赖 config(cache_store.py 头部)。
3. **HTTP 层单向依赖核心**:routes/* 统一 `from .. import (api_cache, cache_store, civitai_client, config, downloader, fav_sync, ...)`(各 routes 文件头部同款一揽子 import),核心模块从不 import routes。
4. **锁纪律**:全仓唯一 RLock = `cache_store._LOCK`(cache_store.py:26);`favorites_store._LOCK = cache_store._LOCK`(favorites_store.py:25,同锁跨模块串行化,commit 1cbb40d)。新存储模块必须复用,禁自建锁。
5. **线程纪律**:事件循环内禁阻塞 IO——sqlite 扫描/SHA256/媒体落盘走 `bg.run_bg`/`bg.spawn`(bg.py:14,22;线程池 `_EXECUTOR` bg.py:9,max_workers=4)。downloader 的 SHA256 校验也走该池(downloader.py:435,批11.6 修复)。
6. **出站单通道**:一切 civitai HTTP 只经 `civitai_client`(白名单 `host_allowed_image`;重试 `_RETRYABLE_STATUS` civitai_client.py:277,退避 7/14/28/56/112s 且尊重 Retry-After :434-437)。前端不持 key,API key 不回传(00_overview 硬约束)。
7. **契约双分支**:`routes/common.py:28` 生产取 PromptServer.routes;生产 `_get/_post` 在 :55-58;缺失(测试/裸 import)时只登记清单不做挂载(:60-68)——49 端点契约快照 `tests/smoke/test_routes_contract.py` 据此跑通。
8. **前端单文件强制**:js 多文件扩展在 frontend 1.52.7 下 `unimport` 转译失败(importModule 未定义,主模块静默不注册)——实验负结论 commit bcb6575,构建链/拆分禁止。

## 4. 入口与启动链(全部 A 级)

```
ComfyUI 加载 custom_nodes
 → __init__.py:2-9      import civitai_client/config/downloader/local_index/routes(导入即注册)
 → __init__.py:13-17    NODE_CLASS_MAPPINGS ← nodes.py:428(4 节点);WEB_DIRECTORY="./js"(:16)
 → routes/__init__.py:28  直挂 /extensions/ComfyUI-Civitai-Studio/{filename}(no-cache 头,防 webview 启发式缓存旧 JS;穿越防护 :31-40)
 → routes/common.py:36-41 no-cache 中间件压 /api/extensions 清单缓存;:43-47 on_shutdown 关 aiohttp session
 → 前端 js:6211 app.registerExtension;js:6252 registerSidebarTab("Civitai")→ buildRoot 五 tab
 → __init__.py:24-27   apply_debug(log_debug/log_timestamp 配置生效)
```

## 5. 核心数据流(A 级,含锚点)

| # | 流 | 链路 |
|---|---|---|
| 1 | 浏览/搜索 | js fetchBrowse(js:890)→GET /search(browse.py:81)→civitai_client.get_json(:417,重试 :432-437)→api_cache 单飞/SWR→aiohttp open_stream(:235);多 tag OR=per-tag 游标合并(js:904-933) |
| 2 | 下载 | POST /download(download.py:82)→downloader._worker(:255)→tmp 分块+Range 续传(:337-341;206 Content-Range 起点校验 :361-367)→SHA256 走 bg 池(:435)→落盘→local_index 关联直写 |
| 3 | 收藏同步 | POST /favorites/sync(favorites.py:188)→fav_sync.sync_now(:426):下行 _down_groups(:95,collections tRPC;Bookmark 跳过 :129-132;心跳续锁 :124-125)→缺席对账(truncated 短路)→上行 _upsync_models/removals/groups(:267/:291/:339,Bookmark 门控 :303/:380-381)→favorites_store 三表(:25 同锁) |
| 4 | 图片代理 | GET /image(media.py:29)→磁盘缓存命中 FileResponse(:40-44)→miss 逐跳 open_stream 全程白名单(:52-58)→206 直通不缓存(:59-65)→bg spawn media_store(:82) |
| 5 | 本地库 | GET /local(local_mod.py:28)→local_index.scan(:234,增量+deep)→assocs 主存储(durable 域);sidecar 只作导出口径 |
| 6 | 分级/媒体类型 | js 请求带 type=image|video(browse.py:143-145 透传)→/images 服务端过滤;模糊判定 browsingLevel 位掩码优先(nsfwBitsOf js:1445-1454) |

## 6. 波及面速查(改 X 动 Y)

| 改动 X | 直接波及 | 兜底 |
|---|---|---|
| 加/改 HTTP 端点 | `routes/<域>.py`;前端调用点;**契约快照 49 端点**(test_routes_contract.py) | smoke+DOM 探针 |
| config.DEFAULTS(config.py:16-31) | routes/cfg.py GET(:167)/POST 白名单(:213);js 设置页(js:3819+);test_run 钳制断言 | smoke |
| cache schema(表/列) | cache_store.py 建表+迁移;**durable 域语义**(assocs/dl_jobs/tag_map/fav_*,cache_store.py:98,103) | test_migrate/test_run |
| 收藏表结构/导出格式 | favorites_store.py+fav_sync.py+js 导入兼容(v2/v3) | test_fav/test_favsync |
| civitai_client 出站行为 | api_cache 单飞;重试预算;域名白名单;debug 日志(civitai_client.py:417-437) | test_apicache |
| 版本号 | 三处同步:version.py:11/pyproject.toml:4/js JS_VERSION:69;release.yml 强校验 tag==VERSION | CI |
| js 文件名/加载方式 | routes/__init__.py:28 直挂路由+no-cache 中间件(common.py:36-41);**单文件禁拆**(bcb6575) | node --check |
| 收藏语义(Bookmark/墓碑) | fav_sync.py:129-132,303,381+favorites_store+js 六处收藏入口(toggleFav) | test_favsync |
| 节点注册键(nodes.py:428) | **BREAKING**:旧工作流失效(commit 8d08ee9 前科) | 真机 |
| RLock/线程池 | cache_store.py:26+bg.py:9 是全局共享;动它们=动全部阻塞路径 | 全 smoke |

## 7. 盲区(未读未证,防"已覆盖"错觉)

- js 6288 行未做逐段拓扑(仅按流抽样标注行号);节点缩略图条/节点翻页内部结构未入图。
- ComfyUI 宿主侧(PromptServer/frontend)行为只引用实测结论,未读其源码。
- `tests/acceptance.py` 用途未查证(未读)。
