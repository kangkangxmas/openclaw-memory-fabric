/**
 * DistillService — two-tier message distillation.
 *
 * Tier 1 (default): rule-based heuristic extraction — fast, zero-cost,
 *   zero-latency. Used when no LLM config is provided.
 *
 * Tier 2 (optional LLM refinement): after heuristic extraction, an LLM
 *   call polishes and enriches the output. Activated by passing
 *   `DistillLLMConfig` to the constructor and setting `llm: true` in
 *   `DistillInput`. Falls back to heuristic output on any LLM error.
 *
 * The output interface is identical for both tiers, so callers are
 * unaffected by which tier runs.
 */

// ---------------------------------------------------------------------------
// LLM Configuration
// ---------------------------------------------------------------------------

export interface DistillLLMConfig {
  /** OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 */
  baseUrl: string;
  /** API key (use "ollama" or "none" for local endpoints) */
  apiKey: string;
  /** Model name, e.g. "gpt-4o-mini" or "qwen2.5:14b" */
  model: string;
  /** Max tokens for the refinement response (default: 800) */
  maxTokens?: number;
  /** Request timeout in ms (default: 15_000) */
  timeoutMs?: number;
}

export interface DistillInput {
  messages: Array<{ role: string; content: string }>;
  /** Set to true to invoke the LLM refinement tier (requires DistillLLMConfig) */
  llm?: boolean;
}

export interface DistillOutput {
  facts: string[];
  decisions: string[];
  entities: string[];
  patterns: string[];
  unresolved: string[];
  publishCandidates: string[];
  /** true when LLM refinement was applied */
  llmRefined?: boolean;
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
  /「([^「」\n]{2,20})」/g,
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

const ENTITY_STOPWORDS = new Set([
  "action",
  "agent",
  "array",
  "assistant",
  "boolean",
  "config",
  "content",
  "context",
  "data",
  "date",
  "entity",
  "entities",
  "error",
  "event",
  "false",
  "function",
  "info",
  "none",
  "number",
  "object",
  "option",
  "options",
  "param",
  "params",
  "pattern",
  "patterns",
  "promise",
  "props",
  "result",
  "state",
  "string",
  "system",
  "true",
  "type",
  "types",
  "unresolved",
  "user",
  "记录",
  "模式",
  "策略",
  "方案",
  "问题",
  "建议",
  "注意"
]);

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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDecision(value: string): string {
  return normalizeText(value)
    .replace(/^[`"'“”‘’*#>\-:\s]+|[`"'“”‘’*#>\-:\s]+$/g, "")
    .trim();
}

function normalizeEntity(value: string): string {
  return normalizeText(value).replace(/^[`"'“”‘’「」]+|[`"'“”‘’「」]+$/g, "");
}

function isLikelyUsefulDecision(value: string): boolean {
  const normalized = normalizeDecision(value);
  if (normalized.length < 12 || normalized.length > 200) return false;
  if (/[：:]$/.test(normalized)) return false;
  if (!/[\p{Script=Han}A-Za-z]/u.test(normalized)) return false;
  if (/^[A-Za-z0-9./_-]+$/.test(normalized)) return false;
  if (/^[A-Za-z0-9./_-]+\s+[A-Za-z0-9./_-]+$/.test(normalized)) return false;
  if (/^(scope|depth|context|strategy|option|pattern)\b[\s/&-]*(scope|depth|context|strategy)?[:：]?$/i.test(normalized)) {
    return false;
  }

  let signal = 0;
  if (/[\p{Script=Han}]/u.test(normalized)) signal += 1;
  if (
    /\b(use|using|adopt|adopting|switch|switching|migrate|migrating|keep|keeping|remove|removing|replace|replacing)\b/i.test(
      normalized
    ) ||
    /(采用|选择|改为|迁移|保留|移除|替换|使用)/.test(normalized)
  ) {
    signal += 1;
  }
  if (/\b[A-Z]{2,}\b|[A-Z][a-zA-Z]+(?:Service|Client|Handler|Manager|Controller|Adapter|Repository|Model|Store)?|[a-z]+[_-][a-z0-9_-]+/.test(normalized)) {
    signal += 1;
  }
  if (normalized.includes(" ")) signal += 1;
  if (/[，。；;]/.test(normalized)) signal += 1;

  return signal >= 2;
}

function isLikelyEntity(value: string): boolean {
  const normalized = normalizeEntity(value);
  if (normalized.length < 3 || normalized.length > 40) return false;
  if (/^[\s\p{P}]+$/u.test(normalized)) return false;
  if (/[`#*<>[\]{}]/.test(normalized)) return false;
  if (/^(no memories found|auto-distilled from session)$/i.test(normalized)) return false;
  if (/(你应该|这些时机|请使用|need to|should use)/i.test(normalized)) return false;
  if (ENTITY_STOPWORDS.has(normalized.toLowerCase())) return false;

  const hasHan = /[\p{Script=Han}]/u.test(normalized);
  if (hasHan) {
    if (/[：。！？?]/u.test(normalized)) return false;
    if (/\s/u.test(normalized)) return false;
    return /[\p{Script=Han}]{2,}/u.test(normalized);
  }

  return /^[A-Za-z][A-Za-z0-9_-]{2,30}$/.test(normalized);
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/[。！？\n.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && s.length < 300);
}

// ---------------------------------------------------------------------------
// LLM Refinement
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT = `You are a memory extraction assistant. You receive a pre-extracted set of memory items (facts, decisions, entities, patterns, unresolved) from a conversation. Your job is to:
1. Remove noise, duplicates, and low-quality entries.
2. Rewrite entries for clarity and conciseness (max 200 chars each).
3. Add any high-signal items the heuristic tier may have missed.
4. Return ONLY a valid JSON object matching this schema:
{
  "facts": ["..."],
  "decisions": ["..."],
  "entities": ["..."],
  "patterns": ["..."],
  "unresolved": ["..."]
}
Do not include any explanation or markdown fences — pure JSON only.`;

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
}

async function callLLM(
  cfg: DistillLLMConfig,
  heuristic: DistillOutput
): Promise<Partial<DistillOutput> | null> {
  const userContent = JSON.stringify(
    {
      facts: heuristic.facts,
      decisions: heuristic.decisions,
      entities: heuristic.entities,
      patterns: heuristic.patterns,
      unresolved: heuristic.unresolved
    },
    null,
    2
  );

  const messages: LLMMessage[] = [
    { role: "system", content: LLM_SYSTEM_PROMPT },
    { role: "user", content: userContent }
  ];

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    cfg.timeoutMs ?? 15_000
  );

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: cfg.maxTokens ?? 800,
        temperature: 0.2
      }),
      signal: controller.signal
    });

    if (!res.ok) return null;

    const data = (await res.json()) as LLMResponse;
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip optional markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as Partial<DistillOutput>;
    return parsed;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mergeWithHeuristic(
  heuristic: DistillOutput,
  refined: Partial<DistillOutput>
): DistillOutput {
  const dedup = (arr: string[] | undefined): string[] => [...new Set(arr ?? [])];
  return {
    facts: dedup(refined.facts).slice(0, 10),
    decisions: dedup(refined.decisions).slice(0, 10),
    entities: dedup(refined.entities).slice(0, 20),
    patterns: dedup(refined.patterns).slice(0, 5),
    unresolved: dedup(refined.unresolved).slice(0, 5),
    publishCandidates: [
      ...dedup(refined.decisions ?? heuristic.decisions).slice(0, 2),
      ...dedup(refined.unresolved ?? heuristic.unresolved).slice(0, 2)
    ],
    llmRefined: true
  };
}

// ---------------------------------------------------------------------------
// DistillService
// ---------------------------------------------------------------------------

export class DistillService {
  constructor(private readonly llmCfg?: DistillLLMConfig) {}

  async distillAsync(input: DistillInput): Promise<DistillOutput> {
    const heuristic = this.distill(input);
    if (!input.llm || !this.llmCfg) return heuristic;

    const refined = await callLLM(this.llmCfg, heuristic);
    if (!refined) return heuristic; // graceful fallback

    return mergeWithHeuristic(heuristic, refined);
  }

  distill(input: DistillInput): DistillOutput {
    const assistantMessages = input.messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content);
    const cleanedMessages = assistantMessages
      .map((text) =>
        text.replace(/<!-- memory-fabric:begin -->[\s\S]*?<!-- memory-fabric:end -->/g, "").trim()
      )
      .filter((text) => text.length > 0);

    const facts: string[] = [];
    const decisions: string[] = [];
    const entities: string[] = [];
    const patterns: string[] = [];
    const unresolved: string[] = [];

    for (const text of cleanedMessages) {
      for (const sentence of splitIntoSentences(text)) {
        const decision = extractFirst(sentence, DECISION_PATTERNS);
        if (decision && isLikelyUsefulDecision(decision)) {
          decisions.push(normalizeDecision(decision));
        }

        const fact = extractFirst(sentence, FACT_PATTERNS);
        if (fact) facts.push(fact);

        const pattern = extractFirst(sentence, PATTERN_MARKERS);
        if (pattern) patterns.push(pattern);

        const open = extractFirst(sentence, UNRESOLVED_MARKERS);
        if (open) unresolved.push(open);
      }

      // Entity extraction runs on full message text
      extractAllGlobal(text, ENTITY_PATTERNS)
        .map((e) => normalizeEntity(e))
        .filter((e) => isLikelyEntity(e))
        .forEach((e) => entities.push(e));
    }

    // Deduplicate preserving insertion order
    const dedup = (arr: string[]): string[] => [...new Set(arr)];

    const cleanFacts = dedup(facts).slice(0, 10);
    const cleanDecisions = dedup(decisions).slice(0, 10);
    const cleanEntities = dedup(entities).slice(0, 20);
    const cleanPatterns = dedup(patterns).slice(0, 5);
    const cleanUnresolved = dedup(unresolved).slice(0, 5);

    // ---------------------------------------------------------------------------
// Quality scoring for promote candidates
// ---------------------------------------------------------------------------

function scoreFactQuality(fact: string): number {
  let score = 0;
  // Length: not too short, not too long
  if (fact.length >= 15 && fact.length <= 150) score += 2;
  else if (fact.length >= 10) score += 1;
  // Contains specific technical terms
  if (/\b(Service|Client|Handler|Manager|Controller|Adapter|Repository|Model|Store|API|DB|Config|Plugin|Module)\b/.test(fact)) score += 2;
  // Contains action verbs
  if (/\b(use|using|adopt|switch|migrate|replace|update|fix|add|remove|configure|deploy)\b/i.test(fact)) score += 1;
  // Contains Chinese technical terms
  if (/[\u4e00-\u9fa5]/.test(fact) && /[\u4e00-\u9fa5]{2,}/.test(fact)) score += 1;
  // Not generic boilerplate
  if (/^(the|a|an|this|that|it|there)\s/i.test(fact)) score -= 1;
  if (/system|application|software/i.test(fact) && !/\b[A-Z][a-zA-Z]+\b/.test(fact)) score -= 1;
  return Math.max(0, score);
}

function scorePatternQuality(pattern: string): number {
  let score = 0;
  if (pattern.length >= 20 && pattern.length <= 150) score += 2;
  // Contains conditional markers
  if (/\b(when|if|always|never|should|must|avoid|prefer)\b/i.test(pattern)) score += 2;
  if (/\b(每次|当|如果|总是|从不|应该|必须|避免|优先)\b/.test(pattern)) score += 2;
  // Contains specific actions
  if (/\b(use|call|invoke|pass|return|set|get|check|validate)\b/i.test(pattern)) score += 1;
  return Math.max(0, score);
}

// High-value items bubble up as publish candidates (decisions + unresolved + quality facts/patterns)
    const scoredFacts = cleanFacts
      .map((f) => ({ fact: f, score: scoreFactQuality(f) }))
      .filter((item) => item.score >= 3)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.fact);
    
    const scoredPatterns = cleanPatterns
      .map((p) => ({ pattern: p, score: scorePatternQuality(p) }))
      .filter((item) => item.score >= 3)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.pattern);

    const publishCandidates = [
      ...cleanDecisions.slice(0, 2), 
      ...cleanUnresolved.slice(0, 2),
      ...scoredFacts.slice(0, 2),
      ...scoredPatterns.slice(0, 1)
    ];

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
