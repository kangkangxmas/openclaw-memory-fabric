import type { FastifyInstance } from "fastify";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { GraphifyService } from "../services/graphify-service.js";
import type { ExperienceStore } from "../stores/experience-store.js";
import { readdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import fastifyStatic from "@fastify/static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// At runtime __dirname is dist/routes/, public/ is at package root
const PUBLIC_DIR = join(__dirname, "..", "..", "public");

export function registerInspectRoutes(
  app: FastifyInstance,
  openviking: OpenVikingService,
  graphify: GraphifyService,
  expStore?: ExperienceStore
): void {
  const hasUI = existsSync(join(PUBLIC_DIR, "index.html"));

  // Serve React SPA static assets (/inspect/assets/*)
  if (hasUI) {
    void app.register(fastifyStatic, {
      root: PUBLIC_DIR,
      prefix: "/inspect/",
      decorateReply: false,
    });
  }

  // SPA entry point
  app.get("/inspect", async (_request, reply) => {
    if (hasUI) {
      const html = readFileSync(join(PUBLIC_DIR, "index.html"), "utf-8");
      return reply.type("text/html; charset=utf-8").send(html);
    }
    return reply
      .type("text/html; charset=utf-8")
      .send(
        "<html><body><h1>Inspector UI not built</h1><p>Run <code>pnpm -C packages/web build</code> to build the UI.</p></body></html>",
      );
  });

  // Agent 列表端点
  app.get("/inspect/agents", async (_request, reply) => {
    try {
      const agentsDir = join(
        process.env.HOME ?? "/tmp",
        ".openviking",
        "data",
        "viking",
        "openclaw-personal",
        "org",
        "default",
        "agents",
      );
      const agents = readdirSync(agentsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((name) => name !== "shared" && name !== "agents");
      return reply.send({ ok: true, agents });
    } catch {
      return reply.send({ ok: true, agents: ["development", "boss"] });
    }
  });

  app.post<{
    Body: {
      agentId: string;
      projectId?: string;
      scope?: "private" | "project" | "shared" | "auto";
      query?: string;
      limit?: number;
    };
  }>(
    "/inspect/memories",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            scope: {
              type: "string",
              enum: ["private", "project", "shared", "auto"],
            },
            query: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (request) => {
      return openviking.inspectMemory(request.body);
    },
  );

  app.post<{ Body: { projectId: string } }>(
    "/inspect/graph",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      return graphify.inspectProjectGraph(request.body.projectId);
    },
  );

  // P0-P2: Self-learning inspection endpoints
  if (expStore) {
    app.get<{ Querystring: { agentId: string } }>(
      "/inspect/experiences",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["agentId"],
            properties: {
              agentId: { type: "string", minLength: 1 },
            },
          },
        },
      },
      async (request) => {
        const entries = await expStore.query({
          agentId: request.query.agentId,
        });
        return { ok: true, count: entries.length, entries };
      },
    );
  }
}
