/**
 * E4: Batch recall and commit endpoints.
 *
 * POST /batch/recall — parallel recall for multiple agents/projects
 * POST /batch/commit — batch commit for multiple payloads
 * POST /graph/incremental — E3: incremental graph update for changed files
 */

import type { FastifyInstance } from "fastify";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { GraphifyService } from "../services/graphify-service.js";

export function registerBatchRoutes(
  app: FastifyInstance,
  openviking: OpenVikingService,
  graphify: GraphifyService,
): void {
  // E4: Batch recall
  app.post<{
    Body: {
      requests: Array<{
        agentId: string;
        projectId?: string;
        scope?: string;
        depth?: string;
        query?: string;
      }>;
    };
  }>(
    "/batch/recall",
    {
      schema: {
        body: {
          type: "object",
          required: ["requests"],
          properties: {
            requests: {
              type: "array",
              items: {
                type: "object",
                required: ["agentId"],
                properties: {
                  agentId: { type: "string", minLength: 1 },
                  projectId: { type: "string" },
                  scope: { type: "string" },
                  depth: { type: "string" },
                  query: { type: "string" },
                },
              },
              maxItems: 10,
            },
          },
        },
      },
    },
    async (request) => {
      const results = await Promise.all(
        request.body.requests.map((req) =>
          openviking
            .recallMemory(req)
            .then((r) => ({ ok: true as const, agentId: req.agentId, ...r }))
            .catch((e: Error) => ({
              ok: false as const,
              agentId: req.agentId,
              error: e.message,
            })),
        ),
      );
      return { ok: true, results };
    },
  );

  // E4: Batch commit
  app.post<{
    Body: {
      commits: Array<{
        agentId: string;
        projectId?: string;
        facts?: string[];
        decisions?: string[];
        entities?: string[];
        patterns?: string[];
        unresolved?: string[];
      }>;
    };
  }>(
    "/batch/commit",
    {
      schema: {
        body: {
          type: "object",
          required: ["commits"],
          properties: {
            commits: {
              type: "array",
              items: {
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
                },
              },
              maxItems: 10,
            },
          },
        },
      },
    },
    async (request) => {
      const results = await Promise.all(
        request.body.commits.map((c) =>
          openviking
            .commitSession(c)
            .then((r) => ({ ok: true as const, agentId: c.agentId, ...r }))
            .catch((e: Error) => ({
              ok: false as const,
              agentId: c.agentId,
              error: e.message,
            })),
        ),
      );
      return { ok: true, results };
    },
  );

  // E3: Incremental graph update
  app.post<{
    Body: { projectId: string; changedFiles: string[] };
  }>(
    "/graph/incremental",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "changedFiles"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            changedFiles: {
              type: "array",
              items: { type: "string" },
              maxItems: 100,
            },
          },
        },
      },
    },
    async (request) => {
      const result = await graphify.incrementalUpdate(
        request.body.projectId,
        request.body.changedFiles,
      );
      return { ok: true, ...result };
    },
  );
}
