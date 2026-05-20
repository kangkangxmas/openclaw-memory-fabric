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
