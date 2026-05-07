# 开发指南

## 如何新增一个 Service

以 `FooService` 为例：

1. **创建 Service 文件**
   ```ts
   // packages/sidecar/src/services/foo-service.ts
   export class FooService {
     async doSomething() { /* ... */ }
   }
   ```

2. **创建对应 Store（如需持久化）**
   ```ts
   // packages/sidecar/src/stores/foo-store.ts
   export class FooStore {
     constructor(private baseDir: string) {}
     async append(data: FooEntry) { /* JSONL append */ }
   }
   ```

3. **注册到 server.ts**
   ```ts
   const foo = new FooService(fooStore);
   registerFooRoute(app, foo);
   ```

4. **创建路由**
   ```ts
   // packages/sidecar/src/routes/foo.ts
   export function registerFooRoute(app: FastifyInstance, foo: FooService) {
     app.get("/foo", async (req, reply) => { /* ... */ });
   }
   ```

5. **写测试**
   ```ts
   // packages/sidecar/test/foo-service.test.ts
   import { describe, it } from "node:test";
   import assert from "node:assert/strict";
   ```

6. **编译验证**
   ```bash
   cd packages/sidecar && pnpm build
   ```

## 测试规范

- 使用 `node:test` + `node:assert/strict`
- 临时目录：`mkdtempSync(join(tmpdir(), "mf-test-"))`
- 测试结束清理：`rmSync(dir, { recursive: true })`
- 运行：`pnpm test`

## 代码规范

- TypeScript strict mode
- 异步操作返回 `Promise<T>`
- fire-and-forget 用 `void fn()` 或 `.catch(() => {})`
- 环境变量通过 `process.env.*` 读取，有默认值

---

*文档版本: P0-P2 | 更新日期: 2026-05-07*
