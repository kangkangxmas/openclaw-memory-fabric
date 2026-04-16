# OpenClaw Memory Fabric
## VibeCoding 开发指令文档
**文档版本**：v1.0  
**文档类型**：AI Coding 执行说明  
**发布日期**：2026-04-15  
**适用对象**：Claude Code、Codex、OpenCode、OpenClaw Agent、任意 VibeCoding 工具

---

## 0. 文档用途

本文件不是产品文档，而是**可直接驱动 AI Coding 工具分阶段实现系统**的开发指令。  
执行本文件时，工具应遵守以下原则：

- 不修改 OpenClaw、OpenViking、Graphify 上游源码
- 以 **OpenClaw 原生插件** 为主交付物
- 插件内部附带 Skills
- 所有重计算逻辑放入 Sidecar
- 任何时候都优先保证可运行、可测试、可回滚
- 每完成一个阶段，都必须通过文档中的验收标准后再进入下一阶段

---

## 1. 目标产物

你需要产出一个名为 **`openclaw-memory-fabric`** 的工程，包含以下内容：

1. OpenClaw 原生插件
2. 插件附带的 Skills 包
3. Sidecar 本地服务
4. 配置模板
5. 本地开发脚本
6. 自动化测试
7. 安装部署文档
8. 示例项目 bootstrap 命令

最终目标：让 OpenClaw 在不修改上游源码的情况下获得：
- 多 Agent 记忆隔离
- 跨天记忆持久化
- 长期记忆载体
- Graphify 结构认知优先
- 自我模型更新能力

---

## 2. 工作方式要求

### 2.1 执行顺序
严格按以下阶段顺序开发：
1. 工程骨架
2. 插件 manifest 与最小启动
3. 配置与健康检查
4. Sidecar 最小服务
5. OpenViking 适配
6. Carrier 文件系统
7. Hook 注入
8. Distill 与 commit
9. Graphify 适配
10. Skills 打包
11. 共享治理
12. 可观测性
13. 测试与验收

### 2.2 开发行为要求
- 每阶段结束必须更新 `CHANGELOG.md`
- 每阶段结束必须补齐或更新测试
- 不允许把未验证的伪代码保留在主分支
- 不允许跳阶段先写高复杂模块
- 每新增一个 tool，都要提供 schema、handler、测试
- 每新增一个 carrier 文件，都要提供职责说明与 merge 规则

### 2.3 实现风格要求
- TypeScript 优先
- Node.js 20+ 兼容
- 插件代码与 sidecar 代码解耦
- 所有 I/O 封装在 adapter / service 层
- 所有业务对象有明确定义的 types
- 所有配置通过 schema 校验

---

## 3. 目标目录结构

严格使用如下目录结构：

```text
openclaw-memory-fabric/
  README.md
  CHANGELOG.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json

  packages/
    plugin/
      package.json
      openclaw.plugin.json
      tsconfig.json
      src/
        index.ts
        types/
        config/
        hooks/
        tools/
        orchestrator/
        adapters/
        carriers/
        observability/
        utils/
      skills/
        project-sensemaking/SKILL.md
        memory-hygiene/SKILL.md
        execution-gate/SKILL.md
        post-task-distill/SKILL.md
      test/

    sidecar/
      package.json
      tsconfig.json
      src/
        server.ts
        routes/
        services/
        adapters/
        models/
        utils/
      test/

  docs/
    01-product-design.md
    02-technical-architecture.md
    03-vibecoding-dev-instructions.md
    04-install-deployment.md

  examples/
    config/
    project-sample/
  scripts/
```

如果实现中发现需要调整，请仅在不破坏整体分层的前提下做最小修改。

---

## 4. 阶段 1：初始化工程骨架

### 目标
创建 monorepo 工程与基础文档。

### 任务
1. 创建上述目录结构
2. 初始化 `pnpm-workspace.yaml`
3. 初始化根目录 `package.json`
4. 初始化 TypeScript 基础配置
5. 创建 `README.md`、`CHANGELOG.md`
6. 在 `docs/` 目录内放置本项目四份文档

### 输出要求
- 根目录 `pnpm install` 可执行
- `pnpm -r build` 结构上可运行，即使先只输出 hello build
- README 说明项目用途

### 验收标准
- 目录结构完整
- `pnpm install` 成功
- 所有 package 可解析
- 无 TypeScript 配置错误

---

## 5. 阶段 2：实现 OpenClaw 插件最小可启动版本

### 目标
实现一个最小可加载的原生插件。

### 任务
1. 创建 `packages/plugin/openclaw.plugin.json`
2. 定义最小 `configSchema`
3. 实现插件入口 `src/index.ts`
4. 注册一个最小工具 `health_status`
5. 能被 OpenClaw 识别并加载

### 输出要求
- 插件 manifest 合法
- `health_status` 返回静态 JSON
- 插件启动日志明确显示版本和配置摘要

### 验收标准
- OpenClaw 能识别并加载插件
- 调用 `health_status` 返回 200
- 插件未引发 gateway 启动异常

---

## 6. 阶段 3：配置与配置校验

### 目标
实现可用的配置加载与 schema 校验。

### 任务
1. 定义配置类型 `MemoryFabricConfig`
2. 使用 schema 校验插件配置
3. 提供默认值合并逻辑
4. 输出 `examples/config/memory-fabric.yaml`

### 配置字段最少包含
- `defaultScope`
- `sidecar.baseUrl`
- `sidecar.timeoutMs`
- `openviking.mode`
- `openviking.targetRoot`
- `graphify.basePath`
- `graphify.autoBootstrap`
- `publishPolicy.defaultVisibility`
- `observability.logLevel`

### 验收标准
- 缺失必填项时报错清晰
- 合法配置可正常加载
- 默认值覆盖行为正确

---

## 7. 阶段 4：实现 Sidecar 最小服务

### 目标
提供可被插件调用的本地 HTTP 服务。

### 任务
1. 选择 Web 框架（Fastify 或 Express，优先 Fastify）
2. 实现：
   - `GET /health`
   - `POST /recall`
   - `POST /commit`
3. 先用 mock 数据返回
4. 统一错误返回格式
5. 加入请求日志中间件

### 错误格式
```json
{
  "error": {
    "code": "SIDE_CAR_ERROR",
    "message": "human readable message",
    "details": {}
  }
}
```

### 验收标准
- Sidecar 可独立启动
- 插件能访问 `/health`
- mock recall / commit 正常返回

---

## 8. 阶段 5：接入 OpenViking 适配层

### 目标
实现 OpenViking 的 recall / commit 适配。

### 任务
1. 在 sidecar 实现 `openviking_service`
2. 封装：
   - `recallMemory()`
   - `commitSession()`
   - `readScopeSummary()`
3. 支持 local mode
4. 对 URI 进行统一构造
5. 实现最小集成测试

### 约束
- 不直接把 OpenViking API 散落在业务代码里
- 所有 OpenViking 调用都必须经过 adapter/service

### 验收标准
- 给定 agentId + projectId + query 能返回 recall 结果
- commit 成功后可二次召回
- URI 构造符合规范

---

## 9. 阶段 6：实现 Carrier 文件系统

### 目标
实现稳定记忆载体的创建、读取、合并、写入。

### 任务
1. 实现 `CarrierRepository`
2. 实现初始化逻辑：
   - `identity.md`
   - `working-style.md`
   - `self-model.md`
   - `project-model.md`
   - `decision-log.md`
   - `entities-glossary.md`
   - `playbooks.md`
   - `open-questions.md`
   - `execution-journal.md`
3. 实现 merge 规则
4. 提供 `carrier_read` 与 `carrier_merge`

### 规则
- 不允许直接字符串拼接覆盖全部文件
- 每种 carrier 使用专门 merge 策略
- 每次写入都写操作日志

### 验收标准
- 新项目可自动初始化全套 carriers
- merge 后结构稳定
- 重复执行不产生灾难性重复

---

## 10. 阶段 7：实现 Hook 注入与 Memory Brief

### 目标
在 OpenClaw 的对话生命周期中注入记忆简报。

### 任务
1. 实现 `before_prompt_build` handler
2. 从当前上下文推断：
   - `agentId`
   - `projectId`
   - `scope`
   - `depth`
3. 调 sidecar `/recall`
4. 组合生成 `MemoryBrief`
5. 通过 `prependContext` 注入

### 输出模板
```markdown
## Memory Brief
### Current Scope
...
### Known Facts
...
### Decisions
...
### Unknowns
...
### Recommended Next Actions
...
```

### 验收标准
- 每次任务前可看到稳定格式的 brief
- 简报来源可追踪
- 注入失败时不影响正常会话，仅降级

---

## 11. 阶段 8：实现 Distill 与 Commit

### 目标
在任务结束后自动蒸馏并回写记忆。

### 任务
1. 实现 `agent_end` handler
2. 抽取：
   - facts
   - decisions
   - entities
   - patterns
   - unresolved
3. 调 `/commit`
4. 更新 carriers
5. 更新 `self-model.md`

### Distill 输出对象
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

### 验收标准
- 完成复杂任务后 carriers 被更新
- OpenViking 中可以召回本轮关键结论
- `self-model.md` 可反映最新理解状态

---

## 12. 阶段 9：接入 Graphify

### 目标
让系统具备“结构认知优先”能力。

### 任务
1. 实现 `graphify_service`
2. 支持：
   - `bootstrapProjectGraph()`
   - `readStructuralBrief()`
   - `queryGraph()`
   - `pathGraph()`
   - `explainGraph()`
3. 把 Graphify 输出目录统一映射到项目目录
4. 在 recall 流程中加入结构判断：
   - 新项目
   - 大项目
   - 跨模块问题
   - 置信度低

### 行为要求
- 复杂任务优先读 `GRAPH_REPORT.md`
- 精确问题再查询 `graph.json`
- 不允许默认把整个 `graph.json` 注入 prompt

### 验收标准
- 新项目能成功 bootstrap 图谱
- 复杂问题前能生成 `StructuralBrief`
- query/path/explain 可用

---

## 13. 阶段 10：打包 Skills

### 目标
用 Skills 固化行为纪律。

### 任务
实现以下 skills：
1. `project-sensemaking`
2. `memory-hygiene`
3. `execution-gate`
4. `post-task-distill`

### 每个 Skill 必须包含
- YAML frontmatter
- 使用场景
- 行为规则
- 正反例
- 工具调用建议

### 验收标准
- Skills 能被 OpenClaw 正常识别
- 与插件配合后，Agent 在复杂任务中先输出结构理解
- Agent 不会把明显临时信息写入长期记忆

---

## 14. 阶段 11：实现共享治理

### 目标
支持项目共享与组织共享记忆。

### 任务
1. 实现 `memory_publish_shared`
2. 实现 `memory_forget_scoped`
3. 共享内容写入 metadata
4. 实现 project shared / org shared 两层目录
5. 加入权限校验

### 验收标准
- 私有内容默认不共享
- 显式 publish 后可被其他 Agent 召回
- 撤回后不再参与默认 recall

---

## 15. 阶段 12：实现可观测性

### 目标
让系统具备日志、指标、健康检查与降级可见性。

### 任务
1. 实现统一日志封装
2. 记录 hook 与 tool 耗时
3. 记录 recall sources
4. 记录降级模式
5. 提供 debug 开关

### 验收标准
- 能快速定位 recall 失败、commit 失败、graph 缺失
- 日志可看出任务使用了哪些记忆来源
- Sidecar 与插件的 request_id 可串联

---

## 16. 阶段 13：测试与验收

### 必须实现的测试集
#### 单元测试
- scope 路由
- carrier merge
- config parser
- brief composer
- graph trigger planner

#### 集成测试
- sidecar recall / commit
- plugin hook invoke
- graph bootstrap mock
- shared publish

#### E2E 测试
1. 多 Agent 隔离测试
2. 跨天续接测试
3. 结构认知优先测试
4. 共享治理测试
5. 故障降级测试

### 最终验收标准
只有全部满足以下条件才可视为完成：
- 插件可安装、可启动
- Sidecar 可运行
- OpenViking recall/commit 可用
- Graphify bootstrap/query 可用
- 多 Agent 记忆隔离可验证
- 跨天不失忆可验证
- 复杂任务结构优先可验证
- 安装部署文档完整可执行

---

## 17. 推荐实现细节

### 17.1 类型优先
先定义类型，再写逻辑：
- `MemoryBrief`
- `DistillResult`
- `SelfModel`
- `StructuralBrief`
- `CarrierPatch`
- `PluginConfig`

### 17.2 Adapter 优先
先封装外部系统：
- `OpenVikingAdapter`
- `GraphifyAdapter`
- `SidecarClient`

### 17.3 Orchestrator 收口
把复杂流程放进 orchestrator：
- `RecallOrchestrator`
- `CommitOrchestrator`
- `GraphBootstrapOrchestrator`

### 17.4 避免坏味道
禁止：
- 在 hooks 中写大段业务逻辑
- 在 tools 中直接访问文件系统
- 在多个地方手写 path 拼接
- 在无 schema 的情况下读取 config
- 把 Graphify 原始大文件直接塞进 prompt

---

## 18. 代码质量要求

- ESLint + Prettier
- 严格 TypeScript
- 无 `any` 泛滥
- 所有异步有错误边界
- 所有文件系统操作有幂等保护
- 所有网络调用支持 timeout 与 retry（谨慎重试）
- 输出日志不可泄露敏感路径与密钥

---

## 19. 最终交付清单

交付时必须具备：

1. 可安装的 OpenClaw 插件包
2. 可启动的 Sidecar 服务
3. 可识别的 Skills
4. 示例配置文件
5. 四份正式文档
6. 自动化测试
7. 示例项目 bootstrap 流程
8. README 中的启动示例
9. 故障排查说明
10. 明确的版本号与 changelog

---

## 20. 最终执行提示

执行本文件时，请遵循以下策略：
- 先让系统“跑起来”，再让系统“变聪明”
- 先实现持久化与隔离，再实现结构认知
- 先保证回写稳定，再做共享治理
- 先写测试，再做复杂重构
- 不做超前设计，不为未来可能性把当前实现变复杂

本文件的目标不是“写一堆代码”，而是**按阶段稳定实现一个真正可运行、可验证、可部署的多 Agent 记忆增强系统**。
