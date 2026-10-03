# 09_branches — 功能候选池(剩余可做清单)

> origin: inline@project-design(2026-10-03)。来源:repo-audit legacy.md / docs/design/absence-reconciliation.md /
> docs/plans/multi-user-multi-key.md / 八轮 E2E 已知边界 / 会话沉淀。每条含 来源/价值/成本估/前置。
> 成本:S=半天内 M=1-2 天 L=3 天+。开工顺序建议见末节路线图。

## P0 基建前置(下个功能批次的第 0 步)

| # | 项 | 来源 | 价值 | 成本 | 前置 |
|---|---|---|---|---|---|
| B0-1 | 前端重复抽取×3:popupAt 弹层工厂 / 对话框目录选择构件 / mergePage 翻页合并 | audit 中危 F-S1-7/8/10 | 消除三处行为分叉温床;新功能不再复制粘贴 | M | 无 |
| B0-2 | ESM 级交互探针(弹层开关/菜单激活/翻页) | audit 结论"前端无回归网" | 前端改动可自动验收,解冻大重构 | M | B0-1 同批 |
| ~~B0-3~~ **已完成(实查校正)** | CI 工作流实际已存在:`ci.yml`(smoke 14 文件 + py_compile + node --check,py3.10/3.13 矩阵)、`release.yml`(tag 触发打包 zip 发 Release,校验 tag==version.py) | 原条目"仓库无工作流"是未查证的失真记录 | 余项:ESM 探针并入 CI(随 B0-2 一起) | S | 无 |

## P1 已设计待实现(方案已定稿,直接开工)

| # | 项 | 来源 | 价值 | 成本 | 前置 |
|---|---|---|---|---|---|
| B1-1 | 缺席对账(条目级两轮确认+嫌疑标记+分组级终局) | docs/design/absence-reconciliation.md 全套方案 | 站方删除/清空集合后本地不再永久滞留孤儿 | M | **先实测**:保守浏览级别账号拉 XXX 集合看枚举是否缩水(方案 3.2-2 风险从推测变实测) |
| B1-2 | 多 API key 管理(命名/切换/权限徽章/旧字段迁移) | docs/plans/multi-user-multi-key.md G1 | 个人号/服务号/只读号分用 | M-L | 该计划文档排期 |
| B1-3 | 多用户部署加固(下载队列 owner 越权 G2/认证覆盖实测 G3/配额总控 G4/key 明文传输指引 G5) | 同上 G2-G5 | --multi-user 形态可用 | L | B1-2(队列 owner 跟随 key 归属) |

## P2 功能增强候选(按需排期)

| # | 项 | 来源 | 价值 | 成本 | 前置 |
|---|---|---|---|---|---|
| B2-1 | 批量更新检查恢复(js runUpdateCheck 批量分支故意暂停中,js:3943 附近) | audit F-S1-6 | 本地库一键全量查新 | S | 真机验证 |
| B2-2 | 节点大图浮层分级角标/遮罩开关 | E2E 已知边界(浮层属主动查看,历史口径无遮罩) | 一致性;避免"网格模糊点开裸奔"观感 | S | 口径确认 |
| B2-3 | tag 管理页(tag_mapping.json 可视化:检索/改名映射/清除失效) | 会话沉淀(tagMap 已是筛选/联想核心资产) | 长期使用后的映射治理 | M | 无 |
| B2-4 | 下载队列优先级/暂停整队/按类型过滤 | 会话沉淀(队列只有取消/重试) | 批量下载体验 | M | 无 |
| B2-5 | 收藏导出格式 v3(含 extra 分级/browsingLevel,导入即还原遮罩体验) | 批8 分级补拉后导出仍缺分级 | 备份完整性 | S | 无 |
| B2-6 | 画廊/模型页"已加载"本地书签(记住上次浏览位置) | F-S1-3 删除 scrollTop 时剥离的功能 | 重开面板回到原位 | S | B0-1(顺手) |

## P3 技术债(低危,遇到再顺手)

| # | 项 | 来源 |
|---|---|---|
| B3-1 | videoThumbEl 工厂(视频首帧属性块×5) | audit F-S1-11 |
| B3-2 | 封面失败重试统一 attachCoverErrorHandler(版本预览图失败直接消失的分叉) | audit F-S1-12 |
| B3-3 | loadFavView≈loadFavDataOnly 合并 | audit F-S1-13 |
| B3-4 | BASE_MODELS/period 词表单源(后端 /enums 已可全量供给) | audit F-S1-14 |
| B3-5 | assignGroups 封装(四连重复) | audit F-S1-15 |
| B3-6 | confirmModal 统一(组删除/重置仍用原生 confirm) | audit F-S1-16 |
| B3-7 | fav_sync 全面 run_bg 化(sqlite 写离开事件循环线程) | audit F-S2-3(性能非正确性) |
| B3-8 | kv_cas 原语(心跳 CAS 原子化)+_enforce_quota 豁免 fav:sync_inflight | audit W1-F1/F2 |
| B3-9 | 顺手项:asset_extract.py:43 过时注释更新(aiohttp 会剥离跨域 Authorization) | audit 否决记录 |

## 不做(裁决留档)

- 公网暴露支持、本机加密(multi-user 计划 E8/E9 裁决);REST favorites 任何形式复活(站方废弃实证);画廊 AND 语义(单值字段必空,用户拍板移除)。

## 建议路线图

1. **下批开工 = B0-1/B0-2 两件**(前端抽取 + ESM 探针,约 2 天;CI 已存在,余项=探针入 CI)——此后每个功能批都有回归网;
2. **随后 B1-1**(缺席对账,M)——先做站方 NSFW 过滤实测,方案文档已就绪;
3. **多用户需求提上日程时** B1-2→B1-3 连做(同文档同域);
4. P2 按使用痛点插队,B3 永远"遇到顺手修"。
