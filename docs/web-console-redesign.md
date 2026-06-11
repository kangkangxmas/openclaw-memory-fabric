# Memory Fabric Web Console 重设计说明

> 日期：2026-06-12
> 目标：把旧 Inspector 工具页重构为可长期使用的后台控制台。

## 本轮改造范围

- 页面框架从旧的文档式侧栏切到 Admin Console：顶部状态栏、左侧分组导航、右侧主工作区。
- 视觉定调改为黑紫色：深色背景、紫色主操作、洋红辅助状态、深色卡片和表格。
- 增加中英文切换：顶部语言开关持久化到 `localStorage`，覆盖全局导航、筛选区、总览、记忆浏览、知识图谱、载体、自学习、联邦治理和 V2 核心运维文案。
- 导航按功能架构重新分组：
  - 运行与灰度：控制台总览、V2 灰度中心。
  - 记忆资产：记忆浏览、知识图谱、载体文件。
  - 治理与学习：自学习、联邦治理。
- 左侧增加功能地图，表达 `L0 事件账本 -> 候选审核 -> 记忆小卡 -> Carrier 投影 -> Bench 验收` 的核心链路。
- 总览页增加记忆链路说明和五段式功能架构卡片。

## 仍需继续优化

- V2 灰度中心需要继续拆分为独立工作区：Canary、Review、Trace、Bench、Carrier Projection。
- 后续继续补充更细的帮助说明和字段级 tooltip，当前静态界面文案已集中到 i18n 字典。
- 需要为写入类操作增加二次确认：Bench Seed、Projection Apply/Rollback、Worker Stop。
- 知识图谱页还需要更清晰的 relation path、筛选和节点详情面板。
- Carrier 页需要 patch diff 和 rollback history，而不是只浏览 Markdown。

## 设计约束

- 暂不引入重型 UI 依赖，继续使用 React + Tailwind，避免后台 bundle 和构建复杂度上升。
- 保留现有 API 和页面路由，不影响 sidecar、plugin 和 OpenClaw 运行链路。
- 先完成框架、主题和信息架构，再逐页打磨数据表达。
