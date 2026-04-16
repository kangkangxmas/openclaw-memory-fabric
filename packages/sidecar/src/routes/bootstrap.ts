import type { FastifyInstance } from "fastify";
import type { GraphifyService } from "../services/graphify-service.js";

interface BootstrapBody {
  projectId: string;
  paths: string[];
  mode?: "auto" | "full";
}

export function registerBootstrapRoute(app: FastifyInstance, graphify: GraphifyService): void {
  app.post<{ Body: BootstrapBody }>(
    "/bootstrap",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "paths"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            paths: { type: "array", items: { type: "string" }, minItems: 1 },
            mode: { type: "string", enum: ["auto", "full"] }
          }
        }
      }
    },
    async (request) => {
      const { projectId, paths } = request.body;
      const result = await graphify.bootstrapProjectGraph({ projectId, paths });
      return { ok: true, projectId, ...result };
    }
  );
}
