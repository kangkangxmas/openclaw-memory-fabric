import type { FastifyInstance } from "fastify";
import type { DistillService } from "../services/distill-service.js";

interface DistillBody {
  agentId: string;
  projectId?: string;
  messages: Array<{ role: string; content: string }>;
  /** Set to true to invoke the optional LLM refinement tier */
  llm?: boolean;
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
            llm: { type: "boolean" },
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
      return distill.distillAsync({
        messages: request.body.messages,
        llm: request.body.llm ?? false
      });
    }
  );
}
