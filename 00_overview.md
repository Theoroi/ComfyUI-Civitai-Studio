# 00_overview — 项目总览

> origin: inline@project-design(2026-10-03,缺档协议最小锚点件)→ **project-design full 档升级**(2026-10-04:补目标用户/功能清单,证据 A=代码 file:line/B=git,推测标 C)。
> 全套文档:00 锚点件 / 01 决策账本 / 02 拓扑 / 03 参考手册 / 09 候选池。

## 定位一句话

ComfyUI 侧边栏插件:Civitai **在线浏览器 + 本地模型管理器 + 下载队列 + 收藏双向同步**,单文件前端 + sqlite 单文件存储,零外部服务依赖。

## 记忆点 ×3

1. **收藏真双向**:集合(collections tRPC)为唯一通道的收藏同步引擎——挂载级对账、墓碑终局、系统集合只读镜像(REST favorites 已实证废弃)。
2. **单文件前端**:js/civitai_studio_app.js 6288 行原生 ESM,无构建无框架(多文件在 frontend 1.52.7 下实测不可行);版本文案三处同步(version.py/pyproject/JS_VERSION)。
3. **限流工程化**:7s 起指数退避×5(尊重 Retry-After)、画廊 900ms 节流、失败保图、请求错误全量落日志(`[Civitai-Studio:模块]` 归因)。

## 目标用户

- **主用户**:在 ComfyUI 里下载/管理 Civitai 模型的个人创作者——不出 ComfyUI 完成搜模型→看生成参数→下载→入库→收藏沉淀闭环;单机单用户(多用户形态不做,见范围边界)。
- **次级**:有 Civitai 账号、重度收藏/整理资产的用户(收藏双向同步 + 本地库关联/查新);API key 持有人(key 只存服务端配置,不回传前端)。

## 核心循环

搜索/浏览(模型/画廊) → 详情(生成参数/资源链路) → 下载(断点续传+SHA256) → 本地库管理(更新检查/关联/重命名) ;收藏 ★ ↔ Civitai 账号(sync_now:下行镜像→缺席对账→上行)。

## 功能清单(从入口枚举,A 级)

- **侧边栏 5 tab**(js registerSidebarTab:6252):模型(在线浏览)/本地库/下载/收藏/设置。
- **4 节点**(nodes.py:428,`CivitaiStudio_` 注册键):ImageSearch / LoraRecipe / ShowText / SaveImage(Export with A1111 geninfo)——缩略图条选图、生成参数回读、选为输出。
- **49 个 HTTP 端点**(routes/,契约快照 test_routes_contract.py):搜索/模型/版本/画廊图片/枚举 6;本地库 10;下载 7;收藏 9;媒体(图片代理/内嵌元数据/缓存/生成数据回退)5;配置与日志 8;资产 4。
- **收藏双向同步**:集合下行镜像、缺席对账、分组上行、导出导入 v3、分级自愈(backfill_levels)。
- **本地库**:增量扫描/深扫、关联主存储(assocs 表)、重命名/移动/删除、更新检查、导入为资产。
- **下载**:断点续传(Range/206 校验)、SHA256 校验、任务持久化(杀进程恢复)、限并发 1-4。

## 硬约束

- 前端禁构建链(单文件直载,ComfyUI webview 环境;负结论 bcb6575);HTTP 出站只走 civitai 系白名单域+代理;API key 不回传前端;sqlite 单连接+全局 RLock(新增存储模块必须复用 cache_store._LOCK,cache_store.py:26)。
- 站方行为红线:系统集合(mode=Bookmark)成员由 ❤ 托管只读;REST favorites 已废弃;`/models?tag=` 单值;`/images` 需要 tag 数字 ID;nsfwLevel 字符串枚举会把 XXX 并进 X(判定用 browsingLevel 位掩码)。

## 当前阶段

v0.8.0(**已发布**(tag v0.8.0,2026-10-03);内容=开发期 0.8.0(09-28)–0.9.13(10-03) 全部批次,见 CHANGELOG 0.8.0 节;上一个公开版本 v0.7.0。未来版本号按 ~/.zcode/AGENTS.md 版本管理规范:仅发版时 bump 且须用户确认,0.x 单消费者锁步——详见 01_decisions)。功能主干完整(49 路由/4 节点/5 tab),E2E 八轮验收驱动迭代;监工审计已收口(高0/中11→修8/低25→修14,余项见 09_branches)。

## 范围边界

不做:公网部署支持(前置反代+认证)、本机加密存储(明文+权限+可吊销=E8 裁决)、游戏化/社会化功能、多 API key 与多用户(候选池 B1-2/B1-3,未排期)。
