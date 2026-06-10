import type { FastifyInstance } from "fastify";
import type { CommitRequest, CommitResponse } from "../models/index.js";
import type { CommitResult } from "../services/openviking-service.js";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { ExperienceService, PostCommitContext } from "../services/experience-service.js";
import type { EventLedgerService } from "../services/event-ledger-service.js";
import type { AtomicMemoryCandidate, AtomicMemoryStore } from "../services/atomic-memory-store.js";
import type { MemoryType } from "../models/schema-v2.js";
import { resolveV2Mode } from "../utils/v2-mode.js";

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

function publishCandidatesFromBody(body: CommitRequest): string[] {
  return [
    ...(body.decisions ?? []).slice(0, 2).map((decision) => decision.slice(0, 80)),
    ...(body.unresolved ?? []).slice(0, 2).map((item) => item.slice(0, 80)),
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeV2Commit(
  body: CommitRequest,
  eventLedger: EventLedgerService,
  atomicStore: AtomicMemoryStore
): Promise<{ eventId: string; candidates: AtomicMemoryCandidate[] }> {
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

  const created: AtomicMemoryCandidate[] = [];
  for (const candidate of candidates) {
    created.push(
      await atomicStore.create({
        agentId: body.agentId,
        projectId: body.projectId,
        type: candidate.type,
        content: candidate.content,
        sourceRefs: [event.eventId],
        confidence: 0.72,
        tags: candidate.tags,
      })
    );
  }

  return { eventId: event.eventId, candidates: created };
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
      const mode = resolveV2Mode(request.body.agentId);
      const v2ServicesReady = !!eventLedger && !!atomicStore;
      let v2: CommitResponse["v2"] =
        mode === "off"
          ? { mode, status: "off", legacyRole: "primary" }
          : v2ServicesReady
            ? undefined
            : { mode, status: "unavailable", legacyRole: "primary", error: "v2 services are not configured" };

      if (mode === "v2-write" && eventLedger && atomicStore) {
        try {
          const write = await writeV2Commit(request.body, eventLedger, atomicStore);
          v2 = {
            mode,
            status: "written",
            eventId: write.eventId,
            candidateCount: write.candidates.length,
            candidateIds: write.candidates.map((candidate) => candidate.candidateId),
            sourceRefs: [write.eventId],
            legacyRole: "fallback",
          };
        } catch (error: unknown) {
          v2 = {
            mode,
            status: "failed",
            legacyRole: "primary",
            error: errorMessage(error),
          };
          request.log.error({ error }, "v2-write primary commit failed; falling back to legacy commit");
        }
      }

      let result: CommitResult | undefined;
      try {
        result = await openviking.commitSession(request.body);
        if (v2) v2.legacyStatus = "written";
      } catch (error: unknown) {
        if (mode === "v2-write" && v2?.status === "written") {
          request.log.warn({ error }, "legacy fallback commit failed after successful v2-write");
          v2.legacyStatus = "failed";
          v2.error = `legacy fallback failed: ${errorMessage(error)}`;
        } else {
          throw error;
        }
      }

      if ((mode === "shadow" || mode === "v2-recall") && eventLedger && atomicStore) {
        v2 = { mode, status: "queued", legacyRole: "primary", legacyStatus: "written" };
        void writeV2Commit(request.body, eventLedger, atomicStore).catch((error: unknown) => {
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
        committed: result?.committed ?? collectCandidates(request.body).length,
        publishCandidates: result?.publishCandidates ?? publishCandidatesFromBody(request.body),
        ...(v2 ? { v2 } : {}),
      };
    }
  );
}
