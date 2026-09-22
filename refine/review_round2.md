# Refine Round 2 — 2026-09-22

## 新增维度与指标

| 维度 | 指标 |
|---|---|
| 并发与生命周期 | 会话/worker/扫描锁交错零泄漏零死锁;实际并发 ≤ max_concurrent;热更新收敛 |
| 端到端用户旅程 | J1-J5 五条旅程每个 API 调用前后端契约匹配;每个分支有出口;断点数=0(高) |

## 评审(2 个并行只读 agent)

- 并发生命周期:18 条(高 0 / 中 4 / 低 14,其中 8 条为"确认安全"的核查结论)
- 用户旅程:13 条(高 0 / 中 4 / 低 9)

## 修复(全部落地)

并发:
1. max_concurrent 只升不降(worker 永生)→ 引入信号量闸门 `_slot()`,实际并发实时对齐配置。
2. 扫描 ts 取开始时间(慢盘 TTL 永不过期)+ 下载完成 force scan 无去抖 → ts 改扫描完成时刻;新增 `schedule_rescan()` 2s 去抖合并。
3. scan/sha256 挤占 ComfyUI 共享默认线程池 → 插件专用 ThreadPoolExecutor(max_workers=2)。
4. 429/WAF 重试逐请求换连接造成 TLS churn 反馈环 → 全局冷却时间戳 `_cooldown_until`,并发批次共享一次退避。
5. 206 无 Content-Range 盲续传 → 起点缺失同样从头下载。
6. verifying 尾窗取消不生效(校验通过后仍落盘)→ `os.replace` 前复查取消标志。
7. 索引快照分步赋值非原子 → 整体原子替换(`_cache = new`),读端引用自洽。
8. 同 version 多文件被去重误挡 → 去重键改为 (version_id, file_index)。
9. 重开面板首帧轮询滞后 → render() 时重置 lastPollTs。

旅程:
10. 未映射类型下载死路(Round1 的 400 改动引入的回归)→ 回退全部注册目录,保证可下载。
11. 入队后下载页最长 8s 显示陈旧空态 → 用入队响应中的 job 立即 unshift + 强制轮询。
12. 本地库已加载时下载完成后切页不刷新 → 切 tab 无条件 loadLocal(后端 30s TTL 兜底)。
13. mirror 填裸域名损坏"在 Civitai 打开"外链 → civitaiPage() 补 https:// 前缀。
14. 详情加载中状态行残留分页文案 → detailId 提前置位。
15. 更新弹窗找不到版本时静默无出口 → 补 toast。
16. 批量检查更新的失败项静默丢弃 → 汇总进 toast(N 个查询失败)。
17. prefill root 严格相等可能因斜杠风格失配 → 归一化后比较。
18. max_concurrent/nsfw 超界值入库 → set_config 侧 clamp。
19. 画廊/说明图无 onerror 挂图常驻 → 隐藏。
20. 清除全部任务后"清除已完成"按钮不隐藏 → 早退分支同步可见性。

## 测试

- 语法:py_compile + node --check 全过。
- 新增针对性单测(独立 python 进程,事件循环内):sanitize 截断尾点、(version_id,file_index) 去重、不同 file_index 放行、worker 状态机收敛、信号量闸门 peak=配置值(4)、索引快照自洽 — 6/6 PASS。
- 真机 API 回归(socks5)通过。

## 遗留项

| 项 | 原因 |
|---|---|
| 代理黑洞时交互请求最长 ~90s 才报错 | 权衡:当前网络环境抖动大,保留 3 次重试换稳定性;前端有"加载中"指示 |
| check_updates 与浏览叠加的突发压力(~13 req/s 瞬时) | 触发条件苛刻(手动批量+同时浏览),有全局退避兜底 |
| 下载进行中改代理不生效(整程粘旧 proxy) | 设计取舍:换线路中断大文件风险 > 收益,失败可换代理续传 |
| close_all 仅测试使用 | 保留供进程退出钩子接入,生产路径无需调用 |

## 下轮

Round 3 按协议无条件进行:加严终检(全文件新鲜眼复审 + 全量门禁 + 文档最终一致性)。

## 窄域复审(独立 agent)

11 项修复:9 PASS / 1 FAIL / 2 PARTIAL。新发现 3 条,已全部二次修复:

1. **严重**:`_scan_unlocked` 重绑定 `_cache` 缺 `global` 声明 → 缓存整体失效,每请求全盘重扫 → 已补 `global _cache`,并实测验证(scan1=0.8ms,scan2=0.00ms,同一快照对象)。
2. prefill 归一化匹配命中后 option 仍用原串严格比较,静默回落第一目录 → 命中时采用 destinations 原串(`matched.root`)。
3. nsfw 偏好只写不读 → setup() 读 config 后回填 `S.browse.nsfw`。

另确认:`_slot()` 重复 global 声明合法;缩容瞬时超发可自愈,接受。
