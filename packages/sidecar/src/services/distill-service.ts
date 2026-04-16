/**
 * DistillService — rule-based message distillation.
 *
 * Extracts structured memory items from a conversation turn without an LLM
 * call. Uses pattern matching on assistant messages to detect facts,
 * decisions, entities, patterns, and unresolved items.
 *
 * This is intentionally a lightweight heuristic tier. A production upgrade
 * path is to replace `distill()` with an LLM call while keeping the same
 * output interface.
 */

export interface DistillInput {
  messages: Array<{ role: string; content: string }>;
}

export interface DistillOutput {
  facts: string[];
  decisions: string[];
  entities: string[];
  patterns: string[];
  unresolved: string[];
  publishCandidates: string[];
}

// ---------------------------------------------------------------------------
// Pattern dictionaries
// ---------------------------------------------------------------------------

const DECISION_PATTERNS = [
  /(?:决定|已决定|we decided|decided to|decision:)\s*[:：]?\s*(.+)/i,
  /(?:采用|选择|改为|迁移到|using|adopting|switching to)\s+(.+)/i,
  /(?:方案|approach|solution)\s*[:：]\s*(.+)/i
];

const FACT_PATTERNS = [
  /(?:事实上|实际上|currently|in fact|known that|已知)\s*[:：]?\s*(.+)/i,
  /(?:the\s+\w+\s+is|该\w+是|系统使用|system uses)\s+(.+)/i,
  /(?:结论|conclusion|finding)\s*[:：]\s*(.+)/i
];

const ENTITY_PATTERNS = [
  // CamelCase identifiers (likely code symbols / service names)
  /\b([A-Z][a-zA-Z]{2,}(?:Service|Client|Handler|Manager|Controller|Adapter|Repository|Model|Store))\b/g,
  // Quoted terms
  /「(.{2,20})」/g,
  /"([A-Za-z][a-zA-Z0-9_-]{2,30})"/g
];

const PATTERN_MARKERS = [
  /(?:模式|pattern|经验|best practice|规律|规则)\s*[:：]\s*(.+)/i,
  /(?:每次|always|whenever|每当)\s+(.{10,})/i
];

const UNRESOLVED_MARKERS = [
  /(?:待确认|待验证|unclear|unresolved|open question|不清楚|未确定)\s*[:：]?\s*(.+)/i,
  /(?:需要确认|need to confirm|TBD|TODO|需要验证)\s*[:：]?\s*(.+)/i,
  /\?\s*(.{10,})\s*\?/
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractFirst(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim().slice(0, 200);
  }
  return null;
}

function extractAllGlobal(text: string, patterns: RegExp[]): string[] {
  const result = new Set<string>();
  for (const re of patterns) {
    const cloned = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = cloned.exec(text)) !== null) {
      if (m[1]) result.add(m[1].trim());
    }
  }
  return [...result];
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/[。！？\n.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && s.length < 300);
}

// ---------------------------------------------------------------------------
// DistillService
// ---------------------------------------------------------------------------

export class DistillService {
  distill(input: DistillInput): DistillOutput {
    const assistantMessages = input.messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content);

    const facts: string[] = [];
    const decisions: string[] = [];
    const entities: string[] = [];
    const patterns: string[] = [];
    const unresolved: string[] = [];

    for (const text of assistantMessages) {
      for (const sentence of splitIntoSentences(text)) {
        const decision = extractFirst(sentence, DECISION_PATTERNS);
        if (decision) decisions.push(decision);

        const fact = extractFirst(sentence, FACT_PATTERNS);
        if (fact) facts.push(fact);

        const pattern = extractFirst(sentence, PATTERN_MARKERS);
        if (pattern) patterns.push(pattern);

        const open = extractFirst(sentence, UNRESOLVED_MARKERS);
        if (open) unresolved.push(open);
      }

      // Entity extraction runs on full message text
      extractAllGlobal(text, ENTITY_PATTERNS).forEach((e) => entities.push(e));
    }

    // Deduplicate preserving insertion order
    const dedup = (arr: string[]): string[] => [...new Set(arr)];

    const cleanFacts = dedup(facts).slice(0, 10);
    const cleanDecisions = dedup(decisions).slice(0, 10);
    const cleanEntities = dedup(entities).slice(0, 20);
    const cleanPatterns = dedup(patterns).slice(0, 5);
    const cleanUnresolved = dedup(unresolved).slice(0, 5);

    // High-value items bubble up as publish candidates (decisions + unresolved)
    const publishCandidates = [...cleanDecisions.slice(0, 2), ...cleanUnresolved.slice(0, 2)];

    return {
      facts: cleanFacts,
      decisions: cleanDecisions,
      entities: cleanEntities,
      patterns: cleanPatterns,
      unresolved: cleanUnresolved,
      publishCandidates
    };
  }
}
