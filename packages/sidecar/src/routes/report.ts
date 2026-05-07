import type { FastifyInstance } from "fastify";
import type { ScoringService } from "../services/scoring-service.js";
import type { ExperienceStore } from "../stores/experience-store.js";

export function registerReportRoute(
  app: FastifyInstance,
  scoring: ScoringService,
  expStore: ExperienceStore
): void {
  app.get<{
    Querystring: { agentId: string; days?: string };
  }>("/report", async (request, reply) => {
    const { agentId, days } = request.query;
    if (!agentId) {
      return reply.status(400).send({ error: "agentId is required" });
    }

    const since = days
      ? Date.now() - Number(days) * 86_400_000
      : undefined;

    const entries = await expStore.query({ agentId, since });
    const reports = scoring.generateReport(entries);

    return { ok: true, agentId, totalEntries: entries.length, reports };
  });
}
