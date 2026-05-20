# OpenClaw Memory Fabric
## 安装与部署文档
**文档版本**：v1.8.0  
**文档类型**：安装部署手册  
**发布日期**：2026-05-21  
**适用对象**：平台工程师、运维工程师、研发负责人、POC 实施人员

---

## 1. 文档目的

本文档说明如何在本地或服务器环境中部署 **OpenClaw Memory Fabric**，并联动 OpenClaw、OpenViking、Graphify 形成完整的多 Agent 记忆增强系统。

部署目标：
- 不修改 OpenClaw、OpenViking、Graphify 源码
- 以插件 + Skills + Sidecar 的方式完成接入
- 获得多 Agent 长期记忆与结构认知增强能力

---

## 2. 部署架构

```text
OpenClaw Gateway
  └── Memory Fabric Plugin
        └── Sidecar Service
              ├── OpenViking Runtime
              ├── Graphify CLI / MCP
              └── Local Carrier Storage
```

---

## 3. 环境要求

## 3.1 操作系统
推荐：
- macOS
- Ubuntu 22.04+
- 其他兼容 Linux 发行版

## 3.2 运行时
- Node.js 20+
- pnpm 9+
- Python 3.11+
- pip 或 uv
- Git

## 3.3 资源建议
### 开发/POC
- CPU：4 core+
- 内存：16 GB+
- 磁盘：20 GB+

### 中型项目
- CPU：8 core+
- 内存：32 GB+
- 磁盘：100 GB+（视图谱与记忆规模而定）

---

## 4. 目录规划

建议使用如下目录：

```text
/opt/openclaw/
  gateway/
  plugins/
  memory-fabric/
    plugin/
    sidecar/
    data/
      carriers/
      graph/
      logs/
      tmp/
  openviking/
  projects/
```

本地开发可使用：

```text
~/workspace/openclaw-memory-fabric/
```

---

## 5. 安装顺序

严格按以下顺序安装：

1. 安装 OpenClaw
2. 安装 OpenViking
3. 安装 Graphify
4. 部署 Memory Fabric 工程
5. 启动 Sidecar
6. 配置 OpenClaw 插件
7. 初始化项目图谱与记忆目录
8. 进行连通性验证

---

## 6. 安装 OpenClaw

### 6.1 安装方式
根据你的团队标准，选择已验证的 OpenClaw 安装方式。

### 6.2 安装后检查
执行：
```bash
openclaw --version
openclaw plugins list
openclaw skills list
```

### 6.3 检查点
- OpenClaw 命令可用
- 网关可启动
- 插件系统可用
- Skills 系统可用

---

## 7. 安装 OpenViking

### 7.1 创建 Python 虚拟环境
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 7.2 安装
```bash
pip install openviking --upgrade
```

或：
```bash
uv pip install openviking --upgrade
```

### 7.3 验证
```bash
python -c "from openviking import OpenViking; print('ok')"
```

### 7.4 初始化目录
```bash
mkdir -p ~/.openviking
```

### 7.5 验证项
- Python 可导入 `openviking`
- 本地存储目录可写
- Sidecar 运行用户有读写权限

---

## 8. 安装 Graphify

### 8.1 安装
根据团队策略选择官方推荐安装方式。若使用 pip：
```bash
pip install graphifyy
```

### 8.2 验证
```bash
graphify --help
```

### 8.3 OpenClaw 平台安装 Skill（可选）
如果需要先验证原生 Graphify Skill：
```bash
graphify claw install
```

### 8.4 验证项
- CLI 命令可用
- 能针对样例目录执行 `graphify .`
- 能生成 `graphify-out/GRAPH_REPORT.md`

---

## 9. 部署 Memory Fabric 工程

## 9.1 获取代码
```bash
git clone <your-repo-url> openclaw-memory-fabric
cd openclaw-memory-fabric
```

## 9.2 安装依赖
```bash
pnpm install
```

## 9.3 构建
```bash
pnpm -r build
```

## 9.3.1 本地开发注意：构建后需手动同步到 extensions

Gateway 通过扫描 `~/.openclaw/extensions/` 目录加载插件（使用 `fs.readdirSync` + `entry.isDirectory()`，**不支持 symlink**）。因此本插件采用真实目录拷贝方式安装：

```
~/.openclaw/extensions/memory-fabric/   ← gateway 实际加载路径
packages/plugin/                        ← 源码与构建产物
```

每次执行 `pnpm -r build` 后，`dist/` 会在源码目录更新，但 extensions 里的拷贝**不会自动同步**。需手动执行：

```bash
rsync -a --delete packages/plugin/dist/ ~/.openclaw/extensions/memory-fabric/dist/
rsync -a packages/plugin/openclaw.plugin.json \
         packages/plugin/skills/ \
         packages/plugin/package.json \
         ~/.openclaw/extensions/memory-fabric/
```

同步完成后重启 gateway 才能生效：

```bash
openclaw gateway restart
```

> **注意**：`node_modules` 变更（依赖升级）不适合 rsync，需重新执行完整安装流程。

## 9.4 目录准备
```bash
mkdir -p ./runtime-data/carriers
mkdir -p ./runtime-data/graph
mkdir -p ./runtime-data/logs
mkdir -p ./runtime-data/tmp
```

---

## 10. 配置 Sidecar

### 10.1 环境变量示例
创建 `packages/sidecar/.env`：

```env
PORT=7811
LOG_LEVEL=info
OPENVIKING_MODE=local
OPENVIKING_BASE_PATH=/opt/openclaw/openviking
OPENVIKING_TARGET_ROOT=viking://org/acme
GRAPHIFY_BASE_PATH=/opt/openclaw/memory-fabric/data/graph
CARRIERS_ROOT=/opt/openclaw/memory-fabric/data/carriers
```

### 10.2 启动
```bash
pnpm --filter sidecar dev
```

或生产模式：
```bash
pnpm --filter sidecar start
```

### 10.3 健康检查
```bash
curl http://127.0.0.1:7811/health
```

期望返回：
```json
{
  "ok": true,
  "service": "@openclaw-memory-fabric/sidecar",
  "version": "1.8.0",
  "phase": "phase-G-dynamic-templates",
  "components": {
    "openviking": {
      "reachable": true
    },
    "graphify": {
      "available": true
    },
    "carriers": {
      "writable": true
    }
  }
}
```

---

## 11. 配置 OpenClaw 插件

### 11.1 安装插件包
若已发布到 npm / ClawHub：
```bash
openclaw plugins install @yourorg/openclaw-memory-fabric
```

若本地调试，可按本地路径或链接方式安装。

### 11.2 启用插件
```bash
openclaw plugins enable @yourorg/openclaw-memory-fabric
```

### 11.3 插件配置示例
在 OpenClaw 配置文件中加入：

```yaml
plugins:
  entries:
    memory-fabric:
      package: "@yourorg/openclaw-memory-fabric"
      enabled: true
      config:
        defaultScope: project
        sidecar:
          baseUrl: "http://127.0.0.1:7811"
          timeoutMs: 12000
        openviking:
          mode: local
          targetRoot: "viking://org/acme"
        graphify:
          basePath: "/opt/openclaw/memory-fabric/data/graph"
          autoBootstrap: true
          autoRefresh: manual
        publishPolicy:
          defaultVisibility: private
        observability:
          logLevel: info
          emitMetrics: true
```

### 11.4 重启 OpenClaw
```bash
openclaw gateway restart
```

或按你的运行方式重启。

---

## 12. 初始化 Skills

如果插件已自带 Skills，OpenClaw 启动后会自动发现。  
如需手动检查：

```bash
openclaw skills list
```

检查是否存在：
- `project-sensemaking`
- `memory-hygiene`
- `execution-gate`
- `post-task-distill`

---

## 13. 初始化一个项目

假设项目目录：
```bash
/opt/openclaw/projects/phoenix-rewrite
```

### 13.1 执行 bootstrap
通过插件工具或 sidecar API 进行：

```bash
curl -X POST http://127.0.0.1:7811/bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "phoenix-rewrite",
    "paths": ["/opt/openclaw/projects/phoenix-rewrite"],
    "mode": "quick"
  }'
```

### 13.2 验证生成结果
应生成：
```text
runtime-data/graph/phoenix-rewrite/graphify-out/GRAPH_REPORT.md
runtime-data/graph/phoenix-rewrite/graphify-out/graph.json
runtime-data/carriers/agents/<agent_id>/projects/phoenix-rewrite/
```

### 13.3 首次问答验证
向 Agent 提问一个跨模块问题，期望系统先体现结构理解，再进入检索/执行。

---

## 14. 联调验证清单

## 14.1 基础联通
- [ ] OpenClaw 可启动
- [ ] 插件已加载
- [ ] Sidecar 可访问
- [ ] OpenViking 可调用
- [ ] Graphify CLI 可调用

## 14.2 记忆能力验证
- [ ] Agent 能写入长期记忆
- [ ] 重启/隔天后仍能召回
- [ ] 不同 Agent 私有记忆隔离

## 14.3 结构认知验证
- [ ] 项目已 bootstrap 图谱
- [ ] 复杂问题会优先读取结构摘要
- [ ] graph query/path/explain 可用

## 14.4 共享治理验证
- [ ] 私有默认不共享
- [ ] 显式 publish 后项目内其他 Agent 可见
- [ ] 撤回后不参与默认召回

## 14.5 自学习闭环验证 (Phase C)
- [ ] 经验蒸馏后 `GET /report?agentId=X` 返回评分报告
- [ ] `GET /patterns?agentId=X` 返回检测到的模式
- [ ] self-model.md 中 confidence 随经验累积自动演进
- [ ] 学习曲线: `GET /inspect/learning-curve?agentId=X&days=30` 返回数据

验证命令：
```bash
# 查看评分报告
curl "http://127.0.0.1:7811/report?agentId=development"

# 查看模式
curl "http://127.0.0.1:7811/patterns?agentId=development"

# 查看学习曲线
curl "http://127.0.0.1:7811/inspect/learning-curve?agentId=development&days=30"
```

## 14.6 生命周期管理验证 (Phase D)
- [ ] 垃圾回收端点可调用
- [ ] 超 1000 条记忆时自动压缩到 750 条
- [ ] summary.json 版本号自动递增

验证命令：
```bash
# 触发垃圾回收
curl -X POST http://127.0.0.1:7811/lifecycle/gc
# 期望: { "ok": true, "sharedRetracted": 0, "draftsRemoved": 0, "memoriesCompacted": [...] }
```

## 14.7 性能与扩展验证 (Phase E)
- [ ] 批量召回端点可用 (最多 10 并发)
- [ ] 增量图谱更新可用
- [ ] 嵌入缓存生效 (相同文本第二次调用 <5ms)

验证命令：
```bash
# 批量召回
curl -X POST http://127.0.0.1:7811/batch/recall \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"agentId":"a1","depth":"l0"},{"agentId":"a2","depth":"l0"}]}'

# 增量图谱更新
curl -X POST http://127.0.0.1:7811/graph/incremental \
  -H "Content-Type: application/json" \
  -d '{"projectId":"my-project","changedFiles":["/path/to/changed.ts"]}'
```

## 14.8 联邦功能验证 (Phase F)
- [ ] 跨项目知识导出/导入/撤回
- [ ] 依赖图谱可查询
- [ ] 自适应预算推荐端点可用
- [ ] 审批提交→待审→审核 流程完整

验证命令：
```bash
# 导出知识
curl -X POST http://127.0.0.1:7811/federation/export \
  -H "Content-Type: application/json" \
  -d '{"sourceProject":"alpha","targetProject":"beta","agentId":"a1","entries":[{"type":"fact","content":"API uses REST"}]}'

# 查看依赖图谱
curl http://127.0.0.1:7811/federation/dependencies

# 自适应预算推荐
curl -X POST http://127.0.0.1:7811/federation/recommend-budget \
  -H "Content-Type: application/json" \
  -d '{"toolCount":8,"turnCount":15,"queryLength":200}'

# 提交审批
curl -X POST http://127.0.0.1:7811/federation/approval/submit \
  -H "Content-Type: application/json" \
  -d '{"sourceAgent":"a1","projectId":"proj","type":"decision","content":"switch to gRPC"}'

# 查看待审批
curl "http://127.0.0.1:7811/federation/approval/pending?projectId=proj"
```

## 14.9 动态注入模板验证 (Phase G)
- [ ] 不同任务类型返回不同格式的 Memory Brief
- [ ] taskType 出现在 response 中
- [ ] 不传 taskType 行为不变 (向后兼容)

验证命令：
```bash
# debug 任务类型 — 期望 Entities 和 Unresolved 在 Facts 之前
curl -X POST http://127.0.0.1:7811/recall \
  -H "Content-Type: application/json" \
  -d '{"agentId":"dev","taskType":"debug","depth":"l1"}'

# code_review 任务类型 — 期望 Decisions 和 Patterns 优先
curl -X POST http://127.0.0.1:7811/recall \
  -H "Content-Type: application/json" \
  -d '{"agentId":"dev","taskType":"code_review","depth":"l1"}'

# 不传 taskType — 与旧版行为一致
curl -X POST http://127.0.0.1:7811/recall \
  -H "Content-Type: application/json" \
  -d '{"agentId":"dev","depth":"l0"}'
```

---

## 15. 生产部署建议

## 15.1 进程管理
建议：
- OpenClaw 使用 systemd / supervisor / 容器
- Sidecar 单独进程管理
- OpenViking 使用本地模式时与 Sidecar 同宿主机
- Graphify 使用 CLI，本地按需触发

## 15.2 systemd 示例思路
为 sidecar 配置独立 service，保证：
- 自动拉起
- 崩溃重启
- 日志落盘
- 环境变量集中管理

## 15.3 容器化建议
可拆成两个容器：
1. OpenClaw Gateway + Plugin
2. Sidecar + Python 依赖

但 POC 阶段推荐先用同机进程方式，排障更简单。

---

## 16. 备份与恢复

## 16.1 需要备份的目录
```text
runtime-data/carriers/
runtime-data/graph/
~/.openviking/
OpenClaw 配置文件
```

## 16.2 备份策略
- 每日增量备份 carriers
- 每周备份 graph 目录
- OpenViking 数据目录按版本打快照
- 发布共享记忆前可做 checkpoint

## 16.3 恢复策略
1. 停止 OpenClaw 与 Sidecar
2. 恢复 carriers / graph / openviking 数据
3. 检查路径权限
4. 启动 Sidecar
5. 启动 OpenClaw
6. 运行健康检查

---

## 17. 常见故障与排查

## 17.1 插件加载失败
### 现象
OpenClaw 启动时报插件错误。

### 检查
- `openclaw.plugin.json` 是否存在
- `configSchema` 是否合法
- 插件构建产物是否完整
- Node 版本是否兼容

## 17.2 Sidecar 不可用
### 现象
记忆简报无法生成，日志出现网络错误。

### 检查
```bash
curl http://127.0.0.1:7811/health
```
- 端口是否占用
- `.env` 是否正确
- sidecar 是否启动成功

## 17.3 OpenViking 调用失败
### 检查
- Python 虚拟环境是否激活
- `openviking` 包是否安装
- 数据目录是否可写
- Sidecar 中路径配置是否正确

## 17.4 Graphify 无法生成图谱
### 检查
- `graphify --help` 是否可运行
- 项目路径是否存在
- 输出目录权限是否正常
- 样例项目能否独立跑通

## 17.5 无法跨天记忆
### 检查
- `agent_end` 是否触发 commit
- carriers 是否写入成功
- OpenViking 数据目录是否有新增内容
- 下次会话是否执行 recall

## 17.6 多 Agent 仍然串味
### 检查
- `agentId` 推断是否正确
- 作用域路由是否误回落到 shared
- shared 目录是否被默认纳入 recall
- publishPolicy 是否过宽

---

## 18. 升级策略

### 18.1 升级原则
- 优先升级本插件与 sidecar
- 三方组件升级前先在测试环境回归
- graph 目录与 carrier 目录变更要有迁移脚本

### 18.2 升级步骤
1. 备份数据
2. 停止服务
3. 升级依赖
4. 执行迁移脚本
5. 启动 sidecar
6. 启动 OpenClaw
7. 运行健康检查和验收脚本

---

## 19. 最终上线检查表

### 基础设施
- [ ] OpenClaw 版本已验证
- [ ] OpenViking 安装完成
- [ ] Graphify 安装完成
- [ ] 插件安装并启用
- [ ] Skills 已发现 (4 个内置 + auto-generated 目录)
- [ ] Sidecar 正常 (/health 返回 ok:true)
- [ ] Inspector Web UI 可访问 (http://127.0.0.1:7811/inspect)

### 核心功能
- [ ] 示例项目已 bootstrap
- [ ] 跨天记忆验证通过
- [ ] 多 Agent 隔离验证通过
- [ ] 复杂项目结构优先验证通过
- [ ] 共享治理验证通过

### 自学习增强 (Phase C)
- [ ] 经验蒸馏自动产出 (experiences.jsonl 有内容)
- [ ] 评分报告可查看 (/report)
- [ ] 模式检测可查看 (/patterns)

### 生命周期 (Phase D)
- [ ] 垃圾回收端点可用 (/lifecycle/gc)
- [ ] 衰减评分整合进 recall 排序

### 性能 (Phase E)
- [ ] 批量操作端点可用 (/batch/recall, /batch/commit)
- [ ] 增量图谱更新可用 (/graph/incremental)

### 联邦 (Phase F)
- [ ] 跨项目导出/导入可用
- [ ] 审批流可用
- [ ] 自适应预算推荐可用

### 动态模板 (Phase G)
- [ ] /recall 带 taskType 返回定制化 brief
- [ ] 不带 taskType 向后兼容

### 运维
- [ ] 备份策略已就绪
- [ ] 日志与监控已就绪
- [ ] LLM 配置验证 (可选: EXPERIENCE_LLM_*, EMBEDDING_*)

---

## 20. 结论

完成上述部署后，你将获得一个以 OpenClaw 为宿主、以 OpenViking 为长期记忆底座、以 Graphify 为结构认知引擎、以 Memory Fabric 为编排层的多 Agent 记忆增强系统。

该系统适合从 POC 逐步走向生产：先解决“不失忆”，再解决“会理解”，最后走向“可共享、可治理、可进化”。
