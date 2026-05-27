# Memory Fabric Phase 2 — 产品设计文档

## 从"能记"到"会进化"：SELF_MODEL 合流与自我进化体系

**文档类型**：产品设计说明书（Product Design）  
**版本**：v1.0  
**日期**：2026-05-26  
**作者**：棱镜 Prism 🔷  
**输入**：03-phase-2-self-evolution-prd.md（麦斯威 需求文档）  
**适用对象**：弧极 Arc 🌀（技术架构设计）、康老板（审核）

---

## 0. 设计原则

在进入具体设计之前，先确立三条原则：

### 原则 1：Workspace 是唯一权威

每个 Agent 的 `~/Ai/Workspaces/{Agent}/SELF_MODEL.md` 是 Agent 自我认知的**唯一权威来源**。
Carrier self-model.md 降级为"传输层快照 + 审计备份"，不再承担自我认知的角色。

### 原则 2：分区治理，不越界

SELF_MODEL.md 被划分为 6 个 region。Region 1-2（Identity / Rules）由人/Agent 手动维护，
Region 3-6 由 sidecar 自动写入。自动写入**绝不触碰人工区域**。

### 原则 3：渐进式升级，不破坏现有

所有改动通过增量方式叠加到现有系统上。不修改 OpenClaw 核心，不修改 OpenViking/Graphify 源码。
现有的 distill、commit、carrier-merge 管道保留，在其上增加新的处理层。

---

## 1. 核心问题与设计目标

### 1.1 问题一句话

> **Agent 有两个自我认知，互相不认识对方。**

Workspace SELF_MODEL.md 定义了"我是谁"，但从不吸收运行时学习。
Carrier self-model.md 记录了运行时反思，但从不回流到 workspace。
sync 脚本单向覆盖反而抹掉了运行时积累。

### 1.2 设计目标

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

## 2. SELF_MODEL 数据结构设计

### 2.1 Region 划分

SELF_MODEL.md 使用 HTML 注释标记六个区域边界。Sidecar 只操作标记内的内容。

```markdown
# SELF_MODEL — {Agent Name} {Emoji}

<!-- region:identity-start -->
## 1. Identity（身份定义）
- Role:
- Capabilities:
- Current Focus:
<!-- region:identity-end -->

<!-- region:rules-start -->
## 2. Rules & Constraints（规则与约束）
- Red Lines:
- Behavioral Rules:
- Scope:
<!-- region:rules-end -->

<!-- region:runtime-start -->
## 3. Runtime Reflections（运行时反思）
### Current Understanding
（当前对项目、对角色、对用户的理解）
### Uncertainties
（当前已知的不确定项列表）
### Missing Evidence
（当前缺少的证据/数据/信息）
### Preferred Next Actions
（建议的下一步行动）
<!-- region:runtime-end -->

<!-- region:decisions-start -->
## 4. Decision Log（决策记录）
（最近 20 条决策，按时间倒序）
<!-- region:decisions-end -->

<!-- region:patterns-start -->
## 5. Pattern Library（模式库）
（已验证的可复用模式）
<!-- region:patterns-end -->

<!-- region:meta-start -->
## 6. Meta
- Updated At:
- Last User Interaction:
- Session Count (recent 30d):
- Confidence: medium
<!-- region:meta-end -->
```

### 2.2 各 Region 的读写权限

| Region | 谁写 | 谁读 | 写入策略 |
|--------|------|------|---------|
| Identity | 人/Agent（手动编辑） | Agent（每次会话注入） | ❌ Sidecar 禁止写入 |
| Rules | 人/Agent（手动编辑） | Agent（每次会话注入） | ❌ Sidecar 禁止写入 |
| Runtime Reflections | Sidecar（agent_end hook） | Agent（每次会话注入） | overwrite（每次 distill 后全量刷新） |
| Decision Log | Sidecar（agent_end hook） | Agent（按需注入） | dedup-append（去重追加，保留最近 20 条） |
| Pattern Library | Sidecar（PatternService 触发） | Agent（按需注入） | dedup-append（去重追加，按置信度降序） |
| Meta | Sidecar（自动） | Agent + 审计 | overwrite（每次 distill 后刷新时间戳和统计） |

### 2.3 决策记录条目格式

```markdown
#### {YYYY-MM-DD HH:MM} — {一句话总结}
- **Context**: {什么场景下做的决策}
- **Decision**: {具体做了什么决策}
- **Rationale**: {为什么这样做}
- **Alternatives**: {考虑过的其他方案}
- **Confidence**: high | medium | low
- **Source**: session:{sessionId}
```

### 2.4 模式库条目格式

```markdown
#### {模式名称}
- **Description**: {描述}
- **Trigger**: {触发条件}
- **Solution**: {解决方案模式}
- **Frequency**: {出现次数}
- **Success Rate**: {成功率}
- **Confidence**: {置信度}
- **Shared To**: [{Agent IDs}]（如果跨 Agent 分享过）
```

---

## 3. 核心流程设计

### 3.1 主流程：agent_end → distill → commit → carrier → workspace

这是整个自我进化体系的核心数据流。

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    AGENT SESSION                         │
                    │                                                         │
                    │  ① 会话开始                                              │
                    │     before_prompt_build hook                            │
                    │     ├─ 注入 Workspace SELF_MODEL.md (Region 1-6)        │
                    │     ├─ 注入 Structural Brief (L0/L1/L2 分层)            │
                    │     └─ 注入 Carrier decision-log.md (最近 5 条)         │
                    │                                                         │
                    │  ② 用户交互... 工具调用... 决策发生...                   │
                    │                                                         │
                    │  ③ agent_end hook 触发                                 │
                    └────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                   SIDECAR DISTILL                       │
                    │                                                         │
                    │  ④ distill-service.ts                                  │
                    │     ├─ Tier 1: heuristic 规则提取（快速、稳定）          │
                    │     ├─ Tier 2: LLM 结构化蒸馏（新增强制启用）            │
                    │     │   ├─ 提取 decisions[]（结构化决策）                │
                    │     │   ├─ 提取 patterns[]（模式识别）                   │
                    │     │   ├─ 提取 uncertainties[]（不确定项）              │
                    │     │   └─ 提取 selfUpdate（自我认知变化）              │
                    │     └─ 产出 distillResult                               │
                    │                                                         │
                    │  ⑤ commit（写入 memory/*.jsonl）                         │
                    └────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                  CARRIER MERGE                          │
                    │                                                         │
                    │  ⑥ carrier-merge（去重、排序、截断）                     │
                    │     ├─ self-model.md  ← 更新 Runtime Reflections        │
                    │     ├─ decision-log.md ← 追加决策记录                   │
                    │     ├─ entities-glossary.md ← 更新实体                  │
                    │     └─ pattern-store.md ← 写入新模式                    │
                    └────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │              WORKSPACE SYNC（NEW！）                     │
                    │                                                         │
                    │  ⑦ workspace-writer（新增 sidecar 模块）                │
                    │     ├─ Step 1: 备份 Workspace SELF_MODEL.md             │
                    │     │   → .memory-fabric/backups/{agent}/SELF_MODEL.{ts}.bak │
                    │     │                                                   │
                    │     ├─ Step 2: 解析 region 标记，定位可写区域            │
                    │     │   ├─ Region 3 (Runtime):     overwrite            │
                    │     │   ├─ Region 4 (Decisions):   dedup-append         │
                    │     │   ├─ Region 5 (Patterns):    dedup-append         │
                    │     │   └─ Region 6 (Meta):        overwrite            │
                    │     │                                                   │
                    │     ├─ Step 3: 写入                                        │
                    │     │                                                   │
                    │     └─ Step 4: 验证 + 通知                              │
                    │         ├─ ✅ 写入成功 → 发送飞书通知给康老板            │
                    │         └─ ❌ 写入失败 → 告警，但不阻塞 Agent            │
                    └─────────────────────────────────────────────────────────┘
```

### 3.2 状态机：SELF_MODEL 生命周期

```
                       ┌─────────────┐
                       │  DORMANT    │ ← Agent 超过 7 天无交互
                       │  (休眠)     │
                       └──────┬──────┘
                              │ 用户交互 or 触发式唤醒
                              ▼
                       ┌─────────────┐
          ┌────────────│   ACTIVE    │◄────────────────┐
          │            │  (活跃)     │                  │
          │            └──────┬──────┘                  │
          │                   │ agent_end hook           │
          │                   ▼                         │
          │            ┌─────────────┐                  │
          │            │  DISTILLING │                  │
          │            │  (蒸馏中)    │                  │
          │            └──────┬──────┘                  │
          │                   │                         │
          │     ┌─────────────┼─────────────┐           │
          │     ▼             ▼             ▼           │
          │  ┌──────┐   ┌──────────┐  ┌──────────┐     │
          │  │ NOOP │   │ MINOR    │  │ MAJOR    │     │
          │  │ 无变更│   │ 小幅更新  │  │ 重大更新  │     │
          │  └──┬───┘   └────┬─────┘  └────┬─────┘     │
          │     │             │              │           │
          │     │             ▼              ▼           │
          │     │     ┌─────────────┐ ┌─────────────┐   │
          │     │     │ 更新 Region │ │ 更新 Region │   │
          │     │     │ 3 + 6       │ │ 3+4+5+6     │   │
          │     │     │ 通知: none  │ │ 通知: 飞书   │   │
          │     │     └──────┬──────┘ └──────┬──────┘   │
          │     │            │               │           │
          │     └────────────┴───────────────┘           │
          │                         │                     │
          │                         ▼                     │
          │                  ┌─────────────┐              │
          │                  │  AUDITING   │              │
          │                  │  (审计中)   │              │
          │                  └──────┬──────┘              │
          │                         │                     │
          │                         ▼                     │
          │                  ┌─────────────┐              │
          │                  │   ACTIVE    │──────────────┘
          │                  │  (回到活跃)  │
          │                  └─────────────┘
          │
          │  （如果发现 stale > 7 天）
          ▼
    ┌─────────────┐
    │ SELF-HEAL   │ ← self-model-audit 触发
    │ (自愈)      │   推送自我激活任务
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   ACTIVE    │ ← 完成 post-task-distill
    │  (恢复活跃)  │
    └─────────────┘
```

**状态说明**：

| 状态 | 触发条件 | 行为 |
|------|---------|------|
| ACTIVE | 正常会话交互 | 正常 distill → commit → merge → workspace sync |
| DISTILLING | agent_end hook 触发 | 执行 distill pipeline，产出结构化提取结果 |
| NOOP | distill 未发现新内容 | 跳过 workspace sync，不发送通知 |
| MINOR | distill 发现 Runtime Reflections 有新内容但无新决策 | 更新 Region 3 + 6，不发送通知 |
| MAJOR | distill 发现新决策或新模式 | 更新 Region 3+4+5+6，发送飞书通知 |
| AUDITING | self-model-audit cron 触发 | 检查新鲜度、内容质量，标记 stale agent |
| DORMANT | 连续 7 天无用户交互 | 标记为 dormant，等待唤醒 |
| SELF-HEAL | audit 发现 stale agent 且最近有活动 | 推送自我激活任务，执行 post-task-distill |

### 3.3 通知策略

| 事件 | 通知方式 | 频率 | 接受者 |
|------|---------|------|--------|
| SELF_MODEL 重大更新（新决策/新模式） | 飞书 DM | 实时 | 康老板 |
| 模式跨 Agent 分享 | 飞书 DM | 实时 | 康老板 |
| Agent 进入 DORMANT 状态 | 飞书 DM | 每日汇总 | 康老板 |
| SELF_MODEL 写入失败 | 飞书 DM | 实时 | 康老板 + 弧极 |
| MEMORY.md 健康报告 | 飞书 DM | 每周一 | 康老板 |
| Graphify 图谱 stale > 7 天 | 飞书 DM | 每日 | 弧极 |

---

## 4. 分级注入策略（Token Budget）

### 4.1 为什么要分级

当前 before_prompt_build hook 向每个 Agent 注入大量上下文（Structural Brief + Carrier self-model + decision-log 等），
这对低频 Agent 是 token 浪费。分级注入根据任务复杂度动态控制注入量。

### 4.2 三级注入

```
┌──────────────────────────────────────────────────────────────────┐
│                    L0: 浅层任务 (< 600 tokens)                    │
│                                                                  │
│  触发: 简单问答、状态查询、单步操作                                 │
│  注入:                                                           │
│    ✅ Workspace SELF_MODEL Region 1-2 (Identity + Rules)          │
│    ✅ Workspace SELF_MODEL Region 3 (Runtime Reflections)         │
│    ❌ Structural Brief（不注入图谱）                               │
│    ❌ Decision Log（不注入决策历史）                               │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                    L1: 中等任务 (< 1800 tokens)                   │
│                                                                  │
│  触发: 多步操作、数据分析、中度复杂度开发                            │
│  注入:                                                           │
│    ✅ L0 全部内容                                                 │
│    ✅ Structural Brief Top 5 核心实体 + 3 条最近决策               │
│    ✅ Workspace SELF_MODEL Region 4 (最近 5 条决策)               │
│    ❌ 完整图谱（不注入）                                          │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                    L2: 复杂任务 (< 5000 tokens)                   │
│                                                                  │
│  触发: 架构设计、跨模块重构、PRD 撰写                              │
│  注入:                                                           │
│    ✅ L1 全部内容                                                 │
│    ✅ 完整 Structural Brief                                      │
│    ✅ Workspace SELF_MODEL Region 4 (全部 20 条决策)              │
│    ✅ Workspace SELF_MODEL Region 5 (Pattern Library)             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 深度判定逻辑

```
判定函数: determineDepth(sessionContext) → 'l0' | 'l1' | 'l2'

规则（优先级从高到低）:
1. 如果当前 taskType 已指定 → 使用 taskType 对应的 depth
2. 如果会话包含 /spec-create 或 /spec-execute → L2
3. 如果用户消息包含 "架构"、"重构"、"设计"、"PRD"、"方案" → L2
4. 如果当前会话工具调用数 > 5 → L1
5. 其他 → L0
```

### 4.4 L0/L1/L2 在各流程中的应用

| 流程 | L0 | L1 | L2 |
|------|-----|-----|-----|
| before_prompt_build hook（注入量） | 600 tokens | 1800 tokens | 5000 tokens |
| distill 深度 | 仅 Tier 1 heuristic | Tier 1 + 轻量 Tier 2 | Tier 1 + 完整 Tier 2 |
| SELF_MODEL 更新 | 仅 Runtime | Runtime + 决策 | Runtime + 决策 + 模式 |
| 通知 | none | none（除非新模式） | 飞书 DM |

---

## 5. 关键模块改造设计

### 5.1 Workspace Writer（新增 sidecar 模块）

这是整个 Phase 2 最关键的新模块。它负责将 carrier 的 distill 结果写回 workspace SELF_MODEL.md。

**模块路径**：`packages/sidecar/src/services/workspace-writer.ts`

**核心 API**：

```typescript
interface WorkspaceWriter {
  /**
   * 将 distill 结果写入 workspace SELF_MODEL.md
   * @returns 写入结果，包含变更摘要
   */
  sync(agentId: string, result: DistillResult): Promise<SyncResult>;
}

interface SyncResult {
  agentId: string;
  regions: {
    runtime: 'noop' | 'updated';      // Region 3
    decisions: 'noop' | 'appended';    // Region 4
    patterns: 'noop' | 'appended';     // Region 5
    meta: 'noop' | 'updated';          // Region 6
  };
  changeSummary: string;               // 人类可读的变更摘要
  backupPath?: string;                 // 备份文件路径
  error?: string;                      // 如果写入失败
}
```

**安全机制**（继承 Region 标记约束）：
1. 写入前：备份 workspace SELF_MODEL.md → `.memory-fabric/backups/{agent}/SELF_MODEL.{timestamp}.bak`
2. 定位 region：用正则 `/<!-- region:(identity|rules|runtime|decisions|patterns|meta)-(start|end) -->/` 定位区域边界
3. 仅替换标记内内容，标记外内容保持不动
4. Identity 和 Rules 区域标记内的内容**绝不覆盖**——如果 distill 触发时想写入这些区域，直接跳过
5. 写入失败 → 记录错误日志 + 通知康老板，**不阻塞 Agent 响应**

### 5.2 Distill Service 改造

**改造范围**：`packages/sidecar/src/services/distill-service.ts`

**新增 Tier 2 LLM 蒸馏**：

```typescript
interface DistillOptions {
  tier: 'tier1' | 'tier2';
  agentRole: string;  // 用于定制 distill prompt
  depth: 'l0' | 'l1' | 'l2';
}

interface StructuredDistillResult {
  decisions: Array<{
    summary: string;
    context: string;
    decision: string;
    rationale: string;
    alternatives: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;
  patterns: Array<{
    name: string;
    description: string;
    triggers: string[];
    solution: string;
    confidence: number;  // 0-1
  }>;
  uncertainties: Array<{
    question: string;
    context: string;
    resolved: boolean;
  }>;
  selfUpdate: string;  // 本次对话后自我认知的变化
}
```

**Tier 2 的 LLM 调用**：
- 通过 OpenClaw Gateway 的 LLM 能力（`gateway.llm`），而非 sidecar 自己向外部请求
- LLM 调用在 agent_end hook 结束后异步执行，不阻塞 Agent 主流程
- 如果 LLM 调用失败，fallback 到 Tier 1 heuristic
- 如果 L0 深度，跳过 Tier 2（节省 token 成本）

### 5.3 Sync 脚本改造

**当前**：`sync-self-models.sh` 做 Workspace → Carrier 单向覆盖（会抹掉 carrier 的运行时内容）

**改造后**：
```bash
# sync-self-models.sh 行为改造:
# 1. 不再覆盖 carrier self-model.md
# 2. 只做两件事:
#    a. 检查 workspace SELF_MODEL.md 是否缺少 region 标记 → 迁移
#    b. 检查 workspace SELF_MODEL.md 是否缺少 Region 3-6 内容 → 从 carrier 补充
# 3. 更名为 sync-to-workspace.sh 以反映新方向
```

### 5.4 Pattern Service 激活

**当前**：PatternService 检测模式后存入 pattern-store，但不通知 Agent

**新增**：
1. 模式触发条件满足时 → 写入 SELF_MODEL Pattern Library (Region 5)
2. 调用 SharingService 找相似 Agent → 推送模式
3. 发送飞书通知："{Agent Name} 发现了一个可复用模式：{pattern name}"

### 5.5 Graphify 激活

**当前**：图谱 stale 20 天，structural brief 标注 "freshness: stale"

**改造**：
1. **增量刷新**：文件变更时触发（监控 workspace 和 carrier 文件变更）
2. **全量刷新**：每周一次（取代永不刷新）
3. **噪声过滤增强**：
   - 实体最小长度：中文 ≥ 2 字符，英文 ≥ 3 字符
   - 过滤纯数字、纯标点实体
   - 过滤出现次数 ≤ 1 的孤立实体
4. **新鲜度检查**：self-model-audit 中增加 Graphify 新鲜度项

---

## 6. 低频 Agent 激活机制

### 6.1 问题

marketing、userservice、assistant 三个 Agent 长期无用户交互，自我进化完全停滞。

### 6.2 方案：触发式唤醒 + 自然任务流入

| Agent | 唤醒方式 | 实施难度 |
|-------|---------|---------|
| **marketing** | 依赖 ops 的每日快报数据注入 → 营销自动分析 | 低（管道已有） |
| **userservice** | 钉钉群消息 webhook → 自动激活处理 | 中（需要 webhook 配置） |
| **assistant** | self-model-audit 发现 stale → 推送自我激活任务 | 低（管道已有） |

### 6.3 流程

```
self-model-audit cron (每日 23:30)
    │
    ├─ 检测到 Agent stale > 7 天
    │
    ├─ 如果 Agent 最近 30 天有过任何 session 记录
    │   └─ 推送 "self-activation" task:
    │      → sessions_spawn agent={id}, task="执行 post-task-distill，扫描最近 session，更新 self-model"
    │
    └─ 如果 Agent 最近 30 天零活动
        └─ 标记为 "dormant"，通知康老板
```

---

## 7. 迁移方案

### 7.1 现有 11 个 Agent 迁移步骤

**Step 1：创建缺失的 Workspace SELF_MODEL**（assistant、userservice）
- 基于 AGENTS.md + Carrier self-model.md 生成初始版本

**Step 2：为所有现有 Workspace SELF_MODEL 添加 Region 标记**
- 现有内容归入 Region 1-2（Identity + Rules）
- 从 Carrier self-model.md 提取 Region 3（Runtime Reflections）、Region 4（Decision Log）
- 添加空的 Region 5-6

**Step 3：改造 sync 脚本**
- 从 Workspace → Carrier 单向覆盖改为 Carrier → Workspace 区域合并

**Step 4：全量验证**
- 跑一轮所有 Agent 的 agent_end hook → distill → ws-sync，验证每个 Agent 的 SELF_MODEL 正确更新

### 7.2 迁移脚本设计

```bash
# migrate-self-models.sh
# 1. 备份所有现有文件
# 2. 为每个 workspace SELF_MODEL.md 添加 region 标记
# 3. 从 carrier 提取 Region 3-4 内容填充
# 4. 为空 Agent 创建初始 SELF_MODEL.md
# 5. 输出迁移报告
```

---

## 8. 数据流总结图

```
                          ┌─────────────────────────────────┐
                          │         康老板（飞书）            │
                          │                                 │
                          │  ▲ 通知: 重大更新/模式发现/异常    │
                          │  │                               │
                          │  │ 手动编辑                      │
                          │  ▼                              │
                          │  Workspace SELF_MODEL.md         │
                          │  (Region 1-2: Identity/Rules)    │
                          └────────────┬────────────────────┘
                                       │
                        注入 Workspace │ 写入 Workspace
                        SELF_MODEL     │ SELF_MODEL
                        (Region 1-6)   │ (Region 3-6)
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         │                             │                             │
         ▼                             │                             ▼
┌──────────────────┐                   │                   ┌──────────────────┐
│ before_prompt    │                   │                   │ Workspace Writer │
│ _build hook      │                   │                   │ (新模块)         │
│                  │                   │                   │                  │
│ L0/L1/L2 分层    │                   │                   │ backup → parse   │
│ 注入到 Agent     │                   │                   │ → write → verify │
│ prompt 中        │                   │                   │ → notify         │
└────────┬─────────┘                   │                   └────────▲─────────┘
         │                             │                            │
         │                             │                            │
         ▼                             │                            │
┌──────────────────┐                   │                   ┌──────────────────┐
│ Agent Session    │                   │                   │ Carrier Merge    │
│                  │                   │                   │                  │
│ 用户交互         │                   │                   │ self-model.md    │
│ 工具调用         │                   │                   │ decision-log.md  │
│ 决策发生         │                   │                   │ entities.md      │
│                  │                   │                   │ pattern-store.md │
└────────┬─────────┘                   │                   └────────▲─────────┘
         │                             │                            │
         │ agent_end hook              │                            │
         ▼                             │                            │
┌──────────────────┐                   │                   ┌──────────────────┐
│ Distill Service  │                   │                   │ Commit           │
│                  │                   │                   │                  │
│ Tier 1: heuristic│───────────────────┼──────────────────▶│ memory/*.jsonl   │
│ Tier 2: LLM      │                   │                   │                  │
│ (异步，不阻塞)   │                   │                   │                  │
└──────────────────┘                   │                   └──────────────────┘
                                       │
                          ┌────────────┴────────────────────┐
                          │         Sidecar 进程             │
                          │  (distill → commit → carrier     │
                          │   merge → workspace write)       │
                          └─────────────────────────────────┘
```

---

## 9. 与 spec-workflow 的联动（Phase 2 增强）

Claude Code 的 spec-workflow 和 Memory Fabric 可以形成互补：

| spec-workflow 能力 | Memory Fabric 联动 |
|-------------------|-------------------|
| `/spec-create` 创建 spec | 自动写入 SELF_MODEL Decision Log："创建了 spec: {name}" |
| `/spec-execute` 完成任务 | 自动记录 Pattern："{task-type} 的完成模式：{approach}" |
| `/spec-steering-setup` 生成项目文档 | Graphify 增量刷新，图谱纳入新文档 |
| `/bug-create` → `/bug-fix` | 记录为 Pattern Library 中的 bug 修复模式 |

---

## 10. Phase 2 不做什么（明确定界）

以下明确不在 Phase 2 范围内：

- ❌ 不修改 OpenClaw 核心源码
- ❌ 不修改 OpenViking / Graphify 源码
- ❌ SELF_MODEL 不同步到 Claude Code（Claude Code 有自己的 CLAUDE.md 体系）
- ❌ 不实现全自动噪声清理（只做噪声标记和报告，清理由人确认）
- ❌ 不做 Agent 创建/销毁自动化
- ❌ 不做跨组织的记忆联邦同步

---

_本设计文档为技术架构设计的输入。弧极 Arc 可以在此基础上开始技术方案设计。任何质疑和改进建议都欢迎。_
