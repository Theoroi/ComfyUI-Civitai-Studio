# 03_reference — 参考手册(术语/命名/时间线/禁写)

> origin: project-design@2026-10-04(逆向 full 档)。**全部条目 A/B 级可证**(A=代码 file:line,B=git commit);
> 推不出的不入册。行号基于 commit 2da9fb9。验收线:术语可反查、命名可执行。

## 1. 术语表(按反查场景排;trigger=何时需要查它)

| 术语 | 定义(可证锚点) | trigger |
|---|---|---|
| **collections / tRPC** | 站方收藏的唯一下行通道;REST `/favorites` 已被站方废弃(commit bfa30fc 实证:`?favorites=true` 被忽略返回全站图) | 动收藏下行/怀疑收藏夹数据来源时 |
| **挂载(mount / itemId)** | 条目×集合的归属关系,存 `fav_item_groups` 表(cache_store.py 建表区);站方侧对应 collectionItemId,上行移除靠它 | 动"从分组移除/同步移除"时 |
| **墓碑(tombstone)** | 收藏条目的本地删除标记;`dirty=1` 本地已取消不复活、`dirty=0` 站方权威可复活;过期物理清除 `purge_tombstones`(favorites_store.py:723) | 动"取消收藏后又被同步拉回"类问题时 |
| **Bookmark / 系统集合** | 站方 ❤ 托管的集合,`mode=="Bookmark"`,本地存 `ctype="Bookmark"` 只读镜像;下行跳过(fav_sync.py:129-132)、上行全门控(:303,:380-381) | 动收藏上行/分组管理时 |
| **缺席对账** | 站方删条目→本地摘挂载的机制;**仅两通道完整枚举才执行**,`truncated=True` 一律短路(fav_sync.py:65-66,223;门控收紧 commit 656e7d5) | 动同步对账/防误杀逻辑时 |
| **durable 域** | 配额淘汰与 clear_cache 均不触及的表:assocs/dl_jobs/tag_map/fav_items/fav_groups/fav_item_groups(cache_store.py:98,103) | 动缓存配额/清缓存/建新表时 |
| **assocs 主存储** | sqlite 关联表 = 本地文件↔civitai 身份的真值;`.civitai.json` sidecar 降级为导出口径(commit 91545f7→e1e6ac4 两阶段) | 动本地库/关联/扫描时 |
| **sidecar(.civitai.json)** | 模型文件旁的元数据文件;`persist_description` 开=双写,关=只存 DB(e1e6ac4) | 动元数据落盘/刷新时 |
| **tagMap / tag_mapping** | 图片分类 tag 名→数字 ID 映射(durable 表);`/images` 的 tags 参数只吃数字 ID(cache_store.py:579;js S.tagMap) | 动画廊 tag 筛选/联想时 |
| **browsingLevel vs nsfwLevel** | 判定源优先级:browsingLevel(数字位掩码 1/2/4/8/16/32)>nsfwLevel(数字或字符串枚举);字符串枚举把 XXX 并进 X 必错档(js:1445-1454) | 动任何 NSFW 判定/筛选时 |
| **媒体类型(type=)** | `/images?type=image|video` **服务端**过滤(browse.py:143-145);渲染层 isVideoItem(js:5118)只作兜底 | 动画廊"图像/视频"筛选时 |
| **档位(tier)** | 站方 CDN 变换档离散:96/320/450/512/…请求值**向上吸附**(config.py:38,41;视频档位表见 js:5143 cdnVideo 注释) | 动缩略图分辨率/URL 变换时 |
| **cdnThumb / cdnVideo** | URL 变换:`/original=true/`→`/width=N/`(js:5133);视频同段(js:5143,固定 320) | 动缩略图加载时 |
| **缩略档位吸附(_snap_px)** | 任意宽度→真实档位向上取(旧 128/256→320);`PX_TIERS=(96,320,450,512)`(config.py:38-49) | 动 px_cover/px_media 时 |
| **单飞(singleflight)/SWR** | api_cache 的并发去重+陈旧回退策略(api_cache.py) | 动 GET 缓存/请求风暴时 |
| **快照(gal_snapshot)** | 画廊 IndexedDB 快照(≤240 条+filters),重开面板秒回(js galleryFilters/saveGallerySnapshot);恢复后 `__restored` 静默刷新 | 动画廊首开/状态恢复时 |
| **blob 缓存** | IndexedDB 缩略图 blob 缓存,命中免 CDN;失败回退原路径(commit e1f0dc9) | 动缩略图加载失败时 |
| **per-tag 游标(OR 合并)** | 多 tag OR=逐 tag 查询各推各的游标再按排序混排(js:904-933);上限 3 tag | 动浏览 tag 筛选时 |
| **漏斗 AND(tagAnd)** | 画廊多 tag AND=逐 tag 查询求交(js `_galleryAndPage`);站方多值 tags 只支持 OR | 动画廊 AND 语义时(已裁决不做,见禁写) |
| **心跳/CAS 续锁** | 长同步的锁续期:集合循环每轮 `heartbeat()`(fav_sync.py:124-125)+`kv_putnx` 原子占位(cache_store.py:293;commit 656e7d5) | 动同步并发/锁时 |
| **契约快照** | `tests/smoke/test_routes_contract.py` 49 端点清单;端点改动必须同步它(routes/common.py:52-67 双分支使测试免 PromptServer) | 加/改端点时 |
| **两端对齐行排版** | 画廊/节点条缩略图按宽高比贪心成行、行内等高铺满(js renderGallery flushRow;目标高=thumbSize) | 动画廊/节点缩略图布局时 |
| **熔断** | gen-data 非公开 API 失败后的短期短路(mem_lru 计数;commit 656e7d5) | 动 image_gen_data 时 |

## 2. 命名规范(可执行)

**Python(civitai_studio/ 包)**
- 模块名小写单词;routes 每域一文件,文件名=URL 域(browse/local_mod/download/favorites/media/cfg/asset_extract)。
- 端点注册只用 `_get/_post` 装饰器(routes/common.py:55-66),禁止直接摸 `PromptServer.routes`。
- 私有符号 `_` 前缀;跨模块只走公有面或显式再导出(`local_index.run_bg` 再导出 bg.run_bg;downloader 曾漏改 `_EXECUTOR` 引用翻车,commit 588b626)。
- sqlite 表名复数蛇形;新表必须声明是否 durable(cache_store.py:98,103 注释口径)。
- 测试:`tests/smoke/test_<域>.py`,自带 folder_paths 桩(test_dljobs.py:6-12),末行 `print("PASS test_<名>")`;CI 跑 `py_compile+全 smoke+node --check`(.github/workflows/ci.yml)。

**版本(契约单一事实源口径)**
- 三处同步:`civitai_studio/version.py:11` / `pyproject.toml:4` / `js:69 JS_VERSION`;release.yml 强校验 tag==VERSION。
- bump 纪律按 ~/.zcode/AGENTS.md:仅发版时 bump 且**须用户确认**;0.x 单消费者锁步;后缀只标成熟度。

**前端(js/civitai_studio_app.js,单文件 6288 行)**
- i18n:键集中在 `STR`(js:72 起,zh/en 两段),取词 `t(key, vars)`(js:474);新增文案必须双语。
- 全局状态:`S.browse / S.gal / S.favs / S.favModelIds / S.cfg / S.tagMap / S.ui`;跨函数一律走 S,禁模块级散变量。
- CSS 类 `cs-` 前缀;控件 id `cs-<域>-<名>`(如 cs-f-lv/cs-gal-fmt)。
- 弹层(菜单/多选/收藏夹选择)一律 window 捕获隔离+stopPropagation(js makeMultiSelect:5212 注释;批5/批6 实证)。
- 缩略图 URL:图片 `cdnThumb`(js:5133)、视频 `cdnVideo`(js:5143);模糊 `nsfwBitsOf+nsfwBlurCss`(js:1445)。
- 注释纪律:注释写约束/根因,不写"改了什么"(无 PR 语境);行内 `// 批N:` 历史标记允许。

**Git/文档**
- commit 正文中文,前缀标域:`batchN:`/`fix(...)`/`feat:`/`refactor:`/`audit`/`docs:`/`chore:`;BREAKING 必须前缀标明(8d08ee9 先例)。
- 核心文档=仓库根 `00_overview/01_decisions/02_topology/03_reference/09_branches`(入库);`docs/` 整体 git-ignored(审计档案/checklist 不入库,.gitignore)。
- 文档编号语义见 ~/.zcode/AGENTS.md 全局表(00 锚点件/01 账本/02 拓扑/03 手册/09 候选池)。

## 3. 时间线(B 级,git 可证)

| 日期 | 事件 | 锚点 |
|---|---|---|
| 09-22 | 立项首提交 | fcaa900 |
| 09-23 | 前两轮三方审计修复(阻塞/会话/下载完整性/路径逃逸/白名单/分页竞态) | c50b69a, bb89eb1 |
| 09-24 | **v0.6.0** 首发布 | tag v0.6.0 |
| 09-26 | 节点注册键全量迁 `CivitaiStudio_`(BREAKING);**v0.7.0** | 8d08ee9;tag v0.7.0 |
| 09-27 | 存储四阶段:媒体缓存→内嵌元数据→assocs 主存储(两阶段)→dl_jobs/tag_map 迁 sqlite durable;routes 拆包(1518 行→7 子模块,URL 零变化);js-modular 实验**负结论**(单文件强制约束) | f2ffad0/ebb0122/c909b8b+e1e6ac4/711f17b;75a5fc1;bcb6575 |
| 09-28 | 收藏引擎批1:REST favorites 退役→collections tRPC 单通道+挂载表;E2E-round1+refine R1-R3(对账门控/增量拉取/CAS/mXSS) | e98a5ab;656e7d5,a1e8f90 |
| 09-29/30 | 批4+审计轮(v0.9.0);sqlite 锁统一(同 RLock 跨模块) | e0154fe;1cbb40d |
| 10-03 | 批5-11.6 八轮 E2E 修复+同构布局/媒体类型服务端过滤;**v0.8.0 发布**(汇总 0.8.0(09-28)–0.9.13) | 067f9ab,588b626;tag v0.8.0 |
| 10-04 | full 档建档(本文件+02_topology+00/01 升级) | 01_decisions 考古区 |

## 4. 禁写事项(违者先回 01_decisions 翻案)

1. **禁编造决策理由**——01 账本只收 A/B 级证据;推不出"为什么"写"设计意图未查证"。
2. **禁 REST favorites 通道任何形式复活**(站方废弃实证,bfa30fc;09_branches 裁决留档)。
3. **禁画廊 AND 语义**(`/images` tags 单值字段 AND 必空;用户拍板移除,e0154fe)。
4. **禁前端构建链/多文件拆分**(frontend 1.52.7 unimport 限制,负结论 bcb6575)。
5. **禁新存储模块自建锁**——唯一 RLock=cache_store._LOCK:26,favorites_store 同锁先例(:25)。
6. **禁动 durable 域语义**(配额淘汰/clear_cache 不触及;assocs/dl_jobs/tag_map/fav_*)。
7. **禁对 Bookmark 集合上行**(改名/移除/建组全门控,fav_sync.py:303,381)。
8. **禁 API key 回传前端**;出站只走 civitai_client 白名单。
9. **禁改 49 端点 URL**(契约快照;加端点可以,改/删先过 01_decisions)。
10. **禁擅自 bump 版本号/打 tag**(须用户确认;AGENTS.md 版本管理规范)。
11. **禁在事件循环里做阻塞 IO**(sqlite/SHA256/大文件 → bg.run_bg/spawn)。
