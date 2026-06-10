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
  "publishCandidates": []
}
```

> `toolCalls` 和 `turnCount` 用于触发经验蒸馏的条件判断。

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

- `mode`：`MEMORY_FABRIC_V2_MODE` 当前值，默认 `shadow`
- `worker`：ConsolidationWorker 状态
- `candidateStats`：candidate queue 总量、状态和类型分布
- `recallAudit`：最近 audit 数量、最近时间、v2 cards/evidence/rendered chars 与 legacy sources/brief chars 均值
- `bench`：最新 Bench report，可能为 `null`
- `readiness`：`modeReady`、`sourceCoverageReady`、`latencyReady`、`candidateQueueHealthy`

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

### GET /v2/memories/:id/trace

查看稳定记忆的 source trace：`sourceRefs`、原始 sources、L0 events、relation trace。

### GET /v2/carriers/drift

查看结构化记忆与 Carrier Markdown 投影的漂移。

Query:

- `agentId` 必填
- `projectId` 可选
- `limit` 可选

### POST /v2/carriers/projection/apply

将稳定结构化记忆应用到 Carrier 投影。apply 前会记录 rollback snapshot。

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

### GET /v2/graph/relations

查询 v2 语义关系图。

Query:

- `agentId`
- `projectId`
- `type=DECIDES|IMPLEMENTS|SUPERSEDES|CAUSES|VALIDATES|CONSTRAINS`
- `memoryId`
- `limit`

### POST /v2/bench/run

运行 Memory Bench v0，可传自定义 cases，或使用已保存的 fixture 文件。

```json
{
  "agentId": "development",
  "projectId": "openclaw-memory-fabric",
  "useFixtures": true,
  "limit": 50
}
```

`useFixtures=false` 且未传 `cases` 时使用内置默认 v0 cases。

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

### GET /v2/bench/report

读取最新一次 Bench report。

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
