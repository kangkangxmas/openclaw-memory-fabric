# Memory Fabric Phase 2 — 技术架构方案

## 从"能记"到"会进化"：SELF_MODEL 合流与自我进化体系

**文档类型**：技术架构设计说明书（Technical Architecture Design）
**版本**：v1.0
**日期**：2026-05-26
**作者**：弧极 Arc 🌀
**输入**：
- 03-phase-2-self-evolution-prd.md（麦斯威 需求文档）
- 04-phase-2-product-design.md（棱镜 🔷 产品设计，已通过康老板审核）
**适用对象**：康老板（审核）、弧极 Arc 🌀（开发实施）

---

## 0. 架构设计原则

在进入具体设计之前，先确立四条原则：

### 原则 1：Workspace 是唯一权威
每个 Agent 的 `~/Ai/Workspaces/{Agent}/SELF_MODEL.md` 是 Agent 自我认知的**唯一权威来源**。Carrier self-model.md 降级为"传输层快照 + 审计备份"，不再承担自我认知的角色。

### 原则 2：分区治理，不越界
SELF_MODEL.md 被划分为 6 个 region。Region 1-2（Identity / Rules）由人/Agent 手动维护，Region 3-6 由 sidecar 自动写入。自动写入**绝不触碰人工区域**。

### 原则 3：渐进式升级，不破坏现有
所有改动通过增量方式叠加到现有系统上。不修改 OpenClaw 核心，不修改 OpenViking/Graphify 源码。现有的 distill、commit、carrier-merge 管道保留，在其上增加新的处理层。

### 原则 4：异步优先，不阻塞主流程
所有 LLM 调用、文件写入、图谱更新均采用异步 fire-and-forget 模式。agent_end 总耗时 ≤ 500ms。

---

## 1. 核心问题与架构目标

### 1.1 问题一句话
> **Agent 有两个自我认知，互相不认识对方。**

### 1.2 架构目标
将两个 self-model 合并为一个统一的、持续自我更新的自我模型：

```
现在（破碎的）：                     目标（统一的）：
                                    
  Workspace    Carrier               Workspace SELF_MODEL.md
  SELF_MODEL   self-model            ┌──────────────────────┐
  ┌──────┐    ┌──────┐               │ Region 1: Identity   │ ← 人工维护
  │ 身份  │    │ 反思  │               │ Region 2: Rules      │ ← 人工维护
  │ 规则  │    │ 目标  │               ├──────────────────────┤
  └──────┘    │ 不确定 │               │ Region 3: Runtime    │ ← Sidecar 自动
       ✗       │ 证据  │               │ Region 4: Decisions  │ ← Sidecar 自动
       互相不认识 └──────┘               │ Region 5: Patterns   │ ← Sidecar 自动
                                        │ Region 6: Meta       │ ← Sidecar 自动
                                        └──────────────────────┘
                                                  ↕ 双向
                                        Carrier self-model.md
                                        （传输快照 + 审计备份）
```

---

## 2. SELF_MODEL 数据结构改造

### 2.1 Region 划分（HTML 注释标记）

SELF_MODEL.md 使用 HTML 注释标记六个区域边界。Sidecar 只操作标记内的内容。

```markdown
# SELF_MODEL

<!-- region:identity -->
## 1. Identity
...
<!-- endregion:identity -->

<!-- region:rules -->
## 2. Rules
...
<!-- endregion:rules -->

<!-- region:runtime -->
## 3. Runtime Learnings
...
<!-- endregion:runtime -->

<!-- region:decisions -->
## 4. Decision Log
...
<!-- endregion:decisions -->

<!-- region:patterns -->
## 5. Patterns
...
<!-- endregion:patterns -->

<!-- region:meta -->
## 6. Meta
...
<!-- endregion:meta -->
```

### 2.2 各 Region 的读写权限

| Region | 名称 | 写入者 | 读取者 | 说明 |
|--------|------|--------|--------|------|
| 1 | Identity | 人 / Agent | Sidecar | 角色、职责、行为准则 |
| 2 | Rules | 人 / Agent | Sidecar | 红线、约束、开发规范 |
| 3 | Runtime | Sidecar | Agent | 运行时学习、经验、教训 |
| 4 | Decisions | Sidecar | Agent | 决策记录（含上下文、理由） |
| 5 | Patterns | Sidecar | Agent | 模式识别、最佳实践 |
| 6 | Meta | Sidecar | Agent | 置信度、更新频率、元数据 |

### 2.3 Region 标记的安全机制

```typescript
// sidecar/src/services/workspace-writer.ts

interface RegionMarker {
  start: string;      // <!-- region:{name} -->
  end: string;        // <!-- endregion:{name} -->
}

const REGIONS: Record<string, RegionMarker> = {
  identity: { start: "<!-- region:identity -->", end: "<!-- endregion:identity -->" },
  rules:    { start: "<!-- region:rules -->",    end: "<!-- endregion:rules -->" },
  runtime:  { start: "<!-- region:runtime -->",  end: "<!-- endregion:runtime -->" },
  decisions:{ start: "<!-- region:decisions -->",end: "<!-- endregion:decisions -->" },
  patterns: { start: "<!-- region:patterns -->", end: "<!-- endregion:patterns -->" },
  meta:     { start: "<!-- region:meta -->",     end: "<!-- endregion:meta -->" },
};

/**
 * 安全写入：只操作标记内的内容，绝不触碰标记外
 */
function writeRegion(
  content: string,
  regionName: string,
  newContent: string
): string {
  const marker = REGIONS[regionName];
  if (!marker) throw new Error(`Unknown region: ${regionName}`);

  const startIdx = content.indexOf(marker.start);
  const endIdx = content.indexOf(marker.end);

  if (startIdx === -1 || endIdx === -1) {
    // 标记不存在：追加到文件末尾（初始化场景）
    return content.trimEnd() + "\n\n" + marker.start + "\n" + newContent + "\n" + marker.end + "\n";
  }

  // 只替换标记之间的内容
  const before = content.slice(0, startIdx + marker.start.length);
  const after = content.slice(endIdx);
  return before + "\n" + newContent + "\n" + after;
}
```

---

## 3. Workspace Writer 模块（新增）

### 3.1 模块定位

Workspace Writer 是 Phase 2 新增的核心模块，负责将 Sidecar 的蒸馏结果写入 Workspace 的 SELF_MODEL.md。

```
┌─────────────────────────────────────────────────────────────┐
│                    Workspace Writer                          │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │ Region Parser│ → │ Content     │ → │ Safe File Writer │ │
│  │ (正则定位)   │    │ Transformer │    │ (备份+原子写入)  │ │
│  └─────────────┘    └─────────────┘    └─────────────────┘ │
│                                                              │
│  职责：                                                       │
│  1. 读取 Workspace SELF_MODEL.md                             │
│  2. 解析 6 个 Region 边界                                     │
│  3. 将 distill 结果映射到对应 Region                          │
│  4. 安全写入（备份 → 写入 → 验证）                             │
│  5. 从不触碰 Region 1-2（Identity/Rules）                     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心接口

```typescript
// sidecar/src/services/workspace-writer.ts

export interface WorkspaceWriter {
  /**
   * 将 distill 结果写入 workspace SELF_MODEL.md
   * @returns 写入结果，包含变更摘要
   */
  sync(agentId: string, result: DistillResult): Promise<SyncResult>;
}

export interface SyncResult {
  agentId: string;
  regions: {
    runtime:   'noop' | 'updated';     // Region 3
    decisions: 'noop' | 'appended';    // Region 4
    patterns:  'noop' | 'appended';    // Region 5
    meta:      'noop' | 'updated';     // Region 6
  };
  changeSummary: string;               // 人类可读的变更摘要
  backupPath?: string;                 // 备份文件路径
  error?: string;                      // 如果写入失败
}

export interface DistillResult {
  // 来自 DistillService 的结构化输出
  decisions: Array<{
    summary: string;
    context: string;
    rationale: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  patterns: Array<{
    description: string;
    frequency: number;
    successRate: number;
  }>;
  uncertainties: string[];
  selfUpdate: string;                  // 自我认知变化摘要
}
```

### 3.3 写入流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 1. 读取文件  │ →  │ 2. 解析区域  │ →  │ 3. 备份原文件│
│   SELF_MODEL │     │   正则定位    │     │   .bak      │
└─────────────┘     └─────────────┘     └─────────────┘
                                               ↓
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 6. 返回结果  │ ←  │ 5. 原子写入  │ ←  │ 4. 内容合并  │
│   SyncResult │     │   验证完整性  │     │   只改3-6区   │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 3.4 安全机制

1. **写入前备份**：`~/.memory-fabric/backups/{agent}/SELF_MODEL.{timestamp}.bak`
2. **Region 标记约束**：写入前验证标记存在，写入后验证标记未被破坏
3. **权限检查**：Region 1-2 的内容哈希一旦变化 → 拒绝写入（人工区域被篡改告警）
4. **原子写入**：先写临时文件，再 rename 覆盖

---

## 4. Distill Service 改造：Tier 2 LLM 蒸馏

### 4.1 现状问题

当前 DistillService 是同步阻塞的：
```
agent_end → distill (LLM call, 2-5s) → commit → carrier-merge → 返回
```

问题：
- agent_end 总耗时 2-5s，用户体验差
- LLM 调用失败会导致整个 commit 失败
- 高频会话（如闲聊）不需要每次蒸馏

### 4.2 改造方案：异步 Tier 2 蒸馏

```
Phase 2 新流程：

agent_end ──→ [Tier 1: 快速蒸馏] ──→ 立即返回（<100ms）
                  │
                  ↓（异步，fire-and-forget）
           [Tier 2: LLM 精炼] ──→ Workspace Writer ──→ SELF_MODEL.md
                  │
                  ↓（异步）
           [Experience Service] ──→ experience.jsonl
```

### 4.3 Tier 1：快速蒸馏（同步，<100ms）

```typescript
// sidecar/src/services/distill-service.ts

interface Tier1Result {
  quickPatterns: string[];      // 工具链模式（正则提取）
  quickDecisions: string[];     // 决策标记（/decision 指令）
  toolChain: string[];          // 工具调用序列
  shouldDistill: boolean;       // 是否触发 Tier 2
}

function tier1QuickDistill(session: SessionContext): Tier1Result {
  const toolChain = session.toolCalls.map(t => t.name);
  
  // 快速模式：连续相同工具调用 ≥3 次
  const quickPatterns = extractRepeatedPatterns(toolChain);
  
  // 快速决策：用户明确标记的决策
  const quickDecisions = session.userMessages
    .filter(m => m.includes('/decision'))
    .map(m => m.replace('/decision', '').trim());
  
  // 触发条件：工具调用 ≥3 或 轮次 ≥5 或 有决策标记
  const shouldDistill = toolChain.length >= 3 || 
                        session.turnCount >= 5 || 
                        quickDecisions.length > 0;
  
  return { quickPatterns, quickDecisions, toolChain, shouldDistill };
}
```

### 4.4 Tier 2：LLM 精炼（异步，不阻塞）

```typescript
// sidecar/src/services/distill-service.ts

async function tier2LLMDistill(
  session: SessionContext,
  tier1: Tier1Result
): Promise<DistillResult> {
  // 使用 DeepSeek V4 Flash（成本降低 70%）
  const llmConfig = {
    baseUrl: process.env.DISTILL_LLM_BASE_URL,
    model: process.env.DISTILL_LLM_MODEL || 'deepseek-v4-flash',
    apiKey: process.env.DISTILL_LLM_API_KEY,
    timeoutMs: 30_000,
    maxTokens: 800
  };

  const prompt = buildDistillPrompt(session, tier1);
  
  const response = await callLLM(llmConfig, prompt);
  
  // 解析结构化输出
  return parseDistillOutput(response);
}
```

### 4.5 触发策略

| 条件 | Tier 1 | Tier 2 | 说明 |
|------|--------|--------|------|
| 工具调用 < 3 且 轮次 < 5 | ✅ | ❌ | 简单会话，不蒸馏 |
| 工具调用 ≥ 3 或 轮次 ≥ 5 | ✅ | ✅ | 标准蒸馏 |
| 包含 /decision 标记 | ✅ | ✅ | 强制蒸馏 |
| 会话时长 > 10 分钟 | ✅ | ✅ | 长会话强制蒸馏 |
| 高频 Agent（>20 次/天）| ✅ | ⚠️ 采样 | 每 3 次触发 1 次 |

---

## 5. 分级注入策略 L0/L1/L2

### 5.1 现状

当前 `before-prompt-build.ts` 注入逻辑：
```typescript
// 当前：固定注入 self-model.md 全部内容
const selfModel = await readFile(selfModelPath, 'utf-8');
context.push({ role: 'system', content: selfModel });
```

问题：
- 所有会话都注入完整 self-model（可能 500+ tokens）
- 简单任务不需要完整上下文
- 没有根据任务复杂度分级

### 5.2 改造方案：动态分级注入

```typescript
// sidecar/src/hooks/before-prompt-build.ts

interface InjectionConfig {
  depth: 'l0' | 'l1' | 'l2';
  maxTokens: number;
  regions: string[];  // 注入哪些 region
}

const INJECTION_CONFIG: Record<string, InjectionConfig> = {
  l0: {
    maxTokens: 600,
    regions: ['identity', 'rules', 'meta']  // 只注入身份+规则+元数据
  },
  l1: {
    maxTokens: 1800,
    regions: ['identity', 'rules', 'runtime', 'meta']  // + 运行时学习
  },
  l2: {
    maxTokens: 5000,
    regions: ['identity', 'rules', 'runtime', 'decisions', 'patterns', 'meta']  // 全部
  }
};

function determineDepth(session: SessionContext): 'l0' | 'l1' | 'l2' {
  // 规则（优先级从高到低）:
  // 1. 如果当前 taskType 已指定 → 使用 taskType 对应的 depth
  // 2. 如果会话包含 /spec-create 或 /spec-execute → L2
  // 3. 如果用户消息包含 "架构"、"重构"、"设计"、"PRD"、"方案" → L2
  // 4. 如果当前会话工具调用数 > 5 → L1
  // 5. 其他 → L0
  
  if (session.taskType === 'architecture' || session.taskType === 'design') return 'l2';
  if (session.userMessages.some(m => /spec-(create|execute)/.test(m))) return 'l2';
  if (session.userMessages.some(m => /架构|重构|设计|PRD|方案/.test(m))) return 'l2';
  if (session.toolCalls.length > 5) return 'l1';
  return 'l0';
}

async function buildSelfModelInjection(
  agentId: string,
  session: SessionContext
): Promise<string> {
  const depth = determineDepth(session);
  const config = INJECTION_CONFIG[depth];
  
  // 读取 SELF_MODEL.md
  const selfModelPath = `~/Ai/Workspaces/${agentId}/SELF_MODEL.md`;
  const content = await readFile(selfModelPath, 'utf-8');
  
  // 按 region 提取内容
  const regions = extractRegions(content);
  
  // 按配置组装
  let injection = '';
  for (const regionName of config.regions) {
    const region = regions[regionName];
    if (region) {
      injection += `<!-- ${regionName} -->\n${region}\n\n`;
    }
  }
  
  // 截断到 maxTokens（粗略估算：1 token ≈ 4 chars）
  const maxChars = config.maxTokens * 4;
  if (injection.length > maxChars) {
    injection = injection.slice(0, maxChars) + '\n... (truncated)';
  }
  
  return injection;
}
```

### 5.3 各 Depth 注入内容

| Depth | 预算 | 注入 Region | 适用场景 |
|-------|------|-------------|----------|
| L0 | ≤600 tokens | Identity + Rules + Meta | 简单问答、工具调用 |
| L1 | ≤1800 tokens | + Runtime | 多轮对话、代码生成 |
| L2 | ≤5000 tokens | + Decisions + Patterns | 架构设计、方案评审 |

---

## 6. Sync 脚本方向反转

### 6.1 现状问题

当前 sync-self-models.sh：
```bash
# 当前：Workspace → Carrier（单向覆盖）
# 问题：每次同步会丢失 Carrier 中的运行时自反思内容
```

### 6.2 改造方案：Carrier → Workspace（单向合流）

```
Phase 2 新流程：

┌─────────────────┐         ┌─────────────────┐
│  Workspace      │         │  Carrier        │
│  SELF_MODEL.md  │ ←────── │  self-model.md  │
│  (唯一权威)      │  合流    │  (传输快照)      │
└─────────────────┘         └─────────────────┘
         ↑                           ↑
         │                           │
    人工编辑                      Sidecar 自动写入
    Region 1-2                    Region 3-6
```

### 6.3 合流策略

```typescript
// sidecar/src/services/workspace-writer.ts

async function mergeCarrierToWorkspace(
  agentId: string
): Promise<SyncResult> {
  // 1. 读取 Workspace SELF_MODEL.md（权威）
  const workspacePath = `~/Ai/Workspaces/${agentId}/SELF_MODEL.md`;
  const workspaceContent = await readFile(workspacePath, 'utf-8');
  
  // 2. 读取 Carrier self-model.md（快照）
  const carrierPath = `~/.memory-fabric/carriers/agents/${agentId}/private/self-model.md`;
  const carrierContent = await readFile(carrierPath, 'utf-8');
  
  // 3. 提取 Carrier 中的 Region 3-6 内容
  const carrierRegions = extractRegions(carrierContent);
  
  // 4. 合流到 Workspace（只更新 Region 3-6）
  let merged = workspaceContent;
  for (const region of ['runtime', 'decisions', 'patterns', 'meta']) {
    if (carrierRegions[region]) {
      merged = writeRegion(merged, region, carrierRegions[region]);
    }
  }
  
  // 5. 安全写入
  return safeWrite(workspacePath, merged, agentId);
}
```

### 6.4 触发时机

| 触发条件 | 频率 | 操作 |
|----------|------|------|
| agent_end 后 | 每次 | Workspace Writer 直接写入（实时） |
| 每日 cron（03:00）| 每日 | 全量合流检查 |
| 人工执行 sync | 按需 | 强制合流 |

---

## 7. Pattern Service / Graphify 激活

### 7.1 现状

PatternService 和 GraphifyService 已存在但处于"待机"状态：
- PatternService.detectPatterns() 只在每 5 条 experience 触发一次
- GraphifyService 只在手动调用时构建图谱

### 7.2 激活方案

#### Pattern Service 增强

```typescript
// sidecar/src/services/pattern-service.ts

interface PatternActivationConfig {
  // 触发条件
  minExperienceCount: 5;        // 最少经验条目
  minConfidence: 0.8;           // 最小置信度
  
  // 激活动作
  writeToSelfModel: true;       // 写入 SELF_MODEL.md Region 5
  shareToOtherAgents: true;     // 跨 Agent 共享
}

async function activatePatterns(agentId: string): Promise<void> {
  // 1. 检测模式
  const patterns = await detectPatterns(agentId);
  
  // 2. 筛选高置信度模式
  const highConfidencePatterns = patterns.filter(p => p.confidence >= 0.8);
  
  // 3. 写入 SELF_MODEL.md Region 5
  if (highConfidencePatterns.length > 0) {
    const workspaceWriter = new WorkspaceWriter();
    await workspaceWriter.sync(agentId, {
      patterns: highConfidencePatterns.map(p => ({
        description: p.description,
        frequency: p.frequency,
        successRate: p.successRate
      })),
      decisions: [],
      uncertainties: [],
      selfUpdate: `识别到 ${highConfidencePatterns.length} 个高置信度模式`
    });
  }
  
  // 4. 跨 Agent 共享（SharingService）
  for (const pattern of highConfidencePatterns) {
    if (pattern.confidence >= 0.9) {
      await sharingService.sharePattern(pattern, allAgentIds);
    }
  }
}
```

#### Graphify 自动刷新

```typescript
// sidecar/src/services/graphify-service.ts

interface GraphifyActivationConfig {
  // 触发条件
  staleThresholdDays: 7;        // 图谱新鲜度阈值
  
  // 激活动作
  autoRebuild: true;            // 自动重建
  incrementalUpdate: true;      // 增量更新（只扫描变更文件）
}

async function activateGraphify(agentId: string): Promise<void> {
  // 1. 检查图谱新鲜度
  const lastBuild = await getLastBuildTime(agentId);
  const isStale = Date.now() - lastBuild > 7 * 24 * 60 * 60 * 1000;
  
  if (!isStale) return;
  
  // 2. 增量扫描（只扫描变更文件）
  const changedFiles = await getChangedFiles(agentId, lastBuild);
  
  // 3. 更新图谱
  if (changedFiles.length > 0) {
    await incrementalBuild(agentId, changedFiles);
  }
  
  // 4. 更新 SELF_MODEL.md Region 6（Meta）
  const workspaceWriter = new WorkspaceWriter();
  await workspaceWriter.sync(agentId, {
    patterns: [],
    decisions: [],
    uncertainties: [],
    selfUpdate: `图谱已更新，扫描 ${changedFiles.length} 个文件`
  });
}
```

### 7.3 激活触发时机

| 服务 | 触发条件 | 频率 |
|------|----------|------|
| Pattern Service | experience 条目每满 5 条 | 自动 |
| Pattern Service | 每日 cron（03:00）| 每日 |
| Graphify | 图谱新鲜度 > 7 天 | 每日检查 |
| Graphify | 文件变更数 > 10 | 即时 |

---

## 8. 低频 Agent 激活机制

### 8.1 问题

低频 Agent（如 userservice、brand）长时间不激活，导致：
- self-model 长期不更新
- 经验积累停滞
- 与其他 Agent 的认知差距拉大

### 8.2 激活机制设计

```typescript
// sidecar/src/services/activation-service.ts

interface ActivationConfig {
  // 低频定义
  inactiveThresholdDays: 3;     // 3 天无会话视为低频
  
  // 激活动作
  pushSelfActivationTask: true;  // 推送自我激活任务
  
  // 任务内容
  taskTemplate: `请回顾最近的工作，更新你的 SELF_MODEL.md：
1. 检查 Region 3（Runtime）是否有新的学习
2. 检查 Region 4（Decisions）是否有待确认的决策
3. 检查 Region 5（Patterns）是否有新的模式
4. 更新 Region 6（Meta）的置信度和时间戳`;
}

async function checkAndActivateInactiveAgents(): Promise<void> {
  // 1. 获取所有 Agent 的最后活跃时间
  const agents = await getAllAgents();
  
  for (const agent of agents) {
    const lastActive = await getLastActiveTime(agent.id);
    const inactiveDays = (Date.now() - lastActive) / (24 * 60 * 60 * 1000);
    
    if (inactiveDays >= ACTIVATION_CONFIG.inactiveThresholdDays) {
      // 2. 推送自我激活任务
      await pushActivationTask(agent.id);
      
      // 3. 记录激活日志
      await logActivation(agent.id, inactiveDays);
    }
  }
}

async function pushActivationTask(agentId: string): Promise<void> {
  // 通过 OpenClaw 的 cron 或消息机制推送任务
  // 实际实现：写入 activation-queue.jsonl，由 cron 消费
  const task = {
    agentId,
    type: 'self-activation',
    priority: 'low',
    createdAt: new Date().toISOString(),
    content: ACTIVATION_CONFIG.taskTemplate
  };
  
  await appendJsonl('~/.memory-fabric/activation-queue.jsonl', task);
}
```

### 8.3 激活任务消费

```typescript
// sidecar/src/cron/activation-consumer.ts

async function consumeActivationTasks(): Promise<void> {
  const tasks = await readJsonl('~/.memory-fabric/activation-queue.jsonl');
  
  for (const task of tasks) {
    if (task.type === 'self-activation') {
      // 1. 触发 Agent 的自我审计
      await triggerSelfModelAudit(task.agentId);
      
      // 2. 等待 Agent 完成审计（异步）
      // 实际：Agent 收到任务后自行处理
      
      // 3. 清理已消费任务
      await removeTask(task.id);
    }
  }
}
```

### 8.4 触发时机

| 触发条件 | 频率 | 操作 |
|----------|------|------|
| 每日 cron（23:30）| 每日 | 检查所有 Agent 活跃度 |
| Agent 连续 3 天无会话 | 自动 | 推送自我激活任务 |
| 人工触发 | 按需 | 强制激活指定 Agent |

---

## 9. 系统架构总览

### 9.1 数据流图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OpenClaw Gateway                               │
│                                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   Agent     │ ←→ │   Plugin    │ ←→ │   Sidecar   │                 │
│  │  (Runtime)  │    │ (Hooks)     │    │  (Server)   │                 │
│  └─────────────┘    └─────────────┘    └──────┬──────┘                 │
│                                                │                        │
└────────────────────────────────────────────────┼────────────────────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────┐
                    │                            │                        │
                    ↓                            ↓                        ↓
           ┌─────────────┐            ┌─────────────────┐      ┌─────────────────┐
           │  Workspace  │            │   Carrier       │      │   OpenViking    │
           │ SELF_MODEL  │ ←────────  │  self-model.md  │      │  memories.jsonl │
           │    .md      │   合流     │  (传输快照)      │      │  (向量存储)      │
           └─────────────┘            └─────────────────┘      └─────────────────┘
                    ↑                            │                        │
                    │                            │                        │
                    │                    ┌───────┴───────┐                │
                    │                    │               │                │
                    │                    ↓               ↓                │
                    │           ┌─────────────┐  ┌─────────────┐         │
                    │           │  Experience │  │   Pattern   │         │
                    │           │   Store     │  │   Store     │         │
                    │           │(经验积累)    │  │ (模式识别)   │         │
                    │           └─────────────┘  └─────────────┘         │
                    │                                                    │
                    │           ┌─────────────────┐                      │
                    └────────── │  Graphify       │ ←────────────────────┘
                                │  (知识图谱)      │
                                └─────────────────┘
```

### 9.2 模块依赖图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Sidecar Server                            │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Routes    │  │   Services  │  │        Stores           │ │
│  │             │  │             │  │                         │ │
│  │ /commit     │→ │ Distill     │→ │ ExperienceStore         │ │
│  │ /recall     │  │   Service   │  │   (经验条目)             │ │
│  │ /carrier    │  │             │  │                         │ │
│  │ /graphify   │→ │ Workspace   │→ │ PatternStore            │ │
│  │ /pattern    │  │   Writer    │  │   (模式条目)             │ │
│  │             │  │   (新增)     │  │                         │ │
│  │             │→ │ Experience  │→ │ VectorStore             │ │
│  │             │  │   Service   │  │   (向量索引)             │ │
│  │             │  │             │  │                         │ │
│  │             │→ │ Pattern     │→ │ GraphStore              │ │
│  │             │  │   Service   │  │   (图谱数据)             │ │
│  │             │  │   (激活)     │  │                         │ │
│  │             │→ │ Graphify    │  │                         │ │
│  │             │  │   Service   │  │                         │ │
│  │             │  │   (激活)     │  │                         │ │
│  │             │→ │ Sharing     │  │                         │ │
│  │             │  │   Service   │  │                         │ │
│  │             │→ │ Scoring     │  │                         │ │
│  │             │  │   Service   │  │                         │ │
│  │             │→ │ Lifecycle   │  │                         │ │
│  │             │  │   Service   │  │                         │ │
│  │             │→ │ Activation  │  │                         │ │
│  │             │  │   Service   │  │                         │ │
│  │             │  │   (新增)     │  │                         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      Hooks (Plugin)                          ││
│  │  ┌─────────────┐              ┌─────────────────────────┐   ││
│  │  │ agent-end   │ → Tier 1     │ before-prompt-build     │   ││
│  │  │             │   快速蒸馏    │                         │   ││
│  │  │             │ → 异步 Tier 2 │ → 分级注入 L0/L1/L2     │   ││
│  │             │               │                         │   ││
│  └─────────────┘              └─────────────────────────┘   ││
└─────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘

### 9.3 改造范围清单

| 模块 | 改造类型 | 说明 |
|------|----------|------|
| Workspace Writer | 新增 | 核心模块，负责 Workspace SELF_MODEL.md 写入 |
| Distill Service | 改造 | 增加 Tier 1/2 异步蒸馏 |
| before-prompt-build | 改造 | 增加分级注入 L0/L1/L2 |
| sync-self-models.sh | 改造 | 方向反转：Carrier → Workspace |
| Pattern Service | 激活 | 增加写入 SELF_MODEL.md 能力 |
| Graphify Service | 激活 | 增加自动刷新机制 |
| Activation Service | 新增 | 低频 Agent 激活机制 |
| Experience Service | 保留 | 现有逻辑不变 |
| Sharing Service | 保留 | 现有逻辑不变 |
| Scoring Service | 保留 | 现有逻辑不变 |
| Lifecycle Service | 保留 | 现有逻辑不变 |
| OpenViking Service | 保留 | 现有逻辑不变 |

---

## 10. 实施计划

### 10.1 开发阶段

| 阶段 | 内容 | 预计工期 | 依赖 |
|------|------|----------|------|
| Phase 1 | Workspace Writer 模块开发 | 1 天 | 无 |
| Phase 2 | Distill Service Tier 2 改造 | 1 天 | Phase 1 |
| Phase 3 | 分级注入 L0/L1/L2 改造 | 0.5 天 | Phase 1 |
| Phase 4 | Sync 脚本方向反转 | 0.5 天 | Phase 1 |
| Phase 5 | Pattern/Graphify 激活 | 1 天 | Phase 1 |
| Phase 6 | 低频 Agent 激活机制 | 0.5 天 | Phase 5 |
| Phase 7 | 集成测试 + 验收 | 1 天 | 全部 |

**总预计工期：5.5 天**

### 10.2 风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| Workspace 文件写入权限 | 高 | 使用 Node.js fs 模块，确保 sidecar 进程有写权限 |
| Region 标记格式不一致 | 中 | 提供初始化脚本，自动为现有 SELF_MODEL.md 添加标记 |
| LLM 调用超时 | 中 | Tier 2 异步处理，超时后降级为 Tier 1 结果 |
| 高频 Agent 采样丢失 | 低 | 采样策略可配置，默认每 3 次触发 1 次 |
| Carrier 与 Workspace 冲突 | 中 | 合流策略优先 Workspace，Carrier 只更新 Region 3-6 |

### 10.3 验收标准

#### P0 验收（核心功能）
- [ ] Workspace SELF_MODEL.md 被正确更新（Region 3-6）
- [ ] Region 1-2 未被触碰
- [ ] agent_end 总耗时 ≤ 500ms
- [ ] 备份机制正常工作

#### P1 验收（体验优化）
- [ ] 分级注入策略正确生效（L0/L1/L2）
- [ ] Pattern Service 自动写入 Region 5
- [ ] Graphify 自动刷新 ≤ 7 天

#### P2 验收（完整功能）
- [ ] 低频 Agent 激活机制正常工作
- [ ] 跨 Agent 模式共享成功推送
- [ ] 中文对话 distill 准确率 ≥ 70%

---

## 11. 附录

### 11.1 环境变量配置

```bash
# Distill LLM 配置（Tier 2）
DISTILL_LLM_BASE_URL=https://api.deepseek.com
DISTILL_LLM_MODEL=deepseek-v4-flash
DISTILL_LLM_API_KEY=sk-...

# Workspace Writer 配置
WORKSPACE_BACKUP_DIR=~/.memory-fabric/backups
WORKSPACE_MAX_BACKUPS=10

# 分级注入配置
INJECTION_L0_MAX_TOKENS=600
INJECTION_L1_MAX_TOKENS=1800
INJECTION_L2_MAX_TOKENS=5000

# 激活机制配置
ACTIVATION_INACTIVE_DAYS=3
ACTIVATION_TASK_PRIORITY=low

# Pattern/Graphify 配置
PATTERN_MIN_CONFIDENCE=0.8
PATTERN_SHARE_CONFIDENCE=0.9
GRAPHIFY_STALE_DAYS=7
```

### 11.2 关键文件路径

| 文件 | 路径 |
|------|------|
| Workspace SELF_MODEL.md | `~/Ai/Workspaces/{agent}/SELF_MODEL.md` |
| Carrier self-model.md | `~/.memory-fabric/carriers/agents/{agent}/private/self-model.md` |
| Workspace Writer | `packages/sidecar/src/services/workspace-writer.ts` |
| Distill Service | `packages/sidecar/src/services/distill-service.ts` |
| before-prompt-build | `packages/sidecar/src/hooks/before-prompt-build.ts` |
| Pattern Service | `packages/sidecar/src/services/pattern-service.ts` |
| Graphify Service | `packages/sidecar/src/services/graphify-service.ts` |
| Activation Service | `packages/sidecar/src/services/activation-service.ts` |

---

_本文档为技术架构设计输入。开发实施前需经康老板审核确认。_

│