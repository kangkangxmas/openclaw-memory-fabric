import type { FastifyInstance } from "fastify";
import type { CarrierRepository, CarrierPatch } from "../services/carrier-service.js";

interface CarrierReadBody {
  agentId: string;
  projectId?: string;
  files?: string[];
}

interface CarrierMergeBody {
  agentId: string;
  projectId?: string;
  patches: CarrierPatch[];
}

interface CarrierInitBody {
  agentId: string;
  projectId?: string;
}

export function registerCarrierRoutes(app: FastifyInstance, carriers: CarrierRepository): void {
  // POST /carrier/init — idempotent init of carrier files
  app.post<{ Body: CarrierInitBody }>(
    "/carrier/init",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" }
          }
        }
      }
    },
    async (request) => {
      const { agentId, projectId } = request.body;
      await carriers.initAgent(agentId);
      if (projectId) await carriers.initProject(agentId, projectId);
      return { ok: true, agentId, projectId: projectId ?? null };
    }
  );

  // POST /carrier/read — read one or more carrier files
  app.post<{ Body: CarrierReadBody }>(
    "/carrier/read",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            files: { type: "array", items: { type: "string" } }
          }
        }
      }
    },
    async (request) => {
      const result = await carriers.read(request.body);
      return { carriers: result };
    }
  );

  // POST /carrier/merge — apply patches to carrier files
  app.post<{ Body: CarrierMergeBody }>(
    "/carrier/merge",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId", "patches"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            patches: {
              type: "array",
              items: {
                type: "object",
                required: ["filename", "content"],
                properties: {
                  filename: { type: "string" },
                  content: { type: "string" }
                }
              }
            }
          }
        }
      }
    },
    async (request) => {
      const result = await carriers.merge(request.body);
      return result;
    }
  );
}
