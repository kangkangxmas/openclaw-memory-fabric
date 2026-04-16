---
name: execution-gate
version: "1.0"
status: active
phase: 10
description: >
  Mandates a structured deliberation step before any significant action. The
  agent must state what it knows, what it is about to do, and why, before
  executing. Prevents impulsive or under-informed tool calls.
triggers:
  - before calling any tool that writes, deletes, or deploys
  - before starting a subtask that spans more than one file
  - before making a decision that will be committed to long-term memory
  - at the start of any task the agent rated as "complex"
tools_used:
  - memory_brief
  - project_graph_query
  - project_graph_path
---

# execution-gate

## Purpose

Every significant agent action must pass through a deliberation gate. This
skill ensures the agent has enough context, has a clear rationale, and has
chosen the least-surprising action path before executing.

---

## Gate Protocol

Before any gated action, the agent MUST produce a Gate Block:

```
### Execution Gate
- **Action**: [What I am about to do]
- **Why**: [Why this is the right action given the brief]
- **Risk**: [What could go wrong; how I will detect and recover]
- **Memory basis**: [Which recalled facts/decisions support this choice]
- **Alternative considered**: [What else was an option and why rejected]
```

Only proceed after this block is written.

---

## Behavior Rules

### MUST

1. **Call `memory_brief` at task start** before forming an action plan.
   The brief must be read, not assumed. State the depth used.

2. **Write the Gate Block** before any write/delete/deploy tool call.
   The block must reference at least one recalled fact or decision.

3. **Choose the lowest-impact action** that achieves the goal.
   If a read-only verification step would de-risk the action, do it first.

4. **Escalate uncertainty before acting.**
   If `open-questions.md` contains an unresolved item directly relevant to
   the action, surface it to the user before proceeding.

5. **After executing, record the outcome.**
   Update `execution-journal.md` (via `carrier_merge`) with what was done
   and what was observed.

### MUST NOT

- Do **not** run destructive operations (overwrite, delete, deploy) without
  a Gate Block.
- Do **not** skip the brief and act from memory alone on complex tasks.
- Do **not** chain multiple high-risk actions without a Gate Block for each.
- Do **not** assume a previous session's recalled decisions are still valid
  without checking `freshness` in the structural brief.

---

## Complexity Scoring (informal)

| Signal                              | Complexity bump |
|-------------------------------------|-----------------|
| Touches > 1 module                  | +1              |
| Involves external API or DB         | +1              |
| Modifies shared state               | +1              |
| Confidence in structural brief < medium | +1          |
| > 3 open questions in scope         | +1              |

Gate is mandatory at complexity ≥ 2.

---

## Examples

### ✅ Correct

> Task: Refactor AuthService to use JWT.
>
> Agent: Reads `memory_brief(depth=l2)`, checks decision-log for prior auth
> decisions, queries `project_graph_explain("AuthService")`, writes Gate Block
> citing retrieved decisions, then proceeds file-by-file.

### ❌ Incorrect

> Task: Refactor AuthService to use JWT.
>
> Agent immediately starts editing files without reading memory or producing
> a Gate Block.
