/**
 * AuthorityModel
 *
 * Analyzes a draft for language patterns that can reduce perceived confidence:
 * passive voice, uncertain qualifiers, and weak structural framing.
 */

export type AuthoritySignalType =
  | "passive-voice"
  | "uncertain-language"
  | "weak-structure";

export interface AuthoritySignal {
  type: AuthoritySignalType;
  phrase: string;
  start: number;
  end: number;
  severity: number; // 1 (low) to 5 (high)
  recommendation: string;
}

export interface AuthorityAnalysis {
  score: number; // 0..100
  executiveAlignment: number; // 0..1
  signals: AuthoritySignal[];
  summary: string;
}

const PASSIVE_PATTERNS: Array<{ pattern: RegExp; recommendation: string }> = [
  {
    pattern:
      /\b(is|are|was|were|be|been|being)\s+((\w{4,}(ed|en))|known|given|seen|made|taken|built|held|sent)\b/gi,
    recommendation: "Prefer active framing with a clear owner and action.",
  },
];

const UNCERTAIN_PATTERNS: Array<{ pattern: RegExp; recommendation: string }> = [
  { pattern: /\bI think\b/gi, recommendation: "Replace with direct ownership language." },
  { pattern: /\bjust\b/gi, recommendation: "Remove minimizing qualifiers when unnecessary." },
  { pattern: /\bmaybe\b/gi, recommendation: "Use a concrete recommendation or plan." },
  { pattern: /\bperhaps\b/gi, recommendation: "Use a clear decision statement." },
  { pattern: /\bkind of\b/gi, recommendation: "Use specific, measurable wording." },
  { pattern: /\bmight\b/gi, recommendation: "Use a timeline or explicit next step." },
];

const EXECUTIVE_PATTERNS: RegExp[] = [
  /\bI will\b/i,
  /\bI recommend\b/i,
  /\bnext steps\b/i,
  /\bby\s+(EOD|end of day|tomorrow|[A-Z][a-z]+\s+\d{1,2})\b/i,
  /\bowner\b/i,
  /\bdecision\b/i,
  /\bdeliverable\b/i,
];

const MAX_RECOMMENDED_WORDS_PER_SENTENCE = 35;
const SEVERITY_PENALTY_MULTIPLIER = 4;
const PASSIVE_FALSE_POSITIVE_PATTERNS: RegExp[] = [
  /\bis known for\b/i,
  /\bare known for\b/i,
  /\bis given the opportunity\b/i,
  /\bare given the opportunity\b/i,
];

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

function collectPatternSignals(
  text: string,
  type: AuthoritySignalType,
  patterns: Array<{ pattern: RegExp; recommendation: string }>,
  severity: number
): AuthoritySignal[] {
  const out: AuthoritySignal[] = [];

  for (const entry of patterns) {
    entry.pattern.lastIndex = 0;
    let match = entry.pattern.exec(text);
    while (match) {
      if (match[0].length === 0) {
        entry.pattern.lastIndex += 1;
        match = entry.pattern.exec(text);
        continue;
      }
      if (type === "passive-voice") {
        const contextWindow = text.slice(
          Math.max(0, match.index - 8),
          Math.min(text.length, match.index + match[0].length + 24)
        );
        if (PASSIVE_FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(contextWindow))) {
          match = entry.pattern.exec(text);
          continue;
        }
      }
      out.push({
        type,
        phrase: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity,
        recommendation: entry.recommendation,
      });
      match = entry.pattern.exec(text);
    }
  }

  return out;
}

function detectWeakStructure(text: string): AuthoritySignal[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [
      {
        type: "weak-structure",
        phrase: "",
        start: 0,
        end: 0,
        severity: 5,
        recommendation:
          "Add a clear opener that states intent, decision, or requested action.",
      },
    ];
  }

  const signals: AuthoritySignal[] = [];
  const sentenceChunks = trimmed.split(/[.!?]\s+/).filter((x) => x.trim().length > 0);

  if (sentenceChunks.length > 0) {
    const longest = sentenceChunks.reduce((a, b) => (a.length >= b.length ? a : b));
    const wordCount = longest.trim().split(/\s+/).length;
    if (wordCount > MAX_RECOMMENDED_WORDS_PER_SENTENCE) {
      const start = text.indexOf(longest);
      signals.push({
        type: "weak-structure",
        phrase: longest.trim(),
        start: start >= 0 ? start : 0,
        end: start >= 0 ? start + longest.length : longest.length,
        severity: 3,
        recommendation:
          "Split long sentences and surface key decision or ask earlier.",
      });
    }
  }

  const hasActionPhrase =
    /\b(please|next steps|I will|we will|action|decision|approve|confirm)\b/i.test(trimmed);
  if (!hasActionPhrase) {
    signals.push({
      type: "weak-structure",
      phrase: trimmed.slice(Math.max(0, trimmed.length - 60)),
      start: Math.max(0, text.length - 60),
      end: text.length,
      severity: 2,
      recommendation:
        "End with an explicit action request, owner, or next-step commitment.",
    });
  }

  return signals;
}

function scoreExecutiveAlignment(text: string): number {
  const hitCount = EXECUTIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  return clamp(hitCount / EXECUTIVE_PATTERNS.length, 0, 1);
}

export function analyzeAuthority(text: string): AuthorityAnalysis {
  const passiveSignals = collectPatternSignals(text, "passive-voice", PASSIVE_PATTERNS, 3);
  const uncertainSignals = collectPatternSignals(
    text,
    "uncertain-language",
    UNCERTAIN_PATTERNS,
    2
  );
  const weakStructureSignals = detectWeakStructure(text);

  const signals = [...passiveSignals, ...uncertainSignals, ...weakStructureSignals].sort(
    (a, b) => a.start - b.start
  );

  const penalty = signals.reduce(
    (sum, signal) => sum + signal.severity * SEVERITY_PENALTY_MULTIPLIER,
    0
  );
  const executiveAlignment = scoreExecutiveAlignment(text);
  const score = clamp(Math.round(100 - penalty + executiveAlignment * 20), 0, 100);

  const summary =
    signals.length === 0
      ? "Draft is direct and structurally clear."
      : `Detected ${signals.length} authority signal(s): ${passiveSignals.length} passive, ${uncertainSignals.length} uncertain, ${weakStructureSignals.length} structural.`;

  return { score, executiveAlignment, signals, summary };
}
