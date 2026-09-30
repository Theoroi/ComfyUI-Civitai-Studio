# ComfyUI Civitai Studio

ComfyUI 侧边栏插件:Civitai **在线浏览器 + 本地模型管理器 + 下载队列**。搜索 Civitai 上的模型直接下载进 ComfyUI 模型目录,跟踪已安装版本、检查更新、删除/定位本地文件。

> 灵感来自 [ComfyUI-Civitai-Toolkit](https://github.com/BAIKEMARK/ComfyUI-Civitai-Toolkit)(MIT)与非公开实践脚本 `civitai_pull.py`,为其重写的轻量版:无外部数据库依赖(本地 sqlite 单文件自动管理)、不需要哈希全库扫描,新增**真实下载队列(断点续传 + SHA256 校验)**。

[English](README_EN.md) | **中文**

**目录**:[功能](#功能) · [兼容性](#兼容性) · [安装](#安装) · [使用](#使用) · [网络问题](#网络问题国内用户) · [API Key](#api-key) · [数据位置](#数据位置) · [卸载](#卸载) · [License](#license)

## 功能

- **🌐 浏览**:搜索 Civitai 模型(类型 / 底模 / 排序 / 时间范围 / NSFW 分级过滤),无限滚动;卡片标记「已安装」;详情页含版本切换、触发词、文件列表、预览图画廊,点预览图可看生成参数(提示词 / 采样器 / Seed / 资源列表,一键复制)。
- **⬇ 下载**:选目标目录(自动按模型类型映射到 checkpoints / loras / vae / controlnet 等注册目录)+ 子文件夹 + 文件名;串行/并发队列、实时速度、**断点续传**、下载后 **SHA256 校验**(可关),完成后自动写 `<模型文件名>.civitai.json` 元数据(含 version_id / 触发词 / hash)。
- **📁 本地库**:按目录分类扫描所有本地模型,搜索、定位(打开资源管理器)、删除(带确认)、**检查更新**(基于 sidecar 里的 version_id 与 Civitai 最新版对比,不用哈希大文件),新版本一键回填同目录下载;**重命名**(同步 sidecar);**展开详情**(封面/元数据/触发词/说明/文件列表/Model ID 与 Version ID 复制/刷新元数据);**手动关联**未关联模型(按文件名智能搜索或粘贴链接,点选版本确认)。
- **⚙ 设置**:API Key、HTTP 代理、API 站点、下载并发数、图片中转开关、SHA256 校验开关、说明落盘开关(默认关)、Tag 自动补全开关(默认开)、收藏自动同步、磁盘缓存上限(50-2000MB)+清空缓存/深度重扫。
- **🧩 工作流节点**:Civitai 图片搜索(缩略图点选,输出 positive / negative / trigger_words / local_checkpoint / image)、LoRA 配方、显示文本、Export with A1111 geninfo(IMAGE 直通);最小验证工作流见 `examples/image_search_verify.json`,拖入画布即可验证输出。
- **🖼 画廊**:全站图片流,按 底模 / NSFW / Tag / 时间 / 格式 筛选,排序含六种(最新/最早/最多互动/最多评论/最多收藏/随机),六快捷预设;卡片带文件格式角标;大图悬浮层含生成参数、分类标签与许可徽章,无生成参数的图自动回退站方非公开接口补底模/LoRA 链路(点击复制 ID)。
- **★ 收藏**:收藏夹独立 tab(资产/模型两类,分组管理、排序、搜索),与 Civitai 账号**双向同步**——模型收藏读写双向(需 Key 勾选 SocialWrite),集合(collections)与本地分组对齐(需 CollectionsRead/Write),图片收藏以集合为准。
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
- 搜索/详情 30s 超时;下载不限总时长(仅限单次读取卡死 90s),支持断点续传。

### API Key

在 [civitai.com/user/account](https://civitai.com/user/account) 生成,设置页粘贴保存。用于下载需要登录的模型、查看 NSFW 内容、提高 API 限额。仅明文保存在本机 `<user_dir>/civitai_studio/config.json`。

注意:**API Key 会下发给 civitai 系域(civitai.com / civitai.green,以及自配镜像 civitai.red)**,镜像同样接受 civitai.com 签发的 Bearer Key(2026-09 实测);不希望 Key 发往镜像的话,请留空 API Key 或不自配镜像。下载遇到 401/403 时,插件会自动依次尝试带 token 与官方域换源。

## 数据位置

- 配置:`<ComfyUI>/user/civitai_studio/config.json`
- 模型元数据:模型文件旁的 `<文件名>.civitai.json`(可随文件一起移动/分享)。开启「说明落盘」后额外包含 `description_html`(截断至 51200 字符)/`tags`/`cover_url`,离线也能看详情;本地库详情区提供「刷新元数据」重写。
- 下载临时文件:`<目标目录>/xxx.<哈希>.part`(断点续传,失败可手动删除所有 `.part` 结尾文件)
- 缓存与队列:`<ComfyUI>/user/civitai_studio/cache/`(cache.sqlite:指纹/收藏/关联/下载任务;media/:图片中转缓存,计入缓存上限)

## 卸载

删除 `custom_nodes/ComfyUI-Civitai-Studio` 目录即可;配置文件在 `user/civitai_studio/`,可一并删除。

## License

MIT
