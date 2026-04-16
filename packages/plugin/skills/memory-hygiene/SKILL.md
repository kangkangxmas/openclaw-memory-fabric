---
name: memory-hygiene
version: "1.0"
status: active
phase: 10
description: >
  Governs what information is worthy of long-term memory storage. Prevents the
  accumulation of noise, temporary guesses, and unverified information in
  stable memory carriers.
triggers:
  - end of any task where decisions or facts emerged
  - when the agent is about to write to a carrier file
  - when considering what to include in memory_commit
tools_used:
  - memory_commit
  - memory_publish_shared
  - carrier_merge
---

# memory-hygiene

## Purpose

Long-term memory is only valuable if it is **stable, verified, and durable**.
This skill prevents the deposition of transient information into permanent
storage, keeping the memory store clean and highly reliable.

---

## Behavior Rules

### MUST

1. **Only commit stable, verified information.**
   A fact is stable if it is unlikely to change in the next 30 days and has
   been confirmed (not inferred) during the session. A decision is stable if
   it has been agreed upon, not merely considered.

2. **Route unverified items to open-questions.**
   If something might be true but hasn't been confirmed, write it to
   `open-questions.md` via `carrier_merge`, not to `decision-log.md` or facts.

3. **Tag the visibility level explicitly.**
   Every `memory_commit` call must include `visibility`. Default to `private`
   unless the agent explicitly decides the information is project-level.

4. **Use `memory_publish_shared` intentionally.**
   Publishing to the shared domain requires an explicit rationale. The agent
   must state why the information benefits other agents, not just itself.

5. **Clean before committing.**
   If the same fact or decision was already committed in a prior session,
   do not create a duplicate entry. Check the brief before writing.

### MUST NOT

- Do **not** commit the following to long-term memory:
  - Session-specific debugging notes ("I tried X and it failed")
  - Guesses or hypotheses not yet validated
  - User questions (only answers/conclusions are stored)
  - Intermediate reasoning steps
  - Raw tool output without synthesis

- Do **not** write to `decision-log.md` for a choice that is still under
  discussion. Use `open-questions.md` until resolved.

---

## Classification Guide

| Type                    | Target carrier          | Visibility  |
|-------------------------|-------------------------|-------------|
| Confirmed technical fact | facts in memory_commit  | private     |
| Agreed architecture decision | decision-log.md   | project     |
| Reusable process/pattern | playbooks.md           | project     |
| Entity / term definition | entities-glossary.md   | project     |
| Unresolved conflict      | open-questions.md      | private     |
| Session task log         | execution-journal.md   | private     |

---

## Examples

### ✅ Correct

> Session conclusion: "We confirmed the database uses PostgreSQL 15."
>
> Agent commits: `{ facts: ["Database: PostgreSQL 15 (confirmed)"],
> visibility: "project_shared" }`

### ❌ Incorrect

> Session speculation: "The database might be using MySQL or PostgreSQL."
>
> Agent commits it as a fact. ← This contaminates long-term memory with noise.

### ✅ Correct handling of the above

> Agent writes to `open-questions.md`:
> `"Database engine not yet confirmed — PostgreSQL or MySQL?"`
