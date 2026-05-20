/**
 * GraphifyService — local-mode graph construction and query.
 *
 * Since Graphify CLI/MCP may not be present, this service implements a
 * lightweight local equivalent:
 *  - scan project files to extract named entities and their co-occurrences
 *  - persist as graph.json + GRAPH_REPORT.md under the configured basePath
 *  - support query / path / explain operations against the stored graph
 *
 * When the real Graphify binary is available, replace `bootstrap()` with a
 * shell-out call while keeping the same output directory convention.
 */

import { mkdir, readFile, writeFile, readdir } from "fs/promises";
import { existsSync, statSync } from "fs";
import { join, extname, basename, resolve } from "path";
import { validateId } from "../utils/path-guard.js";

// ---------------------------------------------------------------------------
// Graph data model
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  type: "module" | "symbol" | "concept" | "file";
  files: string[];
  mentions: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  coocFiles: string[];
}

export interface ProjectGraph {
  projectId: string;
  generatedAt: string;
  fileCount: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// StructuralBrief (mirrors plugin type)
// ---------------------------------------------------------------------------

export interface StructuralBrief {
  projectId: string;
  freshness: "fresh" | "stale" | "missing";
  coreNodes: string[];
  communities: string[];
  keyPaths: Array<{ from: string; to: string; why: string }>;
  unknowns: string[];
  recommendedRetrievalTargets: string[];
  summary: string;
}

export interface GraphInspectResult {
  exists: boolean;
  projectId: string;
  generatedAt?: string;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  report: string;
  topNodes: GraphNode[];
  topEdges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// File scanner helpers
// ---------------------------------------------------------------------------

const SCANNABLE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".java",
  ".rb",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".json"
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "coverage"
]);

/** Very rough token estimate — used for budget checks */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function walkFiles(dir: string, max = 500): Promise<string[]> {
  const files: string[] = [];
  async function walk(d: string) {
    if (files.length >= max) return;
    let entries: string[];
    try {
      entries = await readdir(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= max) break;
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          await walk(full);
        } else if (st.isFile() && SCANNABLE_EXT.has(extname(entry))) {
          files.push(full);
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  await walk(dir);
  return files;
}

/** Extract candidate entity names from file content */
function extractEntities(filePath: string, content: string): string[] {
  const entities: string[] = [];

  // File stem as a node e.g. "payment-service" → "payment-service"
  const stem = basename(filePath, extname(filePath));
  if (stem.length >= 2 && stem !== "index") entities.push(stem);

  // Markdown headings
  const headings = content.match(/^#{1,3}\s+(.+)/gm) ?? [];
  headings.forEach((h) => {
    const name = h.replace(/^#+\s+/, "").trim();
    if (name.length >= 3 && name.length <= 60) entities.push(name);
  });

  // PascalCase symbols (code)
  const pascalCases = content.match(/\b[A-Z][a-zA-Z]{2,}(?:[A-Z][a-zA-Z]*)*\b/g) ?? [];
  pascalCases.forEach((s) => {
    if (s.length >= 4 && s.length <= 40) entities.push(s);
  });

  return [...new Set(entities)];
}

// ---------------------------------------------------------------------------
// GraphifyService
// ---------------------------------------------------------------------------

export class GraphifyService {
  private refreshInProgress = new Set<string>();

  constructor(private readonly basePath: string) {}

  private graphDir(projectId: string): string {
    return join(this.basePath, projectId, "graphify-out");
  }

  private graphJsonPath(projectId: string): string {
    return join(this.graphDir(projectId), "graph.json");
  }

  private reportPath(projectId: string): string {
    return join(this.graphDir(projectId), "GRAPH_REPORT.md");
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  async bootstrapProjectGraph(opts: {
    projectId: string;
    paths: string[];
  }): Promise<{ nodeCount: number; edgeCount: number; fileCount: number }> {
    const { projectId, paths } = opts;
    validateId(projectId, "projectId");
    await mkdir(this.graphDir(projectId), { recursive: true });

    // Collect all files from all paths
    const allFiles: string[] = [];
    for (const p of paths) {
      const resolved = p.startsWith("~") ? join(process.env.HOME ?? "/", p.slice(1)) : resolve(p);
      if (!existsSync(resolved)) continue;
      const st = statSync(resolved);
      if (st.isDirectory()) {
        const found = await walkFiles(resolved, 500 - allFiles.length);
        allFiles.push(...found);
      } else {
        allFiles.push(resolved);
      }
    }

    // Per-file entity extraction
    const fileEntities = new Map<string, string[]>(); // filePath → entities
    for (const fp of allFiles) {
      try {
        const content = await readFile(fp, "utf8");
        if (approxTokens(content) > 20000) continue; // skip huge files
        fileEntities.set(fp, extractEntities(fp, content));
      } catch {
        /* skip unreadable */
      }
    }

    // Build node frequency map
    const nodeFiles = new Map<string, Set<string>>(); // entity → files
    for (const [fp, entities] of fileEntities) {
      for (const e of entities) {
        const s = nodeFiles.get(e) ?? new Set();
        s.add(fp);
        nodeFiles.set(e, s);
      }
    }

    // Build co-occurrence edges (entities in the same file)
    const edgeKey = (a: string, b: string) => [a, b].sort().join("|||");
    const edgeMap = new Map<string, { w: number; files: Set<string> }>();
    for (const [fp, entities] of fileEntities) {
      const uniq = [...new Set(entities)];
      for (let i = 0; i < uniq.length; i++) {
        for (let j = i + 1; j < uniq.length; j++) {
          const key = edgeKey(uniq[i], uniq[j]);
          const existing = edgeMap.get(key) ?? { w: 0, files: new Set<string>() };
          existing.w += 1;
          existing.files.add(fp);
          edgeMap.set(key, existing);
        }
      }
    }

    // Prune low-frequency nodes (keep those appearing in >= 2 files OR >= 5 mentions)
    const nodes: GraphNode[] = [];
    for (const [id, files] of nodeFiles) {
      if (files.size >= 2 || (files.size >= 1 && id.length >= 5)) {
        nodes.push({
          id,
          type: /^[A-Z]/.test(id) ? "symbol" : id.endsWith(".md") ? "concept" : "module",
          files: [...files].slice(0, 10),
          mentions: files.size
        });
      }
    }

    // Keep top 200 nodes by mentions
    nodes.sort((a, b) => b.mentions - a.mentions);
    const topNodes = nodes.slice(0, 200);
    const nodeSet = new Set(topNodes.map((n) => n.id));

    // Prune edges to only those between surviving nodes
    const edges: GraphEdge[] = [];
    for (const [key, { w, files }] of edgeMap) {
      const [src, tgt] = key.split("|||");
      if (nodeSet.has(src) && nodeSet.has(tgt)) {
        edges.push({ source: src, target: tgt, weight: w, coocFiles: [...files].slice(0, 5) });
      }
    }
    edges.sort((a, b) => b.weight - a.weight);
    const topEdges = edges.slice(0, 500);

    const graph: ProjectGraph = {
      projectId,
      generatedAt: new Date().toISOString(),
      fileCount: allFiles.length,
      nodes: topNodes,
      edges: topEdges
    };

    await writeFile(this.graphJsonPath(projectId), JSON.stringify(graph, null, 2), "utf8");
    await writeFile(this.reportPath(projectId), this.generateReport(graph), "utf8");

    return { nodeCount: topNodes.length, edgeCount: topEdges.length, fileCount: allFiles.length };
  }

  // -------------------------------------------------------------------------
  // Read structural brief
  // -------------------------------------------------------------------------

  async readStructuralBrief(projectId: string): Promise<StructuralBrief> {
    validateId(projectId, "projectId");
    const reportPath = this.reportPath(projectId);
    const graphPath = this.graphJsonPath(projectId);

    if (!existsSync(graphPath)) {
      return {
        projectId,
        freshness: "missing",
        coreNodes: [],
        communities: [],
        keyPaths: [],
        unknowns: ["Graph not bootstrapped. Run project_bootstrap first."],
        recommendedRetrievalTargets: [],
        summary: "No graph available. Bootstrap the project to enable structural cognition."
      };
    }

    const graph = await this.loadGraph(projectId);
    const ageMs = Date.now() - new Date(graph.generatedAt).getTime();
    const freshness = ageMs < 24 * 3600 * 1000 ? "fresh" : "stale";

    // Top nodes by mention count
    const coreNodes = graph.nodes.slice(0, 10).map((n) => n.id);

    // Simple community detection: connected components among top-weight edges
    const communities = this.detectCommunities(graph).slice(0, 5);

    // Key paths: top-weight edges as notable relationships
    const keyPaths = graph.edges.slice(0, 5).map((e) => ({
      from: e.source,
      to: e.target,
      why: `co-occur in ${e.weight} file(s): ${e.coocFiles[0] ?? "unknown"}`
    }));

    // Recommended retrieval targets: top nodes not yet read
    const recommendedRetrievalTargets = coreNodes.slice(0, 5);

    let reportSummary = "";
    if (existsSync(reportPath)) {
      const reportText = await readFile(reportPath, "utf8");
      reportSummary = reportText.slice(0, 800);
    }

    return {
      projectId,
      freshness,
      coreNodes,
      communities,
      keyPaths,
      unknowns: [],
      recommendedRetrievalTargets,
      summary:
        reportSummary ||
        `Project ${projectId}: ${graph.nodes.length} entities, ${graph.edges.length} relationships across ${graph.fileCount} files.`
    };
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  async queryGraph(projectId: string, query: string, budget = 20): Promise<GraphNode[]> {
    validateId(projectId, "projectId");
    const graph = await this.loadGraph(projectId);
    const q = query.toLowerCase();
    return graph.nodes
      .filter((n) => n.id.toLowerCase().includes(q))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, budget);
  }

  // -------------------------------------------------------------------------
  // Path
  // -------------------------------------------------------------------------

  async pathGraph(projectId: string, from: string, to: string): Promise<string[]> {
    validateId(projectId, "projectId");
    const graph = await this.loadGraph(projectId);

    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
      adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
    }

    // BFS
    const visited = new Set<string>();
    const queue: string[][] = [[from]];
    while (queue.length > 0) {
      const path = queue.shift()!;
      const node = path[path.length - 1];
      if (node === to) return path;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push([...path, neighbor]);
        }
      }
    }
    return []; // no path found
  }

  // -------------------------------------------------------------------------
  // Explain
  // -------------------------------------------------------------------------

  async explainGraph(
    projectId: string,
    query: string
  ): Promise<{
    node: GraphNode | null;
    neighbors: GraphNode[];
    edges: GraphEdge[];
    explanation: string;
  }> {
    validateId(projectId, "projectId");
    const graph = await this.loadGraph(projectId);
    const q = query.toLowerCase();

    const node =
      graph.nodes.find((n) => n.id.toLowerCase() === q) ??
      graph.nodes.find((n) => n.id.toLowerCase().includes(q)) ??
      null;

    if (!node) {
      return {
        node: null,
        neighbors: [],
        edges: [],
        explanation: `No node found matching "${query}".`
      };
    }

    const relatedEdges = graph.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);

    const neighborIds = new Set(
      relatedEdges.flatMap((e) => [e.source, e.target]).filter((id) => id !== node.id)
    );
    const neighbors = graph.nodes.filter((n) => neighborIds.has(n.id)).slice(0, 10);

    const explanation = [
      `**${node.id}** (${node.type}) — appears in ${node.mentions} file(s)`,
      `Files: ${node.files.slice(0, 3).join(", ")}`,
      neighbors.length > 0
        ? `Connected to: ${neighbors.map((n) => n.id).join(", ")}`
        : "No significant connections."
    ].join("\n");

    return { node, neighbors, edges: relatedEdges, explanation };
  }

  async inspectProjectGraph(projectId: string): Promise<GraphInspectResult> {
    validateId(projectId, "projectId");
    const graphPath = this.graphJsonPath(projectId);
    const reportPath = this.reportPath(projectId);

    if (!existsSync(graphPath)) {
      return {
        exists: false,
        projectId,
        fileCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        report: "No graph available. Run project_bootstrap first.",
        topNodes: [],
        topEdges: []
      };
    }

    const graph = await this.loadGraph(projectId);
    const report = existsSync(reportPath) ? await readFile(reportPath, "utf8") : this.generateReport(graph);

    return {
      exists: true,
      projectId,
      generatedAt: graph.generatedAt,
      fileCount: graph.fileCount,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      report,
      topNodes: graph.nodes.slice(0, 24),
      topEdges: graph.edges.slice(0, 24)
    };
  }

  // -------------------------------------------------------------------------
  // E3: Incremental update — only process changed files
  // -------------------------------------------------------------------------

  async incrementalUpdate(
    projectId: string,
    changedFiles: string[],
  ): Promise<{ updated: number; nodesAdded: number; edgesAdded: number }> {
    validateId(projectId, "projectId");
    const graphPath = this.graphJsonPath(projectId);
    if (!existsSync(graphPath)) {
      // No base graph — need full bootstrap first
      return { updated: 0, nodesAdded: 0, edgesAdded: 0 };
    }

    const graph = await this.loadGraph(projectId);
    let nodesAdded = 0;
    let edgesAdded = 0;

    // Process only the changed files
    const newFileEntities = new Map<string, string[]>();
    for (const fp of changedFiles) {
      const resolved = fp.startsWith("~")
        ? join(process.env.HOME ?? "/", fp.slice(1))
        : resolve(fp);
      if (!existsSync(resolved)) continue;
      try {
        const st = statSync(resolved);
        if (!st.isFile()) continue;
        if (!SCANNABLE_EXT.has(extname(resolved))) continue;
        const content = await readFile(resolved, "utf8");
        if (approxTokens(content) > 20000) continue;
        newFileEntities.set(resolved, extractEntities(resolved, content));
      } catch {
        continue;
      }
    }

    // Add new nodes
    for (const [fp, entities] of newFileEntities) {
      for (const e of entities) {
        const existing = graph.nodes.find((n) => n.id === e);
        if (existing) {
          if (!existing.files.includes(fp)) {
            existing.files.push(fp);
            existing.mentions++;
          }
        } else {
          graph.nodes.push({
            id: e,
            type: /^[A-Z]/.test(e) ? "symbol" : "module",
            files: [fp],
            mentions: 1,
          });
          nodesAdded++;
        }
      }
    }

    // Add new edges from changed files
    const edgeKey = (a: string, b: string) => [a, b].sort().join("|||");
    const existingEdgeKeys = new Set(
      graph.edges.map((e) => edgeKey(e.source, e.target)),
    );

    for (const [fp, entities] of newFileEntities) {
      const uniq = [...new Set(entities)];
      for (let i = 0; i < uniq.length; i++) {
        for (let j = i + 1; j < uniq.length; j++) {
          const key = edgeKey(uniq[i], uniq[j]);
          if (existingEdgeKeys.has(key)) {
            const edge = graph.edges.find(
              (e) => edgeKey(e.source, e.target) === key,
            );
            if (edge && !edge.coocFiles.includes(fp)) {
              edge.weight++;
              edge.coocFiles.push(fp);
            }
          } else {
            graph.edges.push({
              source: uniq[i],
              target: uniq[j],
              weight: 1,
              coocFiles: [fp],
            });
            existingEdgeKeys.add(key);
            edgesAdded++;
          }
        }
      }
    }

    // Re-sort and persist
    graph.nodes.sort((a, b) => b.mentions - a.mentions);
    graph.edges.sort((a, b) => b.weight - a.weight);
    graph.generatedAt = new Date().toISOString();

    await writeFile(
      graphPath,
      JSON.stringify(graph, null, 2),
      "utf8",
    );
    await writeFile(this.reportPath(projectId), this.generateReport(graph), "utf8");

    return { updated: changedFiles.length, nodesAdded, edgesAdded };
  }

  // -------------------------------------------------------------------------
  // On-demand refresh
  // -------------------------------------------------------------------------

  /**
   * If autoRefresh is "on-demand" and the graph is stale (>24h),
   * trigger a background rebuild. Non-blocking, fire-and-forget.
   */
  async maybeRefresh(
    projectId: string,
    paths: string[],
    autoRefresh: "manual" | "on-demand" | "scheduled"
  ): Promise<{ triggered: boolean; reason?: string }> {
    if (autoRefresh !== "on-demand") {
      return { triggered: false, reason: "autoRefresh is not on-demand" };
    }

    if (this.refreshInProgress.has(projectId)) {
      return { triggered: false, reason: "refresh already in progress" };
    }

    const graphPath = this.graphJsonPath(projectId);
    if (!existsSync(graphPath)) {
      // No graph yet — bootstrap from scratch instead of refusing
      this.refreshInProgress.add(projectId);
      this.bootstrapProjectGraph({ projectId, paths })
        .then(() => {
          this.refreshInProgress.delete(projectId);
        })
        .catch(() => {
          this.refreshInProgress.delete(projectId);
        });
      return { triggered: true, reason: "no existing graph — bootstrapping" };
    }

    try {
      const raw = await readFile(graphPath, "utf8");
      const graph = JSON.parse(raw) as ProjectGraph;
      const ageMs = Date.now() - new Date(graph.generatedAt).getTime();

      if (ageMs < 24 * 3600 * 1000) {
        return { triggered: false, reason: "graph is fresh" };
      }

      // Stale → trigger background rebuild
      this.refreshInProgress.add(projectId);
      this.bootstrapProjectGraph({ projectId, paths })
        .then(() => {
          this.refreshInProgress.delete(projectId);
        })
        .catch(() => {
          this.refreshInProgress.delete(projectId);
        });

      return { triggered: true, reason: `graph age ${Math.round(ageMs / 3600000)}h exceeds 24h` };
    } catch {
      return { triggered: false, reason: "failed to read graph" };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async loadGraph(projectId: string): Promise<ProjectGraph> {
    const gp = this.graphJsonPath(projectId);
    if (!existsSync(gp))
      throw new Error(`Graph not found for project "${projectId}". Run bootstrap first.`);
    const raw = await readFile(gp, "utf8");
    return JSON.parse(raw) as ProjectGraph;
  }

  private detectCommunities(graph: ProjectGraph): string[] {
    // Union-Find over top-weight edges → component labels
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));

    for (const e of graph.edges.slice(0, 100)) union(e.source, e.target);

    const components = new Map<string, string[]>();
    for (const n of graph.nodes) {
      const root = find(n.id);
      components.set(root, [...(components.get(root) ?? []), n.id]);
    }

    return [...components.values()]
      .filter((c) => c.length >= 2)
      .sort((a, b) => b.length - a.length)
      .slice(0, 5)
      .map((c) => c.slice(0, 4).join(", ") + (c.length > 4 ? ` (+${c.length - 4} more)` : ""));
  }

  private generateReport(graph: ProjectGraph): string {
    const top10 = graph.nodes
      .slice(0, 10)
      .map((n) => `- **${n.id}** (${n.mentions} files, type: ${n.type})`)
      .join("\n");
    const top5edges = graph.edges
      .slice(0, 5)
      .map((e) => `- ${e.source} ↔ ${e.target} (weight: ${e.weight})`)
      .join("\n");
    const communities = this.detectCommunities(graph);

    return [
      `# GRAPH REPORT: ${graph.projectId}`,
      ``,
      `Generated: ${graph.generatedAt}`,
      `Files scanned: ${graph.fileCount} | Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length}`,
      ``,
      `## Core Entities (Top 10 by mention)`,
      top10 || "_None detected_",
      ``,
      `## Key Relationships`,
      top5edges || "_None detected_",
      ``,
      `## Communities / Clusters`,
      communities.length > 0
        ? communities.map((c, i) => `- Cluster ${i + 1}: ${c}`).join("\n")
        : "_No clusters detected_",
      ``,
      `## Recommended Retrieval Starting Points`,
      graph.nodes
        .slice(0, 5)
        .map((n) => `- ${n.id}`)
        .join("\n"),
      ``
    ].join("\n");
  }
}
