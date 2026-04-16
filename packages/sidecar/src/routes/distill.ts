import type { FastifyInstance } from "fastify";
import type { DistillService } from "../services/distill-service.js";

interface DistillBody {
  agentId: string;
  projectId?: string;
  messages: Array<{ role: string; content: string }>;
}

export function registerDistillRoute(app: FastifyInstance, distill: DistillService): void {
  app.post<{ Body: DistillBody }>(
    "/distill",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId", "messages"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            messages: {
              type: "array",
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: { type: "string" },
                  content: { type: "string" }
                }
              }
            }
          }
        }
      }
    },
    async (request) => {
      return distill.distill({ messages: request.body.messages });
    }
  );
}
