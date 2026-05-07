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

召回记忆，支持 TF-IDF / Hybrid（语义+TF-IDF）排序。

**Request:**
```json
{
  "agentId": "development",
  "projectId": "optional-project",
  "scope": "private",
  "query": "memory storage",
  "depth": "l0",
  "limit": 10
}
```

**Response:**
```json
{
  "ok": true,
  "entries": [...],
  "brief": "formatted brief text"
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

*文档版本: P0-P2 | 更新日期: 2026-05-07*
