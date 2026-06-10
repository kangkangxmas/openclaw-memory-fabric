import type { MemoryEntryV2 } from "../models/schema-v2.js";

export interface MemoryCard {
  memoryId: string;
  type: string;
  time: string;
  confidence: number;
  content: string;
  evidence: string[];
  evidenceSummary?: string;
  tokenCost?: number;
  conflict?: string;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function truncate(value: string, max = 160): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function approxTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}

export class MemoryCardPackager {
  package(entries: MemoryEntryV2[], opts?: { limit?: number; tokenBudget?: number; maxChars?: number }): MemoryCard[] {
    const seen = new Set<string>();
    const cards: MemoryCard[] = [];
    let tokens = 0;
    const limit = opts?.limit ?? 8;
    const tokenBudget = opts?.tokenBudget ?? 700;
    const maxChars = Math.max(80, Math.min(opts?.maxChars ?? 160, 320));

    for (const entry of entries) {
      if (cards.length >= limit) break;
      const key = normalized(entry.content).slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);

      const quality = entry.quality
        ? (entry.quality.specificity + entry.quality.actionability + entry.quality.stability + entry.quality.sourceCoverage) / 4
        : 0.5;
      const evidence = entry.sourceRefs?.slice(0, 3) ?? entry.sources?.map((source) => source.identifier).slice(0, 3) ?? [];
      const conflict =
        entry.status === "superseded" || entry.status === "retracted"
          ? entry.status
          : entry.validUntil && new Date(entry.validUntil).getTime() <= Date.now()
            ? "expired"
            : undefined;
      const card: MemoryCard = {
        memoryId: entry.id,
        type: entry.type,
        time: (entry.validFrom ?? entry.timeline.createdAt).slice(0, 10),
        confidence: clamp(quality),
        content: truncate(entry.content, maxChars),
        evidence,
        evidenceSummary: evidence.length > 0 ? `${evidence.length} source ref${evidence.length > 1 ? "s" : ""}` : "missing source ref",
        conflict,
      };
      card.tokenCost = approxTokens(this.render([card]));
      if (tokens + card.tokenCost > tokenBudget && cards.length > 0) break;
      tokens += card.tokenCost;
      cards.push(card);
    }

    return cards;
  }

  render(cards: MemoryCard[]): string {
    if (cards.length === 0) return "### Memory Cards\nNo relevant memory cards found.";
    return [
      "### Memory Cards",
      ...cards.map((card) => {
        const evidence = card.evidence.length > 0 ? card.evidence.join(", ") : "none";
        const evidenceSummary = card.evidenceSummary ? `\nEvidence Summary: ${card.evidenceSummary}` : "";
        const conflict = card.conflict ? `\nConflict: ${card.conflict}` : "";
        return [
          "[Memory Card]",
          `Type: ${card.type}`,
          `Time: ${card.time}`,
          `Confidence: ${card.confidence.toFixed(2)}`,
          `Content: ${card.content}`,
          `Evidence: ${evidence}${evidenceSummary}${conflict}`,
        ].join("\n");
      }),
    ].join("\n\n");
  }
}
