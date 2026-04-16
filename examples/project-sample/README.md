# Sample Project Bootstrap

This example shows the bootstrap sequence for a new project called `phoenix-rewrite`.

## 1. Start the sidecar

```bash
bash scripts/dev-start.sh --port 7811 --data-dir ./runtime-data
```

## 2. Initialise carrier files for your agent

```bash
curl -X POST http://127.0.0.1:7811/carrier/init \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "projectId": "phoenix-rewrite"
  }'
```

Expected response:
```json
{ "ok": true, "initialized": ["identity.md", "working-style.md", "self-model.md",
  "project-model.md", "decision-log.md", "entities-glossary.md",
  "playbooks.md", "open-questions.md", "execution-journal.md"] }
```

## 3. Bootstrap the project graph (optional — requires Graphify)

```bash
curl -X POST http://127.0.0.1:7811/bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "phoenix-rewrite",
    "paths": ["/path/to/your/project"],
    "mode": "quick"
  }'
```

## 4. Commit your first memories

```bash
curl -X POST http://127.0.0.1:7811/commit \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "projectId": "phoenix-rewrite",
    "facts": [
      "the project uses Node 20 and pnpm",
      "the API gateway runs on port 8080"
    ],
    "decisions": [
      "use JSONL for persistent memory — no database dependency"
    ],
    "entities": ["GatewayService", "AuthController"]
  }'
```

## 5. Recall on the next session

```bash
curl -X POST http://127.0.0.1:7811/recall \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-agent",
    "projectId": "phoenix-rewrite",
    "scope": "project",
    "depth": "l1",
    "query": "API gateway port"
  }'
```

## 6. Share a cross-agent insight

```bash
curl -X POST http://127.0.0.1:7811/shared/publish \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "my-agent",
    "projectId": "phoenix-rewrite",
    "items": [
      { "type": "decision", "content": "blue-green deployment adopted for zero-downtime releases" }
    ]
  }'
```

## 7. Verify health

```bash
bash scripts/health-check.sh
```
