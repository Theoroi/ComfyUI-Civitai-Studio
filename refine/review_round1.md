# Refine Round 1 — 2026-09-22

## 评测维度与指标

| 维度 | 指标 |
|---|---|
| 正确性/健壮性 | 逻辑错误数、竞态数、错误路径可用性;网络层全部异常须翻译为可操作中文提示 |
| 前端正确性/UX | 状态机 bug 数、转义覆盖率(远端数据进 HTML 必须 esc/sanitize)、监听器零泄漏 |
| 安全 | 路径逃逸=0、白名单绕过=0、开放重定向=0、密钥不出本机信任域 |
| 完整度/工程 | 文档与行为一致、打包元数据正确、依赖声明与安装通道一致 |

## 评审(3 个并行只读 agent)

- 后端正确性:29 条(高 3 / 中 6 / 低 20)
- 前端:20 条(高 2 / 中 8 / 低 10)
- 安全+工程:14 条(高 3 / 中 6 / 低 5)

重复项已合并。共 63 条原始发现。

## 修复(本轮全部落地)

高:
1. 同步全量扫描阻塞事件循环(delete/reveal/删后重扫)→ 全部走 executor(`_scan_async`)。
2. 共享 session 被就地处决切断在途下载 → 换代改"延迟退役"(call_later 90s),重建加 asyncio.Lock 防竞态。
3. 并发同名下载交错写同一 .part → 同版本入队去重 + .part 按 job id 独占 + 落盘前 `_unique_dest` 复查。
4. subfolder 尾随空格/点绕过目录校验(`".. "` 等)→ 逐段 `rstrip(" .")` + 保留名过滤 + `realpath` 越界断言。
5. 图片代理白名单 `endswith` 无点边界(evilcivitai.com 命中)→ 精确域/子域匹配。
6. proxy_images 关闭时开放重定向 → 302 前同样过白名单。
7. Authorization 按 mirror 配置而非实际请求主机 → `_headers_for(url)` 逐请求判定。
8. 筛选变更与在途 loadMore 竞态(新筛选被旧响应覆盖)→ pendingReset 补发机制。
9. loadMore 失败页码不回滚跳页丢失 → 页码只在成功后提交。

中/低(择要):
- 事件循环:POST body 非 dict 统一 400;check_updates 改 Semaphore(4)+gather+总超时 120s。
- 下载:Accept-Encoding: identity(防 gzip 哈希必错);Range 200/206 与 Content-Range 起点校验;verifying 阶段可取消;file_index 钳下界;网络错误走统一中文翻译;sidecar 写失败进 job.warning 可见;官方域受限模型用 `?token=`(跨域重定向剥 Authorization)。
- 前端:错误条唯一且可重试;reset 失败保留旧结果+dirty 重拉;proxy_images 切换后全量图片换源(data-direct);sanitizeHtml 剥 scheme 内空白/去 style/拦 data:text/html;详情 id 与 mirror 拼接补 esc;模态 ESC 监听器随关闭移除;详情态恢复(重开面板还原滚动位置与打开的详情);轮询空闲降频 8s+页面隐藏跳过+失败横幅;布局去 calc 魔法数改 flex;主题变量全部带回退值;desc 内外链图走代理+no-referrer。
- 工程:pyproject 移除指向第三方仓库的 Repository、dependencies 声明 aiohttp-socks;README 断链改为内联引用;LICENSE 版权行补权利人;空库也受扫描 TTL 保护;config 读改写全程持锁;/local 响应瘦身;/images 透传 nsfw;destinations 未知类型 400;429/5xx 重试(带 Retry-After);读体阶段网络异常交外层重试(冒烟实测发现)。

## 实测验证

- py_compile + node --check 全过。
- 子文件夹攻击用例(`".. \.."`、`D:/x`、`CON`、`x.`)全部中和;白名单边界(evilcivitai.com / civitai.com.evil.io)全 PASS;token 只加官方域。
- 真实 API 全链(socks5 代理):search 100 items / model detail / images / model-versions OK。

## 遗留项

| 项 | 原因 |
|---|---|
| nsfw 数字档位未映射官方枚举字符串 | 镜像站(默认站点)实测可用且为上游验证口径;切官方站再评估 |
| worker 协程无优雅关停路径 | 仅退出时一条 pending 警告,改坏取消语义的风险大于收益 |
| PublisherId 空缺 | 需在 registry.comfy.org 注册发布者,本机 zip 分发不受影响 |
| 用户代理软件 HTTP-CONNECT 路径波动 | 环境问题:同参数 socks5 正常;已在设置提示建议 socks5:// |

## 下轮新增维度

Round 2:并发与生命周期(会话退役/worker/扫描锁交互)+ 端到端用户旅程走查(代码级 trace:开面板→搜索→详情→下载→本地库管理)。

## 窄域复审(独立 agent,git diff 逐块核对)

修复清单 9 项:6 PASS / 2 PARTIAL / 1 FAIL。新发现 11 条(高 1 / 中 4 / 低 6),已全部二次修复:

1. 图片代理重定向跳未复检白名单(FAIL 根因)→ 跳转后 `host_allowed_image(current)` 再校验。
2. API Key 经 `?token=` 写进 sidecar 的 download_url → 落盘前剥查询串。
3. .part 按 job id 独占导致跨任务续传失效+孤儿文件 → 临时名改确定性哈希(dest|url sha1 前 12 位),跨重启可续传;并发同版本由入队去重挡住。
4. 90s 退役会掐断超长下载 → 下载改用 `open_isolated_stream` 一次性独立会话,不受共享会话退役影响。
5. 可重试状态码检查在 body 解析之后,空体 502 不重试 → 状态码判断前移到解析之前。
6. 读体网络异常注释与行为不符 → 该分支并入重试循环(同挑战/限流路径)。
7. close_all 死代码且未跟踪退役句柄 → 句柄入库 tuple(handle, sess),close_all 取消定时器并立即关闭全部(含退役中)。
8. restoreBrowseState 跳过时 detailId 残留卡死状态行 → 重拉分支显式清 detailId/detail。
9. check_updates 单项非 CivitaiError 异常拖垮整批 → fetch_one 改捕 Exception。
10. errors 变量死赋值 → 删。
11. sanitize_filename 截断可再引入尾随点 → 截断后再 rstrip。

回归门禁:py_compile + node --check + 真机 API(socks5)通过。遗留追加:用户代理 HTTP-CONNECT 路径波动期间 3 次重试可全数超时(环境问题,重试与错误文案已按"已连续 3 次失败"收口)。
