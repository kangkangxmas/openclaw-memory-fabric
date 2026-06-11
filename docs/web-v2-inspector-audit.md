# V2 Inspector Web 优化审计

> 日期：2026-06-11
> 范围：`packages/web` Inspector UI，重点是 v2-write canary 后的人工巡检、候选审核、Source Trace 和 Bench 运维。

## 当前结论

- V2 API 面已经基本齐全：candidate、worker、recall audit、trace、carrier drift、projection、graph relations、bench、gray status 都已有 Web client 封装。
- Web 端主要问题不是缺接口，而是信息架构和操作安全：旧 V2 页把灰度状态、审核、trace、bench seed、projection apply 混在一个平面里，真实 canary 阶段容易误点写入类操作。
- 第 3 项可以先做，并且应先于第 4 项 Carrier 投影治理扩展完成。Source Trace 和 Candidate Review 是判断稳定 memory 是否可信的前置观察面。

## 本轮已落地

- V2 Inspector 顶部接入 `GET /v2/canary/status`，以只读 canary summary 作为默认健康面板。
- Candidate Review 增加状态筛选、证据数量、置信度、promoted memory trace 入口和更明确的 approve/reject 禁用状态。
- Source Trace 从原始 JSON 改为结构化视图：`memoryId/status`、`sourceRefs`、L0 events、source metadata、relation trace，并保留 raw JSON 调试入口。
- Recall Audit 中 v2 memory ids 可直接跳转 Source Trace。
- Bench seed / fixture seed 从顶部主操作移入 Bench Tools，降低真实 Agent 被误写 fixture 记忆的风险。

## 还需要优化的 Web 功能

### P0：灰度运维安全

- 为所有会写入或回滚数据的按钮增加二次确认：`Seed Bench`、`Seed Fixtures`、`Projection Apply`、`Projection Rollback`、`Worker Stop`。
- 将当前 Agent / Project / Mode 做成固定状态条，避免用户在错误 Agent 上执行 review 或 projection。
- Candidate Review 增加批量 retry 和失败原因聚合视图，对应 `POST /v2/memories/candidates/retry`。
- Source Trace 对缺失 event、缺失 sourceRefs、sourceRefs 指向不存在 event 的情况给出显式红色状态。

### P1：可解释性与效率

- Injection Inspector 增加 plan 展开：intent、weights、filters、RRF ranking 和被过滤原因。
- Relation Trace 增加按 relation type 过滤，以及 `memory -> event -> relation -> carrier` 的路径视图。
- Recall Audit 增加 legacy/v2 对比详情抽屉，展示 legacy sources、v2 evidence refs、card previews 和 latency。
- Candidate 表支持搜索、按 type/confidence/sourceRefs 排序，并保留最近筛选条件。

### P2：生产运维面板

- 为 `product / Product`、`development / openclaw-memory-fabric` 提供预设 tabs，减少手动切换 Agent 的误差。
- 增加 24h canary 趋势：pending、needs_review、source coverage、recall audit count、P95 latency。
- Bench 报告增加历史趋势和阈值红线：Recall@5、Injection Precision、Stale Rate、Source Coverage、P95 latency。
- Carrier Drift 展示 patch diff，而不是只列 issue 和 merged/skipped 数量。

## 下一步建议

1. 先在棱镜 `product / Product` 继续跑 2-3 轮真实 v2-write 会话，用本页确认 canary warning 是否只剩真实 recall audit 流量不足。
2. 接着做 P0 的二次确认和缺失证据红色状态，这属于第 3 项收尾。
3. 再启动第 4 项 Carrier 投影治理：等 Source Trace 能稳定解释 promoted memory 后，再把 projection apply/rollback 做成可审阅 patch diff。
