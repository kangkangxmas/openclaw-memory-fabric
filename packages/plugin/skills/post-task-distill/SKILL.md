---
name: post-task-distill
version: "1.0"
status: active
phase: 10
description: >
  Governs the mandatory wrap-up phase after any significant task. Ensures
  decisions, learnings, risks, and open questions are written back to durable
  memory before the session closes.
triggers:
  - after any task that produced a decision or fact
  - at explicit session end
  - after a multi-step plan completes
  - after encountering a significant bug, failure, or surprise
tools_used:
  - memory_commit
  - carrier_merge
  - project_state_refresh
---

# post-task-distill

## Purpose

Agent work is only valuable in the long run if the learnings survive the
session. This skill enforces a disciplined **"close the loop"** habit:
distill, commit, update self-model.

---

## Distillation Protocol

At the end of a task, the agent MUST produce a Distillation Block:

```
### Post-Task Distillation
**Decisions made**: [list; empty if none]
**Facts confirmed**: [list; empty if none]
**Patterns observed**: [list; empty if none]
**Risks / open questions**: [list; empty if none]
**Self-model update**: [what changed in my understanding of this project]
**Next recommended action**: [for whoever picks this up next]
```

Then call `memory_commit` with the appropriate fields, and `carrier_merge`
for any stable carrier updates.

---

## Behavior Rules

### MUST

1. **Always produce a Distillation Block** at the end of any task that lasted
   more than one tool call.

2. **Separate durable knowledge from session noise.**
   Apply the `memory-hygiene` skill classification table before committing.
   Only stable, verified items go to `memory_commit`.

3. **Update `self-model.md`.**
   After distillation, merge a refreshed self-model block reflecting:
   - current goal (what comes next)
   - what is now understood
   - what is still uncertain
   - missing evidence

4. **Add new open questions to `open-questions.md`.**
   If the task raised questions that weren't answered, write them as
   checkboxes via `carrier_merge` to `open-questions.md`.

5. **Consider graph freshness.**
   If the task changed the project structure significantly (new modules,
   renamed entities, deleted components), note that the graph may be stale
   and suggest running `project_state_refresh`.

### MUST NOT

- Do **not** end a task involving decisions without calling `memory_commit`.
- Do **not** commit the Distillation Block prose verbatim — extract
  structured items (facts as strings, decisions as strings, etc.).
- Do **not** mark `open-questions.md` items as resolved without verifying
  the answer. Move them to `decision-log.md` only after confirmed resolution.

---

## Timing

| Trigger                   | When to distill            |
|---------------------------|----------------------------|
| Task explicitly complete  | Immediately                |
| Mid-task checkpoint       | After each major subtask   |
| Surprise/failure          | Before retrying            |
| Session end requested     | Before any closing message |

---

## Examples

### ✅ Correct

> Task: Investigated why checkout fails for EU users.
>
> Distillation Block produced. `memory_commit` called with:
> ```
> facts: ["EU checkout fails due to VAT calculation rounding in BillingService (line 142)"]
> decisions: ["Apply Math.round(x * 100) / 100 fix per EU VAT rules"]
> unresolved: ["No automated test for EU VAT edge cases"]
> ```
> `open-questions.md` updated with the missing test coverage item.
> `self-model.md` updated with new understanding of BillingService internals.

### ❌ Incorrect

> Task: Investigated why checkout fails for EU users.
>
> Agent finds the bug, fixes it, and ends the session without distilling.
> The next agent has no record of the cause, the fix rationale, or the
> missing test coverage.
