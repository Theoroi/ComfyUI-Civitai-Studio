# Changelog

格式参照 Keep a Changelog;项目版本号见 `pyproject.toml` 与 `civitai_studio/version.py`。

## [Unreleased]

### 变更
- 「Civitai 保存图片」节点显示名改为「Export with A1111 geninfo」,并补充搜索别名
- **BREAKING**:全部节点注册键迁移到 `CivitaiStudio_` 前缀(`CivitaiStudio_ImageSearch / _LoraRecipe / _ShowText / _SaveImage`)——**旧工作流里的节点会显示缺失,需重新摆放节点**;显示名不变

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
