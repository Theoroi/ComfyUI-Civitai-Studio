# ComfyUI Civitai Studio

ComfyUI 侧边栏插件:Civitai **在线浏览器 + 本地模型管理器 + 下载队列**。搜索 Civitai 上的模型直接下载进 ComfyUI 模型目录,跟踪已安装版本、检查更新、删除/定位本地文件。

> 灵感来自 [ComfyUI-Civitai-Toolkit](https://github.com/BAIKEMARK/ComfyUI-Civitai-Toolkit)(MIT)与其实践脚本 `civitai_pull.py`,为其重写的轻量版:不需要数据库、不需要哈希全库扫描,新增**真实下载队列(断点续传 + SHA256 校验)**。

## 功能

- **🌐 浏览**:搜索 Civitai 模型(类型 / 底模 / 排序 / 时间范围 / NSFW 分级过滤),无限滚动;卡片标记「已安装」;详情页含版本切换、触发词、文件列表、预览图画廊,点预览图可看生成参数(提示词 / 采样器 / Seed / 资源列表,一键复制)。
- **⬇ 下载**:选目标目录(自动按模型类型映射到 checkpoints / loras / vae / controlnet 等注册目录)+ 子文件夹 + 文件名;串行/并发队列、实时速度、**断点续传**、下载后 **SHA256 校验**(可关),完成后自动写 `<模型文件名>.civitai.json` 元数据(含 version_id / 触发词 / hash)。
- **📁 本地库**:按目录分类扫描所有本地模型,搜索、定位(打开资源管理器)、删除(带确认)、**检查更新**(基于 sidecar 里的 version_id 与 Civitai 最新版对比,不用哈希大文件),新版本一键回填同目录下载。
- **⚙ 设置**:API Key、HTTP 代理、API 站点、下载并发数、图片中转开关、SHA256 校验开关(NSFW 档位在浏览页过滤器选择,自动记住)。

## 兼容性

- 需要 ComfyUI 前端支持 `extensionManager.registerSidebarTab`(2024-07 之后的前端均可;实测 **ComfyUI 0.37.0 / 前端 1.52.7**)。
- 纯 UI 插件,无自定义节点;Python 依赖 `aiohttp`(ComfyUI 自带)+ `aiohttp-socks`(发布包默认安装;代码未装该库也能运行,仅 SOCKS 代理不可用并会提示)。

## 安装

```bash
cd <ComfyUI>/custom_nodes
git clone <本仓库> ComfyUI-Civitai-Studio
```

重启 ComfyUI,左侧边栏出现 **Civitai** 图标(pi-images)。

## 使用

1. 侧边栏打开「Civitai」→ 🌐 浏览 搜索模型 → 点卡片进详情 → 文件旁「⬇ 下载」。
2. 弹窗选目标目录(默认按类型映射,可改)→ 开始下载 → 自动跳到「下载」页看进度。
3. 「本地库」页管理已装模型:检查更新 / 定位 / 删除。

### 网络问题(国内用户)

- **默认 API 站点为 `civitai.red`**(参考上游 Toolkit 仓库的 `civitai_pull.py` 实践):API 与下载端点齐全,基本不被 Cloudflare 拦截;被拦时可在设置里改回 `https://civitai.com`。
- 设置里可配 **HTTP 或 SOCKS5 代理**:`http://127.0.0.1:10808`(v2rayN 混合端口)、`socks5://127.0.0.1:10808`,裸地址自动按 HTTP 处理,`localhost` 自动换成 `127.0.0.1`。API、下载、预览图全部走后端,代理对整条链路生效。
- SOCKS 支持依赖 `aiohttp-socks`(requirements.txt 已声明;未安装时 HTTP 代理仍可用,SOCKS 会给出安装提示)。
- 偶发「返回网页而非 JSON」= 代理出口 IP 被 Cloudflare 挑战,插件会自动重建连接重试 3 次;仍失败就换个节点。
- 搜索/详情 30s 超时;下载不限总时长(仅限单次读取卡死 90s),支持断点续传。

### API Key

在 [civitai.com/user/account](https://civitai.com/user/account) 生成,设置页粘贴保存。用于下载需要登录的模型、查看 NSFW 内容、提高 API 限额。仅明文保存在本机 `<user_dir>/civitai_studio/config.json`。

注意:**API Key 只下发给官方域(civitai.com / civitai.green)**;默认站点 civitai.red 等镜像不认 civitai.com 的 Key,带了 Bearer 头会被拒成 403(实测),因此自动不下发。

## 数据位置

- 配置:`<ComfyUI>/user/civitai_studio/config.json`
- 模型元数据:模型文件旁的 `<文件名>.civitai.json`(可随文件一起移动/分享)
- 下载临时文件:`<目标目录>/xxx.<哈希>.part`(断点续传,失败可手动删除所有 `.part` 结尾文件)

## 与 Civitai-Toolkit 的差异

| | 本插件 | Civitai-Toolkit |
|---|---|---|
| 模型下载 | ✅ 队列 + 续传 + 校验 | ❌ 仅外链 |
| 已安装识别 | sidecar JSON(零开销) | SQLite + 全库 SHA256 |
| Civitai 请求 | 服务端代理(统一代理/鉴权) | 浏览器直连 |
| 依赖 | 无 | 无(SQLite 内置) |

## 卸载

删除 `custom_nodes/ComfyUI-Civitai-Studio` 目录即可;配置文件在 `user/civitai_studio/`,可一并删除。

## License

MIT
