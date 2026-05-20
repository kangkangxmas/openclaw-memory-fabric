/**
 * Phase F: Federation, dependency graph, adaptive budget, and approval routes.
 */

import type { FastifyInstance } from "fastify";
import type { FederationService } from "../services/federation-service.js";

export function registerFederationRoutes(
  app: FastifyInstance,
  federation: FederationService,
): void {
  // F1: Export entries across projects
  app.post<{
    Body: {
      sourceProject: string;
      targetProject: string;
      agentId: string;
      entries: Array<{ type: string; content: string }>;
    };
  }>(
    "/federation/export",
    {
      schema: {
        body: {
          type: "object",
          required: ["sourceProject", "targetProject", "agentId", "entries"],
          properties: {
            sourceProject: { type: "string", minLength: 1 },
            targetProject: { type: "string", minLength: 1 },
            agentId: { type: "string", minLength: 1 },
            entries: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "content"],
                properties: {
                  type: { type: "string" },
                  content: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      return federation.exportEntries(request.body as Parameters<typeof federation.exportEntries>[0]);
    },
  );

  // F1: Import federated entries for a project
  app.get<{ Querystring: { projectId: string; limit?: number } }>(
    "/federation/import",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            limit: { type: "number", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request) => {
      return federation.importEntries(request.query.projectId, request.query.limit);
    },
  );

  // F1: Revoke a federated entry
  app.post<{ Body: { projectId: string; entryId: string } }>(
    "/federation/revoke",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "entryId"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            entryId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const ok = await federation.revokeEntry(request.body.projectId, request.body.entryId);
      return { ok };
    },
  );

  // F2: Get dependency graph
  app.get("/federation/dependencies", async () => {
    return federation.getDependencyGraph();
  });

  // F3: Adaptive budget recommendation
  app.post<{
    Body: {
      toolCount?: number;
      turnCount?: number;
      queryLength?: number;
      mentionCount?: number;
    };
  }>(
    "/federation/recommend-budget",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            toolCount: { type: "number" },
            turnCount: { type: "number" },
            queryLength: { type: "number" },
            mentionCount: { type: "number" },
          },
        },
      },
    },
    async (request) => {
      return federation.recommendBudget(request.body);
    },
  );

  // F4: Submit for approval
  app.post<{
    Body: { sourceAgent: string; projectId: string; type: string; content: string };
  }>(
    "/federation/approval/submit",
    {
      schema: {
        body: {
          type: "object",
          required: ["sourceAgent", "projectId", "type", "content"],
          properties: {
            sourceAgent: { type: "string", minLength: 1 },
            projectId: { type: "string", minLength: 1 },
            type: { type: "string" },
            content: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      return federation.submitForApproval(request.body);
    },
  );

  // F4: List pending approvals
  app.get<{ Querystring: { projectId?: string } }>(
    "/federation/approval/pending",
    async (request) => {
      const pending = await federation.listPendingApprovals(request.query.projectId);
      return { ok: true, count: pending.length, entries: pending };
    },
  );

  // F4: Review (approve/reject) an approval
  app.post<{
    Body: { entryId: string; decision: "approved" | "rejected"; reviewedBy: string };
  }>(
    "/federation/approval/review",
    {
      schema: {
        body: {
          type: "object",
          required: ["entryId", "decision", "reviewedBy"],
          properties: {
            entryId: { type: "string", minLength: 1 },
            decision: { type: "string", enum: ["approved", "rejected"] },
            reviewedBy: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const ok = await federation.reviewApproval(
        request.body.entryId,
        request.body.decision,
        request.body.reviewedBy,
      );
      return { ok };
    },
  );
}
