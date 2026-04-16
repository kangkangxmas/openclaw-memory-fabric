# OpenClaw Memory Fabric — 聊天测试引导脚本

**适用版本**：v1.6.0  
**测试方式**：直接将下方对话发给任意 OpenClaw Agent，观察工具调用结果  
**前置条件**：
- Sidecar 运行中 (`launchctl list com.memory-fabric.sidecar` → PID 存在)
- OpenViking 运行中 (`launchctl list ai.openviking` → PID 存在)
- memory-fabric 插件已在 `openclaw.json` 中启用

---

## 0. 启动验证（先做这一步）

```
你好，请调用 health_status 工具，告诉我 Memory Fabric 插件的当前状态，包括所有组件是否可达。
```

**期望**：返回 `ok: true`，组件里 openviking/graphify/carriers 都显示正常。  
**排查**：若 sidecar 不可达，在终端执行 `launchctl list com.memory-fabric.sidecar` 检查 PID。

---

## 1. Memory Brief — 召回记忆

**测试 L0（轻量）**：
```
请用 memory_brief 工具，以 agentId="test-agent", projectId="test-proj", depth="l0" 给我一个记忆简报。
```

**测试 L2（深度，含 Carrier + Graph 摘要）**：
```
请用 memory_brief 工具，agentId="test-agent", projectId="test-proj", depth="l2", query="架构决策" 给我一个详细记忆简报。
```

**期望**：返回 Markdown 格式的 `## Memory Brief`，包含 Current Scope / Known Facts / Decisions / Unknowns。

---

## 2. Memory Commit — 写入记忆

```
请用 memory_commit 工具提交以下内容：
agentId="test-agent"
projectId="test-proj"
facts=["Memory Fabric sidecar 运行在 port 7811", "OpenViking basePath 是 ~/.openviking/data/viking/openclaw-personal"]
decisions=["确认使用 project 级别隔离作为默认 scope"]
entities=["MemoryFabric", "OpenViking", "SidecarClient"]
visibility="private"
```

**期望**：返回 `ok: true, committed: N`。

**验证写入持久化**（再次召回确认）：
```
请再次调用 memory_brief，agentId="test-agent", projectId="test-proj", depth="l1"，确认刚才 commit 的内容是否已可以被召回。
```

---

## 3. Carrier 文件系统 — 长期记忆载体

**读取 Carrier 文件**：
```
请用 carrier_read 工具，agentId="test-agent", projectId="test-proj"，读取所有 carrier 文件，告诉我每个文件的名称和当前内容。
```

**期望**：返回 9 个 carrier 文件（identity.md / working-style.md / self-model.md / project-model.md / decision-log.md / entities-glossary.md / playbooks.md / open-questions.md / execution-journal.md）。

**合并内容到 Carrier**：
```
请用 carrier_merge 工具，agentId="test-agent", projectId="test-proj"，合并以下内容：
patches=[
  { filename: "decision-log.md", content: "- 2026-04-16 决定使用 Memory Fabric 作为记忆层，替代手动笔记" },
  { filename: "open-questions.md", content: "- [ ] 是否需要为每个项目单独 bootstrap 图谱？" }
]
```

**期望**：返回 `merged: ["decision-log.md", "open-questions.md"]`。

---

## 4. Graphify — 项目图谱

**Bootstrap 图谱**（首次使用某项目时）：
```
请用 project_bootstrap 工具，projectId="openclaw-memory-fabric"，paths=["/Users/kangxuming/Ai/VibeCoding/Workspaces/openclaw-memory-fabric/packages"]，mode="auto"，扫描并构建项目知识图谱。
```

**期望**：返回 `ok: true, nodeCount: N, edgeCount: N`。

**查看结构摘要**：
```
请用 project_state_refresh 工具，projectId="openclaw-memory-fabric"，给我当前的结构认知简报（StructuralBrief）。
```

**期望**：返回 coreNodes / communities / keyPaths / summary。

**图谱查询**：
```
请用 project_graph_query 工具，projectId="openclaw-memory-fabric", query="recall orchestrator", budget=5，找出相关节点。
```

**路径查询**：
```
请用 project_graph_path，projectId="openclaw-memory-fabric", from="SidecarClient", to="SharedService"，找出两者之间的路径。
```

**概念解释**：
```
请用 project_graph_explain，projectId="openclaw-memory-fabric", query="CommitOrchestrator 是如何工作的？"
```

---

## 5. 共享治理 — Shared Memory

**发布共享记忆**：
```
请用 memory_publish_shared 工具：
projectId="test-proj"
agentId="test-agent"
visibility="project_shared"
items=[
  { type: "decision", content: "Memory Fabric v1.6.0 已部署到生产，由 kangxuming 于 2026-04-16 完成", tags: ["deployment", "memory-fabric"] },
  { type: "fact", content: "Sidecar 端口 7811，OpenViking 端口 1933，均由 launchd 托管开机自启", tags: ["infrastructure"] }
]
```

**期望**：返回 `published: 2, ids: [...]`。

**召回共享记忆**（切换到另一个 Agent 视角测试）：
```
请用 memory_brief 工具，agentId="agent-b", projectId="test-proj", scope="shared", depth="l1"，查看 test-proj 下的共享记忆。
```

**期望**：Brief 中包含刚才发布的 decision 和 fact。

**撤回共享记忆**：
```
请用 memory_forget_scoped 工具，projectId="test-proj", query="Memory Fabric v1.6.0 已部署"，撤回这条共享记忆。
```

**期望**：返回 `retracted: 1`。

**验证撤回生效**：
```
再次用 memory_brief，agentId="agent-b", projectId="test-proj", scope="shared"，确认已撤回的内容不再出现。
```

---

## 6. Skills 测试 — 行为规范触发

**project-sensemaking**（在接触新项目时触发）：
```
我刚加入一个新项目 "openclaw-memory-fabric"，请先使用 project-sensemaking skill 对这个项目做一次结构认知，然后告诉我该项目最核心的模块是哪些。
```

**期望**：Agent 先调用 `project_state_refresh` 或 `project_bootstrap`，然后调用 `project_graph_query`，最后输出结构化的项目理解。

**execution-gate**（在执行高影响操作前触发）：
```
请使用 execution-gate skill，然后帮我修改 openclaw-memory-fabric 项目的 sidecar port 从 7811 改为 8811。在执行前告诉我你对这个操作的理解和影响评估。
```

**期望**：Agent 先读取 `memory_brief`，输出 Gate Block（**我知道什么 / 我要做什么 / 影响评估**），等待确认后再执行。

**memory-hygiene**（在决定提交记忆时触发）：
```
我刚完成了一次探索：发现 Memory Fabric 的 RecallOrchestrator 中 L2 深度会额外读取 carrier 文件和图谱摘要。请使用 memory-hygiene skill 判断哪些内容值得写入长期记忆，哪些不值得，然后执行 memory_commit。
```

**期望**：Agent 输出记忆分类表，将稳定事实提交 `memory_commit`，不把探索过程的猜测写入记忆。

**post-task-distill**（任务结束后触发）：
```
刚才我们完成了 Memory Fabric 部署和测试引导文档的编写。请使用 post-task-distill skill 对本次任务做一次蒸馏，提取 facts/decisions/entities，并写入 memory_commit 和 carrier_merge。
```

**期望**：Agent 输出 Distillation Block，调用 `memory_commit` 和 `carrier_merge`（至少更新 `decision-log.md` 和 `execution-journal.md`）。

---

## 7. 多 Agent 隔离测试

在两个不同 Agent 窗口分别执行：

**Agent A**（写入私有记忆）：
```
agentId="agent-alpha" 的视角：请用 memory_commit 提交 facts=["Agent Alpha 的私有信息：数据库密码前缀是 alpha-"], visibility="private", projectId="iso-test"
```

**Agent B**（尝试读取，应看不到 Agent A 的私有内容）：
```
agentId="agent-beta" 的视角：请用 memory_brief，agentId="agent-beta", projectId="iso-test", scope="project", depth="l2"，查看 iso-test 项目的记忆，确认是否能看到 agent-alpha 的私有内容。
```

**期望**：Agent B 的 Brief 中不包含 Agent Alpha 写入的私有内容（`visibility="private"` 的内容只对 agent-alpha 可见）。

---

## 8. 健康与可观测性

```
请调用 health_status，并告诉我：
1. Sidecar 是否可达
2. 所有组件状态（openviking/graphify/carriers）
3. 当前 recall 调用次数和平均延迟
4. 是否有降级模式发生
```

**期望**：
```json
{
  "ok": true,
  "sidecarReachable": true,
  "metrics": {
    "recallCount": N,
    "recallAvgMs": N,
    "degradedModeCount": 0
  },
  "components": {
    "openviking": { "reachable": true },
    "graphify": { "available": true },
    "carriers": { "writable": true }
  }
}
```

---

## 全量测试检查清单

| 功能模块 | 测试项 | 通过标准 |
|----------|--------|----------|
| 基础健康 | `health_status` | `ok: true`，所有组件正常 |
| 记忆召回 | `memory_brief` L0/L1/L2 | 返回 Markdown 格式 Brief |
| 记忆提交 | `memory_commit` + 二次召回 | 提交后 L1 Brief 包含内容 |
| Carrier | `carrier_read` + `carrier_merge` | 9 个文件存在；merge 后内容写入 |
| 图谱构建 | `project_bootstrap` | `ok: true, nodeCount > 0` |
| 图谱查询 | `project_graph_query/path/explain` | 返回相关节点/路径/解释 |
| 共享发布 | `memory_publish_shared` | `published: N, ids: [...]` |
| 共享召回 | `memory_brief scope=shared` | Brief 包含共享内容 |
| 撤回 | `memory_forget_scoped` | `retracted: 1`；二次召回不含该条 |
| 多 Agent 隔离 | private scope 跨 agent | Agent B 看不到 Agent A 的私有记忆 |
| Skill 触发 | 4 个 Skills | Agent 输出 Skill 要求的结构化步骤 |
| Hooks | 自动 before_prompt / agent_end | 每次对话前有 Brief 注入；任务后 carriers 更新 |

---

## 故障排查速查

```bash
# 检查 sidecar 状态
launchctl list com.memory-fabric.sidecar
curl -s http://127.0.0.1:7811/health | jq .

# 查看 sidecar 日志
tail -50 ~/.memory-fabric/sidecar.err.log

# 手动重启 sidecar
launchctl stop com.memory-fabric.sidecar
launchctl start com.memory-fabric.sidecar

# 检查 OpenViking
launchctl list ai.openviking
curl -s http://127.0.0.1:1933/health 2>/dev/null || echo "OpenViking 端口不同，查看 ov.conf"

# 查看 carrier 文件
ls ~/.memory-fabric/carriers/
ls ~/.memory-fabric/carriers/shared/
```
