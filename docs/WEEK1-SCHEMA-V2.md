# Week 1 开发报告 - Schema V2 基础设施升级

## 完成内容

### 1. Schema V2 核心定义 (`src/models/schema-v2.ts`)

**新增数据结构：**
- `MemoryEntryV2` - 增强记忆条目，支持：
  - **多模态内容**：`ContentBlock[]` 支持 text/code/json/markdown/url 格式
  - **时间线信息**：`MemoryTimeline` 包含 createdAt/updatedAt/expiresAt/version/decayFactor
  - **关联图谱**：`MemoryRelation[]` 支持 related/parent/child/supersedes/derived_from/contradicts
  - **来源追踪**：`MemorySource[]` 记录 session/document/code/external/imported 来源
  - **向量嵌入**：`MemoryEmbedding` 缓存 embedding 向量
  - **扩展元数据**：`MemoryMetadata` 支持 tags/taskType/domain/priority/accessCount

**工具函数：**
- `MemoryEntryBuilder` - 流式构建器模式
- `migrateV1ToV2()` / `downgradeV2ToV1()` - 双向迁移
- `validateMemoryEntryV2()` - 数据验证
- `generateMemoryId()` / `getMemoryAgeDays()` / `isMemoryExpired()` / `getMemoryText()` / `touchMemory()`

### 2. 迁移服务 (`src/services/migration-service.ts`)

- **自动检测** V1 格式并触发迁移
- **增量迁移** - 只迁移未迁移的条目
- **备份机制** - 自动创建 `.v1-backup` 文件
- **迁移标记** - `.migration-v2` 文件记录状态
- **回滚支持** - 从备份恢复

### 3. Embedding Service V2 (`src/services/embedding-service-v2.ts`)

- **Schema V2 兼容**：返回 `MemoryEmbedding` 结构
- **双协议支持**：Ollama native + OpenAI-compatible
- **批量嵌入**：`embedBatch()` 支持并发处理
- **智能缓存**：LRU 缓存，支持 TTL 和模型版本失效
- **健康检查**：`healthCheck()` 检测服务可用性
- **已知模型维度**：nomic-embed-text(768), mxbai-embed-large(1024), all-minilm(384)

### 4. Vector Service V2 (`src/services/vector-service-v2.ts`)

- **混合检索**：语义(余弦相似度) + TF-IDF，权重可配置
- **阈值过滤**：支持最低语义/TF-IDF 分数阈值
- **批量索引**：`indexBatch()` 支持并发写入
- **V2 条目支持**：`indexEntry()` 直接索引 MemoryEntryV2
- **来源标记**：结果标记 semantic/tf-idf/hybrid

### 5. Vector Store V2 (`src/stores/vector-store-v2.ts`)

- **持久化存储**：JSONL 格式，支持 compaction
- **Agent 隔离**：`getByAgent()` 按 Agent 查询
- **统计信息**：`getStats()` 返回条目数/Agent 数/平均维度/模型分布
- **数据验证**：写入时验证向量格式

### 6. OpenVikingService 升级

- **自动迁移**：`loadScopeEntries()` 自动检测并迁移 V1 数据
- **V2 内部存储**：使用 `MemoryEntryV2` 作为内部格式
- **向后兼容**：对外 API 仍返回 V1 格式
- **V2 API**：新增 `inspectMemoryV2()` 返回完整 V2 条目
- **访问统计**：自动更新 accessCount 和 lastAccessedAt

## 测试覆盖

| 模块 | 测试数 | 状态 |
|------|--------|------|
| Schema V2 | 15 | ✅ 通过 |
| Embedding Service V2 | 6 | ✅ 通过 |
| Vector Service V2 | 13 | ✅ 通过 |
| 原有测试 | 248 | ✅ 通过 |
| **总计** | **282** | **✅ 全部通过** |

## 文件清单

### 新增文件
- `src/models/schema-v2.ts` - Schema V2 核心定义
- `src/services/migration-service.ts` - V1→V2 迁移服务
- `src/services/embedding-service-v2.ts` - Embedding Service V2
- `src/services/vector-service-v2.ts` - Vector Service V2
- `src/stores/vector-store-v2.ts` - Vector Store V2
- `test/schema-v2.test.ts` - Schema V2 测试
- `test/embedding-service-v2.test.ts` - Embedding Service 测试
- `test/vector-service-v2.test.ts` - Vector Service 测试

### 修改文件
- `src/services/openviking-service.ts` - 集成 V2 支持
- `src/services/lifecycle-service.ts` - 支持 V2 timeline
- `src/stores/vector-store.ts` - 添加 has/remove/clear 方法

## 向后兼容性

- V1 API 完全保留，对外接口不变
- 自动迁移：读取时自动将 V1 转换为 V2
- 备份机制：迁移前自动创建 `.v1-backup`
- 降级支持：`downgradeV2ToV1()` 可将 V2 转回 V1

## 下一步

Week 2 将开发：
1. Memory Core V2 - 基于 Schema V2 的核心记忆引擎
2. Query Router - 智能查询路由
3. API Layer V2 - RESTful API 升级

---

**开发日期**：2026-05-27
**测试状态**：282/282 ✅
**负责人**：弧极 (Arc) 🌀
