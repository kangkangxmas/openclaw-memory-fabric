import type { FastifyInstance } from "fastify";
import type { SkillGenService } from "../services/skill-gen-service.js";

export function registerSkillsRoute(
  app: FastifyInstance,
  skillGen: SkillGenService
): void {
  app.get("/skills/drafts", async (_request, reply) => {
    const drafts = await skillGen.getPendingDrafts();
    return { ok: true, count: drafts.length, drafts };
  });
}
