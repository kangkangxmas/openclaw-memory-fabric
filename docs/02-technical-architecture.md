# OpenClaw Memory Fabric
## 技术架构详细设计文档
**文档版本**：v1.0  
**文档类型**：技术架构详细设计（HLD + LLD）  
**发布日期**：2026-04-15  
**适用对象**：架构师、后端工程师、插件工程师、平台工程师、SRE

---

## 1. 设计目标

在不修改 OpenClaw、OpenViking、Graphify 源码的前提下，基于 **OpenClaw 原生插件 + 插件附带 Skills + 外部 Sidecar 服务** 的方式，实现企业级多 Agent 记忆增强系统。

系统设计目标如下：

- 为不同 Agent 提供作用域隔离的长期记忆
- 提供跨会话、跨天持久化能力
- 提供长期记忆蒸馏、治理与稳定载体管理能力
- 集成 Graphify，形成结构认知优先的任务前置流程
- 通过 Skills 将“能力”转化为“标准动作”
- 在 OpenClaw 网关进程内保持轻量、安全、可降级

---

## 2. 设计原则

### 2.1 不侵入原则
- 不修改三方源码
- 不依赖三方私有 patch
- 不 fork 维护第三方主仓

### 2.2 薄插件原则
OpenClaw 插件只做：
- hooks 接入
- tool 注册
- 配置解析
- 记忆路由
- prompt 注入
- 轻量状态协调

不在插件进程内做重型图谱构建、全量合并、复杂索引计算。

### 2.3 外部计算原则
所有重计算能力通过 Sidecar 承载：
- OpenViking client/server 调用
- Graphify CLI / MCP 调用
- 记忆蒸馏批处理
- 记忆载体 merge
- 图谱增量更新

### 2.4 双层控制原则
- **插件层**：控制“能做什么”
- **Skills 层**：控制“应该怎么做”

### 2.5 渐进注入原则
上下文召回采用预算控制与分层加载：
- L0：最小必要摘要
- L1：中等概览
- L2：按需深挖

---

## 3. 总体架构

```text
┌────────────────────────────────────────────┐
│                 User / Channel             │
└────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────┐
│               OpenClaw Gateway             │
│  - Agent Runtime                           │
│  - Plugin Hooks                            │
│  - Tool Registry                           │
└────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────┐
│         OpenClaw Memory Fabric Plugin      │
│  1. Config Loader                          │
│  2. Scope Router                           │
│  3. Recall Orchestrator                    │
│  4. Carrier Manager                        │
│  5. Distill Coordinator                    │
│  6. Share Governance                       │
│  7. Skills Pack                            │
└────────────────────────────────────────────┘
           │                         │
           │                         │
           ▼                         ▼
┌──────────────────────┐   ┌────────────────────────┐
│ OpenViking Adapter   │   │ Graphify Adapter       │
│ - session commit     │   │ - bootstrap            │
│ - hierarchical read  │   │ - report read          │
│ - semantic retrieval │   │ - query/path/explain   │
└──────────────────────┘   └────────────────────────┘
           │                         │
           ▼                         ▼
┌──────────────────────┐   ┌────────────────────────┐
│ OpenViking Runtime   │   │ Graphify Runtime       │
│ - local / remote     │   │ - CLI / MCP            │
│ - viking:// storage  │   │ - graphify-out         │
└──────────────────────┘   └────────────────────────┘
```

---

## 4. 技术分层

## 4.1 L1：OpenClaw 插件层
职责：
- 注册插件 manifest
- 注册工具
- 接入 hooks
- 识别 agent_id / project_id / scope
- 动态构造 Memory Brief
- 将结果注入 OpenClaw 上下文
- 协调回写与治理

## 4.2 L2：记忆适配层
职责：
- 将业务动作翻译为 OpenViking 读写
- 管理稳定载体文件
- 管理共享记忆 metadata
- 提供 recall/commit 的统一接口

## 4.3 L3：结构认知层
职责：
- 管理项目图谱目录
- 触发 Graphify 构建/更新
- 读取 `GRAPH_REPORT.md`
- 对 `graph.json` 执行 query/path/explain

## 4.4 L4：执行纪律层
职责：
- 通过 Skills 将“结构先行、检索后行、执行最后”固定为 Agent 行为习惯
- 限制不合规写入
- 约束回写格式

---

## 5. 插件能力清单

## 5.1 注册对象
- Native plugin
- tool capabilities
- bundled skills
- hook handlers
- optional service endpoints（本地状态检查）

## 5.2 必要文件
```text
packages/openclaw-memory-fabric/
  openclaw.plugin.json
  package.json
  src/
    index.ts
    config/
    hooks/
    tools/
    orchestrator/
    adapters/
    carriers/
    utils/
  skills/
    project-sensemaking/
      SKILL.md
    memory-hygiene/
      SKILL.md
    execution-gate/
      SKILL.md
    post-task-distill/
      SKILL.md
```

---

## 6. 配置设计

## 6.1 插件配置模型
```yaml
plugins:
  entries:
    memory-fabric:
      package: "@yourorg/openclaw-memory-fabric"
      enabled: true
      config:
        defaultScope: project
        recallBudget:
          l0Tokens: 600
          l1Tokens: 1800
          l2Tokens: 5000
        sidecar:
          baseUrl: "http://127.0.0.1:7811"
          timeoutMs: 12000
        openviking:
          mode: local
          basePath: "~/.openviking"
          targetRoot: "viking://org/acme"
        graphify:
          basePath: "~/.graphify-projects"
          autoBootstrap: true
          autoRefresh: manual
        publishPolicy:
          defaultVisibility: private
          allowOrgShared: true
        observability:
          logLevel: info
          emitMetrics: true
```

## 6.2 配置校验规则
- `defaultScope`：`private | project | shared`
- `sidecar.baseUrl` 必填
- `recallBudget` 各层必须大于 0
- `openviking.mode`：`local | remote`
- `graphify.autoRefresh`：`manual | on-demand | scheduled`

---

## 7. 作用域与命名空间设计

## 7.1 URI 设计
```text
viking://org/<org>/agents/<agent_id>/private/
viking://org/<org>/agents/<agent_id>/projects/<project_id>/
viking://org/<org>/shared/projects/<project_id>/
viking://org/<org>/shared/org/
```

## 7.2 路由规则
| 条件 | 读取范围 | 写入范围 |
|---|---|---|
| 默认单 Agent 对话 | private + current project | private |
| 项目任务 | private + current project + project shared | current project |
| 显式发布 | private + project | project shared / org shared |
| 组织知识问答 | project shared + org shared | 仅在显式 commit 时写入 |

## 7.3 元数据模型
所有共享条目都应带有 metadata：
```yaml
id: mem-20260415-001
source_agent: architect-agent
project_id: phoenix-rewrite
visibility: project_shared
created_at: 2026-04-15T10:20:00Z
tags:
  - decision
  - architecture
status: active
confidence: high
```

---

## 8. 稳定记忆载体设计

## 8.1 目录规划
```text
carriers/
  agents/<agent_id>/private/
    identity.md
    working-style.md
    self-model.md
  agents/<agent_id>/projects/<project_id>/
    project-model.md
    decision-log.md
    entities-glossary.md
    playbooks.md
    open-questions.md
    execution-journal.md
  shared/projects/<project_id>/
    published-memory.md
```

## 8.2 文件职责
| 文件 | 职责 |
|---|---|
| `identity.md` | Agent 身份、职责边界、偏好 |
| `working-style.md` | 工作习惯、输出风格、执行约束 |
| `self-model.md` | 自我理解状态、已知/未知、下一步建议 |
| `project-model.md` | 项目目标、模块地图、核心术语 |
| `decision-log.md` | 关键决策及其背景 |
| `entities-glossary.md` | 实体、术语、别名 |
| `playbooks.md` | 可复用流程与经验 |
| `open-questions.md` | 冲突、未知、待验证项 |
| `execution-journal.md` | 时间序列任务日志 |

## 8.3 合并原则
- 追加日志：`execution-journal.md`
- 去重合并：`entities-glossary.md`
- 有序累积：`decision-log.md`
- 覆盖更新：`self-model.md`
- 冲突保留：`open-questions.md`

---

## 9. Graphify 集成设计

## 9.1 图谱目录
```text
graph/
  <project_id>/
    graphify-out/
      GRAPH_REPORT.md
      graph.json
      graph.html
      graph.gml
```

## 9.2 图谱生成策略
### 首次接入
- 输入项目目录、文档目录或混合知识目录
- 执行 bootstrap
- 生成初始图谱文件

### 增量更新
- 手动更新：由工具触发
- 按需更新：当项目资料时间戳变更时触发
- 不在主问答线程中执行深度重建

## 9.3 结构认知读取策略
优先顺序：
1. `GRAPH_REPORT.md`
2. graph query 局部子图
3. graph path / explain
4. 原始文档或代码细读

## 9.4 结构认知输出对象
定义 `StructuralBrief`：
```ts
type StructuralBrief = {
  projectId: string
  freshness: "fresh" | "stale" | "missing"
  coreNodes: string[]
  communities: string[]
  keyPaths: Array<{ from: string; to: string; why: string }>
  unknowns: string[]
  recommendedRetrievalTargets: string[]
  summary: string
}
```

---

## 10. OpenViking 集成设计

## 10.1 接入目标
- 作为长期记忆后端
- 作为层级化上下文读写底座
- 作为 session-based 记忆抽取引擎
- 作为项目上下文的语义检索层

## 10.2 使用策略
### 会话层
每轮对话后，将完整消息或压缩摘要提交给 OpenViking session 管理接口进行记忆抽取。

### 目录层
将长期载体与项目知识目录映射到 `viking://` 命名空间，便于目录递归检索。

### 加载层
由 Recall Orchestrator 决定 L0/L1/L2 读入深度。

## 10.3 Recall 策略
```text
Step 1: 判断任务复杂度
Step 2: 判断 scope
Step 3: 读取 private/project/shared 的 L0 摘要
Step 4: 判断是否需要 Graphify Structural Brief
Step 5: 如果还缺证据，则下钻 L1/L2
Step 6: 组合为 Memory Brief 注入
```

## 10.4 Commit 策略
`agent_end` 后执行：
- 提取本轮 facts / decisions / entities / patterns / unresolved
- 写入 OpenViking session commit
- 同步更新 carriers
- 更新 self-model
- 必要时触发共享审批候选项生成

---

## 11. Hook 设计

## 11.1 使用的 Hook
| Hook | 用途 |
|---|---|
| `before_prompt_build` | 构造并注入 Memory Brief / Structural Brief |
| `before_tool_call` | 观测高价值工具动作，辅助蒸馏 |
| `after_tool_call` | 记录工具结果摘要 |
| `agent_end` | 执行 turn 级蒸馏与 commit |
| `before_compaction` / `after_compaction` | 记录上下文压缩前后状态（可选） |

## 11.2 before_prompt_build 伪流程
```text
1. 识别当前 agent_id
2. 识别当前 project_id
3. 识别任务复杂度与结构置信度
4. 计算 recall plan
5. 调用 Sidecar：
   - openviking recall
   - read carriers
   - graphify structural brief（如需要）
6. 生成 Memory Brief
7. 通过 prependContext 注入
```

## 11.3 agent_end 伪流程
```text
1. 收集本轮 messages 与工具摘要
2. 执行 distill
3. 分类输出：
   - facts
   - decisions
   - entities
   - patterns
   - unresolved
4. 写 OpenViking
5. 更新 carriers
6. 更新 self-model
7. 输出审计日志
```

---

## 12. Tool 设计

## 12.1 工具清单
```ts
memory_brief(scope?, projectId?, depth?)
memory_commit(facts?, decisions?, entities?, patterns?, visibility?)
memory_publish_shared(projectId, items)
memory_forget_scoped(scope, query)
project_bootstrap(projectId, paths, mode?)
project_state_refresh(projectId)
project_graph_query(projectId, query, budget?)
project_graph_path(projectId, from, to)
project_graph_explain(projectId, query)
carrier_read(projectId?, files?)
carrier_merge(projectId, patchSet)
health_status()
```

## 12.2 工具职责
| 工具 | 作用 |
|---|---|
| `memory_brief` | 生成当前任务的记忆简报 |
| `memory_commit` | 显式提交关键记忆 |
| `memory_publish_shared` | 发布共享记忆 |
| `memory_forget_scoped` | 作用域内忘记/废弃 |
| `project_bootstrap` | 初始化项目图谱与载体 |
| `project_state_refresh` | 刷新项目认知状态 |
| `project_graph_query/path/explain` | 结构认知精确查询 |
| `carrier_read/merge` | 载体读取与合并 |
| `health_status` | 健康检查 |

---

## 13. Sidecar 设计

## 13.1 原则
Sidecar 作为本地服务运行，承接插件外部依赖与重计算。

## 13.2 推荐模块
```text
sidecar/
  app.py or server.ts
  routes/
    /health
    /recall
    /commit
    /bootstrap
    /graph/query
    /graph/path
    /graph/explain
    /carrier/merge
  services/
    openviking_service
    graphify_service
    distill_service
    carrier_service
```

## 13.3 Sidecar API
### `POST /recall`
输入：
```json
{
  "agentId": "architect-agent",
  "projectId": "phoenix-rewrite",
  "scope": "auto",
  "depth": "l1",
  "query": "请分析支付链路重构方案"
}
```

输出：
```json
{
  "memoryBrief": "...",
  "sources": ["openviking:l0", "carrier:decision-log", "graphify:structural-brief"],
  "budgetUsed": 1420
}
```

### `POST /commit`
### `POST /bootstrap`
### `POST /graph/query`
### `GET /health`
按此模式统一返回。

---

## 14. Skills 设计

## 14.1 `project-sensemaking`
核心规则：
- 面对复杂问题先读取结构摘要
- 用“当前理解 / 未知点 / 下一步检索”格式思考
- 禁止在不了解结构时直接盲搜全仓

## 14.2 `memory-hygiene`
核心规则：
- 只把稳定且高价值信息写长期记忆
- 临时判断、未经验证内容进入 open questions
- 共享发布必须显式声明

## 14.3 `execution-gate`
核心规则：
- 先 `memory_brief`
- 再决定 graph query / openviking recall / 直接执行
- 所有复杂任务必须说明为何选定该动作

## 14.4 `post-task-distill`
核心规则：
- 收尾必须回写决策、经验、风险、待办
- 更新 self-model
- 项目级变更需考虑是否刷新图谱

---

## 15. 核心数据对象

## 15.1 MemoryBrief
```ts
type MemoryBrief = {
  agentId: string
  projectId?: string
  scope: "private" | "project" | "shared" | "auto"
  structuralNeeded: boolean
  summary: string
  keyFacts: string[]
  decisions: string[]
  entities: string[]
  unknowns: string[]
  nextBestActions: string[]
  sources: string[]
}
```

## 15.2 DistillResult
```ts
type DistillResult = {
  facts: string[]
  decisions: string[]
  entities: string[]
  patterns: string[]
  unresolved: string[]
  publishCandidates: string[]
}
```

## 15.3 SelfModel
```ts
type SelfModel = {
  currentGoal: string
  understood: string[]
  uncertain: string[]
  missingEvidence: string[]
  preferredNextActions: string[]
  confidence: "low" | "medium" | "high"
  updatedAt: string
}
```

---

## 16. 降级策略

| 故障 | 降级方式 |
|---|---|
| Graphify 不可用 | 跳过 structural brief，使用 OpenViking + carriers |
| OpenViking 不可用 | 只使用 carriers + graphify |
| Sidecar 不可用 | 插件退化为只读本地稳定载体 |
| Graph 文件缺失 | 提示项目未 bootstrap，可手动触发 |
| 共享目录冲突 | 延迟写入并记录待处理项 |

---

## 17. 可观测性设计

## 17.1 日志字段
- request_id
- agent_id
- project_id
- hook_name
- recall_depth
- memory_sources
- graph_freshness
- budget_used
- commit_items_count
- publish_candidates_count
- latency_ms
- degraded_mode

## 17.2 指标
- `memory_brief_latency_ms`
- `memory_commit_latency_ms`
- `graph_bootstrap_duration_ms`
- `graph_query_duration_ms`
- `carrier_merge_conflicts_total`
- `memory_recall_noise_ratio`
- `sidecar_unavailable_total`

## 17.3 健康检查
返回：
- plugin loaded
- sidecar reachable
- openviking reachable
- graphify available
- writable paths ready
- last refresh time

---

## 18. 安全设计

## 18.1 基本原则
- 私有记忆默认不可共享
- 共享写入必须显式动作
- 所有发布内容可追溯
- 不在 OpenClaw 主进程内直接执行重型不可信逻辑

## 18.2 路径安全
- 所有 project path 必须在允许目录白名单内
- 禁止相对路径逃逸
- 对 graphify 输入路径做 normalize 和校验

## 18.3 注入安全
- 记忆简报统一模板化
- 清洗潜在 prompt injection 痕迹
- 对共享记忆来源标注可信度

---

## 19. 测试设计

## 19.1 单元测试
- scope router
- metadata parser
- carrier merge
- brief composer
- distill classifier
- config validation

## 19.2 集成测试
- 插件启动与配置加载
- hook 注入流程
- sidecar recall / commit
- OpenViking 本地模式
- Graphify bootstrap / query

## 19.3 端到端测试
- 多 Agent 同项目隔离
- 跨天记忆续接
- 复杂项目结构优先
- 显式共享发布与召回
- 故障降级

---

## 20. 里程碑建议

### M1：基础可运行
- 插件 manifest
- 配置加载
- health_status
- Sidecar 空壳

### M2：长期记忆可用
- OpenViking recall / commit
- carriers 初始化与合并
- before_prompt_build / agent_end

### M3：结构认知可用
- Graphify bootstrap
- Structural Brief
- graph query/path/explain

### M4：治理闭环
- publish shared
- self-model 更新
- observability 与降级

---

## 21. 结论

本设计的关键不在于“再接一个记忆库”，而在于构建一个 **可治理、可分层、可审计、可进化的记忆编排层**。  
通过 OpenClaw 插件承载基础能力、OpenViking 承载长期记忆、Graphify 承载结构认知、Skills 固化行为纪律，系统能在不修改三方源码的前提下，显著提升 OpenClaw 多 Agent 记忆能力与复杂任务智能度。
