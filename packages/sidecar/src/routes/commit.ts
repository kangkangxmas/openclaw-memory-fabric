import type { FastifyInstance } from "fastify";
import type { CommitRequest, CommitResponse } from "../models/index.js";
import type { OpenVikingService } from "../services/openviking-service.js";

export function registerCommitRoute(app: FastifyInstance, openviking: OpenVikingService): void {
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
      return {
        ok: true,
        committed: result.committed,
        publishCandidates: result.publishCandidates
      };
    }
  );
}
