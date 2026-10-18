# ComfyUI Civitai Studio

ComfyUI 侧边栏插件:Civitai **在线浏览器 + 本地模型管理器 + 下载队列**。搜索 Civitai 上的模型直接下载进 ComfyUI 模型目录,跟踪已安装版本、检查更新、删除/定位本地文件。

> 灵感来自 [ComfyUI-Civitai-Toolkit](https://github.com/BAIKEMARK/ComfyUI-Civitai-Toolkit)(MIT)与非公开实践脚本 `civitai_pull.py`,为其重写的轻量版:无外部数据库依赖(本地 sqlite 单文件自动管理)、不需要哈希全库扫描,新增**真实下载队列(断点续传 + SHA256 校验)**。

[English](README_EN.md) | **中文**

**目录**:[功能](#功能) · [兼容性](#兼容性) · [安装](#安装) · [使用](#使用) · [网络问题](#网络问题国内用户) · [API Key](#api-key) · [数据位置](#数据位置) · [卸载](#卸载) · [License](#license)

## 功能

- **🌐 浏览**:搜索 Civitai 模型(类型 / 底模 / 排序 / 时间范围 / NSFW 分级多选 / 隐藏需付费),无限滚动;卡片标记「已安装」,封面按模型分级模糊,**悬停轮播**(换图间隔可设,开播预载 ≤8 张,切到视频自动播放可关);卡片尺寸四档(迷你/小/中/大);筛选面板与画廊同构;详情页含版本切换、触发词、文件列表、预览图画廊,点预览图可看生成参数(提示词 / 采样器 / Seed / 资源列表,一键复制)。
- **⬇ 下载**:选目标目录(自动按模型类型映射到 checkpoints / loras / vae / controlnet 等注册目录)+ 子文件夹 + 文件名;串行/并发队列、实时速度、**断点续传**、下载后 **SHA256 校验**(可关);完成后模型元数据(版本 / 触发词 / hash)自动写入本地库,**不再生成 `.civitai.json` 伴随文件**(v0.8.0 起退役)。
- **📁 本地库**:按目录分类扫描所有本地模型,搜索、定位(资源管理器选中文件)、删除(带确认)、**检查更新**(基于库内记录的 version_id 与 Civitai 最新版对比,不用哈希大文件),新版本一键回填同目录下载;**重命名**与**移动**(元数据在库内,无伴随文件需迁移);**展开详情**(封面/元数据/触发词/说明/文件列表/Model ID 与 Version ID 复制/刷新元数据);**手动关联**未关联模型(按文件名智能搜索或粘贴链接,点选版本确认)。
- **⚙ 设置**:六个折叠组——🔑账户与连接(API Key / 站点镜像 / HTTP·SOCKS5 代理 / 预览图中转)/ 🧩模型(缩略图真实 CDN 档位 96/320/450、悬停轮播间隔与视频自动播放)/ ⬇下载(并发数 / SHA256 校验)/ 💾存储与缓存(磁盘缓存上限 50-2000MB + 清空缓存 / 深度重扫)/ 🧪实验(收藏同步总闸、收藏自动同步、Tag 抓取、生成参数回退——非公开 API 能力集中此组)/ 日志(调试日志、时间戳前缀)。
- **🧩 工作流节点**:Civitai 图片搜索(缩略图点选,tag 筛选支持数字 ID 多选与节点级 OR/AND 语义切换,输出 positive / negative / trigger_words / local_checkpoint / image)、LoRA 配方、显示文本、Export with A1111 geninfo(IMAGE 直通);最小验证工作流见 `examples/image_search_verify.json`,拖入画布即可验证输出。
- **🖼 画廊**:全站图片流,按 底模 / Tag / 时间 / NSFW 分级多选 / 媒体类型(图像|视频,服务端过滤) 筛选,排序含六种(最新/最早/最多互动/最多评论/最多收藏/随机),六快捷预设;卡片带文件格式角标;重开面板自动恢复上次内容与筛选;大图悬浮层含生成参数、分类标签与许可徽章,无生成参数的图自动回退站方非公开接口补底模/LoRA 链路(点击复制 ID),悬浮详情/弹窗右缘可拖拽调宽(自动记忆)。
- **👁 NSFW 遮罩**:顶栏 👁 按分级勾选打码(PG/PG-13/R/X/XXX,默认遮 X/XXX,悬停临时清晰);覆盖模型封面、画廊/收藏网格、节点缩略图与大图浮层。
- **★ 收藏**:收藏夹独立 tab(资产/模型两类,分组管理、排序、搜索),与 Civitai 账号**双向同步**——模型收藏读写双向(需 Key 勾选 SocialWrite),集合(collections)与本地分组对齐(需 CollectionsRead/Write),图片收藏以集合为准;站方系统集合(如 Liked Models)只读镜像;条目分级随库记忆(遮罩体验导入即还原),支持 JSON 导入/导出。手动「同步」**强制全量枚举**,网页端刚保存的条目立即可见;自动同步走增量(站方集合列表有分钟级缓存滞后,新建集合需数分钟追上,已知边界)。
- **🏷 Tag 工具**:图片页分类标签抓取(id+名称),自动累积到本地 `tag_mapping.json` 供筛选与联想。

## 兼容性

- 需要 ComfyUI 前端支持 `extensionManager.registerSidebarTab`(2024-07 之后的前端均可;实测 **ComfyUI 0.37.0 / 前端 1.52.7**)。
- 内置 4 个自定义节点(图片搜索 / LoRA 配方 / 显示文本 / Export with A1111 geninfo,详见 `examples/image_search_verify.json`);Python 依赖 `aiohttp`(ComfyUI 自带)+ `aiohttp-socks`(发布包默认安装;代码未装该库也能运行,仅 SOCKS 代理不可用并会提示)。

## 安装

```bash
cd <ComfyUI>/custom_nodes
git clone <本仓库> ComfyUI-Civitai-Studio
```

重启 ComfyUI,左侧边栏出现 **Civitai** 图标(pi-images)。

## 使用

1. 侧边栏打开「Civitai」→ 🌐 浏览 搜索模型 → 点卡片进详情 → 文件旁「⬇ 下载」。
2. 弹窗选目标目录(默认按类型映射,可改)→ 开始下载 → 自动跳到「下载」页看进度。
3. 「本地库」页管理已装模型:检查更新 / 详情 / 关联 / 重命名 / 定位 / 删除。

### 网络问题(国内用户)

- **默认 API 站点为 `https://civitai.com`**;被 Cloudflare 拦截时,可在设置里把「API 站点」改为镜像 `https://civitai.red`(API 与下载端点齐全,基本不被 Cloudflare 拦截)。
- 设置里可配 **HTTP 或 SOCKS5 代理**:裸地址自动按 HTTP 处理,`localhost` 自动换成 `127.0.0.1`。API、下载、预览图全部走后端,代理对整条链路生效。
- SOCKS 支持依赖 `aiohttp-socks`(requirements.txt 已声明;未安装时 HTTP 代理仍可用,SOCKS 会给出安装提示)。
- 偶发「返回网页而非 JSON」= 代理出口 IP 被 Cloudflare 挑战,插件会自动重建连接重试 3 次;仍失败就换个节点。
- 站方过载(503)时自动指数退避重试 5 次(0.5/1/2/4/8s,站方 Retry-After 更大则从其);画廊另有 900ms 客户端节流与失败保图(不清屏,错误横幅可点击重试)。
- 搜索/详情 30s 超时;下载不限总时长(仅限单次读取卡死 90s),支持断点续传。

### API Key

在 [civitai.com/user/account](https://civitai.com/user/account) 生成,设置页粘贴保存。用于下载需要登录的模型、查看 NSFW 内容、提高 API 限额。仅明文保存在本机 `<user_dir>/civitai_studio/config.json`。

注意:**API Key 会下发给 civitai 系域(civitai.com / civitai.green,以及自配镜像 civitai.red)**,镜像同样接受 civitai.com 签发的 Bearer Key(2026-09 实测);不希望 Key 发往镜像的话,请留空 API Key 或不自配镜像。下载遇到 401/403 时,插件会自动依次尝试带 token 与官方域换源。

## 数据位置

- 配置:`<ComfyUI>/user/civitai_studio/config.json`
- 模型元数据:存于本地 sqlite(见下),**不再生成**模型文件旁的 `<文件名>.civitai.json` 伴随文件(v0.8.0 起退役);旧版本生成的遗留文件可手动删除,重命名模型时会自动清理。
- 下载临时文件:`<目标目录>/xxx.<哈希>.part`(断点续传,失败可手动删除所有 `.part` 结尾文件)
- 缓存与队列:`<ComfyUI>/user/civitai_studio/cache/`(cache.sqlite:指纹/收藏与分组/本地库关联/下载任务;media/:图片中转缓存,计入缓存上限)

## 卸载

删除 `custom_nodes/ComfyUI-Civitai-Studio` 目录即可;配置文件在 `user/civitai_studio/`,可一并删除。

## License

MIT
