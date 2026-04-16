import type { FastifyInstance } from "fastify";
import type { GraphifyService } from "../services/graphify-service.js";

interface GraphQueryBody {
  projectId: string;
  query: string;
  budget?: number;
}
interface GraphPathBody {
  projectId: string;
  from: string;
  to: string;
}
interface GraphExplainBody {
  projectId: string;
  query: string;
}
interface StructuralBriefBody {
  projectId: string;
}

export function registerGraphRoutes(app: FastifyInstance, graphify: GraphifyService): void {
  // GET structural brief (lightweight — no heavy computation)
  app.post<{ Body: StructuralBriefBody }>(
    "/graph/brief",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string", minLength: 1 } }
        }
      }
    },
    async (request) => {
      return graphify.readStructuralBrief(request.body.projectId);
    }
  );

  // Keyword search over nodes
  app.post<{ Body: GraphQueryBody }>(
    "/graph/query",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "query"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            query: { type: "string", minLength: 1 },
            budget: { type: "number", minimum: 1, maximum: 100 }
          }
        }
      }
    },
    async (request) => {
      const { projectId, query, budget } = request.body;
      const nodes = await graphify.queryGraph(projectId, query, budget);
      return { nodes };
    }
  );

  // BFS path between two nodes
  app.post<{ Body: GraphPathBody }>(
    "/graph/path",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "from", "to"],
          properties: {
            projectId: { type: "string" },
            from: { type: "string", minLength: 1 },
            to: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request) => {
      const { projectId, from, to } = request.body;
      const path = await graphify.pathGraph(projectId, from, to);
      return { path, found: path.length > 0 };
    }
  );

  // Explain a node and its neighbours
  app.post<{ Body: GraphExplainBody }>(
    "/graph/explain",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "query"],
          properties: {
            projectId: { type: "string" },
            query: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request) => {
      const { projectId, query } = request.body;
      return graphify.explainGraph(projectId, query);
    }
  );
}
