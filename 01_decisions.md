# 01_decisions — 决策账本

> 时间序只追加;每条含 决策/理由/被否选项/证据等级。历史部分为逆向重建(证据=A 代码锚点/B commit);
> 自 2026-10-03 起实时追加;2026-10-04 full 档考古扩充早期区(下方"逆向考古"节,B 级为主)。

## 逆向考古(2026-09-22 ~ 09-26,project-design full 档 2026-10-04 补,证据 B=commit)

| 日期 | 决策 | 理由 | 被否选项 | 锚点(B) |
|---|---|---|---|---|
| 09-22 | 立项:单插件承载 浏览+下载+本地管理,不走独立服务 | ComfyUI 侧边栏 API 可挂 UI;用户在创作流内闭环 | 独立 web 应用 | fcaa900 首提交 |
| 09-23 | 上线前先过两轮三方审计再继续加功能 | round1 63 项(阻塞/下载完整性/路径逃逸/白名单/分页竞态)+round2 并发与旅程 | 边加功能边修 | c50b69a,bb89eb1 |
| 09-24 | v0.6.0 作为首个对外发布 | 功能主干(浏览/下载/本地库/画廊)可用 | 等收藏同步做完再发 | tag v0.6.0 |
| 09-26 | 节点注册键全量迁 `CivitaiStudio_` 前缀(BREAKING) | 通用名易与其它插件撞注册键 | 保留旧键双注册(歧义) | 8d08ee9 |
| 09-26 | v0.7.0 发布:节点四件+收藏 v1(REST) | 当时尚未知 REST favorites 已废弃 | — | tag v0.7.0 |

## 逆向重建(2026-09-27 ~ 2026-10-03)

| 日期 | 决策 | 理由 | 被否选项 | 锚点 |
|---|---|---|---|---|
| 09-27 | 本地模型身份主存储=sqlite assocs 表(durable 域),sidecar 降级为导出口径 | 外部删 sidecar 不再丢关联;DB=真值,快照补源 | 维持 sidecar 为真值 | 91545f7→e1e6ac4(两阶段,full 档考古补) |
| 09-27 | tag_map / dl_jobs 迁 sqlite durable 域(legacy JSON 只读迁移源) | 用户策展数据与任务不可被配额淘汰/清缓存触及 | 继续以 JSON 文件为准 | 816043e,acbc5e7,711f17b(full 档考古补) |
| 09-27 | routes.py(1518 行)按域拆 routes/ 包,URL 与注册面零变化 | 49 端点契约快照兜底重构;按域可维护 | 单文件+分区注释 | 75a5fc1,f85f48f(full 档考古补) |
| 09-27 | 前端维持**单文件**(多文件实验结项:负结论) | frontend 1.52.7 用 unimport 转译扩展模块,多文件触发 importModule 未定义、主模块静默失败(实测复现) | js-modular 拆分 | 54434c4,bcb6575(full 档考古补) |
| 09-27 | REST favorites 双通道退役,收藏下行唯一通道=collections tRPC | 双域实测 `?favorites=true` 被忽略(返回全站热榜)+PR #4836 源码注释 | 混用 REST 兼容旧库 | docs/research/favorites-api-research.md;commit 批1 |
| 09-28 | removeFromCollection 的 itemId=实体 id(非集合条目主键) | Civitai 源码 `CollectionItem."modelId"=$2` 实证;"Item not found" 幂等化 | 按条目主键重查 | fav_sync.py:_upsync_removals docstring |
| 09-29 | 收藏重置=全清(用户拍板 A) | 陈旧缓存锚定事故后干净的恢复路径 | 保留收藏仅清缓存 | CHANGELOG 批3;routes/favorites.py reset |
| 09-29 | Legacy 机制整体退役 | REST 通道死,哨兵清理失去存在意义 | 保留哨兵兼容存量 | CHANGELOG 批3 |
| 09-29 | 站方系统集合(mode=Bookmark)只读镜像 | Liked Models 成员由 ❤ 托管,removeFromCollection 会被拉回(实测) | 继续对其上行移除 | fav_sync Bookmark 门控;批4 CHANGELOG |
| 09-30 | 画廊/浏览四处筛选删手输框,只留下拉多选 | E2E 8b 用户拍板 | 保留自由输入 | 批4 commit |
| 09-30 | 画廊无 AND 语义 | 图片单值字段 AND 必空 | 保留降级提示 | 批4 CHANGELOG;E2E 拍板 |
| 09-30 | 服务端重试 7s 起指数退避×5 | 用户拍板"7s 起步,最多 5 次"(503 期间) | 尊重 Retry-After 2s(偏激进,未采) | civitai_client get_json;批5 |
| 10-03 | 收藏条目缓存键 v2→v3 | 强制全量重拉落地存量坏封面/.mp4 修复 | 逐条迁移脚本 | fav_sync._COLITEMS_KEY;批5 |
| 10-03 | 模糊判定源=browsingLevel 位掩码(用户建议),nsfwLevel 字符串仅回退 | 实测 browsingLevel=16 条目 nsfwLevel 显示 "X"(XXX 被并入 X,必错档) | 继续用 nsfwLevel 字符串 | 批6 commit;官方 images.md 参考 |
| 10-03 | 日志自管格式+propagate=False | 时间戳/模块归因/免 ComfyUI INFO 门,错误独立可见 | 回归根 formatter(双写+无时间戳) | log.py;0.9.2-0.9.4 |
| 10-03 | 前端日志保留大图模糊 | 用户确认"保留这个功能" | 撤销大图遮罩 | 批8 反馈 |
| 10-03 | 弹层事件 window 捕获隔离+双通道激活 | 宿主 pointerdown preventDefault 抑制 click 的规范行为(现象复现:pointerd 在流/click 不生成) | 仅加白名单(0.9.1 未根治) | 批5-批6 演进 |

## 本日新增(2026-10-03,实时)

| 日期 | 决策 | 理由 | 被否选项 | 锚点 |
|---|---|---|---|---|
| 10-03 | 补建 00_overview/09_branches/01_decisions 最小件 | 用户问"剩余可做功能",项目无核心文档;缺档协议轻依赖就地补建,09_branches 承载功能候选池 | 先补全套 02/03(当前无必要,拓扑已在 docs/repo-audit/02_architecture.md) | origin: inline@project-design;00_overview.md/09_branches.md |
| 10-03 | 路线图定为 B0 基建→B1-1 缺席对账→多用户按需 | 前端无回归网是最大工程风险;审计 legacy 中危三项均被此阻塞 | 直接开新功能批 | 09_branches.md 建议路线图 |
| 10-03 | 缩略设置暴露真实 CDN 档位(96/320/450),后端 `_snap_px` 向上吸附 | 实测档位离散:128/256 都落 320 档,标签与实际不符(用户拍板"换用真实挡位") | 保持任意宽度输入(标签误导) | config.PX_TIERS;批11.3 |
| 10-03 | 发版号取 **0.8.0**(=开发期 0.8.0(09-28)–0.9.13 全部内容) | 公开线只看 tag:v0.6→v0.7→v0.8;开发期 0.8.x/0.9.x 从未发布,编号回落对外不可见(用户拍板"按0.8.0发布") | 发 v0.9.13(公开线跳 0.8)/v0.10.0 | CHANGELOG 0.8.0 折叠节;version.py/JS_VERSION/pyproject=0.8.0;待打 tag |
| 10-03 | v0.8.0 正式发布(main 快进+CI 绿后打 tag;Release 正文用 CHANGELOG 摘要) | 用户授权"tag v0.8.0 然后 push";未来版本号遵循 ~/.zcode/AGENTS.md 版本管理规范(仅发版时 bump、bump 须用户确认、0.x 单消费者锁步、后缀只标成熟度) | 在 feat 分支直接打 tag(主线脱节) | release.yml run 37128702866;release/tag/v0.8.0 |
| 10-03 | 视频缩略取 320 档 | 不糊的最小档(96 档在 150-280px 卡面肉眼糊);与图片缩略同档;体积比 450 档 -41~-47% | 450(站方 feed 口径,偏大)/96(太糊) | js cdnVideo;批11.2 |

## 补建事由(缺档协议要求)

- `00_overview.md`:inline@project-design 2026-10-03。验收线自检:定位一句话✓ 记忆点×3✓ 核心循环✓ 硬约束✓ 范围✓ 阶段✓(全部 A 级:代码/实测/文档锚点)。
- `09_branches.md`:同上。验收线:每条含来源/价值/成本/前置✓;不做项留档✓;路线图✓。
- `02_topology.md` 未补:repo-audit/02_architecture.md 已承载同职责(模块地图+波及面),避免双源;`03_reference.md` 未补:术语/地雷散见各 docstring 与 research 文档,待积累后一次性收册。
