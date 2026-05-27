# Memory Fabric Phase 2 — 技术架构方案

> **文档类型**：技术架构设计（Technical Architecture）  
> **版本**：v1.0  
> **日期**：2026-05-26  
> **作者**：弧极 Arc 🌀  
> **输入**：03-phase-2-self-evolution-prd.md（麦斯威）、04-phase-2-product-design.md（棱镜）  
> **状态**：待康老板 Review

---

## 1. 架构总览

### 1.1 核心架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT SESSION (OpenClaw)                          │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ before_prompt   │    │ User Interaction│    │   agent_end     │         │
│  │    hook         │    │   + Tools       │    │     hook        │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                  │
│           ▼                      │                      ▼                  │
│  ┌─────────────────┐            │           ┌─────────────────┐            │
│  │ Context Builder │            │           │  Distill Pipe   │            │
│  │  (L0/L1/L2)     │            │           │ (Tier1 + Tier2) │            │
│  │                 │            │           │                 │            │
│  │ • SELF_MODEL    │            │           │ • Heuristic     │            │
│  │   Region 1-6    │            │           │ • LLM Struct    │            │
│  │ • Structural    │            │           │ • Async Exec    │            │
│  │   Brief         │            │           │                 │            │
│  │ • Decision Log  │            │           │                 │            │
│  └─────────────────┘            │           └────────┬────────┘            │
│                                 │                    │                     │
└─────────────────────────────────┼────────────────────┼─────────────────────┘
                                  │                    │
                                  │                    ▼
                                  │         ┌─────────────────┐
                                  │         │  DistillResult  │
                                  │         │  (Structured)   │
                                  │         └────────┬────────┘
                                  │                    │
                                  ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SIDECAR (Memory Fabric)                             │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │     Commit      │    │  Carrier Merge  │    │ Workspace Writer│         │
│  │                 │    │                 │    │  (NEW MODULE)   │         │
│  │ memory/*.jsonl  │    │ • self-model.md │    │                 │         │
│  │                 │    │ • decision-log  │    │ • Backup        │         │
│  │                 │    │ • entities      │    │ • Region Parse  │         │
│  │                 │    │ • pattern-store │    │ • Safe Write    │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Pattern Service │    │ Sharing Service │    │ Graphify Sync   │         │
│  │   (Activated)   │    │  (Activated)    │    │  (Activated)    │         │
│  │                 │    │                 │    │                 │         │
│  │ • Threshold     │    │ • Jaccard       │    │ • Incremental   │         │
│  │   Check         │    │   Similarity    │    │ • Weekly Full   │         │
│  │ • Write Region5 │    │ • Cross-Agent   │    │ • Noise Filter  │         │
│  │ • Notify Boss   │    │   Push          │    │                 │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WORKSPACE (File System)                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SELF_MODEL.md (Unified)                          │   │
│  │                                                                     │   │
│  │  <!-- region:identity-start -->                                     │   │
│  │  ## 1. Identity (Region 1) ← 人工维护，不可覆盖                      │   │
│  │  <!-- region:identity-end -->                                       │   │
│  │                                                                     │   │
│  │  <!-- region:rules-start -->                                        │   │
│  │  ## 2. Rules (Region 2) ← 人工维护，不可覆盖                         │   │
│  │  <!-- region:rules-end -->                                          │   │
│  │                                                                     │   │
│  │  <!-- region:runtime-start -->                                      │   │
│  │  ## 3. Runtime Reflections ← Sidecar 自动写入 (overwrite)            │   │
│  │  <!-- region:runtime-end -->                                        │   │
│  │                                                                     │   │
│  │  <!-- region:decisions-start -->                                    │   │
│  │  ## 4. Decision Log ← Sidecar 自动写入 (dedup-append)                │   │
│  │  <!-- region:decisions-end -->                                      │   │
│  │                                                                     │   │
│  │  <!-- region:patterns-start -->                                     │   │
│  │  ## 5. Pattern Library ← Sidecar 自动写入 (dedup-append)             │   │
│  │  <!-- region:patterns-end -->                                       │   │
│  │                                                                     │   │
│  │  <!-- region:meta-start -->                                         │   │
│  │  ## 6. Meta ← Sidecar 自动写入 (overwrite)                           │   │
│  │  <!-- region:meta-end -->                                           │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 关键数据流

```
Agent Session → agent_end hook → Distill Pipe → Structured Result
                                                    │
                    ┌───────────────────────────────┼───────────────────────────────┐
                    │                               │                               │
                    ▼                               ▼                               ▼
            ┌──────────────┐              ┌──────────────┐              ┌──────────────┐
            │   Commit     │              │Carrier Merge │              │Workspace     │
            │              │              │              │              │Writer        │
            │memory/*.jsonl│              │• self-model  │              │              │
            │              │              │• decision-log│              │• Backup      │
            │              │              │• entities    │              │• Region Parse│
            │              │              │• patterns    │              │• Safe Write  │
            └──────────────┘              └──────────────┘              └──────────────┘
                                                                                │
                                                                                ▼
                                                                         ┌──────────────┐
                                                                         │ SELF_MODEL.md│
                                                                         │  (Workspace) │
                                                                         └──────────────┘
```

---

## 2. 核心模块设计

### 2.1 Workspace Writer（新增模块）

**模块路径**：`packages/sidecar/src/services/workspace-writer.ts`

**核心职责**：
- 将 DistillResult 安全写入 Workspace SELF_MODEL.md
- 只操作 Region 3-6，绝不触碰 Region 1-2
- 写入前自动备份，写入失败不阻塞 Agent

**接口设计**：

```typescript
interface WorkspaceWriter {
  /**
   * 主入口：将 distill 结果同步到 workspace
   */
  sync(agentId: string, result: DistillResult): Promise<SyncResult>;
  
  /**
   * 初始化：为缺少 region 标记的 SELF_MODEL 添加标记
   */
  initializeRegions(agentId: string): Promise<InitializeResult>;
  
  /**
   * 备份：创建 SELF_MODEL 的时间戳备份
   */
  backup(agentId: string): Promise<string>; // 返回备份路径
}

interface SyncResult {
  agentId: string;
  regions: {
    runtime: 'noop' | 'updated';
    decisions: 'noop' | 'appended';
    patterns: 'noop' | 'appended';
    meta: 'noop' | 'updated';
  };
  changeSummary: string;
  backupPath: string;
  error?: string;
}

interface DistillResult {
  runtime: RuntimeReflections;
  decisions: DecisionEntry[];
  patterns: PatternEntry[];
  uncertainties: UncertaintyEntry[];
  selfUpdate: string;
  meta: MetaInfo;
}
```

**安全机制**：

```typescript
// 区域标记正则
const REGION_MARKERS = {
  identity: /<!-- region:identity-start -->([\s\S]*?)<!-- region:identity-end -->/,
  rules: /<!-- region:rules-start -->([\s\S]*?)<!-- region:rules-end -->/,
  runtime: /<!-- region:runtime-start -->([\s\S]*?)<!-- region:runtime-end -->/,
  decisions: /<!-- region:decisions-start -->([\s\S]*?)<!-- region:decisions-end -->/,
  patterns: /<!-- region:patterns-start -->([\s\S]*?)<!-- region:patterns-end -->/,
  meta: /<!-- region:meta-start -->([\s\S]*?)<!-- region:meta-end -->/
};

// 写入策略
const WRITE_STRATEGY = {
  identity: 'protected',   // ❌ 禁止写入
  rules: 'protected',      // ❌ 禁止写入
  runtime: 'overwrite',    // ✅ 全量覆盖
  decisions: 'dedup-append', // ✅ 去重追加
  patterns: 'dedup-append',  // ✅ 去重追加
  meta: 'overwrite'        // ✅ 全量覆盖
};

// 安全写入流程
async function safeWrite(agentId: string, region: string, content: string): Promise<void> {
  // 1. 备份
  const backupPath = await backup(agentId);
  
  // 2. 读取当前文件
  const currentContent = await readSelfModel(agentId);
  
  // 3. 定位区域
  const marker = REGION_MARKERS[region];
  if (!marker.test(currentContent)) {
    throw new Error(`Region ${region} not found in SELF_MODEL.md`);
  }
  
  // 4. 检查保护区域
  if (WRITE_STRATEGY[region] === 'protected') {
    throw new Error(`Region ${region} is protected and cannot be written`);
  }
  
  // 5. 执行写入
  const newContent = currentContent.replace(marker, `<!-- region:${region}-start -->\n${content}\n<!-- region:${region}-end -->`);
  
  // 6. 验证写入后文件完整性
  if (!validateRegions(newContent)) {
    // 回滚
    await restoreFromBackup(backupPath);
    throw new Error('Write validation failed, rolled back');
  }
  
  // 7. 写入文件
  await writeFile(selfModelPath, newContent);
}
```

**去重追加策略**：

```typescript
function dedupAppend(existing: string, newEntries: DecisionEntry[]): string {
  const existingEntries = parseExistingEntries(existing);
  const merged = [...existingEntries];
  
  for (const entry of newEntries) {
    // 基于 summary 的语义去重（n-gram overlap >= 80% 视为重复）
    const isDuplicate = existingEntries.some(e => 
      ngramSimilarity(e.summary, entry.summary) >= 0.8
    );
    if (!isDuplicate) {
      merged.push(entry);
    }
  }
  
  // 按时间倒序，保留最近 20 条
  return formatEntries(merged.slice(-20));
}
```

---

### 2.2 Distill Service 改造

**改造范围**：`packages/sidecar/src/services/distill-service.ts`

**核心变更**：
1. 新增 Tier 2 LLM 结构化蒸馏（默认启用）
2. 支持 L0/L1/L2 深度控制
3. 产出结构化 DistillResult（而非字符串数组）

**架构**：

```typescript
class DistillService {
  private tier1: Tier1HeuristicDistiller;
  private tier2: Tier2LLMDistiller;
  
  async distill(session: SessionContext, options: DistillOptions): Promise<DistillResult> {
    // 1. 始终执行 Tier 1（快速、稳定）
    const tier1Result = await this.tier1.distill(session);
    
    // 2. L0 深度跳过 Tier 2
    if (options.depth === 'l0') {
      return this.convertTier1ToStructured(tier1Result);
    }
    
    // 3. L1/L2 执行 Tier 2（异步，不阻塞）
    try {
      const tier2Result = await this.tier2.distill(session, {
        agentRole: options.agentRole,
        depth: options.depth
      });
      return this.mergeResults(tier1Result, tier2Result);
    } catch (error) {
      // LLM 失败 fallback 到 Tier 1
      logger.warn('Tier 2 distillation failed, falling back to Tier 1', error);
      return this.convertTier1ToStructured(tier1Result);
    }
  }
}
```

**Tier 2 LLM Distiller**：

```typescript
class Tier2LLMDistiller {
  private gatewayLLM: GatewayLLMClient;
  
  async distill(session: SessionContext, options: Tier2Options): Promise<StructuredDistillResult> {
    const prompt = this.buildPrompt(session, options);
    
    // 通过 OpenClaw Gateway 调用 LLM（非外部请求）
    const response = await this.gatewayLLM.complete({
      model: 'deepseek/deepseek-v4-flash', // 轻量模型，成本低
      prompt,
      temperature: 0.3,
      maxTokens: 2000
    });
    
    return this.parseStructuredOutput(response);
  }
  
  private buildPrompt(session: SessionContext, options: Tier2Options): string {
    return `
你是一位专业的对话分析专家。请分析以下 AI Agent 的对话记录，提取结构化信息。

Agent 角色: ${options.agentRole}
分析深度: ${options.depth}

对话记录:
${session.transcript}

请提取以下内容（JSON 格式）:
{
  "decisions": [
    {
      "summary": "一句话总结",
      "context": "决策场景",
      "decision": "具体决策",
      "rationale": "决策理由",
      "alternatives": ["备选方案"],
      "confidence": "high|medium|low"
    }
  ],
  "patterns": [
    {
      "name": "模式名称",
      "description": "描述",
      "triggers": ["触发条件"],
      "solution": "解决方案",
      "confidence": 0.9
    }
  ],
  "uncertainties": [
    {
      "question": "不确定的问题",
      "context": "上下文",
      "resolved": false
    }
  ],
  "selfUpdate": "本次对话后自我认知的变化"
}

要求:
1. 只提取有实质内容的决策，过滤闲聊和日常操作
2. confidence 基于证据充分程度判断
3. 如果无重要内容，返回空数组
4. 必须返回合法的 JSON，不要 markdown 代码块
`;
  }
}
```

---

### 2.3 Context Builder（L0/L1/L2 分级注入）

**模块路径**：`packages/sidecar/src/services/context-builder.ts`

**职责**：根据任务复杂度动态构建注入上下文

```typescript
interface ContextBudget {
  l0: 600;    // tokens
  l1: 1800;   // tokens
  l2: 5000;   // tokens
}

interface ContextPayload {
  selfModel: {
    identity: string;      // Region 1-2
    runtime: string;       // Region 3
    decisions?: string;    // Region 4 (L1: 最近5条, L2: 全部)
    patterns?: string;     // Region 5 (仅 L2)
  };
  structuralBrief?: string; // L1: Top5, L2: 完整
  decisionLog?: string;    // L1: 最近3条, L2: 最近10条
}

class ContextBuilder {
  async build(agentId: string, sessionContext: SessionContext): Promise<ContextPayload> {
    const depth = this.determineDepth(sessionContext);
    const selfModel = await this.readSelfModel(agentId);
    
    const payload: ContextPayload = {
      selfModel: {
        identity: this.extractRegion(selfModel, 'identity') + 
                  this.extractRegion(selfModel, 'rules'),
        runtime: this.extractRegion(selfModel, 'runtime')
      }
    };
    
    if (depth === 'l1' || depth === 'l2') {
      payload.selfModel.decisions = this.extractDecisions(selfModel, depth === 'l1' ? 5 : 20);
      payload.structuralBrief = await this.getStructuralBrief(depth === 'l1' ? 'top5' : 'full');
    }
    
    if (depth === 'l2') {
      payload.selfModel.patterns = this.extractRegion(selfModel, 'patterns');
      payload.decisionLog = await this.getDecisionLog(10);
    }
    
    return payload;
  }
  
  private determineDepth(sessionContext: SessionContext): 'l0' | 'l1' | 'l2' {
    // 优先级从高到低
    if (sessionContext.taskType) {
      return TASK_TYPE_DEPTH_MAP[sessionContext.taskType] || 'l0';
    }
    if (sessionContext.hasSpecCommand) return 'l2';
    if (sessionContext.keywords?.some(k => /架构|重构|设计|PRD|方案/.test(k))) return 'l2';
    if (sessionContext.toolCallCount > 5) return 'l1';
    return 'l0';
  }
}
```

---

### 2.4 Pattern Service 激活

**改造范围**：`packages/sidecar/src/services/pattern-service.ts`

**新增逻辑**：

```typescript
class PatternService {
  private workspaceWriter: WorkspaceWriter;
  private sharingService: SharingService;
  
  async onPatternDetected(pattern: Pattern): Promise<void> {
    // 1. 检查阈值
    if (pattern.frequency < 3 || pattern.successRate < 0.8 || pattern.confidence < 0.9) {
      return;
    }
    
    // 2. 写入 SELF_MODEL Region 5
    await this.workspaceWriter.sync(pattern.agentId, {
      patterns: [{
        name: pattern.name,
        description: pattern.description,
        triggers: pattern.triggers,
        solution: pattern.solution,
        frequency: pattern.frequency,
        successRate: pattern.successRate,
        confidence: pattern.confidence
      }]
    });
    
    // 3. 跨 Agent 分享
    const similarAgents = await this.sharingService.findSimilarAgents(pattern);
    if (similarAgents.length > 0) {
      await this.sharingService.pushPattern(pattern, similarAgents);
      
      // 4. 通知康老板
      await notifyBoss({
        type: 'pattern_shared',
        content: `${pattern.agentId} 发现了一个可复用模式「${pattern.name}」，已分享给 ${similarAgents.join(', ')}`
      });
    }
  }
}
```

---

### 2.5 Graphify 激活

**改造范围**：`packages/sidecar/src/services/graphify-sync.ts`（新增）

**核心功能**：

```typescript
class GraphifySyncService {
  private fileWatcher: FileWatcher;
  private graphifyClient: GraphifyClient;
  
  async start(): Promise<void> {
    // 1. 文件变更监听（增量刷新）
    this.fileWatcher.watch([
      '~/Ai/Workspaces/**/*.md',
      '~/.memory-fabric/carriers/**/*.md'
    ], async (changedFiles) => {
      await this.incrementalRefresh(changedFiles);
    });
    
    // 2. 每周全量刷新
    cron.schedule('0 3 * * 0', async () => {
      await this.fullRefresh();
    });
  }
  
  async incrementalRefresh(changedFiles: string[]): Promise<void> {
    // 只更新变更文件相关的图谱节点
    await this.graphifyClient.updatePartial(changedFiles);
  }
  
  async fullRefresh(): Promise<void> {
    // 全量重建图谱
    await this.graphifyClient.buildFull({
      noiseFilter: {
        minEntityLength: { zh: 2, en: 3 },
        filterPureNumbers: true,
        filterPurePunctuation: true,
        filterIsolatedEntities: true
      }
    });
  }
}
```

---

### 2.6 低频 Agent 激活

**改造范围**：`packages/sidecar/src/services/agent-activation.ts`（新增）

```typescript
class AgentActivationService {
  async checkAndActivate(): Promise<void> {
    const agents = await this.getAllAgents();
    
    for (const agent of agents) {
      const staleDays = await this.getStaleDays(agent.id);
      
      if (staleDays > 7) {
        const recentSessions = await this.getRecentSessions(agent.id, 30);
        
        if (recentSessions.length > 0) {
          // 有活动但 stale → 推送自我激活任务
          await this.pushSelfActivationTask(agent.id);
        } else {
          // 无活动 → 标记 dormant
          await this.markDormant(agent.id);
          await notifyBoss({
            type: 'agent_dormant',
            content: `${agent.id} 已连续 30 天无活动，已标记为 dormant`
          });
        }
      }
    }
  }
  
  private async pushSelfActivationTask(agentId: string): Promise<void> {
    // 通过 OpenClaw Gateway 推送任务
    await gateway.sessionsSpawn({
      agentId,
      task: '执行 post-task-distill：扫描最近 session，更新 self-model，产出本周工作总结'
    });
  }
}
```

---

## 3. 数据模型

### 3.1 SELF_MODEL.md 标准格式

```markdown
# SELF_MODEL — {Agent Name} {Emoji}

<!-- region:identity-start -->
## 1. Identity（身份定义）
- **Role**: {角色描述}
- **Capabilities**: {能力列表}
- **Current Focus**: {当前关注点}
<!-- region:identity-end -->

<!-- region:rules-start -->
## 2. Rules & Constraints（规则与约束）
- **Red Lines**: {不可违反的规则}
- **Behavioral Rules**: {行为准则}
- **Scope**: {职责范围}
<!-- region:rules-end -->

<!-- region:runtime-start -->
## 3. Runtime Reflections（运行时反思）
### Current Understanding
{当前对项目、角色、用户的理解}

### Uncertainties
- [ ] {不确定项 1}（添加时间：YYYY-MM-DD）
- [x] {已解决的不确定项}（解决时间：YYYY-MM-DD）

### Missing Evidence
{缺少的证据/数据/信息}

### Preferred Next Actions
{建议的下一步行动}
<!-- region:runtime-end -->

<!-- region:decisions-start -->
## 4. Decision Log（决策记录）

#### YYYY-MM-DD HH:MM — {决策摘要}
- **Context**: {决策场景}
- **Decision**: {具体决策}
- **Rationale**: {决策理由}
- **Alternatives**: {备选方案}
- **Confidence**: high|medium|low
- **Source**: session:{sessionId}

#### YYYY-MM-DD HH:MM — {决策摘要}
...
<!-- region:decisions-end -->

<!-- region:patterns-start -->
## 5. Pattern Library（模式库）

#### {模式名称}
- **Description**: {描述}
- **Trigger**: {触发条件}
- **Solution**: {解决方案}
- **Frequency**: {出现次数}
- **Success Rate**: {成功率}
- **Confidence**: {置信度}
- **Shared To**: [{Agent IDs}]

#### {模式名称}
...
<!-- region:patterns-end -->

<!-- region:meta-start -->
## 6. Meta
- **Updated At**: YYYY-MM-DD HH:MM:SS
- **Last User Interaction**: YYYY-MM-DD HH:MM:SS
- **Session Count (recent 30d)**: {数量}
- **Confidence**: medium
<!-- region:meta-end -->
```

### 3.2 决策记录条目

```typescript
interface DecisionEntry {
  timestamp: string;        // ISO 8601
  summary: string;          // 一句话总结
  context: string;          // 决策场景
  decision: string;         // 具体决策
  rationale: string;        // 决策理由
  alternatives: string[];   // 备选方案
  confidence: 'high' | 'medium' | 'low';
  source: string;           // session:{sessionId}
}
```

### 3.3 模式库条目

```typescript
interface PatternEntry {
  name: string;
  description: string;
  triggers: string[];
  solution: string;
  frequency: number;
  successRate: number;
  confidence: number;
  sharedTo?: string[];
  createdAt: string;
}
```

---

## 4. API 设计

### 4.1 Workspace Writer API

```typescript
// 同步 distill 结果到 workspace
POST /api/v1/workspace/sync
Body: {
  agentId: string;
  result: DistillResult;
}
Response: {
  success: boolean;
  regions: {
    runtime: 'noop' | 'updated';
    decisions: 'noop' | 'appended';
    patterns: 'noop' | 'appended';
    meta: 'noop' | 'updated';
  };
  changeSummary: string;
  backupPath: string;
}

// 初始化 region 标记
POST /api/v1/workspace/initialize
Body: {
  agentId: string;
}
Response: {
  success: boolean;
  regionsAdded: string[];
}

// 获取 SELF_MODEL 内容
GET /api/v1/workspace/self-model/:agentId
Response: {
  content: string;
  regions: {
    identity: string;
    rules: string;
    runtime: string;
    decisions: string;
    patterns: string;
    meta: string;
  };
}
```

### 4.2 Distill API（改造）

```typescript
// 执行蒸馏
POST /api/v1/distill
Body: {
  sessionId: string;
  agentId: string;
  depth: 'l0' | 'l1' | 'l2';
  tier: 'tier1' | 'tier2' | 'both';
}
Response: {
  success: boolean;
  result: DistillResult;
  tierUsed: 'tier1' | 'tier2';
  processingTime: number;
}
```

---

## 5. 迁移方案

### 5.1 迁移脚本

```bash
#!/bin/bash
# migrate-self-models.sh
# 一键迁移所有 Agent 的 SELF_MODEL

set -e

AGENTS=("ai" "assistant" "boss" "brand" "development" "hr" "main" "marketing" "ops" "product" "userservice")
BACKUP_DIR="~/.memory-fabric/backups/migration-$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "=== Memory Fabric Phase 2 迁移开始 ==="
echo "备份目录: $BACKUP_DIR"

for agent in "${AGENTS[@]}"; do
  echo ""
  echo "处理 Agent: $agent"
  
  WORKSPACE_FILE="~/Ai/Workspaces/${agent}/SELF_MODEL.md"
  CARRIER_FILE="~/.memory-fabric/carriers/agents/${agent}/private/self-model.md"
  
  # 1. 备份
  if [ -f "$WORKSPACE_FILE" ]; then
    cp "$WORKSPACE_FILE" "$BACKUP_DIR/${agent}-workspace.bak"
    echo "  ✓ 备份 workspace SELF_MODEL"
  fi
  
  # 2. 为缺少 region 标记的文件添加标记
  if [ -f "$WORKSPACE_FILE" ]; then
    node -e "
      const fs = require('fs');
      const content = fs.readFileSync('$WORKSPACE_FILE', 'utf8');
      
      // 检查是否已有 region 标记
      if (!content.includes('<!-- region:identity-start -->')) {
        // 需要迁移
        const regions = {
          identity: content, // 现有内容归入 identity
          rules: '',
          runtime: '',
          decisions: '',
          patterns: '',
          meta: ''
        };
        
        // 从 carrier 提取 runtime 和 decisions
        if (fs.existsSync('$CARRIER_FILE')) {
          const carrier = fs.readFileSync('$CARRIER_FILE', 'utf8');
          // 解析 carrier 内容...
        }
        
        // 生成新格式
        const newContent = generateNewFormat(regions);
        fs.writeFileSync('$WORKSPACE_FILE', newContent);
        console.log('  ✓ 迁移完成');
      } else {
        console.log('  ✓ 已有 region 标记，跳过');
      }
    "
  else
    # 创建初始 SELF_MODEL
    echo "  创建初始 SELF_MODEL..."
    # 基于 AGENTS.md 和 carrier 生成
  fi
done

echo ""
echo "=== 迁移完成 ==="
echo "备份目录: $BACKUP_DIR"
echo "请检查每个 Agent 的 SELF_MODEL.md 是否正确"
```

### 5.2 迁移检查清单

- [ ] 所有 Agent 的 Workspace SELF_MODEL.md 存在
- [ ] 所有 SELF_MODEL.md 包含 6 个 region 标记
- [ ] Region 1-2 内容未被修改
- [ ] Region 3-6 内容正确填充
- [ ] 备份文件可访问
- [ ] 迁移后 agent_end hook 正常工作

---

## 6. 安全与可靠性

### 6.1 安全机制

| 层级 | 机制 | 说明 |
|------|------|------|
| 备份 | 每次写入前自动备份 | `~/.memory-fabric/backups/{agent}/SELF_MODEL.{timestamp}.bak` |
| 区域保护 | Region 1-2 禁止自动写入 | 硬编码保护，任何写入请求都会被拒绝 |
| 验证 | 写入后验证 region 标记完整性 | 如果验证失败，自动回滚 |
| 降级 | 写入失败不阻塞 Agent | 记录错误日志，通知康老板 |

### 6.2 可靠性保障

```typescript
// 写入失败处理
async function handleWriteFailure(agentId: string, error: Error): Promise<void> {
  logger.error(`SELF_MODEL write failed for ${agentId}`, error);
  
  // 1. 记录到错误日志
  await logError({
    agentId,
    error: error.message,
    timestamp: new Date().toISOString()
  });
  
  // 2. 通知康老板
  await notifyBoss({
    type: 'self_model_write_failed',
    content: `${agentId} 的 SELF_MODEL 写入失败: ${error.message}`
  });
  
  // 3. 不抛出错误，不阻塞 Agent
  // Agent 继续正常运行
}
```

---

## 7. 性能考虑

### 7.1 性能指标

| 指标 | 目标 | 说明 |
|------|------|------|
| Distill 延迟 | < 3s (Tier1), < 10s (Tier2) | 异步执行，不阻塞 Agent |
| Workspace 写入 | < 500ms | 本地文件操作 |
| Context 构建 | < 200ms | 读取 + 组装 |
| 内存占用 | < 100MB | Sidecar 进程 |

### 7.2 优化策略

1. **异步执行**：Tier 2 LLM 蒸馏在 agent_end 后异步执行，不阻塞 Agent 响应
2. **缓存**：SELF_MODEL 内容缓存，避免频繁读取
3. **批量写入**：Decision Log 和 Pattern Library 支持批量追加
4. **增量更新**：Graphify 增量刷新，避免全量重建

---

## 8. 部署计划

### 8.1 阶段划分

| 阶段 | 内容 | 预计工期 | 依赖 |
|------|------|---------|------|
| Phase 1 | Workspace Writer 模块开发 | 3 天 | 无 |
| Phase 2 | Distill Service Tier 2 改造 | 2 天 | Phase 1 |
| Phase 3 | Context Builder L0/L1/L2 | 2 天 | Phase 1 |
| Phase 4 | Pattern Service + Sharing 激活 | 2 天 | Phase 2 |
| Phase 5 | Graphify 激活 + 噪声过滤 | 2 天 | Phase 3 |
| Phase 6 | 低频 Agent 激活机制 | 1 天 | Phase 4 |
| Phase 7 | 迁移脚本 + 全量验证 | 2 天 | Phase 1-6 |
| Phase 8 | 集成测试 + 性能优化 | 2 天 | Phase 7 |

**总计：约 16 天**

### 8.2 部署顺序

```bash
# Step 1: 备份现有数据
./scripts/backup-all.sh

# Step 2: 部署新模块
npm run deploy:workspace-writer
npm run deploy:distill-v2
npm run deploy:context-builder

# Step 3: 执行迁移
./scripts/migrate-self-models.sh

# Step 4: 验证
npm run test:integration
npm run test:e2e

# Step 5: 启用新功能
npm run enable:phase2
```

---

## 9. 验收标准

### 9.1 P0 验收

- [ ] 任意 Agent 完成一次有实质性决策的对话后，Workspace SELF_MODEL.md 的 Runtime Reflections 区域被自动更新
- [ ] Identity / Rules 区域内容不被自动化覆盖
- [ ] 写入失败不阻塞 Agent 正常响应

### 9.2 P1 验收

- [ ] 所有 Agent 的 Workspace SELF_MODEL 包含 6 个标准区域
- [ ] MEMORY.md 新增条目中，完整条目占比 ≥ 80%
- [ ] 决策日志条目包含 Context / Decision / Rationale 三个字段

### 9.3 P2 验收

- [ ] assistant 和 userservice 有 Workspace SELF_MODEL.md
- [ ] Graphify 图谱新鲜度 ≤ 7 天
- [ ] structural brief 中噪声实体数量下降 ≥ 50%

### 9.4 P3 验收

- [ ] 中文对话的 distill 准确率达到 ≥ 70%（人工抽查 20 条）
- [ ] 至少 1 次跨 Agent 模式分享被成功推送

---

## 10. 风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|---------|
| Workspace 写入失败导致 SELF_MODEL 损坏 | 高 | 低 | 自动备份 + 验证 + 回滚机制 |
| Tier 2 LLM 蒸馏成本过高 | 中 | 中 | 使用轻量模型（deepseek-v4-flash），L0 跳过 Tier 2 |
| Region 标记格式不兼容 | 高 | 低 | 严格的正则匹配 + 格式验证 |
| 迁移后 Agent 行为异常 | 高 | 低 | 灰度发布 + 快速回滚 |
| Graphify 增量刷新性能差 | 中 | 中 | 文件变更防抖 + 批量处理 |

---

## 11. 与现有系统的集成

### 11.1 与 OpenClaw Gateway 集成

```typescript
// 通过 Gateway LLM 能力执行 Tier 2 蒸馏
const gatewayLLM = new GatewayLLMClient({
  baseUrl: process.env.OPENCLAW_GATEWAY_URL,
  apiKey: process.env.OPENCLAW_GATEWAY_API_KEY
});

// 在 agent_end hook 中调用
openclaw.on('agent_end', async (session) => {
  const result = await distillService.distill(session, {
    depth: contextBuilder.determineDepth(session),
    tier: 'both'
  });
  
  await workspaceWriter.sync(session.agentId, result);
});
```

### 11.2 与 Feishu 通知集成

```typescript
// 重要事件通知康老板
async function notifyBoss(event: BossNotification): Promise<void> {
  await feishu.sendMessage({
    target: 'user:ou_2acd983044600dc97615987a239407b3',
    content: formatNotification(event)
  });
}
```

---

_本技术架构方案基于麦斯威的 PRD 和棱镜的产品设计，详细定义了 Memory Fabric Phase 2 的技术实现路径。待康老板 Review 确认后进入开发阶段。_

---

**文档信息**
- 作者：弧极 Arc 🌀
- 日期：2026-05-26
- 版本：v1.0
- 状态：待 Review