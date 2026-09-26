# Changelog

格式参照 Keep a Changelog;项目版本号见 `pyproject.toml` 与 `civitai_studio/version.py`。

## [Unreleased]

### 新增
- 【导入为资产】：大图浮层一键把原始图片下载到 `input/civitai_import/`（LoadImage 可直接选用，文件内嵌的工作流随文件可用），命名 `civitai_<id>`；重复导入按 SHA256 幂等跳过，同 id 内容不同自动递增 `civitai_<id>_x`
- 【提取工作流】：大图浮层一键解析原文件内嵌的 ComfyUI 工作流（PNG tEXt/iTXt、MP4 mdta），存为用户工作流 `workflows/civitai_studio/extract_<id>.json`。防泛滥：提取进子目录（模板浏览器的列表是非递归 glob，实测不会涌入模板列表）、按图片 id 幂等覆盖不膨胀、收藏夹 tab 内「提取管理」面板（列表/删除）、超 300 个提醒清理
- 完整收藏系统：收藏夹独立 tab（顶栏★，内分「资产」「模型」两类；分组/未分组过滤、逐条分组分配、搜索；同步/导入/导出按钮）。与 Civitai 账号收藏**双向同步**——图片收藏走 REST 读取（`?favorites=true`），模型收藏读写双向（写走 tRPC `user.toggleFavorite`，**需 API Key 勾选 SocialWrite 作用域**，缺失时同步结果内提示），Civitai 集合 ↔ 本地分组对齐（tRPC collection.*）；冲突按**最新修改时间覆盖**（本地未同步改动优先；本地取消为永久否决——网页端重新收藏不会自动回到本地，须本地重新 ★）；设置页可开「自动同步」（打开收藏夹时触发，30 分钟节流）。图片收藏的本地→远端方向官方无端点，暂只支持远端→本地
- 收藏数据迁移至 sqlite（`fav_items`/`fav_groups` 表，含墓碑与脏标记；旧 favorites.json 首启自动迁移，旧文件只读保留）；支持导入/导出 JSON（导出含分组与墓碑，导入可选整库替换——当前默认合并）
- 收藏入口扩展：**图像搜索节点缩略图左上角★**、大图浮层「★ 收藏」按钮（原画廊★保留，全入口状态即时互通）
- 存储系统阶段 4（内嵌生成数据）：解析本地图片/视频内嵌的生成参数（PNG tEXt/iTXt、MP4 mdta——REST 对部分条目脱敏，靠文件内嵌可恢复 prompt/workflow/参数），结果按 mtime/size 缓存于 sqlite（文件不变永久命中）；MP4 流式定位 moov，不整读大视频；新端点 `POST /civitai_studio/embedded_meta`（收 `{path}`，限 output/input/temp 与已注册模型目录；为「提取工作流/导入为资产」打底）
- 存储系统阶段 3（媒体缓存）：proxy_images 中转的图片/视频落服务端磁盘缓存（user 目录 cache/media，计入缓存上限，最旧优先自动淘汰；命中支持 Range，视频拖动不整段重拉）
- 画廊快照（IndexedDB）：页面重载/重启后重开画廊立即显示上次内容与筛选（上限 240 条、30 天有效期），切入时后台静默刷新，数据变化才无感重排
- 存储系统阶段 2（API 缓存层）：同 key 并发回源只打一次（singleflight）；模型详情与版本数据加磁盘 SWR——重启后 6h 内免回源直接可用，过期先回旧值再后台刷新；images 搜索页 60s 内存缓存（不落盘）；站方枚举磁盘缓存 24h；本地更新检查与下载元数据解析统一走缓存（面板二次打开零回源，API 回源次数大幅下降）
- 存储系统阶段 1（设计见 docs/cache-design.md）：统一磁盘缓存层 `cache_store`（sqlite/WAL，user 目录 `cache/cache.sqlite`，损坏自动重建）；本地索引 mtime/size 指纹增量化——未变文件不再重读 sidecar，重启后索引立即可用，二次扫描从全盘读文件降为目录列表
- 设置页：磁盘缓存上限（50-2000MB，默认 500）、缓存占用实时显示、「清空缓存」（kv+指纹清空后立即重建索引）与「深度重扫」（手动改过 sidecar 后的全量兜底）
- 管理端点：`GET /civitai_studio/cache_usage`、`POST /civitai_studio/cache_clear`、`POST /civitai_studio/local/deep_rescan`；`/local/models` 响应新增 `scan_stats`（total/reused/read/dur）
- 画廊收藏（轻量版）：条目★一键收藏/取消（user 目录 favorites.json 持久化，上限 5000），「★只看收藏」过滤
- Export with A1111 geninfo 节点新增 IMAGE 直通输出（存完图可继续喂给下个节点，对齐原生 SaveImage）
- 支持 `CIVITAI_API_KEY` 环境变量兜底：设置页未配置 key 时自动读取（云部署/容器场景）

### 变更
- 下载队列持久化文件迁至 `user/civitai_studio/cache/download_jobs.json`（旧位置文件只读兜底，升级首启自动读取）
- sidecar 写入（关联/刷新元数据）后自动作废对应指纹，下次扫描强制重读
- 共享后台线程池抽为 `bg.py`（2→4 线程，sqlite 缓存 IO 与扫描/哈希共用）；`prime_model_cache` 回填同时落磁盘缓存
- 「清空缓存」改为穿透全部层（内存缓存 + sqlite kv/指纹 + 重建索引）；磁盘 SWR 语义提示：数据过期后先回旧值（最长 7 天窗口）并后台刷新，模型名/版本信息的服务端改动最迟数小时内在后台生效，「刷新元数据」按钮始终绕缓存取最新
- 「Civitai 保存图片」节点显示名改为「Export with A1111 geninfo」,并补充搜索别名
- **BREAKING**:全部节点注册键迁移到 `CivitaiStudio_` 前缀(`CivitaiStudio_ImageSearch / _LoraRecipe / _ShowText / _SaveImage`)——**旧工作流里的节点会显示缺失,需重新摆放节点**;显示名不变
- API key 读取统一走 `civitai_client.api_key()`（设置页优先 → 环境变量兜底），涉及请求头/下载 token/401 提示三处

### 清理
- 移除死代码 `_recent_image_ids()`、`used_url` 死变量、`_slot()` 重复 global 声明

## [0.7.0] - 2026-09-26

### 新增
- 下载:失败/已取消任务可「重试(续传)」,断点 .part 自动命中续传;队列持久化到用户目录,重启后恢复任务列表,中断任务标记原因并支持断点重试
- 下载对话框:模型类型可手动覆盖;新增「实例」范围(共享目录 / 本实例 / 所有实例)与目标目录三级联动;文件下拉标注除 format 外的 metadata(类型/精度/裁剪/主文件)
- 下载完成后:「查看本地文件」(资源管理器选中文件)与「本地库」(切页+预填搜索)
- 本地库:「移动」到其它已注册目录(类型/实例/目录选择,.civitai.json 随迁,同名自动排重);「定位」改为资源管理器选中文件(原实现只开文件夹)
- 浮层导航:大图/模型页/所有弹窗统一左上角「返回」——从信息页跳来的返回上一页(来源页隐藏保活,状态原样还原),直接打开的等同关闭;✕/Esc 整链销毁不留隐藏僵尸;开始下载后不跳下载页,返回来源页
- 图像:条目带 modelVersionIds 时不再显示黄(Lora)/绿(底模)缺失角标

### 变更
- 浏览/画廊底模筛选与信息面板 image id 输入改用自绘补全组件(可自由输入 + ComfyUI 原生观感弹层,替代浏览器 datalist 私样式)
- 图像搜索节点:`base_model` 输出更名 `local_checkpoint`——解析本地已安装 checkpoint 文件名(原实现直接输出 Civitai 底模名,连线加载器必报错)
- 三色缺失角标 title 补充「仅检测常见字段,缺失≠真缺」语义
- 模型详情切换 `/models?ids=` 查询端点(与网页版同源,文件名可读),文件名尾部文件 ID 段用 `metadata.fp` 还原显示与默认保存名

### 修复
- 图像搜索节点:`thumbs_size→thumbs_height` 半截改名导致的执行 TypeError;缩略图行高不再随节点宽度变化,恒等于 thumbs_height;节点上冗余 image_id 参数行隐藏(值由信息面板输入行/「选为输出」维护)
- 本地库「定位」无效(旧实现只打开文件夹不选中文件)
- 下载实例归类按路径名猜测导致 ComfyUI-Shared 档目标目录为空(改为按 `folder_paths.base_path` 归类)
- 短暂引入又撤销的缩略图区自适应(与节点高度贴合逻辑正反馈,会把节点撑长)

## [0.6.0] 及更早

见 git 历史(`git log --oneline`)。
