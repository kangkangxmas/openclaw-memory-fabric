import type { FastifyInstance } from "fastify";
import type { OpenVikingService } from "../services/openviking-service.js";
import type { GraphifyService } from "../services/graphify-service.js";
import type { ExperienceStore } from "../stores/experience-store.js";

const INSPECT_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Memory Fabric Inspector</title>
    <style>
      :root {
        --bg: #f3efe4;
        --panel: rgba(255, 252, 245, 0.88);
        --ink: #1f1d18;
        --muted: #70695d;
        --line: rgba(38, 31, 19, 0.15);
        --accent: #0f766e;
        --accent-2: #b45309;
        --shadow: 0 20px 50px rgba(31, 29, 24, 0.12);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.14), transparent 28%),
          radial-gradient(circle at top right, rgba(180, 83, 9, 0.10), transparent 24%),
          linear-gradient(180deg, #f7f3eb 0%, var(--bg) 100%);
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      }

      .shell {
        max-width: 1440px;
        margin: 0 auto;
        padding: 28px 20px 40px;
      }

      .hero {
        display: grid;
        gap: 12px;
        margin-bottom: 20px;
      }

      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: var(--accent);
      }

      h1 {
        margin: 0;
        font-size: clamp(34px, 6vw, 68px);
        line-height: 0.95;
        font-weight: 700;
      }

      .subhead {
        max-width: 820px;
        color: var(--muted);
        font-size: 17px;
        line-height: 1.55;
      }

      .layout {
        display: grid;
        grid-template-columns: 360px minmax(0, 1fr);
        gap: 18px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(10px);
      }

      .controls {
        padding: 18px;
        position: sticky;
        top: 18px;
        height: fit-content;
      }

      .controls h2,
      .results h2 {
        margin: 0 0 14px;
        font-size: 18px;
      }

      .field {
        display: grid;
        gap: 6px;
        margin-bottom: 14px;
      }

      label {
        font-size: 13px;
        color: var(--muted);
      }

      input, select, textarea, button {
        font: inherit;
      }

      input, select, textarea {
        width: 100%;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.75);
        border-radius: 14px;
        padding: 10px 12px;
        color: var(--ink);
      }

      textarea {
        min-height: 82px;
        resize: vertical;
      }

      .button-grid {
        display: grid;
        gap: 10px;
        margin-top: 8px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 11px 14px;
        cursor: pointer;
        background: var(--ink);
        color: #fffdf8;
        transition: transform 120ms ease, opacity 120ms ease;
      }

      button.secondary {
        background: #fffdf8;
        color: var(--ink);
        border: 1px solid var(--line);
      }

      button:hover { transform: translateY(-1px); }
      button:disabled { opacity: 0.5; cursor: wait; transform: none; }

      .results {
        padding: 18px;
        display: grid;
        gap: 16px;
      }

      .status {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        color: var(--muted);
        font-size: 14px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 118, 110, 0.1);
        color: var(--accent);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .card {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255,255,255,0.72);
        overflow: hidden;
      }

      .card h3 {
        margin: 0;
        padding: 12px 14px;
        font-size: 15px;
        border-bottom: 1px solid var(--line);
        background: rgba(31, 29, 24, 0.03);
      }

      .card-body {
        padding: 14px;
      }

      .metric-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .metric {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 12px;
        background: rgba(255,255,255,0.64);
      }

      .metric .k {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .metric .v {
        margin-top: 6px;
        font-size: 26px;
      }

      pre {
        margin: 0;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: #1a1916;
        color: #f4efe2;
        overflow: auto;
        font-family: "SFMono-Regular", "Menlo", "Monaco", "Cascadia Mono", monospace;
        font-size: 12px;
        line-height: 1.5;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      th, td {
        text-align: left;
        vertical-align: top;
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
      }

      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .mono { font-family: "SFMono-Regular", "Menlo", "Monaco", monospace; }

      .stack {
        display: grid;
        gap: 14px;
      }

      @media (max-width: 1080px) {
        .layout { grid-template-columns: 1fr; }
        .controls { position: static; }
        .cards, .metric-row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <div class="eyebrow">OpenClaw Memory Fabric</div>
        <h1>记忆检索</h1>
        <div class="subhead">
          查看 Agent 的记忆摘要、载体文件、原始条目，以及项目知识图谱的结构、节点和关系。同时展示 P0-P2 自学习数据：经验记录、模式识别、技能草稿和自评分。
        </div>
      </div>

      <div class="layout">
        <aside class="panel controls">
          <h2>查询条件</h2>
          <div class="field">
            <label for="agentId">Agent ID</label>
            <input id="agentId" value="boss" />
          </div>
          <div class="field">
            <label for="projectId">Project ID</label>
            <input id="projectId" value="Boss" />
          </div>
          <div class="field">
            <label for="scope">范围</label>
            <select id="scope">
              <option value="project" selected>project</option>
              <option value="private">private</option>
              <option value="shared">shared</option>
              <option value="auto">auto</option>
            </select>
          </div>
          <div class="field">
            <label for="depth">召回深度</label>
            <select id="depth">
              <option value="l0">l0</option>
              <option value="l1">l1</option>
              <option value="l2" selected>l2</option>
            </select>
          </div>
          <div class="field">
            <label for="query">查询内容</label>
            <textarea id="query">最近的重要记忆、决策和图谱结构</textarea>
          </div>
          <div class="field">
            <label for="carrierFiles">载体文件</label>
            <input id="carrierFiles" value="self-model.md,decision-log.md,entities-glossary.md,project-model.md" />
          </div>
          <div class="field">
            <label for="memoryLimit">原始记忆条数上限</label>
            <input id="memoryLimit" type="number" min="1" max="500" value="80" />
          </div>
          <div class="button-grid">
            <button id="loadAll">加载完整快照</button>
            <button id="loadBrief" class="secondary">加载记忆摘要</button>
            <button id="loadCarriers" class="secondary">加载载体文件</button>
            <button id="loadMemories" class="secondary">加载原始记忆</button>
            <button id="loadGraph" class="secondary">加载图谱快照</button>
          </div>

          <div class="stack" style="margin-top: 18px;">
            <h2>Self-Learning (P0-P2)</h2>
            <div class="button-grid">
              <button id="loadExperiences" class="secondary">加载经验记录</button>
              <button id="loadPatterns" class="secondary">加载识别模式</button>
              <button id="loadDrafts" class="secondary">加载技能草稿</button>
              <button id="loadReport" class="secondary">加载评分报告</button>
            </div>
          </div>

          <div class="stack" style="margin-top: 18px;">
            <h2>图谱探查</h2>
            <div class="field">
              <label for="graphNeedle">图谱查询</label>
              <input id="graphNeedle" value="memory" />
            </div>
            <div class="button-grid">
              <button id="runGraphQuery" class="secondary">查询节点</button>
            </div>
            <div class="field">
              <label for="fromNode">路径起点</label>
              <input id="fromNode" value="Memory" />
            </div>
            <div class="field">
              <label for="toNode">路径终点</label>
              <input id="toNode" value="Boss" />
            </div>
            <div class="button-grid">
              <button id="runGraphPath" class="secondary">查找路径</button>
              <button id="runGraphExplain" class="secondary">解释节点</button>
            </div>
          </div>
        </aside>

        <main class="panel results">
          <div class="status">
            <span class="pill" id="statusPill">就绪</span>
            <span id="statusText">等待查询。</span>
          </div>

          <div class="metric-row">
            <div class="metric"><div class="k">记忆数</div><div class="v" id="memoryCount">0</div></div>
            <div class="metric"><div class="k">读取范围</div><div class="v" id="scopeCount">0</div></div>
            <div class="metric"><div class="k">图谱节点</div><div class="v" id="nodeCount">0</div></div>
            <div class="metric"><div class="k">图谱边</div><div class="v" id="edgeCount">0</div></div>
          </div>

          <div class="cards">
            <section class="card">
              <h3>记忆摘要</h3>
              <div class="card-body"><pre id="briefOut">尚未加载。</pre></div>
            </section>
            <section class="card">
              <h3>图谱报告</h3>
              <div class="card-body"><pre id="graphReportOut">尚未加载。</pre></div>
            </section>
          </div>

          <section class="card">
            <h3>载体文件</h3>
            <div class="card-body" id="carrierOut">尚未加载。</div>
          </section>

          <section class="card">
            <h3>原始记忆条目</h3>
            <div class="card-body" id="memoryTableWrap">尚未加载。</div>
          </section>

          <div class="cards">
            <section class="card">
              <h3>图谱查询 / 路径</h3>
              <div class="card-body"><pre id="graphProbeOut">尚未执行。</pre></div>
            </section>
            <section class="card">
              <h3>热门节点 / 边</h3>
              <div class="card-body"><pre id="graphSummaryOut">尚未加载。</pre></div>
            </section>
          </div>

          <div class="cards">
            <section class="card">
              <h3>经验记录</h3>
              <div class="card-body"><pre id="experiencesOut">尚未加载。</pre></div>
            </section>
            <section class="card">
              <h3>识别模式</h3>
              <div class="card-body"><pre id="patternsOut">尚未加载。</pre></div>
            </section>
          </div>

          <div class="cards">
            <section class="card">
              <h3>技能草稿</h3>
              <div class="card-body"><pre id="draftsOut">尚未加载。</pre></div>
            </section>
            <section class="card">
              <h3>评分报告</h3>
              <div class="card-body"><pre id="reportOut">尚未加载。</pre></div>
            </section>
          </div>
        </main>
      </div>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);

      function ctx() {
        return {
          agentId: $("agentId").value.trim(),
          projectId: $("projectId").value.trim(),
          scope: $("scope").value,
          depth: $("depth").value,
          query: $("query").value.trim(),
          files: $("carrierFiles").value.split(",").map((v) => v.trim()).filter(Boolean),
          limit: Number($("memoryLimit").value || 80)
        };
      }

      function apiBase() {
        const path = window.location.pathname;
        if (path.startsWith("/memory-fabric/")) return "/memory-fabric";
        return "";
      }

      function setStatus(text, accent = "var(--accent)") {
        $("statusPill").textContent = "运行中";
        $("statusPill").style.background = "rgba(15, 118, 110, 0.1)";
        $("statusPill").style.color = accent;
        $("statusText").textContent = text;
      }

      async function post(url, payload) {
        const res = await fetch(apiBase() + url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message || "请求失败");
        }
        return data;
      }

      function renderCarrier(carriers) {
        if (!carriers.length) {
          $("carrierOut").textContent = "没有可显示的载体文件。";
          return;
        }
        $("carrierOut").innerHTML = carriers.map((carrier) => {
          const content = carrier.exists ? escapeHtml(carrier.content || "") : "文件不存在";
          return '<div style="margin-bottom:14px;">' +
            '<div class="mono" style="margin-bottom:8px;color:var(--accent-2);">' + escapeHtml(carrier.filename) + '</div>' +
            '<pre>' + content + '</pre>' +
          '</div>';
        }).join("");
      }

      function renderMemories(entries) {
        if (!entries.length) {
          $("memoryTableWrap").textContent = "没有原始记忆条目。";
          return;
        }
        const rows = entries.map((entry) => '<tr>' +
          '<td class="mono">' + escapeHtml(entry.createdAt || "") + '</td>' +
          '<td>' + escapeHtml(entry.type || "") + '</td>' +
          '<td>' + escapeHtml(entry.scope || "") + '</td>' +
          '<td>' + escapeHtml(entry.content || "") + '</td>' +
        '</tr>').join("");
        $("memoryTableWrap").innerHTML =
          '<table><thead><tr><th>创建时间</th><th>类型</th><th>范围</th><th>内容</th></tr></thead><tbody>' +
          rows +
          '</tbody></table>';
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      async function loadBrief() {
        const c = ctx();
        const data = await post("/recall", c);
        $("briefOut").textContent = data.memoryBrief || "无摘要";
        setStatus("记忆摘要已加载。");
      }

      async function loadCarriers() {
        const c = ctx();
        const data = await post("/carrier/read", {
          agentId: c.agentId,
          projectId: c.projectId || undefined,
          files: c.files
        });
        renderCarrier(data.carriers || []);
        setStatus("载体文件已加载。");
      }

      async function loadMemories() {
        const c = ctx();
        const data = await post("/inspect/memories", {
          agentId: c.agentId,
          projectId: c.projectId || undefined,
          scope: c.scope,
          query: c.query,
          limit: c.limit
        });
        $("memoryCount").textContent = String(data.totalEntries || 0);
        $("scopeCount").textContent = String((data.scopesRead || []).length);
        renderMemories(data.entries || []);
        setStatus("原始记忆已加载。");
      }

      async function loadGraph() {
        const c = ctx();
        if (!c.projectId) throw new Error("图谱查询需要 Project ID。");
        const data = await post("/inspect/graph", { projectId: c.projectId });
        $("nodeCount").textContent = String(data.nodeCount || 0);
        $("edgeCount").textContent = String(data.edgeCount || 0);
        $("graphReportOut").textContent = data.report || "无图谱报告";
        const topNodes = (data.topNodes || []).slice(0, 8).map((node) =>
          "- " + node.id + " (" + node.mentions + ", " + node.type + ")"
        );
        const topEdges = (data.topEdges || []).slice(0, 8).map((edge) =>
          "- " + edge.source + " ↔ " + edge.target + " (" + edge.weight + ")"
        );
        $("graphSummaryOut").textContent =
          "热门节点\n" + (topNodes.join("\n") || "_无_") +
          "\n\n热门边\n" + (topEdges.join("\n") || "_无_");
        setStatus("图谱快照已加载。");
      }

      async function runGraphQuery() {
        const c = ctx();
        const data = await post("/graph/query", {
          projectId: c.projectId,
          query: $("graphNeedle").value.trim(),
          budget: 12
        });
        $("graphProbeOut").textContent = JSON.stringify(data, null, 2);
        setStatus("图谱查询已执行。");
      }

      async function runGraphPath() {
        const c = ctx();
        const data = await post("/graph/path", {
          projectId: c.projectId,
          from: $("fromNode").value.trim(),
          to: $("toNode").value.trim()
        });
        $("graphProbeOut").textContent = JSON.stringify(data, null, 2);
        setStatus("路径查找已执行。");
      }

      async function runGraphExplain() {
        const c = ctx();
        const data = await post("/graph/explain", {
          projectId: c.projectId,
          query: $("graphNeedle").value.trim()
        });
        $("graphProbeOut").textContent = JSON.stringify(data, null, 2);
        setStatus("节点解释已执行。");
      }

      async function loadExperiences() {
        const c = ctx();
        const data = await fetch(apiBase() + "/inspect/experiences?agentId=" + encodeURIComponent(c.agentId)).then((r) => r.json());
        $("experiencesOut").textContent = JSON.stringify(data, null, 2);
        setStatus("经验记录已加载。");
      }

      async function loadPatterns() {
        const c = ctx();
        const data = await fetch(apiBase() + "/patterns?agentId=" + encodeURIComponent(c.agentId)).then((r) => r.json());
        $("patternsOut").textContent = JSON.stringify(data, null, 2);
        setStatus("识别模式已加载。");
      }

      async function loadDrafts() {
        const data = await fetch(apiBase() + "/skills/drafts").then((r) => r.json());
        $("draftsOut").textContent = JSON.stringify(data, null, 2);
        setStatus("技能草稿已加载。");
      }

      async function loadReport() {
        const c = ctx();
        const data = await fetch(apiBase() + "/report?agentId=" + encodeURIComponent(c.agentId)).then((r) => r.json());
        $("reportOut").textContent = JSON.stringify(data, null, 2);
        setStatus("评分报告已加载。");
      }

      async function withBusy(fn, label) {
        const buttons = [...document.querySelectorAll("button")];
        buttons.forEach((button) => button.disabled = true);
        setStatus(label + "...");
        try {
          await fn();
        } catch (error) {
          $("statusPill").textContent = "错误";
          $("statusPill").style.background = "rgba(153, 27, 27, 0.1)";
          $("statusPill").style.color = "#991b1b";
          $("statusText").textContent = error.message || String(error);
        } finally {
          buttons.forEach((button) => button.disabled = false);
        }
      }

      $("loadBrief").addEventListener("click", () => withBusy(loadBrief, "加载记忆摘要"));
      $("loadCarriers").addEventListener("click", () => withBusy(loadCarriers, "加载载体文件"));
      $("loadMemories").addEventListener("click", () => withBusy(loadMemories, "加载原始记忆"));
      $("loadGraph").addEventListener("click", () => withBusy(loadGraph, "加载图谱快照"));
      $("runGraphQuery").addEventListener("click", () => withBusy(runGraphQuery, "执行图谱查询"));
      $("runGraphPath").addEventListener("click", () => withBusy(runGraphPath, "执行路径查找"));
      $("runGraphExplain").addEventListener("click", () => withBusy(runGraphExplain, "执行节点解释"));
      $("loadAll").addEventListener("click", () => withBusy(async () => {
        await loadBrief();
        await loadCarriers();
        await loadMemories();
        await loadGraph();
        await loadExperiences();
        await loadPatterns();
        await loadDrafts();
        await loadReport();
      }, "加载完整快照"));

      $("loadExperiences").addEventListener("click", () => withBusy(loadExperiences, "加载经验记录"));
      $("loadPatterns").addEventListener("click", () => withBusy(loadPatterns, "加载识别模式"));
      $("loadDrafts").addEventListener("click", () => withBusy(loadDrafts, "加载技能草稿"));
      $("loadReport").addEventListener("click", () => withBusy(loadReport, "加载评分报告"));
    </script>
  </body>
</html>`;

export function registerInspectRoutes(
  app: FastifyInstance,
  openviking: OpenVikingService,
  graphify: GraphifyService,
  expStore?: ExperienceStore
): void {
  app.get("/inspect", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(INSPECT_PAGE);
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
            scope: { type: "string", enum: ["private", "project", "shared", "auto"] },
            query: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) => {
      return openviking.inspectMemory(request.body);
    }
  );

  app.post<{ Body: { projectId: string } }>(
    "/inspect/graph",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request) => {
      return graphify.inspectProjectGraph(request.body.projectId);
    }
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
              agentId: { type: "string", minLength: 1 }
            }
          }
        }
      },
      async (request) => {
        const entries = await expStore.query({ agentId: request.query.agentId });
        return { ok: true, count: entries.length, entries };
      }
    );
  }
}
