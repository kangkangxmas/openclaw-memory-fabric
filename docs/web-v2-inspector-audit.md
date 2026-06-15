# V2 Inspector Web 优化审计

> 日期：2026-06-11
> 范围：`packages/web` Inspector UI，重点是 v2-write canary 后的人工巡检、候选审核、Source Trace 和 Bench 运维。

## 当前结论

- V2 API 面已经基本齐全：candidate、worker、recall audit、trace、carrier drift、projection、graph relations、bench、gray status 都已有 Web client 封装。
- Web 端主要问题不是缺接口，而是信息架构和操作安全：旧 V2 页把灰度状态、审核、trace、bench seed、projection apply 混在一个平面里，真实 canary 阶段容易误点写入类操作。
- 第 3 项可以先做，并且应先于第 4 项 Carrier 投影治理扩展完成。Source Trace 和 Candidate Review 是判断稳定 memory 是否可信的前置观察面。

## 本轮已落地

- V2 Inspector 顶部接入 `GET /v2/canary/status`，以只读 canary summary 作为默认健康面板。
- V2 Inspector 增加多 Agent 灰度运维面板：按 Agent/Project scope 展示 `off / shadow / v2-recall / v2-write`、mode 来源、运行时覆盖、队列、recall audit、sourceRefs 覆盖率和 worker 命中状态。
- 多 Agent 面板支持从已发现 agents/projects 自动生成 scope，也支持手工添加尚未产生 candidates 或 audit 的 Agent/Project；手工 scope 会保存在浏览器本地状态中。
- 每个 scope 支持单独切换模式、回滚上一次 runtime override、定向启动单实例 ConsolidationWorker，并提供显式 Emergency Off。
- Candidate Review 增加状态筛选、证据数量、置信度、promoted memory trace 入口和更明确的 approve/reject 禁用状态。
- Source Trace 从原始 JSON 改为结构化视图：`memoryId/status`、`sourceRefs`、L0 events、source metadata、relation trace，并保留 raw JSON 调试入口。
- Recall Audit 中 v2 memory ids 可直接跳转 Source Trace。
- Bench seed / fixture seed 从顶部主操作移入 Bench Tools，降低真实 Agent 被误写 fixture 记忆的风险。
- V2 Inspector 增加固定运行上下文状态条：明确左侧全局上下文、棱镜 canary 范围、当前模式和 worker 范围。
- 所有会写入或回滚数据的高风险按钮增加二次确认：candidate approve/reject、candidate retry、projection apply/rollback、worker stop、bench seed/fixture seed。
- Candidate Review 增加搜索、排序、失败原因聚合和 `POST /v2/memories/candidates/retry` 的受控入口；retry 仅覆盖 `needs_review/rejected`。
- Source Trace 对缺失 `sourceRefs`、缺失 L0 events、`sourceRefs` 找不到 event、缺 source metadata、缺 relation trace 给出红色或黄色状态。
- Acceptance Ops 增加验收目标、fixture scopes、latest bench readiness、fixture-backed acceptance run 和 seeded fixture cleanup。
- Governance & Safety 增加 stable memory evidence audit、source-less samples、敏感 candidate 扫描和批量 reject；敏感扫描不回传原始 content。
- Carrier Projection Governance 增加 policy 展示、schema whitelist、projection history 和 rollback 操作入口。

## 还需要优化的 Web 功能

### P0：灰度运维安全

- 已完成：多 Agent 灰度配置、逐 scope 切换/回滚/Emergency Off、二次确认、固定运行上下文状态条、Candidate retry/搜索/排序/失败聚合、Source Trace 缺失证据状态、Acceptance Ops、敏感候选治理、evidence audit、Carrier projection policy/history/rollback。
- 剩余：把 projection apply/rollback 从按钮确认升级为 patch diff 审阅。

### P1：可解释性与效率

- Injection Inspector 增加 plan 展开：intent、weights、filters、RRF ranking 和被过滤原因。
- Relation Trace 增加按 relation type 过滤，以及 `memory -> event -> relation -> carrier` 的路径视图。
- Recall Audit 增加 legacy/v2 对比详情抽屉，展示 legacy sources、v2 evidence refs、card previews 和 latency。
- Candidate 表保留最近筛选条件；搜索、按 confidence/sourceRefs 排序已完成。

### P2：生产运维面板

- 为 `product / Product`、`development / openclaw-memory-fabric` 提供预设 tabs，减少手动切换 Agent 的误差。
- 增加 24h canary 趋势：pending、needs_review、source coverage、recall audit count、P95 latency。
- Bench 报告增加历史趋势和阈值红线：Recall@5、Injection Precision、Stale Rate、Source Coverage、P95 latency。
- Carrier Drift 展示 patch diff，而不是只列 issue 和 merged/skipped 数量。

## 下一步建议

1. 先在棱镜 `product / Product` 继续跑 2-3 轮真实 v2-write 会话，用本页确认 canary warning 是否只剩真实 recall audit 流量不足。
2. 使用多 Agent 灰度面板把第二个低风险 Agent 加入 `v2-recall`，观察 pending、needs_review、sourceRefs 覆盖率和 recall audit。
3. Carrier 投影治理基础已启动：先用 policy/history/rollback 保证可审计和可回滚；下一轮把 projection apply/rollback 做成可审阅 patch diff。
