/**
 * SkillDraftStore — tracks auto-generated skill draft metadata.
 *
 * Persisted as JSON alongside the draft directory:
 *   {draftDir}/drafts-meta.json
 */

import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftMeta {
  hash: string;
  taskType: string;
  filePath: string;
  status: "pending" | "reviewed" | "ignored";
  createdAt: number;
  reviewedAt?: number;
}

// ---------------------------------------------------------------------------
// SkillDraftStore
// ---------------------------------------------------------------------------

export class SkillDraftStore {
  private readonly metaPath: string;

  constructor(draftDir: string) {
    this.metaPath = join(draftDir, "drafts-meta.json");
  }

  private async load(): Promise<DraftMeta[]> {
    try {
      const raw = await readFile(this.metaPath, "utf-8");
      return JSON.parse(raw) as DraftMeta[];
    } catch {
      return [];
    }
  }

  private async save(metas: DraftMeta[]): Promise<void> {
    await mkdir(join(this.metaPath, ".."), { recursive: true });
    await writeFile(this.metaPath, JSON.stringify(metas, null, 2));
  }

  /** Append a new draft meta entry. */
  async add(meta: DraftMeta): Promise<void> {
    const all = await this.load();
    all.push(meta);
    await this.save(all);
  }

  /** Check if a pattern hash already has a draft. */
  async exists(hash: string): Promise<boolean> {
    const all = await this.load();
    return all.some((m) => m.hash === hash);
  }

  /** List all drafts with a given status. */
  async listByStatus(status: DraftMeta["status"]): Promise<DraftMeta[]> {
    const all = await this.load();
    return all.filter((m) => m.status === status);
  }

  /** Shortcut for pending drafts. */
  async getPending(): Promise<DraftMeta[]> {
    return this.listByStatus("pending");
  }

  /** Mark a draft as reviewed. */
  async markReviewed(hash: string): Promise<void> {
    const all = await this.load();
    const meta = all.find((m) => m.hash === hash);
    if (meta) {
      meta.status = "reviewed";
      meta.reviewedAt = Date.now();
      await this.save(all);
    }
  }

  /** Mark a draft as ignored. */
  async markIgnored(hash: string): Promise<void> {
    const all = await this.load();
    const meta = all.find((m) => m.hash === hash);
    if (meta) {
      meta.status = "ignored";
      meta.reviewedAt = Date.now();
      await this.save(all);
    }
  }
}
