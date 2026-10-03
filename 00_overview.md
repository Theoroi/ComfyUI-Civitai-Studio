# 00_overview — 项目总览

> origin: inline@project-design(2026-10-03,缺档协议最小锚点件;逆向 A 级证据,推测标 C)

## 定位一句话

ComfyUI 侧边栏插件:Civitai **在线浏览器 + 本地模型管理器 + 下载队列 + 收藏双向同步**,单文件前端 + sqlite 单文件存储,零外部服务依赖。

## 记忆点 ×3

1. **收藏真双向**:集合(collections tRPC)为唯一通道的收藏同步引擎——挂载级对账、墓碑终局、系统集合只读镜像(REST favorites 已实证废弃)。
2. **单文件前端**:js/civitai_studio_app.js ~5.9k 行原生 ESM,无构建无框架;改前跑 ESM 执行探针,版本文案三处同步(version.py/JS_VERSION/pyproject)。
3. **限流工程化**:7s 起指数退避×5、客户端 900ms 节流、失败保图、请求错误全量落日志(`[Civitai-Studio:模块]` 归因)。

## 核心循环

搜索/浏览(模型/画廊) → 详情(生成参数/资源链路) → 下载(断点续传+SHA256+sidecar) → 本地库管理(更新检查/关联/重命名) ;收藏 ★ ↔ Civitai 账号(sync_now:下行镜像→缺席对账→上行 toggleFavorite/saveItem/removeFromCollection)。

## 硬约束

- 前端禁构建链(单文件直载,ComfyUI webview 环境);HTTP 出站只走 civitai 系白名单域+代理;API key 不回传前端;sqlite 单连接+全局 RLock(新增存储模块必须复用 cache_store._LOCK)。
- 站方行为红线:系统集合(mode=Bookmark)成员由 ❤ 托管只读;REST favorites 已废弃;`/models?tag=` 单值;`/images` 需要 tag 数字 ID;nsfwLevel 字符串枚举会把 XXX 并进 X(判定用 browsingLevel 位掩码)。

## 当前阶段

v0.9.13(开发中版本序列 0.8→0.9.x 逐批递增,正式发版从 v0.7.0 之后尚未打 tag——详见 01_decisions)。功能主干完整(48+1 路由/4 节点/5 tab),E2E 八轮验收驱动迭代;监工审计已收口(高0/中11→修8/低25→修14,余项见 09_branches)。

## 范围边界

不做:公网部署支持(前置反代+认证)、本机加密存储(明文+权限+可吊销=E8 裁决)、游戏化/社会化功能。
