import type { FastifyInstance } from "fastify";
import type { SharedService, SharedEntry } from "../services/shared-service.js";

interface PublishBody {
  sourceAgent: string;
  projectId: string;
  visibility?: "project_shared" | "org_shared";
  items: Array<{ type: SharedEntry["type"]; content: string; tags?: string[] }>;
}

interface ForgetBody {
  projectId: string;
  query: string;
  sourceAgent?: string;
}

interface RecallSharedBody {
  projectId: string;
  query?: string;
  limit?: number;
}

export function registerSharedRoutes(app: FastifyInstance, shared: SharedService): void {
  app.post<{ Body: PublishBody }>(
    "/shared/publish",
    {
      schema: {
        body: {
          type: "object",
          required: ["sourceAgent", "projectId", "items"],
          properties: {
            sourceAgent: { type: "string", minLength: 1 },
            projectId: { type: "string", minLength: 1 },
            visibility: { type: "string", enum: ["project_shared", "org_shared"] },
            items: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["type", "content"],
                properties: {
                  type: { type: "string", enum: ["fact", "decision", "entity", "pattern", "note"] },
                  content: { type: "string", minLength: 1 },
                  tags: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      }
    },
    async (request) => {
      const { sourceAgent, projectId, visibility = "project_shared", items } = request.body;
      return shared.publish({ sourceAgent, projectId, visibility, items });
    }
  );

  app.post<{ Body: ForgetBody }>(
    "/shared/forget",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "query"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            query: { type: "string", minLength: 1 },
            sourceAgent: { type: "string" }
          }
        }
      }
    },
    async (request) => {
      return shared.forget(request.body);
    }
  );

  app.post<{ Body: RecallSharedBody }>(
    "/shared/recall",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            query: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 100 }
          }
        }
      }
    },
    async (request) => {
      return shared.recall(request.body);
    }
  );
}
