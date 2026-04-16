import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { validateId } from "../utils/path-guard.js";

// ---------------------------------------------------------------------------
// Carrier file definitions
// ---------------------------------------------------------------------------

/** Merge strategy for each carrier file */
type MergeStrategy =
  | "append"
  | "dedup-append"
  | "ordered-accumulate"
  | "overwrite"
  | "conflict-preserve";

interface CarrierDef {
  filename: string;
  strategy: MergeStrategy;
  description: string;
  template: string;
}

const PRIVATE_CARRIERS: CarrierDef[] = [
  {
    filename: "identity.md",
    strategy: "overwrite",
    description: "Agent identity, role, and responsibility boundaries",
    template: `# Identity

## Role
<!-- Describe the agent's role here -->

## Responsibilities
<!-- List core responsibilities -->

## Constraints
<!-- List hard constraints -->
`
  },
  {
    filename: "working-style.md",
    strategy: "overwrite",
    description: "Working habits, output style, and execution constraints",
    template: `# Working Style

## Output Format Preferences
<!-- e.g. concise bullet points, structured markdown, etc. -->

## Execution Approach
<!-- e.g. validate before execute, prefer reversible actions, etc. -->

## Communication Style
<!-- e.g. technical depth, audience assumptions, etc. -->
`
  },
  {
    filename: "self-model.md",
    strategy: "overwrite",
    description: "Agent's self-understanding: current goal, known/unknown, next actions",
    template: `# Self Model

## Current Goal
<!-- What is the agent currently trying to accomplish? -->

## Understood
<!-- What has the agent confidently understood? -->

## Uncertain
<!-- What is the agent unsure about? -->

## Missing Evidence
<!-- What information is still needed? -->

## Preferred Next Actions
<!-- What should the agent do next? -->

## Confidence
<!-- low | medium | high -->

## Updated At
<!-- ISO timestamp -->
`
  }
];

const PROJECT_CARRIERS: CarrierDef[] = [
  {
    filename: "project-model.md",
    strategy: "overwrite",
    description: "Project goals, module map, and core terminology",
    template: `# Project Model

## Goal
<!-- Describe the project goal -->

## Module Map
<!-- List and describe key modules -->

## Core Terminology
<!-- Key terms and their definitions -->
`
  },
  {
    filename: "decision-log.md",
    strategy: "ordered-accumulate",
    description: "Key decisions and their rationale, newest first",
    template: `# Decision Log

<!-- Format: ## YYYY-MM-DD: Decision Title\n**Context:** ...\n**Decision:** ...\n**Rationale:** ... -->
`
  },
  {
    filename: "entities-glossary.md",
    strategy: "dedup-append",
    description: "Entities, terms, and aliases — deduplicated on merge",
    template: `# Entities Glossary

<!-- Format: - **EntityName**: description (alias1, alias2) -->
`
  },
  {
    filename: "playbooks.md",
    strategy: "dedup-append",
    description: "Reusable processes and patterns",
    template: `# Playbooks

<!-- Format: ## Playbook Name\n**When to use:** ...\n**Steps:** ... -->
`
  },
  {
    filename: "open-questions.md",
    strategy: "conflict-preserve",
    description: "Conflicts, unknowns, and items pending validation",
    template: `# Open Questions

<!-- Format: - [ ] Question or conflict description (added: YYYY-MM-DD) -->
`
  },
  {
    filename: "execution-journal.md",
    strategy: "append",
    description: "Chronological task log",
    template: `# Execution Journal

<!-- Format: ## YYYY-MM-DDTHH:MM:SSZ\n**Task:** ...\n**Outcome:** ...\n**Notes:** ... -->
`
  }
];

// ---------------------------------------------------------------------------
// Patch types
// ---------------------------------------------------------------------------

export interface CarrierPatch {
  /** target filename, e.g. "decision-log.md" */
  filename: string;
  /** content to merge in (semantics depend on file strategy) */
  content: string;
}

export interface CarrierReadResult {
  filename: string;
  content: string;
  exists: boolean;
}

// ---------------------------------------------------------------------------
// CarrierRepository
// ---------------------------------------------------------------------------

export class CarrierRepository {
  constructor(private readonly carriersRoot: string) {}

  private privatePath(agentId: string): string {
    return join(this.carriersRoot, "agents", agentId, "private");
  }

  private projectPath(agentId: string, projectId: string): string {
    return join(this.carriersRoot, "agents", agentId, "projects", projectId);
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /** Initialise all carrier files for an agent (private + project). Idempotent. */
  async initAgent(agentId: string): Promise<void> {
    validateId(agentId, "agentId");
    const dir = this.privatePath(agentId);
    await mkdir(dir, { recursive: true });
    for (const def of PRIVATE_CARRIERS) {
      await this.ensureCarrier(join(dir, def.filename), def.template);
    }
  }

  /** Initialise project-scope carriers for an agent. Idempotent. */
  async initProject(agentId: string, projectId: string): Promise<void> {
    validateId(agentId, "agentId");
    validateId(projectId, "projectId");
    const dir = this.projectPath(agentId, projectId);
    await mkdir(dir, { recursive: true });
    for (const def of PROJECT_CARRIERS) {
      await this.ensureCarrier(join(dir, def.filename), def.template);
    }
  }

  private async ensureCarrier(filePath: string, template: string): Promise<void> {
    if (!existsSync(filePath)) {
      await writeFile(filePath, template, "utf8");
    }
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async read(opts: {
    agentId: string;
    projectId?: string;
    files?: string[];
  }): Promise<CarrierReadResult[]> {
    const { agentId, projectId, files } = opts;
    validateId(agentId, "agentId");
    if (projectId) validateId(projectId, "projectId");
    const results: CarrierReadResult[] = [];

    const dirs: Array<{ dir: string; defs: CarrierDef[] }> = [
      { dir: this.privatePath(agentId), defs: PRIVATE_CARRIERS }
    ];
    if (projectId) {
      dirs.push({ dir: this.projectPath(agentId, projectId), defs: PROJECT_CARRIERS });
    }

    for (const { dir, defs } of dirs) {
      for (const def of defs) {
        if (files && !files.includes(def.filename)) continue;
        const filePath = join(dir, def.filename);
        if (existsSync(filePath)) {
          const content = await readFile(filePath, "utf8");
          results.push({ filename: def.filename, content, exists: true });
        } else {
          results.push({ filename: def.filename, content: def.template, exists: false });
        }
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Merge
  // -------------------------------------------------------------------------

  async merge(opts: {
    agentId: string;
    projectId?: string;
    patches: CarrierPatch[];
  }): Promise<{ merged: string[]; skipped: string[] }> {
    const { agentId, projectId, patches } = opts;
    validateId(agentId, "agentId");
    if (projectId) validateId(projectId, "projectId");
    const merged: string[] = [];
    const skipped: string[] = [];

    const allDefs = [...PRIVATE_CARRIERS, ...PROJECT_CARRIERS];
    const defMap = new Map(allDefs.map((d) => [d.filename, d]));

    for (const patch of patches) {
      const def = defMap.get(patch.filename);
      if (!def) {
        skipped.push(`${patch.filename} (unknown carrier)`);
        continue;
      }

      const isPrivate = PRIVATE_CARRIERS.some((d) => d.filename === patch.filename);
      const dir = isPrivate
        ? this.privatePath(agentId)
        : projectId
          ? this.projectPath(agentId, projectId)
          : null;

      if (!dir) {
        skipped.push(`${patch.filename} (requires projectId)`);
        continue;
      }

      await mkdir(dir, { recursive: true });
      const filePath = join(dir, def.filename);

      await this.applyPatch(filePath, def, patch.content);
      merged.push(patch.filename);
    }

    return { merged, skipped };
  }

  private async applyPatch(filePath: string, def: CarrierDef, incoming: string): Promise<void> {
    const existing = existsSync(filePath) ? await readFile(filePath, "utf8") : def.template;

    switch (def.strategy) {
      case "overwrite": {
        // Replace entire file content
        await writeFile(filePath, incoming, "utf8");
        break;
      }

      case "append": {
        // Unconditionally append new content with a separator
        const separator = `\n<!-- appended: ${new Date().toISOString()} -->\n`;
        await writeFile(filePath, existing + separator + incoming, "utf8");
        break;
      }

      case "dedup-append": {
        // Append only lines not already present (simple line-level dedup)
        const existingLines = new Set(
          existing
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        );
        const newLines = incoming
          .split("\n")
          .filter((l) => l.trim() && !existingLines.has(l.trim()));
        if (newLines.length === 0) break;
        await writeFile(filePath, existing.trimEnd() + "\n" + newLines.join("\n") + "\n", "utf8");
        break;
      }

      case "ordered-accumulate": {
        // Prepend new content after the first heading (newest-first log)
        const headerEnd = existing.indexOf("\n") + 1;
        const header = existing.slice(0, headerEnd);
        const body = existing.slice(headerEnd);
        const entry = `\n${incoming.trim()}\n`;
        await writeFile(filePath, header + entry + body, "utf8");
        break;
      }

      case "conflict-preserve": {
        // Append with a conflict marker if content seems different from existing
        const alreadyPresent = existing.includes(incoming.trim().slice(0, 40));
        if (!alreadyPresent) {
          const ts = new Date().toISOString().slice(0, 10);
          const line = `- [ ] ${incoming.trim()} (added: ${ts})\n`;
          await writeFile(filePath, existing.trimEnd() + "\n" + line, "utf8");
        }
        break;
      }
    }
  }
}
