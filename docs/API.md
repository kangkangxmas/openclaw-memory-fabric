# API 文档 — Sidecar HTTP 接口

Base URL: `http://127.0.0.1:7811`

---

## POST /distill

消息蒸馏，提取 facts/decisions/entities/patterns/unresolved。

**Request:**
```json
{
  "agentId": "development",
  "messages": [
    { "role": "assistant", "content": "We decided to use JSONL for storage." }
  ]
}
```

**Response:**
```json
{
  "facts": ["string"],
  "decisions": ["string"],
  "entities": ["string"],
  "patterns": ["string"],
  "unresolved": ["string"],
  "publishCandidates": ["string"]
}
```

---

## POST /commit

提交记忆条目，触发经验蒸馏（fire-and-forget）。

**Request:**
```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "scope": "private",
  "messages": [...],
  "toolCalls": [{"name":"read"},{"name":"edit"},{"name":"exec"}],
  "turnCount": 6,
  "patterns": ["pattern description"],
  "sessionSummary": "optional summary"
}
```

**Response:**
```json
{
  "ok": true,
  "committed": 5,
  "publishCandidates": [],
  "v2": {
    "mode": "v2-write",
    "status": "written",
    "eventId": "evt_...",
    "candidateCount": 5,
    "candidateIds": ["cand_..."],
    "sourceRefs": ["evt_..."],
    "legacyRole": "fallback",
    "legacyStatus": "written"
  }
}
```

> `toolCalls` 和 `turnCount` 用于触发经验蒸馏的条件判断。`v2` 字段为可选兼容扩展：`off` 不写 v2；`shadow` 和 `v2-recall` 返回 `queued` 并异步写 L0/L1；`v2-write` 先同步写 L0 event 和 L1 candidates，再写 legacy JSONL 作为 fallback。sidecar 会按 `agentId` 解析最终模式：全局模式来自 `MEMORY_FABRIC_V2_MODE`，单 Agent 灰度可通过 `MEMORY_FABRIC_V2_WRITE_AGENT_IDS`、`MEMORY_FABRIC_V2_RECALL_AGENT_IDS`、`MEMORY_FABRIC_V2_SHADOW_AGENT_IDS`、`MEMORY_FABRIC_V2_OFF_AGENT_IDS` 覆盖。

---

## POST /recall

召回记忆，支持 TF-IDF / Hybrid（语义+TF-IDF）排序。Phase G 新增 `taskType` 字段，启用任务类型驱动的动态注入模板。

**Request:**
```json
{
  "agentId": "development",
  "projectId": "optional-project",
  "scope": "private",
  "query": "memory storage",
  "depth": "l0",
  "taskType": "debug"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| agentId | string | 是 | Agent 标识 |
| projectId | string | 否 | 项目标识 |
| scope | string | 否 | private / project / shared / auto |
| depth | string | 否 | l0 / l1 / l2 (默认 l0) |
| query | string | 否 | 检索关键词 |
| taskType | string | 否 | 任务类型 (Phase G)，影响 brief 模板选择 |

有效 taskType 值: `code_review`, `debug`, `architecture`, `devops`, `qa`, `documentation`, `refactor`, `general`

不同 taskType 会：
- 调整 Memory Brief 中的 section 排序 (重点信息优先展示)
- 给重点 section 分配更多条目预算
- 自动注入该类型对应的 Learned Patterns (来自 PatternStore)

**Response:**
```json
{
  "memoryBrief": "## Memory Brief\nAgent: development | ...",
  "sources": ["openviking:private:l0", "patterns:debug"],
  "budgetUsed": 200,
  "taskType": "debug"
}
```

---

## v2 自研记忆接口

v2 接口统一挂在 `/v2/*`，用于 L0 event、L1 candidate、异步巩固、memory cards、Carrier projection、relation graph 和 Bench。旧 `/recall`、`/commit`、`/carrier/*` 保持兼容。

### POST /v2/events

追加 L0 evidence event。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "sourceType": "message",
  "sourceUri": "session://...",
  "content": "User explicitly requested v2 self-research route."
}
```

返回 `event.eventId`、`event.contentHash`、`event.sourceUri`。

### POST /v2/memories/candidates

写入 L1 candidates。没有 `sourceRefs` 的 candidate 会进入 `needs_review`，不会直接进入稳定库。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "candidates": [
    {
      "type": "decision",
      "content": "v2 keeps Hy-Memory as design reference only.",
      "sourceRefs": ["evt_..."],
      "confidence": 0.9
    }
  ]
}
```

### GET /v2/memories/candidates

查询候选记忆。

Query:

- `agentId`
- `projectId`
- `status=pending,needs_review,rejected,promoted`
- `limit`

### GET /v2/memories/candidates/stats

返回 candidate 总量、按状态统计、按类型统计。

### POST /v2/memories/candidates/:id/review

人工 review candidate。

```json
{
  "agentId": "development",
  "decision": "approve",
  "reviewedBy": "inspector",
  "reason": "explicit user instruction"
}
```

`approve` 会打上 `manual_review_approved`，但不能绕过 `sourceRefs` 必填门禁。

### POST /v2/memories/candidates/retry

批量把 `needs_review` 或 `rejected` candidate 重置为可重试状态。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "statuses": ["rejected"],
  "limit": 100
}
```

### POST /v2/consolidation/run

手动执行一次巩固。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "limit": 100
}
```

### POST /v2/consolidation/worker/start

启动后台巩固 worker。

默认不会随 sidecar 启动自动运行。需要开机自动处理 pending candidates 时设置 `MEMORY_FABRIC_CONSOLIDATION_WORKER=auto`，并可选配置 `MEMORY_FABRIC_CONSOLIDATION_AGENT_ID`、`MEMORY_FABRIC_CONSOLIDATION_PROJECT_ID`、`MEMORY_FABRIC_CONSOLIDATION_INTERVAL_MS`、`MEMORY_FABRIC_CONSOLIDATION_LIMIT`。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "intervalMs": 30000,
  "limit": 100
}
```

### POST /v2/consolidation/worker/stop

停止后台巩固 worker。

### GET /v2/consolidation/status

返回 worker 状态和 candidate stats。

### GET /v2/gray/status

返回 v2 灰度汇总状态，用于 daily check 和 Inspector 顶层状态卡。

Query:

- `agentId` 默认 `development`
- `projectId` 可选

Response 包含：

- `mode`：当前 `agentId` / `projectId` 的有效 v2 模式。解析顺序为：`MEMORY_FABRIC_V2_OFF_AGENT_IDS` 紧急关闭 > Inspector runtime override > 环境 allowlist > `MEMORY_FABRIC_V2_MODE`。
- `worker`：ConsolidationWorker 状态
- `candidateStats`：candidate queue 总量、状态和类型分布
- `recallAudit`：最近 audit 数量、最近时间、v2 cards/evidence/rendered chars 与 legacy sources/brief chars 均值
- `bench`：最新 Bench report，可能为 `null`
- `readiness`：`modeReady`、`sourceCoverageReady`、`latencyReady`、`candidateQueueHealthy`

### GET /v2/rollout/effective

返回某个 Agent/Project 的有效 v2 灰度模式。plugin 的 `before_prompt_build` 会优先读取该接口，失败时才回退本地环境变量。

Query:

- `agentId` 必填语义字段，缺省时按 `development`
- `projectId` 可选

Response 包含：

- `mode`：`off`、`shadow`、`v2-recall`、`v2-write`
- `source`：`runtime_override`、`env_global`、`env_agent_write`、`env_agent_recall`、`env_agent_shadow`、`env_agent_off`
- `baseMode` / `baseSource`：不考虑 runtime override 时的环境基线
- `canRollback`：是否存在 Inspector 可回滚的 runtime override

### GET /v2/rollout/modes

返回多 Agent 灰度面板数据。接口会合并请求传入的 Agent、runtime overrides、candidate queue 和 recall audit 中出现过的 Agent/Project。

Query:

- `agentIds` 可选，逗号分隔
- `agentId` / `projectId` 可选，用于把当前 Inspector 选择固定加入结果

Response 包含：

- `defaultMode`：全局环境默认模式
- `modes[]`：每个 Agent/Project 的有效模式、来源、候选队列、recall audit 和 worker 命中状态
- `overrides[]`：当前持久化 runtime override 列表

### POST /v2/rollout/modes

为单个 Agent/Project 写入 runtime override。该配置会持久化在 v2 rollout 配置文件中，并记录 history。

Body:

- `agentId` 必填
- `projectId` 可选
- `mode` 必填：`off`、`shadow`、`v2-recall`、`v2-write`
- `updatedBy` 可选，Inspector 默认 `inspector`
- `reason` 可选

### POST /v2/rollout/modes/rollback

回滚某个 Agent/Project 的上一次 runtime override。若上一次来源是环境变量，则删除 runtime override，恢复环境基线。

Body:

- `agentId` 必填
- `projectId` 可选
- `updatedBy` 可选
- `reason` 可选

### GET /v2/canary/status

返回单 Agent v2-write 灰度巡检状态。该接口只读，不写 smoke 记忆，也不 seed bench fixture。

Query:

- `agentId` 默认 `product`
- `projectId` 默认 `Product`
- `expectedMode` 可选；棱镜灰度应传 `v2-write`
- `maxPending` 默认 `25`
- `maxNeedsReview` 默认 `10`
- `minCandidateSourceCoverage` 默认 `0.98`
- `maxP95LatencyMs` 默认 `300`
- `candidateLimit` 默认 `200`
- `auditLimit` 默认 `50`

Response 包含：

- `status`：`ready`、`warn` 或 `fail`
- `mode`：当前 `agentId` 的有效 v2 模式
- `worker`：ConsolidationWorker 状态和当前作用域
- `candidateStats`：pending、needs_review、rejected、promoted 计数
- `candidateSourceCoverage`：最近 candidate 样本中带 `sourceRefs` 的比例
- `recallAudit`：最近 v2 recall audit 数量、平均 cards/evidence/latency
- `bench`：最新 bench report，可能为 `null`
- `checks`：逐项巡检结果。`fail` 用于阻断继续扩灰；`warn` 用于提示还缺真实流量或 bench。

命令行巡检：

```bash
pnpm v2:canary-monitor -- --agent-id product --project-id Product --strict
```

### POST /v2/recall/plan

返回可解释检索计划、稳定记忆、memory cards 和渲染文本。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "query": "为什么 v2 不直接接入 Hy-Memory",
  "scope": "project",
  "limit": 5
}
```

Response 包含：

- `plan.intent`
- `plan.weights`
- `entries`
- `cards`
- `rendered`
- `relations`
- `executionTimeMs`

### POST /v2/recall/audit

记录 legacy recall 与 v2 recall 对照日志。plugin 在 `MEMORY_FABRIC_V2_MODE=v2-recall|v2-write` 且 v2 cards 命中时调用。

Payload 可包含：

- `legacy.sourceCount`、`legacy.budgetUsed`、`legacy.memoryBriefChars`
- `legacy.sources`、`legacy.memoryBriefPreview`
- `v2.intent`、`v2.cardCount`、`v2.evidenceCount`、`v2.renderedChars`、`v2.executionTimeMs`
- `v2.memoryIds`、`v2.evidenceRefs`、`v2.cardPreviews`

### GET /v2/recall/audit

查询 recall 对照日志，支持 `agentId`、`projectId`、`limit`。返回最近 audit entries，包含 query、mode、legacy 对照指标、v2 memory ids、evidence refs 和卡片预览。

### GET /v2/context/health

只读上下文压缩健康报告。该接口不归档、不删除、不修改 OpenClaw 会话文件；它扫描常见 `*.jsonl` / `*.trajectory.jsonl` 文件，并按运行态优先级读取当前 Gateway 日志：`~/Library/Logs/openclaw/gateway.log`，然后是 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`，最后才是近期 legacy `~/.openclaw/logs/gateway*.log`。过旧 legacy 日志会被跳过，避免历史 stale Graphify 记录污染当前健康状态。

Response 包含：

- `report.thresholds.activeTranscriptMaxBytes`：活跃 transcript 阈值，默认 16MB。
- `report.thresholds.trajectoryArchiveBytes`：trajectory 归档候选阈值，默认 20MB。
- `report.files.sessionCount`、`scannedFileCount`、`maxTranscriptBytes`、`maxTrajectoryBytes`；两个 `max*Bytes` 只统计未归档活跃文件。
- `report.files.activeTranscriptWarnings`：未归档且超过阈值的 transcript。
- `report.files.trajectoryArchiveCandidates`：未归档且超过阈值的 `.trajectory.jsonl`。
- `report.compaction.compactionCount`、`overflowCount`、`timeoutCount`、`alreadyCompactedRecentlyCount`。
- `report.compaction.staleBriefDetailedInjectionCount`：日志中仍出现 stale Graphify 详细注入的次数。
- `report.compaction.staleBriefSkippedCount`：stale Graphify 被降级跳过详细注入的次数。
- `report.warnings`：面向 Inspector 的聚合告警。

### GET /v2/memories/:id/trace

查看稳定记忆的 source trace：`sourceRefs`、原始 sources、L0 events、relation trace 和 relation path。Response 还包含 `entry.contentPreview`、validity、supersedes、quality 等调试字段。

### GET /v2/carriers/drift

查看结构化记忆与 Carrier Markdown 投影的漂移。

Query:

- `agentId` 必填
- `projectId` 可选
- `limit` 可选

### POST /v2/carriers/projection/preview

预览稳定结构化记忆将如何投影到 Carrier Markdown。该接口不写 Carrier，只返回 preview id、patches、rollback snapshot、按文件聚合的 before/after diff 和 summary。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "memoryIds": ["mem_..."],
  "limit": 100
}
```

### POST /v2/carriers/projection/apply-preview

应用前一次 preview 生成的 patches。推荐 Inspector 和人工运维都走 `preview -> apply-preview` 两步流。

```json
{
  "previewId": "proj_preview_..."
}
```

### POST /v2/carriers/projection/apply

将稳定结构化记忆应用到 Carrier 投影。apply 前会记录 rollback snapshot。

公开 API 只接受 `agentId`、`projectId`、`memoryIds` 和 `limit`，不接受任意 Markdown patch。服务内部直接应用 patch 时也必须满足 Carrier 投影白名单并携带 `<!-- memory-fabric projection:v2.0 memory:... -->` 所有权标记；不满足条件的 patch 会出现在响应 `projection.skipped` 中。生产运维建议优先使用 preview/apply-preview。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "memoryIds": ["mem_..."],
  "limit": 100
}
```

### POST /v2/carriers/projection/rollback

按 projectionId 回滚 Carrier 投影。

```json
{
  "projectionId": "proj_..."
}
```

### GET /v2/carriers/projection/history

查看 projection apply/rollback 历史。

### GET /v2/carriers/projection/policy

查看 Carrier Projection 治理策略。Response 包含：

- `projectionVersion`
- `schemaWhitelist`
- `ownershipRules`

Inspector 使用该接口展示允许投影的 carrier 文件、section ownership 和可回滚策略。

### GET /v2/graph/relations

查询 v2 语义关系图。

Query:

- `agentId`
- `projectId`
- `type=DECIDES|IMPLEMENTS|SUPERSEDES|CAUSES|VALIDATES|CONSTRAINS`
- `memoryId`
- `limit`

### POST /v2/bench/run

运行 Memory Bench v0，可传自定义 cases，或使用已保存的 fixture 文件。接口带运行锁：已有 bench 正在运行时返回 `409` 和 `activeRun`，避免重复触发长任务。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "useFixtures": true,
  "limit": 50,
  "caseTimeoutMs": 5000,
  "totalTimeoutMs": 60000,
  "persist": true
}
```

`useFixtures=false` 且未传 `cases` 时使用内置默认 v0 cases；这种默认运行视为诊断，默认 `persist=false`，不会覆盖 latest。传入自定义 `cases` 或 `useFixtures=true` 时默认 `persist=true`，也可显式传 `persist=false` 做只读诊断。

报告字段包含：

- `status=complete|partial|failed`
- `completedCases`
- `timedOutCases`
- `errorCount`
- `errors`
- `durationMs`
- `results[].matchedTerms`、`missingTerms`、`planIntent`、`cardMemoryIds`、`cardPreviews`、`evidenceCount`，用于失败 case drilldown。

只有 `status=complete` 且 `cases > 0` 的报告会写入 latest report；`0-case`、`partial`、`failed` 只返回给调用方，不覆盖已有验收指标。

### GET /v2/bench/status

读取 Bench 运行状态和 latest report 摘要。

Response:

- `state=idle|running`
- `activeRun`：运行中时包含 `runId`、`startedAt`、`casesTotal`、`casesCompleted`、`lastCaseId`、`caseTimeoutMs`、`totalTimeoutMs`
- `latestReport`：latest report 的轻量摘要，供 Inspector 展示运行态和质量门槛

### POST /v2/bench/seed

把默认、自定义或已保存 fixture cases 灌入 v2 结构化记忆库。接口会为每个 case 写入 L0 event、L1 candidate，并运行 consolidator；重复执行会按 fixture tag 跳过已存在记忆。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "limit": 50,
  "useFixtures": false,
  "cases": [
    {
      "id": "real-session-001",
      "query": "v2 为什么不直接依赖 Hy-Memory",
      "expectedTerms": ["Hy-Memory", "runtime", "自研"],
      "agentId": "development",
      "projectId": "openclaw-memory-fabric"
    }
  ]
}
```

Response 包含 `requested`、`skippedExisting`、`createdEvents`、`createdCandidates`、`promoted`、`needsReview`、`rejected` 和 `memoryIds`。

### GET /v2/bench/fixtures

读取已保存的 Bench fixture 文件。

Response:

- `source=persisted|empty`
- `count`
- `cases`

### POST /v2/bench/fixtures

保存真实 Bench fixture cases。

```json
{
  "mode": "replace",
  "cases": [
    {
      "id": "real-session-001",
      "query": "继续上次 Memory Fabric v2 改造任务",
      "expectedTerms": ["v2", "任务", "下一步"],
      "agentId": "development",
      "projectId": "openclaw-memory-fabric"
    }
  ]
}
```

`mode=append` 时按 `id` 去重并覆盖同 id case；`mode=replace` 会替换整个 fixture 文件。

### POST /v2/bench/fixtures/cleanup

清理 Bench fixture 数据。用于把 `bench_fixture` 标记的稳定 memory 和 candidate 从常规运维视图中移除，并可选清空持久化 fixture 文件。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "clearFixtures": true,
  "rejectCandidates": true,
  "deleteMemories": true,
  "limit": 2000
}
```

Response 包含 `memoryDeleted`、`candidatesRejected` 和 `fixturesCleared`。清理稳定 memory 时会同时使用 promoted candidate 反查和 fresh core tag 扫描，避免运行中索引缓存漏掉 fixture memory。

### GET /v2/bench/report

读取最新一次 Bench report。

### GET /v2/bench/history

读取历史 Bench report 摘要。Query:

- `limit` 默认 20，最大 200

Response 包含 `generatedAt`、`status`、`cases`、`completedCases`、`recallAt5`、`injectionPrecision`、`sourceCoverage`、`p95LatencyMs`。

### GET /v2/ops/acceptance/status

V2 Acceptance 运维状态。Response 包含验收目标、latest bench report、fixture scopes、seeded fixture candidate/memory 数和当前失败项。该接口用于判断是否可以继续扩大灰度。

### POST /v2/ops/acceptance/run

运行生产验收 Bench。可选 `seed=true` 先把持久化 fixtures 灌入稳定库，再运行 fixture bench。

```json
{
  "seed": true,
  "limit": 50,
  "caseTimeoutMs": 5000,
  "totalTimeoutMs": 60000
}
```

### GET /v2/ops/evidence-audit

按 Agent/Project 扫描稳定 v2 memories 的证据覆盖率，返回 source-backed/source-less 数量、按 type 聚合和 source-less samples。该接口只读，不修改 memory。

Query:

- `agentId`
- `projectId`
- `type`
- `limit`

### GET /v2/ops/sensitive-candidates

扫描 candidate queue 中可能包含凭据、数据库连接信息、DSN 或 user/password 的候选记忆。Response 只返回 candidateId、reason、type、status、sourceRefs 数量和 promotedMemoryId，不返回原始 content。

Query:

- `agentId`
- `projectId`
- `status=pending,needs_review,rejected,promoted`
- `limit`

### POST /v2/ops/sensitive-candidates/reject

批量 reject 当前扫描命中的敏感候选。默认行为是 reject candidate 并 retract 已 promoted 的稳定 memory，写入 sensitive audit log；只有显式传 `deletePromotedMemories=true` 才硬删除 promoted memory。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "statuses": ["pending", "needs_review", "promoted"],
  "action": "quarantine",
  "retractPromotedMemories": true,
  "deletePromotedMemories": false,
  "limit": 500
}
```

Response 包含 `rejected`、`retractedMemories`、`deletedMemories` 和 `affected`。

### GET /v2/ops/sensitive-candidates/audit

查询敏感候选治理审计日志。

Query:

- `agentId`
- `projectId`
- `candidateId`
- `limit`

Response 包含 `action=reject|quarantine|retract|delete`、candidateId、reason、promotedMemoryId、previousMemoryStatus、newMemoryStatus 和 reviewedBy。

### v2 gray smoke 脚本

仓库提供 `pnpm v2:gray-smoke` 串联灰度检查流程：

1. `GET /health`
2. 可选 `POST /v2/bench/fixtures`
3. `GET /v2/bench/fixtures`
4. `POST /v2/bench/seed`
5. `POST /v2/bench/run`
6. `GET /v2/gray/status`

示例：

```bash
pnpm v2:gray-smoke -- \
  --base-url http://127.0.0.1:7811 \
  --agent-id development \
  --project-id openclaw-memory-fabric
```

使用真实 fixture 文件并严格检查指标：

```bash
pnpm v2:gray-smoke -- \
  --fixture-file ./fixtures/development-bench.json \
  --fixture-mode append \
  --strict \
  --require-v2-mode
```

默认只检查链路可用性；`--strict` 才会按 Bench 验收目标让命令返回非零状态码。

---

## GET /patterns?agentId={agentId}

查询识别出的稳定模式（P1-1）。

**Response:**
```json
{
  "ok": true,
  "count": 1,
  "patterns": [
    {
      "id": "pat-xxx",
      "taskType": "development",
      "frequency": 10,
      "successRate": 1.0,
      "commonTools": ["edit→exec", "read→edit"],
      "commonLessons": ["Check for rate limits"],
      "confidence": 10,
      "detectedAt": 1778137695089
    }
  ]
}
```

---

## GET /skills/drafts

查询待审阅的 Skill 草稿（P1-2）。

**Response:**
```json
{
  "ok": true,
  "count": 1,
  "drafts": [
    {
      "fileName": "development-235c17c9.md",
      "taskType": "development",
      "patternId": "pat-xxx",
      "confidence": 10,
      "status": "pending",
      "generatedAt": "2026-05-07T07:36:42.751Z"
    }
  ]
}
```

---

## GET /report?agentId={agentId}

自评分报告（P2-2），按 taskType 聚合均分与趋势。

**Response:**
```json
{
  "ok": true,
  "reports": [
    {
      "taskType": "development",
      "totalEntries": 10,
      "avgScore": 81,
      "successRate": 0.9,
      "trend": "flat",
      "recentScores": [80, 82, 78, 85, 90]
    }
  ]
}
```

---

## POST /carrier/merge

合并 Carrier 文件。

**Request:**
```json
{
  "agentId": "development",
  "projectId": "optional",
  "items": [
    { "type": "decision", "content": "..." },
    { "type": "open_question", "content": "..." }
  ]
}
```

---

## POST /batch/recall

批量召回（Phase E），并行处理多个 agent 的 recall 请求。

**Request:**
```json
{
  "requests": [
    { "agentId": "agent-1", "projectId": "proj", "depth": "l0" },
    { "agentId": "agent-2", "projectId": "proj", "query": "auth" }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "results": [
    { "ok": true, "agentId": "agent-1", "memoryBrief": "...", "sources": [...], "budgetUsed": 200 },
    { "ok": true, "agentId": "agent-2", "memoryBrief": "...", "sources": [...], "budgetUsed": 350 }
  ]
}
```

> 最多 10 个并发请求。失败的请求返回 `{ "ok": false, "error": "message" }`。

---

## POST /batch/commit

批量提交（Phase E），并行处理多个 commit payload。

**Request:**
```json
{
  "commits": [
    { "agentId": "a1", "projectId": "p1", "facts": ["fact-1"] },
    { "agentId": "a2", "projectId": "p1", "decisions": ["use gRPC"] }
  ]
}
```

---

## POST /graph/incremental

增量图谱更新（Phase E），只处理变更文件。

**Request:**
```json
{
  "projectId": "my-project",
  "changedFiles": ["/path/to/changed-file.ts"]
}
```

**Response:**
```json
{ "ok": true, "updated": 1, "nodesAdded": 3, "edgesAdded": 5 }
```

---

## POST /lifecycle/gc

垃圾回收（Phase D），清理过期数据。

**Response:**
```json
{
  "ok": true,
  "sharedRetracted": 2,
  "draftsRemoved": 1,
  "memoriesCompacted": [{ "path": "...", "before": 1050, "after": 750, "removed": 300 }]
}
```

---

## GET /inspect/learning-curve?agentId={agentId}&days={days}

学习曲线数据（Phase C），按日聚合经验统计。

**Response:**
```json
{
  "ok": true,
  "curve": [
    { "date": "2026-05-15", "experiences": 3, "avgScore": 72.5, "successRate": 0.67, "patterns": 2 }
  ]
}
```

---

## POST /federation/export

跨项目知识导出（Phase F）。

**Request:**
```json
{
  "sourceProject": "project-alpha",
  "targetProject": "project-beta",
  "agentId": "agent-1",
  "entries": [{ "type": "fact", "content": "API uses REST" }]
}
```

---

## GET /federation/import?projectId={projectId}

导入其他项目的联邦知识。

---

## POST /federation/revoke

撤回已导出条目。

**Request:** `{ "projectId": "target", "entryId": "fed-xxx" }`

---

## GET /federation/dependencies

查看多项目依赖图谱。

**Response:**
```json
{
  "projects": ["alpha", "beta"],
  "dependencies": [{ "from": "alpha", "to": "beta", "strength": 3, "sharedEntities": ["PostgreSQL"] }]
}
```

---

## POST /federation/recommend-budget

自适应记忆预算推荐（Phase F）。

**Request:** `{ "toolCount": 8, "turnCount": 15, "queryLength": 200 }`

**Response:** `{ "depth": "l2", "tokenBudget": 5000, "reason": "high complexity (score=7)" }`

---

## POST /federation/approval/submit

提交待审核条目（Phase F）。

**Request:** `{ "sourceAgent": "agent-1", "projectId": "proj", "type": "decision", "content": "switch to gRPC" }`

## GET /federation/approval/pending?projectId={projectId}

查看待审批列表。

## POST /federation/approval/review

审批条目。

**Request:** `{ "entryId": "appr-xxx", "decision": "approved", "reviewedBy": "reviewer-1" }`

---

*文档版本: v1.7.0 (Phase A-F) | 更新日期: 2026-05-20*
