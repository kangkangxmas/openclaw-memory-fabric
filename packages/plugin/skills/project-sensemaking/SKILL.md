---
name: project-sensemaking
version: "1.0"
status: active
phase: 10
description: >
  Enforces structural-cognition-first behavior before any retrieval or execution
  on a complex project. Prevents blind search and ensures the agent understands
  project topology before acting.
triggers:
  - first contact with a new project
  - cross-module questions
  - project resource count > 10 files
  - agent structural confidence is low or unknown
tools_used:
  - project_bootstrap
  - project_graph_query
  - project_graph_explain
  - memory_brief
---

# project-sensemaking

## Purpose

Before searching, coding, or answering a complex project question, the agent must
first orient itself within the project's structure. This skill enforces
**"understand the map before navigating"**.

---

## Behavior Rules

### MUST

1. **Read the Structural Brief first.**
   On any task that touches more than one module, or that the agent has not
   encountered before, start by calling `memory_brief` with `depth=l1` or
   higher. If a graph brief is available, read it before proceeding.

2. **State your current structural understanding.**
   After reading the brief, output a concise "Current Understanding" block
   that lists what you know, what you don't know, and where you plan to look.

3. **Identify the 3 most relevant nodes before retrieving files.**
   Use `project_graph_query` to find the most relevant entities for the question
   at hand. Only then decide which files to read.

4. **Bootstrap if the graph is missing.**
   If `freshness=missing`, call `project_bootstrap` before attempting any
   structural reasoning. Inform the user that this one-time setup is running.

### MUST NOT

- Do **not** run a global file search before reading the structural brief on a
  new or complex project.
- Do **not** answer multi-module questions based only on the current context
  window without consulting memory.
- Do **not** skip structural orientation because "the question looks simple" —
  let the brief confirm simplicity, not your assumption.

---

## Output Format

After reading the brief, always produce this block before proceeding:

```
### Structural Orientation
- **Known**: [list what the brief confirms]
- **Unknown**: [list gaps]
- **Plan**: [which nodes/files to check next]
```

---

## Examples

### ✅ Correct

> User: "How does authentication interact with the billing module?"
>
> Agent: Calls `memory_brief(depth=l1, projectId="acme")`, reads structural
> brief, identifies `AuthService` and `BillingService` as core nodes,
> calls `project_graph_path(from="AuthService", to="BillingService")`,
> then outputs Structural Orientation block, then answers.

### ❌ Incorrect

> User: "How does authentication interact with the billing module?"
>
> Agent: Immediately searches the codebase for "auth" and "billing" without
> reading any structural context.

---

## Degradation

If the sidecar is unavailable (no graph, no memory brief), the agent MUST:
1. Acknowledge the limitation explicitly.
2. Ask the user for a high-level project description before proceeding.
3. Work from that description and note it as unverified.
