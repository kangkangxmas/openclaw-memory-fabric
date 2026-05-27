# Memory Fabric Phase 2 — 详细开发排期

> **文档类型**：开发排期计划（Development Schedule）  
> **版本**：v1.0  
> **日期**：2026-05-26  
> **作者**：弧极 Arc 🌀  
> **状态**：待康老板确认

---

## 1. 项目概览

| 项目 | 内容 |
|------|------|
| 项目名称 | Memory Fabric Phase 2 — 自我进化体系 |
| 技术负责人 | 弧极 Arc 🌀 |
| 产品负责人 | 棱镜 Prism 🔷 |
| 需求来源 | 麦斯威 PRD + 棱镜产品设计 |
| 审批人 | 康老板 |
| 开始日期 | 2026-05-27 |
| 预计工期 | 16 个工作日 |
| 预计完成 | 2026-06-18 |

---

## 2. 里程碑总览

```
Week 1 (5.27-5.30) ─── 核心基础设施
  ├── Day 1-3:  Workspace Writer 模块（P0 核心依赖）
  └── Day 4:    迁移脚本 + Region 初始化

Week 2 (6.2-6.6) ──── 蒸馏与上下文
  ├── Day 5-6:  Distill Service Tier 2 LLM 改造（P1）
  ├── Day 7-8:  Context Builder L0/L1/L2 分级注入（P1）
  └── Day 9:    Week 1-2 集成测试

Week 3 (6.9-6.13) ─── 激活与同步
  ├── Day 10-11: Pattern Service + Sharing 激活（P2）
  ├── Day 12-13: Graphify 激活 + 噪声过滤（P2）
  └── Day 14:    低频 Agent 激活机制（P2）

Week 4 (6.16-6.18) ── 集成与验收
  ├── Day 15:   全量迁移 + 验证
  ├── Day 16:   集成测试 + 性能优化
  └── Day 17:   验收测试 + 交付文档
```

---

## 3. 详细排期

---

### Week 1: 核心基础设施（5.27 - 5.30）

---

#### Day 1 (5.27 周二): Workspace Writer — 基础架构

**目标**：搭建 Workspace Writer 模块骨架，实现 Region 标记解析与备份机制

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | 创建 feature 分支，搭建模块目录结构 | `feat/phase2-workspace-writer` |
| 10:30-12:00 | 实现 Region 标记解析器 | `src/services/region-parser.ts` |
| 13:30-15:30 | 实现备份服务（时间戳备份 + 回滚） | `src/services/backup-service.ts` |
| 15:30-17:30 | 实现安全写入核心（定位区域 → 替换 → 验证） | `src/services/safe-writer.ts` |
| 17:30-18:00 | 单元测试 | `tests/region-parser.test.ts` |

**当日交付物**：
- [x] Region 标记正则匹配 6 个区域
- [x] 备份文件生成到 `~/.memory-fabric/backups/{agent}/`
- [x] 写入后验证完整性，失败自动回滚
- [x] 单元测试 ≥ 5 个

---

#### Day 2 (5.28 周三): Workspace Writer — 6 Region 写入策略

**目标**：实现 6 个 Region 的差异化写入策略

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | Region 3 (Runtime) overwrite 策略 | `src/services/runtime-writer.ts` |
| 10:30-12:00 | Region 4 (Decisions) dedup-append 策略 + 去重算法 | `src/services/decision-writer.ts` |
| 13:30-15:00 | Region 5 (Patterns) dedup-append 策略 + 置信度排序 | `src/services/pattern-writer.ts` |
| 15:00-16:30 | Region 6 (Meta) overwrite 策略 + 时间戳更新 | `src/services/meta-writer.ts` |
| 16:30-18:00 | Region 1-2 保护机制 + 边界 case 测试 | `tests/region-protection.test.ts` |

**当日交付物**：
- [x] 6 个 Region 写入策略正确执行
- [x] 去重逻辑（n-gram overlap ≥ 80% 判定为重复）
- [x] Decision Log 保留最近 20 条
- [x] Pattern Library 按置信度降序排列
- [x] Region 1-2 写入请求被拒绝
- [x] 单元测试 ≥ 10 个

---

#### Day 3 (5.29 周四): Workspace Writer — 集成与 API

**目标**：WorkspaceWriter 主类集成，暴露 API，完成错误处理与通知

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | WorkspaceWriter 主类组装 | `src/services/workspace-writer.ts` |
| 10:30-12:00 | initializeRegions() 实现（为无标记文件添加 Region） | `src/services/region-initializer.ts` |
| 13:30-15:00 | 错误处理 + 飞书通知机制 | `src/services/notification-service.ts` |
| 15:00-16:30 | E2E 测试（模拟 agent_end → distill → workspace sync 完整流程） | `tests/workspace-writer.e2e.test.ts` |
| 16:30-18:00 | API 文档 + 代码审查 | `docs/api/workspace-writer.md` |

**当日交付物**：
- [x] `sync()` 方法完整可用
- [x] `initializeRegions()` 方法完整可用
- [x] 写入失败 → 日志 + 通知康老板 + 不阻塞 Agent
- [x] E2E 测试通过率 100%
- [x] API 文档完成

---

#### Day 4 (5.30 周五): 迁移脚本 + 全 Agent 初始化

**目标**：为现有 11 个 Agent 的 SELF_MODEL 添加 Region 标记，从 Carrier 提取内容填充

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | 编写 migrate-self-models.sh 主脚本 | `scripts/migrate-self-models.sh` |
| 10:30-12:00 | 实现备份 → 解析 → 标记 → 填充 → 验证流程 | `scripts/migrate-steps/` |
| 13:30-15:00 | 为 assistant 和 userservice 创建初始 SELF_MODEL | `scripts/create-missing-self-models.sh` |
| 15:00-16:30 | 执行迁移（先在 2 个测试 Agent 上验证） | 迁移报告 |
| 16:30-18:00 | 全量迁移 + 验证 + 回归测试 | 迁移完成报告 |

**当日交付物**：
- [x] 迁移脚本完整可用
- [x] 11 个 Agent 的 SELF_MODEL.md 均包含 6 个 Region 标记
- [x] assistant + userservice 拥有 SELF_MODEL.md
- [x] Region 1-2 内容未被修改
- [x] Region 3-4 内容从 Carrier 正确提取

---

### Week 2: 蒸馏与上下文（6.2 - 6.6）

---

#### Day 5 (6.2 周一): Distill Service — Tier 2 LLM 蒸馏

**目标**：实现 Tier 2 结构化蒸馏，通过 Gateway LLM 能力调用

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | GatewayLLMClient 封装 | `src/services/gateway-llm-client.ts` |
| 10:30-12:00 | Tier2LLMDistiller 核心逻辑 | `src/services/tier2-llm-distiller.ts` |
| 13:30-15:00 | 角色定制化蒸馏 Prompt 模板 | `src/templates/distill-prompts/` |
| 15:00-16:30 | 结构化输出解析 + 校验 | `src/services/distill-output-parser.ts` |
| 16:30-18:00 | 单元测试 | `tests/tier2-distiller.test.ts` |

**当日交付物**：
- [x] Tier 2 蒸馏通过 Gateway 调用 deepseek-v4-flash
- [x] 产出结构化 DistillResult（decisions/patterns/uncertainties/selfUpdate）
- [x] LLM 调用失败自动 fallback 到 Tier 1
- [x] 单元测试 ≥ 5 个

---

#### Day 6 (6.3 周二): Distill Service — 集成改造

**目标**：DistillService 主类集成 Tier 1 + Tier 2，支持深度控制

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | DistillService 主类改造（Tier 1 + Tier 2 编排） | `src/services/distill-service.ts` |
| 10:30-12:00 | 深度控制（L0 跳过 Tier 2，L1/L2 执行） | 深度控制逻辑 |
| 13:30-15:00 | 异步执行机制（agent_end 后非阻塞） | 异步管道改造 |
| 15:00-16:30 | MEMORY.md 质量过滤（≥ 30 字符 + 完整性 + 去重 + 噪声） | `src/services/memory-quality-filter.ts` |
| 16:30-18:00 | 集成测试 | `tests/distill-integration.test.ts` |

**当日交付物**：
- [x] DistillService 支持 depth 参数
- [x] L0 跳过 Tier 2，L1/L2 执行
- [x] 异步执行不阻塞 Agent 响应
- [x] MEMORY.md 质量过滤 4 项规则
- [x] 集成测试通过

---

#### Day 7 (6.4 周三): Context Builder — L0/L1/L2 分级注入

**目标**：实现任务复杂度判定与分级上下文注入

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | 深度判定逻辑（determineDepth） | `src/services/context-builder.ts` |
| 10:30-12:00 | L0 注入（Identity + Rules + Runtime，≤ 600 tokens） | L0 构建逻辑 |
| 13:30-15:00 | L1 注入（L0 + Top5 实体 + 5 条决策，≤ 1800 tokens） | L1 构建逻辑 |
| 15:00-16:30 | L2 注入（L1 + 完整 Brief + 全部决策 + 模式，≤ 5000 tokens） | L2 构建逻辑 |
| 16:30-18:00 | before_prompt_build hook 集成 | hook 改造 |

**当日交付物**：
- [x] 3 级深度判定逻辑
- [x] 3 级上下文组装
- [x] Token 预算控制（600/1800/5000）
- [x] Hook 集成

---

#### Day 8 (6.5 周四): Context Builder — 优化与边界

**目标**：优化注入效率，处理边界 case，缓存机制

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | SELF_MODEL 内容缓存（避免每次读文件） | 缓存层 |
| 10:30-12:00 | Token 计数 + 精确预算控制 | Token 计数器 |
| 13:30-15:00 | 边界 case：缺失 Region、空内容、超大文件 | 边界处理 |
| 15:00-16:30 | 降级策略（读取失败时的最小注入） | 降级逻辑 |
| 16:30-18:00 | 单元测试 + 性能基准测试 | 测试 + 基准 |

**当日交付物**：
- [x] 缓存命中率 ≥ 80%
- [x] Context 构建延迟 < 200ms
- [x] 降级策略保证最小注入
- [x] 单元测试 ≥ 8 个

---

#### Day 9 (6.6 周五): Week 1-2 集成测试

**目标**：验证 Workspace Writer + Distill Tier 2 + Context Builder 完整链路

| 时间 | 任务 | 产出 |
|------|------|------|
| 09:00-10:30 | 完整链路测试：agent_end → distill → carrier merge → workspace sync | E2E 测试 |
| 10:30-12:00 | Region 保护测试：确认 Region 1-2 不被覆盖 | 安全测试 |
| 13:30-15:00 | 降级测试：Tier 2 失败 → Tier 1 fallback → 仍能写入 Workspace | 降级测试 |
| 15:00-16:30 | L0/L1/L2 注入准确性测试 | 注入测试 |
| 16:30-18:00 | Bug 修复 + 代码审查 | Bug 列表 |

**当日交付物**：
- [x] 完整链路测试通过
- [x] Region 保护 100% 生效
- [x] 降级路径正常
- [x] 3 级注入内容准确
- [x] 无 P0/P1 Bug

---

### Week 3: 激活与同步（6.9 - 6.13）

---

#### Day 10 (6.9 周一): Pattern Service 激活

**目标**：模式检测达到阈值后自动写入 SELF_MODEL Region 5

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | PatternService 阈值检查改造 | `src/services/pattern-service.ts` 改造 |
| 10:30-12:00 | 模式 → Workspace Writer Region 5 写入 | 写入管道 |
| 13:30-15:00 | 模式格式化（Pattern → Markdown 条目） | 格式化器 |
| 15:00-16:30 | 飞书通知：模式发现通知康老板 | 通知集成 |
| 16:30-18:00 | 单元测试 | 测试 ≥ 5 个 |

**当日交付物**：
- [x] 模式 freq ≥ 3, successRate ≥ 0.8, confidence ≥ 0.9 → 自动写入
- [x] 写入后通知康老板
- [x] 单元测试通过

---

#### Day 11 (6.10 周二): Sharing Service 激活

**目标**：高置信度模式跨 Agent 推送

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | SharingService Jaccard 相似度匹配激活 | `src/services/sharing-service.ts` 改造 |
| 10:30-12:00 | 跨 Agent 模式推送管道 | 推送逻辑 |
| 13:30-15:00 | 推送 → 目标 Agent Carrier 写入 | Carrier 写入 |
| 15:00-16:30 | 飞书通知：模式分享通知康老板（含 approve/reject 信息） | 通知格式 |
| 16:30-18:00 | 单元测试 | 测试 ≥ 3 个 |

**当日交付物**：
- [x] Jaccard ≥ 0.6 的 Agent 自动接收模式推送
- [x] 推送后通知康老板
- [x] 单元测试通过

---

#### Day 12 (6.11 周三): Graphify 激活 — 增量刷新

**目标**：文件变更触发增量图谱更新 + 每周全量刷新

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | GraphifySyncService 实现 | `src/services/graphify-sync.ts` |
| 10:30-12:00 | 文件变更监听（chokidar） | 文件监听器 |
| 13:30-15:00 | 增量刷新逻辑 | 增量更新 |
| 15:00-16:30 | 每周全量刷新 cron（每周日 03:00） | Cron 配置 |
| 16:30-18:00 | 单元测试 | 测试 ≥ 3 个 |

**当日交付物**：
- [x] 文件变更触发增量图谱更新
- [x] 每周全量刷新 cron
- [x] 增量刷新延迟 < 30s

---

#### Day 13 (6.12 周四): Graphify 激活 — 噪声过滤 + 新鲜度

**目标**：增强噪声过滤，新鲜度健康检查

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | 噪声过滤增强（最小长度 + 纯数字/标点过滤 + 孤立实体） | 噪声过滤器 |
| 10:30-12:00 | 新鲜度健康检查集成到 self-model-audit | 审计增强 |
| 13:30-15:00 | Structural Brief 质量评估（freshness: stale → fresh 判定） | 新鲜度判定 |
| 15:00-16:30 | 图谱 stale > 7 天 → 飞书通知弧极 | 通知集成 |
| 16:30-18:00 | 单元测试 | 测试 ≥ 5 个 |

**当日交付物**：
- [x] 噪声实体下降 ≥ 50%
- [x] 中文 ≥ 2 字符，英文 ≥ 3 字符过滤
- [x] 纯数字/标点/孤立实体过滤
- [x] stale > 7 天通知

---

#### Day 14 (6.13 周五): 低频 Agent 激活

**目标**：为 marketing/userservice/assistant 设计触发式唤醒机制

| 时间 | 任务 | 产出文件 |
|------|------|----------|
| 09:00-10:30 | AgentActivationService 实现 | `src/services/agent-activation.ts` |
| 10:30-12:00 | stale 检测 + 自我激活任务推送 | 激活逻辑 |
| 13:30-15:00 | dormant 标记 + 通知康老板 | dormant 逻辑 |
| 15:00-16:30 | marketing 触发器（ops 快报注入）| 触发器配置 |
| 16:30-18:00 | 单元测试 + 集成验证 | 测试 ≥ 3 个 |

**当日交付物**：
- [x] stale > 7 天 → 推送自我激活任务
- [x] 30 天零活动 → dormant + 通知康老板
- [x] marketing 触发器配置

---

### Week 4: 集成与验收（6.16 - 6.18）

---

#### Day 15 (6.16 周一): 全量迁移 + 验证

**目标**：在生产环境执行全量迁移，验证所有 Agent

| 时间 | 任务 | 产出 |
|------|------|------|
| 09:00-10:30 | 生产环境备份 | 全量备份 |
| 10:30-12:00 | 执行迁移脚本 | 迁移日志 |
| 13:30-15:00 | 逐一验证 11 个 Agent 的 SELF_MODEL | 验证报告 |
| 15:00-16:30 | 修复迁移问题 | Bug 修复 |
| 16:30-18:00 | 灰度验证：选 2 个 Agent 跑完整 agent_end 流程 | 灰度报告 |

**当日交付物**：
- [x] 11 个 Agent SELF_MODEL 迁移完成
- [x] Region 1-2 内容不变
- [x] Region 3-6 正确填充
- [x] 灰度验证通过

---

#### Day 16 (6.17 周二): 集成测试 + 性能优化

**目标**：全链路集成测试 + 性能基准

| 时间 | 任务 | 产出 |
|------|------|------|
| 09:00-10:30 | 全链路集成测试（11 Agent × 完整流程） | 测试报告 |
| 10:30-12:00 | 性能基准测试 | 性能数据 |
| 13:30-15:00 | 性能优化（缓存、批量写入、异步优化） | 优化 Patch |
| 15:00-16:30 | 压力测试（连续 10 次 agent_end 无异常） | 压力报告 |
| 16:30-18:00 | Bug 修复 | Bug 列表 |

**当日交付物**：
- [x] 全链路测试通过
- [x] Distill Tier 2 延迟 < 10s
- [x] Workspace 写入延迟 < 500ms
- [x] Context 构建 < 200ms
- [x] 无 P0 Bug

---

#### Day 17 (6.18 周三): 验收测试 + 交付文档

**目标**：按验收标准逐项检查，输出交付文档

| 时间 | 任务 | 产出 |
|------|------|------|
| 09:00-10:30 | P0 验收测试 | P0 验收报告 |
| 10:30-12:00 | P1 验收测试 | P1 验收报告 |
| 13:30-15:00 | P2 验收测试 | P2 验收报告 |
| 15:00-16:30 | 交付文档整理 | 交付物清单 |
| 16:30-18:00 | 向康老板汇报 | 验收汇报 |

**当日交付物**：
- [x] P0 验收通过
- [x] P1 验收通过
- [x] P2 验收通过
- [x] 交付文档完整

---

## 4. 依赖关系图

```
Day 1-3: Workspace Writer ─────────┐
                                    ├──→ Day 9: 集成测试
Day 4: 迁移脚本 ───────────────────┘         │
                                              ▼
Day 5-6: Distill Tier 2 ──────────┐
                                    ├──→ Day 9: 集成测试
Day 7-8: Context Builder ─────────┘
                                              │
                                              ▼
Day 10-11: Pattern + Sharing ─────┐
                                    ├──→ Day 14: 激活验证
Day 12-13: Graphify ──────────────┘
                                    │
Day 14: Agent Activation ──────────┘
                                              │
                                              ▼
Day 15-17: 全量迁移 + 集成测试 + 验收
```

**关键路径**：Day 1-3 (Workspace Writer) → Day 9 (集成测试) → Day 15-17 (验收)

---

## 5. 风险与应对

| 风险 | 影响 | 概率 | 应对 | 预留时间 |
|------|------|------|------|---------|
| Workspace 写入失败导致 SELF_MODEL 损坏 | 高 | 低 | 自动备份 + 回滚机制 | 0 天 |
| Tier 2 LLM 蒸馏成本过高 | 中 | 中 | 使用 deepseek-v4-flash，L0 跳过 Tier 2 | 0 天 |
| Region 标记格式解析异常 | 高 | 低 | 严格正则 + 格式验证 + 回滚 | 0.5 天 |
| 迁移后 Agent 行为异常 | 高 | 低 | 灰度发布 + 快速回滚 | 0.5 天 |
| Graphify 增量刷新性能差 | 中 | 中 | 文件变更防抖 + 批量处理 | 0.5 天 |
| Gateway LLM 调用频率受限 | 中 | 低 | 队列 + 指数退避 + Tier 1 fallback | 0 天 |

**风险缓冲**：Week 4 前半段预留了弹性时间应对以上风险。

---

## 6. 交付物清单

| # | 交付物 | 类型 | 负责人 | 交付日 |
|---|--------|------|--------|--------|
| 1 | Workspace Writer 模块 | 代码 | 弧极 | Day 3 |
| 2 | Region 标记解析器 | 代码 | 弧极 | Day 1 |
| 3 | 迁移脚本 | 脚本 | 弧极 | Day 4 |
| 4 | Tier 2 LLM Distiller | 代码 | 弧极 | Day 5-6 |
| 5 | Context Builder L0/L1/L2 | 代码 | 弧极 | Day 7-8 |
| 6 | Pattern Service 激活 | 代码 | 弧极 | Day 10 |
| 7 | Sharing Service 激活 | 代码 | 弧极 | Day 11 |
| 8 | Graphify 激活 + 噪声过滤 | 代码 | 弧极 | Day 12-13 |
| 9 | Agent Activation 服务 | 代码 | 弧极 | Day 14 |
| 10 | 全量迁移报告 | 文档 | 弧极 | Day 15 |
| 11 | 集成测试报告 | 文档 | 弧极 | Day 16 |
| 12 | 验收测试报告 | 文档 | 弧极 | Day 17 |
| 13 | API 文档 | 文档 | 弧极 | Day 3 + Day 8 |
| 14 | SELF_MODEL 标准模板 | 模板 | 弧极 | Day 4 |

---

## 7. 验收标准

### P0 验收（Day 17）

- [ ] 任意 Agent 完成有实质决策的对话后，Workspace SELF_MODEL.md 的 Runtime Reflections 区域被自动更新
- [ ] Identity / Rules 区域内容不被自动化覆盖
- [ ] 写入失败不阻塞 Agent 正常响应

### P1 验收（Day 17）

- [ ] 所有 Agent 的 Workspace SELF_MODEL 包含 6 个标准区域
- [ ] MEMORY.md 新增条目中，完整条目占比 ≥ 80%
- [ ] 决策日志条目包含 Context / Decision / Rationale 三个字段

### P2 验收（Day 17）

- [ ] assistant 和 userservice 有 Workspace SELF_MODEL.md
- [ ] Graphify 图谱新鲜度 ≤ 7 天
- [ ] structural brief 中噪声实体数量下降 ≥ 50%

### P3 验收（后续迭代）

- [ ] 中文对话的 distill 准确率达到 ≥ 70%（人工抽查 20 条）
- [ ] 至少 1 次跨 Agent 模式分享被成功推送

---

## 8. 沟通计划

| 频率 | 内容 | 途径 | 接收者 |
|------|------|------|--------|
| 每日 | 进度更新（完成/阻塞/计划） | 飞书 DM | 康老板 |
| 每周五 | 周报（进度 + 风险 + 下周计划） | 飞书群 | 康老板 + 棱镜 |
| 里程碑 | 阶段性 Demo + 评审 | 飞书视频 | 全团队 |
| 异常 | 阻塞问题 + 解决方案 | 飞书 DM | 康老板（即时） |

---

_本排期基于技术架构方案 v1.0，待康老板确认后立即启动开发。_

---

**文档信息**  
作者：弧极 Arc 🌀  
日期：2026-05-26  
版本：v1.0  
状态：待确认
