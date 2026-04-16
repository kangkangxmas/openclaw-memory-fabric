# OpenClaw Memory Fabric

A multi-agent memory orchestration layer for [OpenClaw](https://github.com/openclaw/openclaw),
delivered as a native plugin + local sidecar service. No upstream source modifications required.

## What it provides

- **Multi-agent memory isolation** — each agent has its own private memory namespace
- **Cross-session persistence** — memories survive context window resets and process restarts
- **Stable memory carriers** — 9 structured markdown files per agent/project (identity, decisions, glossary, etc.)
- **Structure-first project understanding** — Graphify integration for code graph injection
- **Governed shared memory** — publish / retract cross-agent insights with audit trail
- **Observability** — structured JSON logs to stderr, in-memory metrics, async health endpoint

---

## Quick start

### Prerequisites

- Node.js 20+
- pnpm 9+

### 1. Install and build

```bash
git clone <repo-url> openclaw-memory-fabric
cd openclaw-memory-fabric
pnpm install
pnpm -r build
```

### 2. Start the sidecar

```bash
bash scripts/dev-start.sh
# Sidecar listens on http://127.0.0.1:7811
```

Or with custom settings:

```bash
PORT=9000 DATA_DIR=./my-data bash scripts/dev-start.sh
```

### 3. Verify health

```bash
bash scripts/health-check.sh
# [memory-fabric] OK — sidecar is healthy
```

Or directly:

```bash
curl http://127.0.0.1:7811/health
```

### 4. Bootstrap a project

```bash
bash examples/project-sample/bootstrap.sh my-agent my-project
```

Or manually:

```bash
# Init carrier files
curl -X POST http://127.0.0.1:7811/carrier/init \
  -H "Content-Type: application/json" \
  -d '{ "agentId": "my-agent", "projectId": "my-project" }'

# Commit facts
curl -X POST http://127.0.0.1:7811/commit \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "projectId": "my-project",
    "facts": ["Node 20 is required", "sidecar runs on port 7811"],
    "decisions": ["use JSONL for memory storage"]
  }'

# Recall on next session
curl -X POST http://127.0.0.1:7811/recall \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "projectId": "my-project",
    "scope": "project",
    "depth": "l1",
    "query": "storage format"
  }'
```

### 5. Load the plugin in OpenClaw

```yaml
# openclaw config
plugins:
  entries:
    memory-fabric:
      package: "@openclaw-memory-fabric/plugin"
      enabled: true
      config:
        defaultScope: project
        sidecar:
          baseUrl: "http://127.0.0.1:7811"
          timeoutMs: 12000
        observability:
          logLevel: info
          emitMetrics: true
```

---

## Running tests

```bash
# Unit + integration tests (all packages)
pnpm test

# E2E tests (starts a real sidecar, runs scenarios)
pnpm test:e2e
```

---

## Repository layout

```text
packages/
  plugin/         — OpenClaw native plugin (TypeScript)
    src/
      hooks/      — before_prompt_build, agent_end
      orchestrator/ — RecallOrchestrator, CommitOrchestrator
      tools/      — health_status, memory_publish_shared, memory_forget_scoped
      observability/ — Logger, MetricsCollector re-exports
      utils/      — Logger, MetricsCollector, SidecarClient
    skills/       — 4 SKILL.md files (project-sensemaking, memory-hygiene, etc.)
    test/

  sidecar/        — Local HTTP service (Fastify 5 + TypeScript)
    src/
      routes/     — /recall, /commit, /carrier/*, /distill, /shared/*, /graph/*
      services/   — OpenVikingService, CarrierRepository, DistillService,
                    GraphifyService, SharedService
    test/

docs/             — Product design, architecture, dev instructions, deployment guide
  progress/       — Per-phase implementation records (phase-01 … phase-13)

examples/
  config/         — Annotated reference config (memory-fabric.yaml)
  project-sample/ — Bootstrap walkthrough + shell script

scripts/
  dev-start.sh    — Start sidecar in dev mode
  dev-stop.sh     — Stop running sidecar
  health-check.sh — Ping /health endpoint
  e2e/            — E2E test suite (node --test)
```

---

## Key sidecar endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| POST | `/recall` | Retrieve memory brief for a session |
| POST | `/commit` | Persist distilled session memory |
| POST | `/distill` | Extract facts/decisions/entities from messages |
| POST | `/carrier/init` | Initialise carrier files for agent/project |
| POST | `/carrier/read` | Read specific carrier file contents |
| POST | `/carrier/merge` | Merge patches into carrier files |
| POST | `/bootstrap` | Build Graphify project graph |
| POST | `/graph/brief` | Get structural brief for a project |
| POST | `/shared/publish` | Publish entries to shared memory |
| POST | `/shared/recall` | Recall shared entries |
| POST | `/shared/forget` | Retract shared entries (audit-safe) |

---

## Environment variables (sidecar)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7811` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `OPENVIKING_MODE` | `local` | `local` or `remote` |
| `OPENVIKING_BASE_PATH` | `~/.openviking` | Local memory storage root |
| `OPENVIKING_TARGET_ROOT` | `viking://org/default` | URI namespace root |
| `CARRIERS_ROOT` | `~/.memory-fabric/carriers` | Carrier files root |
| `GRAPHIFY_BASE_PATH` | `~/.memory-fabric/graphs` | Graph output root |

---

## Phase progress

All 13 implementation phases completed. See `docs/progress/` for per-phase records.

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Monorepo skeleton | ✓ |
| 2 | Plugin manifest & minimal startup | ✓ |
| 3 | Config validation | ✓ |
| 4 | Sidecar minimal routes | ✓ |
| 5 | OpenViking local adapter | ✓ |
| 6 | Carrier file system | ✓ |
| 7 | Hook injection & memory brief | ✓ |
| 8 | Distill & commit pipeline | ✓ |
| 9 | Graphify integration | ✓ |
| 10 | Skills packaging | ✓ |
| 11 | Shared governance | ✓ |
| 12 | Observability | ✓ |
| 13 | Tests & acceptance | ✓ |

---

## Troubleshooting

**Sidecar not reachable:**
```bash
bash scripts/health-check.sh
# check port, check if already running: lsof -i :7811
```

**Build errors:**
```bash
pnpm -r build 2>&1 | grep error
```

**Test failures:**
```bash
pnpm test 2>&1 | grep "not ok"
```

See `docs/04-install-deployment.md` for the full deployment guide including systemd setup, backup strategies, and upgrade procedures.
