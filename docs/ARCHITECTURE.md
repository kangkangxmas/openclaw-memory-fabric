# OpenClaw Memory Fabric — 架构文档

> 本文档描述 `openclaw-memory-fabric` 自学习增强（P0/P1/P2）的架构设计、核心模块与数据流。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Plugin (Gateway 进程内)                  │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │ agent-end   │→ │ CommitOrchestrator│→│ sidecar-client.ts  │ │
│  │   hook      │  │ (构建 commit 请求) │  │ (HTTP → sidecar)   │ │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP
┌─────────────────────────────────────────────────────────────────┐
│                      Sidecar (独立进程, 7811)                    │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Routes     │  │  Services   │  │   Stores    │             │
│  │  /commit    │→ │ Experience  │→ │ Experience  │             │
│  │  /recall    │  │   Service   │  │   Store     │             │
│  │  /patterns  │  │  (P0-1)     │  │(JSONL 文件) │             │
│  │  /skills/...│  ├─────────────┤  ├─────────────┤             │
│  │  /report    │  │  Pattern    │  │  Pattern    │             │
│  │  /distill   │  │  Service    │  │  Store      │             │
│  └─────────────┘  │  (P1-1)     │  │(JSONL 文件) │             │
│                   ├─────────────┤  ├─────────────┤             │
│                   │  SkillGen   │  │  SkillDraft │             │
│                   │  Service    │  │   Store     │             │
│                   │  (P1-2)     │  │(JSON 文件)  │             │
│                   ├─────────────┤  ├─────────────┤             │
│                   │   Vector    │  │   Vector    │             │
│                   │  Service    │  │   Store     │             │
│                   │  (P2-1)     │  │(JSONL 文件) │             │
│                   ├─────────────┤  ├─────────────┤             │
│                   │  Scoring    │  │  OpenViking │             │
│                   │  Service    │  │   Service   │             │
│                   │  (P2-2)     │  │(TF-IDF 召回)│             │
│                   ├─────────────┤  ├─────────────┤             │
│                   │  Sharing    │  │  Carrier    │             │
│                   │  Service    │  │ Repository  │             │
│                   │  (P2-3)     │  │(Markdown)   │             │
│                   └─────────────┘  └─────────────┘             │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │ Embedding   │  │  Distill    │  (可选 LLM 层)                 │
│  │  Service    │  │   Service   │                                │
│  │(Ollama API) │  │(启发式+LLM) │                                │
│  └─────────────┘  └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心数据流

### 2.1 经验蒸馏（P0）

```
plugin: agent-end hook
  → CommitOrchestrator.execute()
     → /distill (提取 facts/decisions/patterns...)
     → /commit (传 toolCalls/turnCount/sessionSummary)
        → OpenVikingService.commitSession()  ← 同步返回
        → ExperienceService.postCommitDistill()  ← fire-and-forget
           ① 条件判断 (toolCalls≥3 || turnCount≥5)
           ② 5 分钟限频检查
           ③ LLM 提取 / 启发式回退 → 写 experiences.jsonl
           ④ Carrier 刷新 (>24h 更新 self-model.md)
           ⑤ 每 10 条经验 → 触发 PatternService.detectPatterns()
```

### 2.2 模式识别 → Skill 生成（P1）

```
PatternService.detectPatterns()
  → clusterByTaskType() → evaluateCluster()
  → findCommonToolPairs() (频率 ≥50%)
  → PatternStore.append(pattern)
  → skillGen.onPatternDetected(pattern)
     → hashPattern() 去重检查
     → generateContent() (LLM / fallback 模板)
     → writeFile() → skills/auto-generated/{taskType}-{hash}.md
     → DraftStore.add(meta) 跟踪 pending 状态
```

### 2.3 向量检索 + 自评分 + 共享（P2）

```
commit 成功后
  → VectorService.index(entry)  ← fire-and-forget 异步 index

recall 时
  → VectorService.hybridQuery(query)
     → cosineSimilarity(embedding) × 0.6 + TF-IDF × 0.4
     → RRF merge → 排序返回

ScoringService
  → 3 维度评分（目标完成度 40/工具效率 30/决策质量 30）
  → LLM 评估 / 启发式回退
  → 追加到 experience entry

SharingService
  → confidence ≥ 9 的 pattern
  → Jaccard 工具相似度 ≥ 0.6 匹配目标 agent
  → 写入对方 experiences.jsonl (标记 sharedFrom)
```

---

## 3. 存储架构

所有数据基于 **JSONL 文件系统**，零额外数据库依赖。

| 存储 | 路径 | 格式 | 说明 |
|------|------|------|------|
| 经验 | `{basePath}/agents/{agentId}/experiences.jsonl` | JSONL | 每次 commit 后异步写入 |
| 模式 | `{basePath}/agents/{agentId}/patterns.jsonl` | JSONL | PatternService 检测后写入 |
| 向量 | `{basePath}/embeddings.jsonl` | JSONL | commit 后异步 index |
| Skill 草稿 | `~/.openclaw/skills/auto-generated/` | Markdown | SkillGenService 生成 |
| 草稿元数据 | `~/.openclaw/skills/auto-generated/drafts-meta.json` | JSON | 跟踪 pending/reviewed/ignored |
| Carrier | `~/.memory-fabric/carriers/` | Markdown | self-model, decision-log, glossary |

---

## 4. 环境变量

### 必需

| 变量 | 说明 | 示例 |
|------|------|------|
| `PORT` | Sidecar 端口 | `7811` |
| `HOST` | Sidecar 地址 | `127.0.0.1` |
| `OPENVIKING_BASE_PATH` | OpenViking 数据根目录 | `~/.openviking/data/viking/openclaw-personal` |
| `CARRIERS_ROOT` | Carrier 文件根目录 | `~/.memory-fabric/carriers` |

### 可选（经验蒸馏 LLM）

| 变量 | 说明 | 示例 |
|------|------|------|
| `EXPERIENCE_LLM_BASE_URL` | LLM API 地址 | `http://127.0.0.1:11434/v1` |
| `EXPERIENCE_LLM_MODEL` | 模型名 | `qwen2.5:3b` |
| `EXPERIENCE_LLM_API_KEY` | API Key | `ollama` |
| `EXPERIENCE_LLM_MAX_TOKENS` | 最大 token | `512` |
| `EXPERIENCE_LLM_TIMEOUT_MS` | 超时 | `5000` |

### 可选（向量检索 Embedding）

| 变量 | 说明 | 示例 |
|------|------|------|
| `EMBEDDING_BASE_URL` | Embedding API 地址 | `http://127.0.0.1:11434` |
| `EMBEDDING_MODEL` | 模型名 | `nomic-embed-text` |
| `EMBEDDING_TIMEOUT_MS` | 超时 | `10000` |

> 不配置 `EMBEDDING_BASE_URL` 时，向量检索自动降级为纯 TF-IDF。

---

## 5. API 端点

### 核心端点（原有）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/distill` | 消息蒸馏 |
| POST | `/commit` | 提交记忆 |
| POST | `/recall` | 召回记忆 |
| POST | `/carrier/merge` | 合并 Carrier |

### 新增端点（P0-P2）

| 方法 | 路径 | 说明 | 阶段 |
|------|------|------|------|
| GET | `/patterns?agentId=` | 查询识别出的模式 | P1-1 |
| GET | `/skills/drafts` | 查询待审阅 Skill 草稿 | P1-2 |
| GET | `/report?agentId=` | 自评分报告（taskType 均分+趋势） | P2-2 |

---

## 6. 关键设计决策

1. **纯 JSONL 文件系统**：不引入 SQLite/PostgreSQL，零额外依赖，万级条目 brute-force 无压力。
2. **异步非阻塞**：所有新增能力（蒸馏、模式检测、向量 index、共享）均为 fire-and-forget，失败不影响主流程。
3. **5 分钟限频**：同一 agent 5 分钟内最多触发一次经验蒸馏，避免高频 commit 场景下的资源浪费。
4. **Skill 安全门禁**：自动生成标记 `[AUTO-DRAFT]`，放入独立目录，需人工确认才生效。
5. **Hash 去重**：同一 pattern 内容（taskType + tools + lessons 的 md5）不重复生成草稿。
6. **混合检索**：cosine × 0.6 + TF-IDF × 0.4，兼顾语义相关性和关键词匹配。

---

*文档版本: P0-P2 完整版 | 更新日期: 2026-05-07*
