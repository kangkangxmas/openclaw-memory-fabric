import type { FastifyInstance } from "fastify";
import type { CommitRequest, CommitResponse } from "../models/index.js";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { ExperienceService, PostCommitContext } from "../services/experience-service.js";
import type { EventLedgerService } from "../services/event-ledger-service.js";
import type { AtomicMemoryStore } from "../services/atomic-memory-store.js";
import type { MemoryType } from "../models/schema-v2.js";

type V2Mode = "off" | "shadow" | "v2-recall" | "v2-write";

function v2Mode(): V2Mode {
  const raw = process.env.MEMORY_FABRIC_V2_MODE;
  if (raw === "off" || raw === "shadow" || raw === "v2-recall" || raw === "v2-write") return raw;
  return "shadow";
}

function collectCandidates(body: CommitRequest): Array<{ type: MemoryType; content: string; tags: string[] }> {
  const groups: Array<{ type: MemoryType; values?: string[]; tag: string }> = [
    { type: "fact", values: body.facts, tag: "fact" },
    { type: "decision", values: body.decisions, tag: "decision" },
    { type: "entity", values: body.entities, tag: "entity" },
    { type: "pattern", values: body.patterns, tag: "pattern" },
    { type: "unresolved", values: body.unresolved, tag: "unresolved" },
  ];

  return groups.flatMap((group) =>
    (group.values ?? [])
      .map((content) => content.trim())
      .filter(Boolean)
      .map((content) => ({ type: group.type, content, tags: ["commit", group.tag] }))
  );
}

async function shadowWriteV2(
  body: CommitRequest,
  eventLedger: EventLedgerService,
  atomicStore: AtomicMemoryStore
): Promise<void> {
  const candidates = collectCandidates(body);
  const event = await eventLedger.append({
    agentId: body.agentId,
    projectId: body.projectId,
    sourceType: "session",
    sourceUri: `commit://${body.agentId}`,
    summary: body.sessionSummary ?? `Commit session with ${candidates.length} candidate memories`,
    payload: {
      counts: {
        facts: body.facts?.length ?? 0,
        decisions: body.decisions?.length ?? 0,
        entities: body.entities?.length ?? 0,
        patterns: body.patterns?.length ?? 0,
        unresolved: body.unresolved?.length ?? 0,
        toolCalls: body.toolCalls?.length ?? 0,
        turnCount: body.turnCount ?? 0,
      },
      visibility: body.visibility,
    },
  });

  for (const candidate of candidates) {
    await atomicStore.create({
      agentId: body.agentId,
      projectId: body.projectId,
      type: candidate.type,
      content: candidate.content,
      sourceRefs: [event.eventId],
      confidence: 0.72,
      tags: candidate.tags,
    });
  }
}

export function registerCommitRoute(
  app: FastifyInstance,
  openviking: OpenVikingService,
  experience?: ExperienceService,
  eventLedger?: EventLedgerService,
  atomicStore?: AtomicMemoryStore
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

      if (eventLedger && atomicStore && v2Mode() !== "off") {
        void shadowWriteV2(request.body, eventLedger, atomicStore).catch((error: unknown) => {
          request.log.warn({ error }, "v2 shadow-write failed");
        });
      }

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
