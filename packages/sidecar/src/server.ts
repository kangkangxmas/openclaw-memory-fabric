import { join } from "path";
import Fastify, { type FastifyError } from "fastify";
import { loadSidecarConfig } from "./config/index.js";
import { OpenVikingService } from "./services/openviking-service.js";
import { CarrierRepository } from "./services/carrier-service.js";
import { DistillService, type DistillLLMConfig } from "./services/distill-service.js";
import { GraphifyService } from "./services/graphify-service.js";
import { SharedService } from "./services/shared-service.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerRecallRoute } from "./routes/recall.js";
import { registerCommitRoute } from "./routes/commit.js";
import { registerCarrierRoutes } from "./routes/carrier.js";
import { registerDistillRoute } from "./routes/distill.js";
import { registerBootstrapRoute } from "./routes/bootstrap.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerInspectRoutes } from "./routes/inspect.js";
import { registerSharedRoutes } from "./routes/shared.js";
import { registerPatternsRoute } from "./routes/patterns.js";
import { registerSkillsRoute } from "./routes/skills.js";
import { registerReportRoute } from "./routes/report.js";
import { ExperienceStore } from "./stores/experience-store.js";
import { ExperienceService } from "./services/experience-service.js";
import { PatternStore } from "./stores/pattern-store.js";
import { PatternService } from "./services/pattern-service.js";
import { SkillDraftStore } from "./stores/skill-draft-store.js";
import { SkillGenService } from "./services/skill-gen-service.js";
import { VectorStore } from "./stores/vector-store.js";
import { EmbeddingService } from "./services/embedding-service.js";
import { VectorService } from "./services/vector-service.js";
import { ScoringService } from "./services/scoring-service.js";
import { SharingService } from "./services/sharing-service.js";
import { registerBatchRoutes } from "./routes/batch.js";
import { registerFederationRoutes } from "./routes/federation.js";
import { FederationService } from "./services/federation-service.js";
import { runGarbageCollection } from "./services/lifecycle-service.js";
import type { ErrorResponse } from "./models/index.js";

export async function buildServer() {
  const cfg = loadSidecarConfig();

  // P2-1: Vector store and embedding service
  const vectorStore = new VectorStore(cfg.openviking.basePath);
  await vectorStore.load();

  const embedCfg =
    process.env.EMBEDDING_BASE_URL && process.env.EMBEDDING_MODEL
      ? {
          baseUrl: process.env.EMBEDDING_BASE_URL,
          model: process.env.EMBEDDING_MODEL,
          apiKey: process.env.EMBEDDING_API_KEY ?? undefined,
          timeoutMs: process.env.EMBEDDING_TIMEOUT_MS
            ? Number(process.env.EMBEDDING_TIMEOUT_MS)
            : undefined
        }
      : undefined;

  const embedder = embedCfg ? new EmbeddingService(embedCfg) : undefined;
  const vectorService = embedder ? new VectorService(vectorStore, embedder) : undefined;

  const openviking = new OpenVikingService(cfg.openviking, vectorService);
  const carriers = new CarrierRepository(cfg.carriers.root);
  // Optional LLM refinement for distill — configure via env vars
  const llmCfg: DistillLLMConfig | undefined =
    process.env.DISTILL_LLM_BASE_URL && process.env.DISTILL_LLM_MODEL
      ? {
          baseUrl: process.env.DISTILL_LLM_BASE_URL,
          apiKey: process.env.DISTILL_LLM_API_KEY ?? "none",
          model: process.env.DISTILL_LLM_MODEL,
          maxTokens: process.env.DISTILL_LLM_MAX_TOKENS
            ? Number(process.env.DISTILL_LLM_MAX_TOKENS)
            : undefined,
          timeoutMs: process.env.DISTILL_LLM_TIMEOUT_MS
            ? Number(process.env.DISTILL_LLM_TIMEOUT_MS)
            : undefined
        }
      : undefined;
  const distill = new DistillService(llmCfg);
  const graphify = new GraphifyService(cfg.graphify.basePath);
  const shared = new SharedService(cfg.carriers.root);

  // P0-1 / P0-3: Experience store and service
  const expStore = new ExperienceStore(cfg.openviking.basePath);

  // P1-1: Pattern store and service
  const patStore = new PatternStore(cfg.openviking.basePath);

  // P1-2: Skill draft store and generation service
  const draftDir = join(process.env.HOME ?? "/tmp", ".openclaw", "skills", "auto-generated");
  const draftStore = new SkillDraftStore(draftDir);
  const skillGen = new SkillGenService(draftStore, {
    draftDir,
    llmCfg: llmCfg // optional: reuse same LLM for skill generation
  });

  // P2-3: Cross-agent sharing
  const sharingService = new SharingService(expStore, cfg.openviking.basePath);

  const patService = new PatternService(expStore, patStore, {
    llmCfg: llmCfg, // optional: reuse same LLM for lesson synthesis
    skillGen,       // P1-2: auto-generate skills on pattern detection
    sharing: sharingService // P2-3: cross-agent sharing
  });

  // P2-2: Scoring service
  const scoringService = new ScoringService(llmCfg);

  const expService = new ExperienceService(expStore, carriers, {
    llmCfg: llmCfg // reuse distill LLM config (or configure EXPERIENCE_LLM_* env vars)
  }, patService, scoringService);

  const app = Fastify({ logger: true });

  // Unified error handler
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const body: ErrorResponse = {
      error: {
        code: statusCode === 400 ? "BAD_REQUEST" : "SIDECAR_ERROR",
        message: error.message,
        details: {}
      }
    };
    void reply.status(statusCode).send(body);
  });

  registerHealthRoute(app, cfg);
  registerRecallRoute(app, openviking, shared, patStore);
  registerCommitRoute(app, openviking, expService);
  registerCarrierRoutes(app, carriers);
  registerDistillRoute(app, distill);
  registerBootstrapRoute(app, graphify);
  registerGraphRoutes(app, graphify);
  registerInspectRoutes(app, openviking, graphify, expStore);
  registerSharedRoutes(app, shared);
  registerPatternsRoute(app, patService);
  registerSkillsRoute(app, skillGen);
  registerReportRoute(app, scoringService, expStore);
  registerBatchRoutes(app, openviking, graphify);

  // Phase F: Federation
  const federation = new FederationService(cfg.carriers.root);
  registerFederationRoutes(app, federation);

  // D4: Garbage collection endpoint
  app.post("/lifecycle/gc", async () => {
    const result = await runGarbageCollection({
      carriersRoot: cfg.carriers.root,
      openVikingBasePath: cfg.openviking.basePath,
      draftDir: join(process.env.HOME ?? "/tmp", ".openclaw", "skills", "auto-generated"),
    });
    return { ok: true, ...result };
  });

  return { app, cfg };
}

async function start() {
  const { app, cfg } = await buildServer();
  await app.listen({ host: cfg.host, port: cfg.port });
}

const directRunArg = process.argv[1];
const isDirectRun = typeof directRunArg === "string" && import.meta.url.endsWith(directRunArg);

if (isDirectRun) {
  start().catch((error: unknown) => {
    console.error("Failed to start sidecar", error);
    process.exitCode = 1;
  });
}
