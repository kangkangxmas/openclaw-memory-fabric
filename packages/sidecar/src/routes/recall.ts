import type { FastifyInstance } from "fastify";
import type { RecallRequest, RecallResponse } from "../models/index.js";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { SharedService } from "../services/shared-service.js";
import type { PatternStore } from "../stores/pattern-store.js";
import { getTemplateConfig } from "../services/brief-templates.js";

export function registerRecallRoute(
  app: FastifyInstance,
  openviking: OpenVikingService,
  shared: SharedService,
  patternStore?: PatternStore
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
            query: { type: "string" },
            taskType: { type: "string" }
          }
        }
      }
    },
    async (request): Promise<RecallResponse> => {
      const { agentId, projectId, scope, depth, query, taskType } = request.body;

      // Core recall from OpenViking (passes taskType for template-driven formatting)
      const result = await openviking.recallMemory({ agentId, projectId, scope, depth, query, taskType });

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

      // Inject learned patterns from PatternStore when the template requests it
      if (patternStore && taskType) {
        const template = getTemplateConfig(taskType);
        if (template.includePatterns) {
          try {
            const patterns = await patternStore.query({ agentId, taskType, limit: 3 });
            if (patterns.length > 0) {
              const patternSection = [
                `\n### Learned Patterns (${taskType})`,
                ...patterns.map(
                  (p) => `- [confidence: ${p.confidence.toFixed(1)}] ${p.commonLessons.slice(0, 2).join("; ") || p.taskType}`
                )
              ].join("\n");
              result.memoryBrief += patternSection;
              result.sources.push("patterns:" + taskType);
            }
          } catch {
            // Pattern injection failure is non-fatal
          }
        }
      }

      return {
        memoryBrief: result.memoryBrief,
        sources: result.sources,
        budgetUsed: result.budgetUsed,
        taskType: result.taskType
      };
    }
  );
}
