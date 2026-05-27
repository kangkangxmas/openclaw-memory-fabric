# OpenClaw Memory Fabric — 二期工程 PRD

## AI 团队记忆与自我进化体系全面升级

**文档版本**：v1.0（草案）  
**文档类型**：产品需求文档（PRD）  
**发布日期**：2026-05-26  
**作者**：麦斯威 ⚡  
**适用对象**：棱镜 Prism 🔷（产品设计）、弧极 Arc 🌀（技术架构设计）  
**状态**：待产品设计 → 技术方案 → 康老板确认 → 开发

---

## 1. 背景与动机

### 1.1 一期工程成果总结

OpenClaw Memory Fabric v1.8.0 已完成以下核心能力建设：

| 模块 | 状态 | 说明 |
|------|------|------|
| 多 Agent 记忆隔离 | ✅ 完成 | 每个 Agent 独立的 carrier 文件体系 |
| 跨天持久化 | ✅ 完成 | Sidecar 驱动的 JSONL 记忆存储 |
| 蒸馏管道 | ✅ 完成 | agent_end → distill → commit → carrier merge 全自动 |
| 短时→长时升级 | ✅ 完成 | Memory Dreaming Promotion cron 每日 03:00 |
| 知识图谱 | ✅ 完成 | Graphify 本地模式，30+ 文件扫描 → 图谱构建 |
| 经验提取 | ✅ 完成 | ExperienceService：工具调用≥3次触发 LLM 经验蒸馏 |
| 分层召回 | ✅ 完成 | L0/L1/L2 三级预算控制（600/1800/5000 tokens） |
| 工作区同步 | ✅ 完成 | launchd daily 23:00 Workspace → Carrier 单向同步 |
| 新鲜度巡检 | ✅ 完成 | boss 的 self-model-audit cron 每日 23:30 |
| OpenViking 集成 | ✅ 完成 | 向量存储 + 语义检索 + 衰减评分 |
| 跨项目联邦 | ✅ 完成 | FederationService：项目间记忆导入/导出 |
| 跨 Agent 共享 | ✅ 完成 | SharingService：高置信度模式自动推送 |

### 1.2 2026-05-26 全面审计发现的核心问题

2026-05-26 对 15 个 Agent 配置和 11 个活跃 Agent 进行的全面审计发现：

#### 🔴 P0：双重 SELF_MODEL 各自为政，无合流机制

**现状**：
- **Workspace SELF_MODEL.md**（`~/Ai/Workspaces/{Agent}/SELF_MODEL.md`）：人工编写的静态身份模板，内容简短（多数 12-23 行），Updated At 停留在 2026-05-25（sync 脚本写入后长期不变）
- **Carrier self-model.md**（`~/.memory-fabric/carriers/agents/{Agent}/private/self-model.md`）：Memory Fabric 侧车每次 agent_end 后自动写入的运行时自反思（Current Goal → Understood → Uncertain → Missing Evidence → Preferred Next Actions）

**问题**：
- Workspace SELF_MODEL 定义了身份但从不吸收运行时的真实认知——它是一张不会更新的"身份证"
- Carrier self-model 持续积累自反思但从不回流到 workspace——它是 Agent 的"私人日记"但从不出门
- sync-self-models.sh 单向覆盖（Workspace → Carrier），每次同步会丢失 Carrier 中的自反思内容
- **结果是：Agent 有两个自我认知，互相不认识对方**

**证据**：
- Workspace boss SELF_MODEL：20 行，只有 Role + Current Focus + Capabilities
- Carrier boss self-model：运行时动态更新，但 sync 后会被 workspace 覆盖
- main 的 Workspace 125 行（含 Distill Log、Uncertainties、Confidence），是唯一做得好的模板

#### 🔴 P1：Workspace SELF_MODEL 严重空心化

除 main Agent 外，所有 Agent 的 workspace SELF_MODEL 都缺少：

- ❌ 历史决策记录（做了什么决策、为什么）
- ❌ 已知模式沉淀（反复出现的问题和处理方式）
- ❌ 不确定性追踪（当前已知什么不确定、需要什么新证据）
- ❌ 置信度自评（对自己能力边界的准确判断）

**数据**：主流 Agent workspace SELF_MODEL 行数：
- boss: 20 行 | brand: 12 行 | development: 11 行 | hr: 12 行
- marketing: 23 行 | ops: 14 行 | product: 12 行
- main（参考基准）: 125 行

#### 🟡 P2：两个 Agent 缺少 Workspace SELF_MODEL

- **assistant（小企鹅）**：有 Carrier self-model（最后更新 2026-05-24），无 Workspace SELF_MODEL.md
- **UserService**：有 Carrier self-model（最后更新 2026-05-25），无 Workspace SELF_MODEL.md

#### 🟡 P2：MEMORY.md 自动化写入质量不稳定

Memory Dreaming Promotion 每天从短时记忆自动升级条目到 MEMORY.md，但：

- 大量条目被截断（不完整的句子上带有 `[score=...]` 标签但无实质内容）
- 缺少最小内容长度和质量过滤
- 从未被人工审查或清理
- 某些条目如 `"权 😄"`、`"很重要——名字是身份的一部分"`（重复 13 次）属于噪声

#### 🟡 P2：低频 Agent 的实际进化停滞

- **marketing（跃跃）**：Carrier self-model 曾在 5/25 审计中报告 11d stale，最近 5/25 更新但没有证据表明有实质性任务交互
- **userservice**：同样在审计中标记为 10d stale
- **assistant（小企鹅）**：自 5/6 以来几乎没有实际用户交互

#### 🔵 P3：决策日志质量差

Carrier 的 decision-log.md 中充满截断的碎片化内容：
- `"了 \`default\` 只能读顶级配置"`
- `"都在重复自己，像某种回声训练"`
- `"the \`feishu_bitable\` approach or see if there's another way"`

这些是 distill 的 rule-based 提取产生的碎片，既无上下文也不可追溯。

#### 🔵 P3：Graphify 知识图谱未被实际使用

所有 Agent 均有 Graphify 生成的图谱（~2.4MB 总计），但：
- 图谱最后一次全量生成是 2026-05-06
- 此后 stale 已 20 天
- before_prompt_build hook 产生的 Structural Brief 标注为 "freshness: stale"
- 报告中充斥噪声（如 "权 😄"、"off"、"message"、"text" 等无意义实体）
- 缺少有效的自动刷新触发机制

---

## 2. 二期工程目标

### 2.1 总体目标

**从"能记"升级为"会进化"**：让每个 AI Agent 拥有一个随着时间推移不断自我校准、自我完善的统一自我模型，使其真正具备自我认知和持续进化能力。

### 2.2 核心目标（按优先级）

| 优先级 | 目标 | 一句话描述 |
|--------|------|-----------|
| **P0** | SELF_MODEL 合流 | Workspace 和 Carrier self-model 从两套独立体系合并为单一权威来源 |
| **P1** | 自模型内容升级 | 所有 Agent 的 SELF_MODEL 补全决策记录、模式沉淀、不确定性追踪 |
| **P1** | 记忆质量治理 | MEMORY.md 质量过滤 + 决策日志可追溯 + 人群审流 |
| **P2** | 补齐缺失 | assistant 和 userservice 创建 Workspace SELF_MODEL |
| **P2** | Graphify 激活 | 知识图谱自动刷新 + 噪声过滤 + 实际注入到 Agent 推理中 |
| **P2** | 低频 Agent 激活 | 为 marketing/assistant/userservice 设计主动汇报或触发器机制 |
| **P3** | 蒸馏质量升级 | 从纯 heuristic 提取升级为 LLM 辅助的结构化蒸馏 |
| **P3** | 跨 Agent 协同进化 | 基于 SharingService 实现真正的"一个人学会 = 全团队受益" |

---

## 3. 需求详细说明

### 3.1 P0：SELF_MODEL 合流 —— 统一自我模型架构

#### 问题还原

```
当前状态：
┌──────────────────────────┐     ┌──────────────────────────┐
│  Workspace SELF_MODEL.md │     │  Carrier self-model.md   │
│                          │     │                          │
│  - 身份定义（人写）       │     │  - 运行时自反思（机器写） │
│  - 规则约束               │  ✗   │  - Current Goal           │
│  - 静态 Updated At        │  不  │  - Understood             │
│                          │  通  │  - Uncertain              │
│  单向覆盖 ↓ (sync 23:00) │     │  - Missing Evidence       │
│                          │     │  - Preferred Next Actions  │
└──────────────────────────┘     └──────────────────────────┘
```

#### 目标状态

```
目标状态：
┌─────────────────────────────────────────────────┐
│           Workspace SELF_MODEL.md               │
│               （唯一权威来源）                     │
│                                                 │
│  ## Identity（身份定义——人/Agent 编辑）           │
│  ## Rules & Constraints（规则——人/Agent 编辑）    │
│  ## Runtime Reflections（运行时——Sidecar 自动）  │
│     - Current Understanding                     │
│     - Uncertainties                             │
│     - Missing Evidence                          │
│     - Preferred Next Actions                    │
│  ## Decision Log（决策记录——Sidecar 自动）       │
│  ## Pattern Library（模式库——Sidecar 自动）      │
│  ## Confidence（置信度——自动计算）                │
│                                                 │
│  ↑ 写入                                      ↓ 载入 │
│  sync-self-models.sh                  before_prompt_build │
│  (Carrier ← Workspace)              (注入到 prompt)      │
└─────────────────────────────────────────────────┘
           ↕ 双向
┌─────────────────────────────────────────────────┐
│           Carrier self-model.md                  │
│           （运行时传输层 + 审计备份）               │
└─────────────────────────────────────────────────┘
```

#### 具体需求

1. **统一 SELF_MODEL 模板**：定义一套标准格式，包含以下 6 个区域：

   ```markdown
   # SELF_MODEL.md — {Agent Name} | {Emoji}

   ## 1. Identity（身份定义）
   - Role:
   - Capabilities:
   - Current Focus:

   ## 2. Rules & Constraints（规则与约束）
   - Red Lines:
   - Behavioral Rules:
   - Scope:

   ## 3. Runtime Reflections（运行时反思）← Sidecar 自动写入
   ### Current Understanding
   ### Uncertainties
   ### Missing Evidence
   ### Preferred Next Actions

   ## 4. Decision Log（决策记录）← Sidecar 自动写入
   <!-- 最近 10 条决策，按时间倒序 -->

   ## 5. Pattern Library（模式库）← Sidecar 自动写入
   <!-- 验证过的可复用模式 -->

   ## 6. Meta（元信息）
   - Updated At:
   - Last User Interaction:
   - Session Count (recent 30d):
   ```

2. **双向同步改造**：

   - **同步方向一（Deprecated）**：Workspace → Carrier 单向覆盖 → **改为 Carrier → Workspace 的指定区域合并写入**
   - **同步方向二（新增）**：Agent 运行时通过 agent_end hook → sidecar distill API → 写入 Workspace SELF_MODEL.md 的 Region 3-5（Runtime Reflections / Decision Log / Pattern Library）
   - 区域 1-2（Identity / Rules）始终由人/Agent 手动维护，sidecar **绝不覆盖**

3. **合并策略**：
   - Region 3 (Runtime Reflections)：**overwrite**（每次 distill 后刷新）
   - Region 4 (Decision Log)：**dedup-append**（去重追加，保留最近 20 条）
   - Region 5 (Pattern Library)：**dedup-append**（去重追加，按置信度降序）
   - Region 6 (Meta)：自动更新时间戳

4. **安全性**：
   - 写入前自动备份 Workspace SELF_MODEL.md → `.memory-fabric/backups/{agent}/SELF_MODEL.{timestamp}.bak`
   - 每次写入只操作区域标记内的内容（`<!-- region:xxx-start -->` ... `<!-- region:xxx-end -->`），不触碰区域外
   - 写入失败不阻塞 Agent 正常运行

---

### 3.2 P1：自模型内容升级 —— 决策记录与模式沉淀

#### 3.2.1 决策记录化

**当前**：decision-log.md 中全是截断的碎片（如 `"了 default 只能读顶级配置"`）

**目标**：每条决策从"一句话碎片"升级为结构化记录

**决策记录格式**：

```markdown
## {YYYY-MM-DD HH:MM}: {一句话总结}

- **Context**: {什么场景下做的决策}
- **Decision**: {具体做了什么决策}
- **Rationale**: {为什么这样做}
- **Alternatives Considered**: {考虑过的其他方案}
- **Outcome**: {结果如何}（后续更新）
- **Source**: {源 session ID}
```

**实现**：
- sidecar 的 distill API 增加 `llm: true` 调用（利用 OpenClaw Gateway 的 LLM 能力，而非 sidecar 自身请求外部模型）
- 或利用 agent_end hook 中已有的 agent 模型能力，在 commit 阶段做结构化提取

#### 3.2.2 模式沉淀

**当前**：PatternService 检测到模式后存入 pattern-store，但不会通知 Agent

**目标**：验证过的模式自动写入 SELF_MODEL，让 Agent 在后续对话中能"记住自己学过的东西"

**触发条件**（参考现有 PatternService 常量）：
- 同类型任务出现 ≥ 3 次
- 成功率 ≥ 80%
- 置信度 ≥ 0.9

**实现**：
- 满足条件的模式 → 写入 SELF_MODEL 的 Pattern Library 区域
- 同时推送一条飞书通知给康老板："{Agent Name} 发现了一个可复用的模式：{pattern summary}"

#### 3.2.3 不确定性追踪

**当前**：Carrier self-model 的 `Uncertain` 和 `Missing Evidence` 字段会随每次 agent_end 刷新，但上次的内容被覆盖后永久丢失

**目标**：不确定性追踪有记忆

**实现**：
- SELF_MODEL 中 Uncertainties 区域维护一个"已知未知"列表
- 每次 distill 后，新增的不确定项追加，不再不确定的标为 ✅ resolved
- 保留最近 20 条不确定项
- Agent 在每次对话开始时看到自己的 Uncertainties 列表，主动寻找解决机会

---

### 3.3 P1：记忆质量治理

#### 3.3.1 MEMORY.md 质量过滤

**问题**：Memory Dreaming Promotion 写入的条目质量参差不齐

**改进**：
- **最小内容长度**：条目 content 必须 ≥ 30 字符才写入
- **完整性检查**：截断检测——内容以标点、省略号、或非终止字符结尾的不写入
- **去重**：与 MEMORY.md 已有条目做语义去重（n-gram overlap ≥ 80% 跳过）
- **噪声过滤**：移除纯 emoji、纯标点、少于 3 个中文/英文词的内容

#### 3.3.2 决策日志可追溯

- 每条 decision-log 条目必须有源 session ID 引用
- 截断的旧条目做一次批量清理（归档而非删除）

#### 3.3.3 人群审流

- 每周一通过 boss 的 self-model-audit cron 附加一份"MEMORY.md 健康报告"：
  - 本周新增条目数
  - 质量评分（完整条目占比）
  - 噪声条目清单（供人工审查）

---

### 3.4 P2：补齐缺失

#### 3.4.1 assistant（小企鹅）SELF_MODEL 创建

- 基于 assistant 的 AGENTS.md（含 4 处蒸馏条款）和 Carrier self-model（已存在），生成一份初始 Workspace SELF_MODEL.md
- 模板参考 main 的格式，内容需体现 assistant 的「执行助理」角色

#### 3.4.2 UserService SELF_MODEL 创建

- 同理，基于已有 AGENTS.md 和 Carrier self-model 生成

---

### 3.5 P2：Graphify 知识图谱激活

#### 3.5.1 自动刷新

- 当项目文件变更时（新增/修改 .md 或 .ts 文件），触发增量图谱更新
- 至少每周全量刷新一次（取代当前的永不刷新状态）

#### 3.5.2 噪声过滤

- Entity stopwords 增强：当前的 stopwords 列表过滤了 "config", "data", "error" 等基础词，但实际图谱中仍有大量噪声（如 "off", "message", "text", "doc", "权 😄"）
- 增加：纯数字实体过滤、纯标点实体过滤、重复次数≤1 的孤立实体过滤
- 增加实体最小长度（≥2 个中文字符或 ≥3 个英文字符）

#### 3.5.3 分层注入策略

- **L0（浅层任务）**：不注入图谱 brief，避免浪费 token
- **L1（中等复杂度）**：注入 Top 5 核心实体 + 3 条最相关的决策
- **L2（复杂架构任务）**：注入完整 Structural Brief（当前行为）

#### 3.5.4 新鲜度健康检查

- 在 self-model-audit 中增加 Graphify 新鲜度检查
- 图谱生成超过 7 天 → 警告

---

### 3.6 P2：低频 Agent 激活

#### 问题

marketing、userservice、assistant 三个 Agent 长期无用户交互 → Carrier self-model stale → 自我进化完全停滞

#### 触发式唤醒方案

| Agent | 触发器 | 频率 | 说明 |
|-------|--------|------|------|
| **marketing** | 收入快报数据注入 | 每日（跟随 ops 的每日三班快报） | ops 的快报 cron 完成后 → 推送数据给 marketing → marketing 分析并产出增长建议 |
| **userservice** | 钉钉群新问题→自动激活 | 实时（钉钉 webhook） | 钉钉群收到用户问题时自动唤醒 userservice 处理 |
| **assistant** | 每日/每周摘要触发 | 每日/每周 | 如果长时间无任务流入，触发一次"本周团队状态摘要"任务 |

#### 自模型卡住兜底

- self-model-audit 检测到 stale > 7 天时，除了标记外，主动推送一个"自我激活任务"给该 Agent：
  - Agent 收到后执行一次 post-task-distill（扫描最近 session，更新 self-model）
  - 如果 Agent 确实无任何最近活动 → 标注状态为 "dormant"，提示康老板该 Agent 需要重新评估角色

---

### 3.7 P3：蒸馏质量升级

#### 当前局限

distill-service.ts 的 Tier 1（默认）是纯 heuristic 规则提取：
- 正则匹配决策句（`/决定|已决定|decided to/`）
- 正则匹配事实句（`/事实上|currently|系统使用/`）
- 正则匹配实体（CamelCase 或引号包裹词）

**问题**：中文对话中大量重要信息不符合这些模式，导致提取碎片化。

#### 升级方案

- **Tier 2 LLM 蒸馏默认启用**：利用 OpenClaw Gateway 自身的 LLM 能力（而非 sidecar 外部请求），在 agent_end hook 中触发结构化蒸馏
- 保留 Tier 1 作为 fallback（LLM 请求失败时）
- LLM 蒸馏的 prompt 模板需要针对不同 Agent 角色定制（产品、开发、运营等提取重点不同）

#### 蒸馏产出格式升级

从当前的碎片字符串数组升级为：

```json
{
  "decisions": [
    {
      "summary": "一句话",
      "context": "上下文",
      "rationale": "原因",
      "confidence": "high|medium|low"
    }
  ],
  "patterns": [
    {
      "description": "模式描述",
      "frequency": 3,
      "successRate": 0.9
    }
  ],
  "uncertainties": ["待确认项1", "待确认项2"],
  "selfUpdate": "本次对话后自我认知的变化"
}
```

---

### 3.8 P3：跨 Agent 协同进化

#### 当前

SharingService 基础设施已就位（Jaccard 相似度匹配、tool chain 分析），但实际推送是否生效未知。

#### 激活

- 当一个 Agent 的模式达到 ≥ 0.9 置信度时：
  1. 写入该 Agent 的 SELF_MODEL Pattern Library
  2. SharingService 找到 tool chain 相似的 Agent（Jaccard ≥ 0.6）
  3. 推送模式到目标 Agent 的 Carrier
  4. 发送飞书通知："{Source Agent} 学会了一个新模式，已分享给 {Target Agents}"
- 康老板可以 review 和 approve/reject 跨 Agent 分享

---

## 4. 技术实现约束

### 不侵入原则（继承一期）

- 不修改 OpenClaw 核心源码
- 不修改 OpenViking / Graphify 源码
- 所有能力通过 Memory Fabric 插件 + Sidecar + Skills 实现

### Workspace 安全红线（继承一期）

- `~/Ai/Services/openclaw/` 下文件不可修改
- Workspace SELF_MODEL.md 的 Identity / Rules 区域不可被自动化覆盖
- 所有自动写入操作必须有备份

### 康老板可见性

- 所有自模型变更、记忆升级、模式发现 → 必须飞书通知康老板
- 通知频率：重要事件实时通知，一般事件每日汇总

---

## 5. 交付物

| 序号 | 交付物 | 负责人 | 预期产出 |
|------|--------|--------|---------|
| 1 | 产品设计文档 | 棱镜 Prism | 针对本文档的详细产品设计，含交互流程图、状态机、数据流 |
| 2 | 技术架构设计 | 弧极 Arc | 详细技术方案，含 API 设计、数据模型、sidecar 改造范围、plugin 改造范围 |
| 3 | SELF_MODEL 统一模板 | 棱镜 + 弧极 | 包含 6 个区域的标准 Markdown 模板 |
| 4 | 实现代码 | 弧极 Arc | Memory Fabric v2.0，所有 P0-P3 功能 |
| 5 | 迁移脚本 | 弧极 Arc | 将现有 11 个 Agent 的 workspace SELF_MODEL 迁移为新格式的一键脚本 |

---

## 6. 验收标准

### P0 验收
- [ ] 任意 Agent 完成一次有实质性决策的对话后，其 Workspace SELF_MODEL.md 的 Runtime Reflections 区域被自动更新
- [ ] Identity / Rules 区域内容不被自动化覆盖
- [ ] 写入失败不阻塞 Agent 正常响应

### P1 验收
- [ ] 所有 Agent 的 Workspace SELF_MODEL 包含 6 个标准区域
- [ ] MEMORY.md 新增条目中，完整条目占比 ≥ 80%
- [ ] 决策日志条目包含 Context / Decision / Rationale 三个字段

### P2 验收
- [ ] assistant 和 userservice 有 Workspace SELF_MODEL.md
- [ ] Graphify 图谱新鲜度 ≤ 7 天
- [ ] structural brief 中噪声实体数量下降 ≥ 50%

### P3 验收
- [ ] 中文对话的 distill 准确率达到 ≥ 70%（人工抽查 20 条）
- [ ] 至少 1 次跨 Agent 模式分享被成功推送

---

## 7. 时间线建议

| 阶段 | 内容 | 预计 |
|------|------|------|
| Phase 1 | 棱镜产品设计 | 2-3 天 |
| Phase 2 | 弧极技术架构设计 | 2-3 天 |
| Phase 3 | 康老板 Review | 1 天 |
| Phase 4 | P0 + P1 实现 | 3-5 天 |
| Phase 5 | P2 实现 | 2-3 天 |
| Phase 6 | P3 实现 | 2-3 天 |
| Phase 7 | 全量迁移 + 验收 | 1-2 天 |

---

_本文档为需求输入。棱镜 Prism 和弧极 Arc 请在此基础上做专业的产品和技术设计，任何对本文档的质疑和改进建议都欢迎。_
