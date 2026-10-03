# 01_decisions — 决策账本

> 时间序只追加;每条含 决策/理由/被否选项。历史部分(批1-批8)为逆向重建(证据=commit/文档锚点,A 级);
> 自 2026-10-03 起实时追加。

## 逆向重建(2026-09-27 ~ 2026-10-03)

| 日期 | 决策 | 理由 | 被否选项 | 锚点 |
|---|---|---|---|---|
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

## 补建事由(缺档协议要求)

- `00_overview.md`:inline@project-design 2026-10-03。验收线自检:定位一句话✓ 记忆点×3✓ 核心循环✓ 硬约束✓ 范围✓ 阶段✓(全部 A 级:代码/实测/文档锚点)。
- `09_branches.md`:同上。验收线:每条含来源/价值/成本/前置✓;不做项留档✓;路线图✓。
- `02_topology.md` 未补:repo-audit/02_architecture.md 已承载同职责(模块地图+波及面),避免双源;`03_reference.md` 未补:术语/地雷散见各 docstring 与 research 文档,待积累后一次性收册。
