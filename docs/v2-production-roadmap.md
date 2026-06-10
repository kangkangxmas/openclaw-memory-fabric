# OpenClaw Memory Fabric v2 生产化开发计划

> 日期：2026-06-10
> 主线：自研 v2，不引入 Hy-Memory 运行时依赖。Hy-Memory 仅作为分层记忆、异步巩固、证据追踪、supersedes 和评测方法参考。

## 1. 当前结论

- v2 基线版可以接入当前 OpenClaw 使用：旧 `/recall`、`/commit`、`/carrier/*` 保持兼容；`/commit` 默认 shadow-write L0 event 和 L1 candidate；`MEMORY_FABRIC_V2_MODE=v2-recall` 可让 `before_prompt_build` 优先注入 v2 memory cards，失败回退 legacy recall。
- 不建议立即全量切到 `v2-write`：当前生产化能力仍应先在 `development` Agent 灰度，观察 candidate review、worker 巩固、recall 对照日志、Carrier projection 和 Bench 指标。
- Carrier 在 v2 中是结构化记忆的 Markdown 投影，不再作为唯一事实源；稳定事实源是 L0 event ledger、L1/L2/L3/L5 stable memories、relation graph 和 source trace。

## 2. 已完成的生产化基线

### Phase 1：巩固链路产品化

- `ConsolidationWorker`：支持 start、stop、status、定时处理 pending candidates、幂等 in-flight 锁、失败计数、最后运行结果和最后错误。
- Candidate API：支持列表、状态过滤、统计、review approve/reject、批量 retry。
- `MemoryConsolidator`：成为 worker 和手动 `/v2/consolidation/run` 共用核心；无 `sourceRefs` 不进稳定库；profile/intent 需要明确用户指令、多源高质量证据或人工 review。
- Manual review：`manual_review_approved` 可作为 profile/intent 高信任门禁，但仍不能绕过 `sourceRefs` 必填。

### Phase 2：v2 Recall 灰度实跑

- `RetrievalPlanner`：输出 intent、layers、preferredTypes、weights 和 reason；entity relation intent 接入 relation graph 排序增强。
- `MemoryCardPackager`：支持去重、token budget、80-160 字默认 card、证据摘要、过期/冲突标记。
- Recall 对照日志：plugin 在 v2 cards 命中时采样 legacy recall，并写入 `/v2/recall/audit`，不影响本次 v2 注入结果。

### Phase 3：Carrier 投影治理

- `CarrierProjectionEngine`：支持 drift audit、apply、rollback、history；apply 前记录 rollback snapshot。
- `CarrierRepository.replace`：提供 rollback 精确恢复能力。
- 投影白名单：只允许 `self-model.md`、`decision-log.md`、`execution-journal.md`、`entities-glossary.md`。
- 投影所有权：直接 patch 必须带 `memory-fabric projection:v2.0 memory:<id>` 标记；API apply 只从稳定 memory 生成 patch，非法 patch 进入 `skipped`。
- `self-model.md`：只接受高质量、带 sourceRefs 的 profile/intent，不接受低置信 preference。

### Phase 4：Graphify 关系图升级

- `V2RelationGraphService`：支持 `DECIDES`、`IMPLEMENTS`、`SUPERSEDES`、`CAUSES`、`VALIDATES`、`CONSTRAINS` 语义边。
- Consolidator promotion 同步写入 `VALIDATES`、`SUPERSEDES`、`DECIDES`、`IMPLEMENTS` 关系。
- `/v2/memories/:id/trace` 返回 source events 和 relation trace。

### Phase 5：Memory Bench、全量灰度与切主

- `MemoryBenchRunner`：内置 30+ v0 cases，可运行、持久化 latest report 和历史 JSONL。
- `MemoryBenchFixtureSeeder`：可重复把默认、自定义或持久化 fixture cases 写入 L0 event、L1 candidate，并触发 consolidator promotion，避免空库 bench 指标失真。
- `GET /v2/bench/report`：读取最新报告。
- `GET /v2/gray/status`：汇总 mode、worker、candidate stats、recall audit、latest bench 和 readiness flags。
- V2 Inspector：增加 Candidate Review、Consolidation Worker、Carrier Drift、Projection Apply/Rollback、Relation Trace、Bench Report、Bench Seed 和 Gray Status。

## 3. 后续持续开发计划

### Milestone A：development Agent 灰度

目标：让 `development` Agent 在真实 OpenClaw 工作流中使用 `v2-recall`。

步骤：
- 设置 `MEMORY_FABRIC_V2_MODE=v2-recall`。
- 保持 sidecar 旧 `/recall`、旧 Carrier、旧 JSONL 全部可用。
- 每日查看 `/v2/gray/status?agentId=development`，确认 mode、worker、candidate queue、latest bench 和 readiness flags。
- 每日查看 `/v2/recall/audit`，对比 legacy source count、legacy budget、legacy brief preview、v2 card count、v2 evidence refs、v2 memory ids 和 card previews。
- 每日查看 `/v2/consolidation/status` 和 candidates stats，确保 pending 不堆积、needs_review 可解释。
- 每日运行 `/v2/bench/run`，保存 `/v2/bench/report`。
- 推荐使用统一 smoke 命令串联 fixture、seed、bench 和 gray status：

```bash
pnpm v2:gray-smoke -- --agent-id development --project-id openclaw-memory-fabric
```

严格验收时追加：

```bash
pnpm v2:gray-smoke -- --agent-id development --project-id openclaw-memory-fabric --strict --require-v2-mode
```

退出条件：
- v2 cards 命中率稳定，无空注入扩大。
- Source Coverage 接近 1.0。
- P95 latency <= 300ms。
- Recall Audit 中 v2 card previews 与 query 相关，legacy/v2 差异可解释。
- 无错误 candidate 被写入 `self-model.md`。

### Milestone B：真实 Bench Fixture

目标：用 30-50 个真实 OpenClaw 会话 case 替换或补充默认 v0 case。

步骤：
- 从真实 session 中抽取 query、expectedTerms、agentId、projectId。
- 使用 `POST /v2/bench/fixtures` 保存 fixture 文件；`mode=append` 用于持续补 case，`mode=replace` 用于重建基线。
- 使用 `POST /v2/bench/seed` + `useFixtures=true` 做 fixture seed：先写 L0 events，再写 candidates，再运行 consolidator；重复执行必须跳过已存在 fixture。
- 使用 `POST /v2/bench/run` + `useFixtures=true` 固定输出 Recall@5、Injection Precision、Stale Rate、Source Coverage、平均注入 token、P95 latency。
- 每次实现变更后运行同一 fixture，避免空库指标误导。

命令行保存并执行 fixture：

```bash
pnpm v2:gray-smoke -- \
  --fixture-file ./fixtures/development-bench.json \
  --fixture-mode append \
  --agent-id development \
  --project-id openclaw-memory-fabric
```

验收门槛：
- Recall@5 >= 0.85
- Injection Precision >= 0.80
- Stale Rate <= 0.05
- Source Coverage >= 0.98
- P95 latency <= 300ms

### Milestone C：v2-write 预切主

目标：在 `development` Agent 开启 `v2-write`，但保留 legacy 回退。

步骤：
- `/commit` 切为 v2-first 时仍保留 legacy JSONL shadow。
- ConsolidationWorker 默认启动，但只处理 pending，不自动反复处理 needs_review。
- Candidate review 必须可清空 blocked 状态。
- Carrier projection 只由稳定 memories apply，直接 patch 必须有投影所有权标记，且每次 apply 可 rollback。

回退方式：
- `MEMORY_FABRIC_V2_MODE=shadow`：恢复 legacy recall 注入，保留 v2 shadow-write。
- `MEMORY_FABRIC_V2_MODE=off`：关闭 v2 shadow-write。
- 回滚最新 Carrier projection：`POST /v2/carriers/projection/rollback`。

### Milestone D：多 Agent 扩展

目标：从 `development` 扩展到所有 OpenClaw Agent。

步骤：
- 对每个 Agent 建立独立 candidate stats 和 bench slice。
- 确认 projectId 作用域隔离：跨 Agent 只通过 federation/shared 进入。
- V2 Inspector 按 agent/project 过滤 candidates、relations、audit logs、bench cases。
- 切主前记录每个 Agent 的回滚点。

## 4. API 清单

新增或扩展：

- `GET /v2/memories/candidates`
- `GET /v2/memories/candidates/stats`
- `POST /v2/memories/candidates/:id/review`
- `POST /v2/memories/candidates/retry`
- `POST /v2/consolidation/worker/start`
- `POST /v2/consolidation/worker/stop`
- `GET /v2/consolidation/status`
- `POST /v2/recall/audit`
- `GET /v2/recall/audit`
- `POST /v2/carriers/projection/apply`
- `POST /v2/carriers/projection/rollback`
- `GET /v2/carriers/projection/history`
- `GET /v2/graph/relations`
- `GET /v2/gray/status`
- `GET /v2/bench/fixtures`
- `POST /v2/bench/fixtures`
- `POST /v2/bench/seed`
- `POST /v2/bench/run`
- `GET /v2/bench/report`
- `pnpm v2:gray-smoke -- ...`

保持兼容：

- `/recall`
- `/commit`
- `/carrier/*`
- 旧 OpenViking JSONL 存储

## 5. 阶段验收命令

每阶段必须运行：

```bash
pnpm -r test
pnpm -r build
```

单模块快速检查：

```bash
pnpm -C packages/sidecar test
pnpm -C packages/plugin test
pnpm -C packages/web build
```

## 6. 切主 Checklist

- `development` Agent 在 `v2-recall` 下稳定使用至少一个真实开发周期。
- `/v2/recall/audit` 中 v2 card count、evidence count、legacy source count 没有持续异常。
- Candidate queue 无不可解释积压；needs_review 都有 reviewReason。
- Carrier projection 每次 apply 都有 rollback record。
- Bench 达到验收门槛。
- 旧 `/recall`、旧 Carrier、旧 JSONL 回退路径已验证。

## 7. 回滚 Checklist

- 将 `MEMORY_FABRIC_V2_MODE` 改回 `shadow` 或 `off`。
- 停止 worker：`POST /v2/consolidation/worker/stop`。
- 如 Carrier 被错误投影，调用 `POST /v2/carriers/projection/rollback`。
- 保留 v2 event/candidate/stable memory 数据，不删除；通过 status/retraction 修正。
- 用 `/recall` 验证 legacy prompt 注入恢复。
