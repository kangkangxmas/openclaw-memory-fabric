import type { FastifyInstance } from "fastify";
import type { RecallRequest, RecallResponse } from "../models/index.js";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { SharedService } from "../services/shared-service.js";

export function registerRecallRoute(
  app: FastifyInstance,
  openviking: OpenVikingService,
  shared: SharedService
): void {
  app.post<{ Body: RecallRequest }>(
    "/recall",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            scope: { type: "string", enum: ["private", "project", "shared", "auto"] },
            depth: { type: "string", enum: ["l0", "l1", "l2"] },
            query: { type: "string" }
          }
        }
      }
    },
    async (request): Promise<RecallResponse> => {
      const { agentId, projectId, scope, depth, query } = request.body;

      // Core recall from OpenViking
      const result = await openviking.recallMemory({ agentId, projectId, scope, depth, query });

      // Append shared memory when scope includes shared and projectId is provided
      if ((scope === "shared" || scope === "auto") && projectId) {
        try {
          const sharedResult = await shared.recall({ projectId, query, limit: 10 });
          if (sharedResult.entries.length > 0) {
            const sharedSection = [
              "\n### Shared Memory",
              ...sharedResult.entries.map(
                (e) => `- [${e.type}] ${e.content} _(from: ${e.sourceAgent})_`
              )
            ].join("\n");
            result.memoryBrief += sharedSection;
            result.sources.push(sharedResult.source);
          }
        } catch {
          // Shared recall failure is non-fatal
        }
      }

      return result;
    }
  );
}
