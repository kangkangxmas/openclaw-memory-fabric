import type { FastifyInstance } from "fastify";
import type { PatternService } from "../services/pattern-service.js";

export function registerPatternsRoute(
  app: FastifyInstance,
  patterns: PatternService
): void {
  app.get<{
    Querystring: { agentId: string; limit?: string };
  }>("/patterns", async (request, reply) => {
    const { agentId, limit } = request.query;
    if (!agentId) {
      return reply.status(400).send({ error: "agentId is required" });
    }

    const results = await patterns.listPatterns(
      agentId,
      limit ? Number(limit) : undefined
    );

    return { ok: true, count: results.length, patterns: results };
  });
}
