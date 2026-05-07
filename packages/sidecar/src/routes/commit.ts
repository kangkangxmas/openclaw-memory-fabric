import type { FastifyInstance } from "fastify";
import type { CommitRequest, CommitResponse } from "../models/index.js";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { ExperienceService, PostCommitContext } from "../services/experience-service.js";

export function registerCommitRoute(
  app: FastifyInstance,
  openviking: OpenVikingService,
  experience?: ExperienceService
): void {
  app.post<{ Body: CommitRequest }>(
    "/commit",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            facts: { type: "array", items: { type: "string" } },
            decisions: { type: "array", items: { type: "string" } },
            entities: { type: "array", items: { type: "string" } },
            patterns: { type: "array", items: { type: "string" } },
            unresolved: { type: "array", items: { type: "string" } },
            visibility: { type: "string", enum: ["private", "project_shared", "org_shared"] }
          }
        }
      }
    },
    async (request): Promise<CommitResponse> => {
      const result = await openviking.commitSession(request.body);

      // P0-1 / P0-3: Fire-and-forget experience distillation + carrier refresh
      if (experience && (request.body.toolCalls ?? []).length > 0) {
        const ctx: PostCommitContext = {
          agentId: request.body.agentId,
          projectId: request.body.projectId,
          toolCalls: request.body.toolCalls ?? [],
          toolCount: request.body.toolCalls?.length ?? 0,
          turnCount: request.body.turnCount ?? 0,
          patterns: request.body.patterns,
          decisions: request.body.decisions,
          tokenCost: 0,
          sessionSummary: request.body.sessionSummary
        };
        // Fire async — never block the commit response
        void experience.postCommitDistill(ctx);
      }

      return {
        ok: true,
        committed: result.committed,
        publishCandidates: result.publishCandidates
      };
    }
  );
}
