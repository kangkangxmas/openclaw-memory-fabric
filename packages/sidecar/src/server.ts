import Fastify, { type FastifyError } from "fastify";
import { loadSidecarConfig } from "./config/index.js";
import { OpenVikingService } from "./services/openviking-service.js";
import { CarrierRepository } from "./services/carrier-service.js";
import { DistillService } from "./services/distill-service.js";
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
import type { ErrorResponse } from "./models/index.js";

export async function buildServer() {
  const cfg = loadSidecarConfig();
  const openviking = new OpenVikingService(cfg.openviking);
  const carriers = new CarrierRepository(cfg.carriers.root);
  const distill = new DistillService();
  const graphify = new GraphifyService(cfg.graphify.basePath);
  const shared = new SharedService(cfg.carriers.root);

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
  registerRecallRoute(app, openviking, shared);
  registerCommitRoute(app, openviking);
  registerCarrierRoutes(app, carriers);
  registerDistillRoute(app, distill);
  registerBootstrapRoute(app, graphify);
  registerGraphRoutes(app, graphify);
  registerInspectRoutes(app, openviking, graphify);
  registerSharedRoutes(app, shared);

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
