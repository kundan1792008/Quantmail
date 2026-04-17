/**
 * ToneAdapter
 *
 * Detects the dominant tone of an email draft and adapts completion suggestions
 * to match that tone.  It also provides recipient-aware tone overrides and
 * template detection (meeting invites, follow-ups, apologies, etc.).
 *
 * Tone taxonomy
 * ─────────────
 *   formal      – Professional business communication; complete sentences,
 *                 no contractions, respectful salutations.
 *   casual      – Friendly / peer-level communication; contractions OK,
 *                 informal openers ("Hey", "Hi").
 *   urgent      – Time-sensitive message; short sentences, action-oriented,
 *                 emphasis on deadlines.
 *   apologetic  – Expressing regret or correcting a mistake; empathetic phrasing,
 *                 accountability language.
 *   neutral     – Default / no strong signal detected.
 *
 * Detection pipeline
 * ──────────────────
 *  1. Heuristic keyword/phrase analysis (fast, no LLM call needed).
 *  2. Recipient relationship override (manager → formal, friend → casual).
 *  3. Template matching (meeting invite, follow-up, status update, etc.).
 */

import type { EmailTone, RecipientInfo } from "./SmartComposeEngine";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Result of tone detection. */
export interface ToneDetectionResult {
  /** Primary detected tone. */
  tone: EmailTone;
  /** Secondary tone signal (may equal primary). */
  secondaryTone: EmailTone;
  /**
   * Confidence in the primary tone detection, [0, 1].
   */
  confidence: number;
  /**
   * Which detection method produced the result:
   *   "heuristic" – keyword/pattern analysis
   *   "recipient"  – recipient relationship override
   *   "template"   – template type matched
   */
  method: "heuristic" | "recipient" | "template";
  /**
   * Detected template type, if any.
   */
  templateType?: EmailTemplate;
}

/** Known email template archetypes. */
export type EmailTemplate =
  | "meeting-invite"
  | "follow-up"
  | "status-update"
  | "introduction"
  | "apology"
  | "thank-you"
  | "request"
  | "announcement"
  | "none";

/** Tone-adapted completion suggestion. */
export interface AdaptedSuggestion {
  /** Original text before adaptation. */
  original: string;
  /** Text after tone adaptation. */
  adapted: string;
  /** Tone applied during adaptation. */
  appliedTone: EmailTone;
}

/** Configuration options for the ToneAdapter. */
export interface ToneAdapterConfig {
  /**
   * When true, the recipient relationship overrides the heuristic result if
   * the relationship clearly implies a tone (default: true).
   */
  enableRecipientOverride?: boolean;
  /**
   * When true, a detected template type forces a specific tone (default: true).
   */
  enableTemplateOverride?: boolean;
}

// ─── Internal Signal Tables ───────────────────────────────────────────────────

/** Keywords / phrases that are strong signals for each tone. */
const TONE_SIGNALS: Record<EmailTone, RegExp[]> = {
  formal: [
    /\bdear\s+\w/i,
    /\bsincerely\b/i,
    /\bkind\s+regards\b/i,
    /\bwith\s+respect\b/i,
    /\bplease\s+find\s+attached\b/i,
    /\bherewith\b/i,
    /\bfurthermore\b/i,
    /\bthereafter\b/i,
    /\bnotwithstanding\b/i,
    /\bpursuant\s+to\b/i,
    /\benclosed\s+please\b/i,
    /\bplease\s+do\s+not\s+hesitate\b/i,
    /\bshould\s+you\s+require\b/i,
    /\bwould\s+appreciate\b/i,
  ],
  casual: [
    /\bhey\b/i,
    /\bhi\s+there\b/i,
    /\bwhat'?s\s+up\b/i,
    /\bno\s+worries\b/i,
    /\bcheers\b/i,
    /\bawesome\b/i,
    /\bcool\b/i,
    /\bcan't\b/i,
    /\bdon't\b/i,
    /\bwon't\b/i,
    /\bI'?m\b/i,
    /\bwe'?re\b/i,
    /\bthanks\s*!\s*$/im,
    /\blmk\b/i,
    /\basap\b/i,
  ],
  urgent: [
    /\burgent\b/i,
    /\bimmediately\b/i,
    /\bASAP\b/,
    /\btime[- ]sensitive\b/i,
    /\bdeadline\b/i,
    /\bcritical\b/i,
    /\boverdue\b/i,
    /\bblocking\b/i,
    /\bby\s+end\s+of\s+day\b/i,
    /\bEOD\b/,
    /\bCOB\b/,
    /\bby\s+today\b/i,
    /\bby\s+tomorrow\b/i,
    /\bneed\s+this\s+now\b/i,
    /\bstopped\s+working\b/i,
    /\bdown\b.*\bproduction\b/i,
    /\boutage\b/i,
  ],
  apologetic: [
    /\bsorry\b/i,
    /\bapologize\b/i,
    /\bapologies\b/i,
    /\bmy\s+fault\b/i,
    /\bmy\s+mistake\b/i,
    /\bI\s+should\s+have\b/i,
    /\bplease\s+forgive\b/i,
    /\bdeep\s+regret\b/i,
    /\bunfortunately\b/i,
    /\bI\s+take\s+full\s+responsibility\b/i,
    /\bmissed\b.*\bmeeting\b/i,
    /\boverlooked\b/i,
    /\bfailed\s+to\b/i,
    /\bbeg\s+your\s+pardon\b/i,
  ],
  neutral: [],
};

/** Templates and their canonical tone + detection patterns. */
const TEMPLATE_PATTERNS: Array<{
  type: EmailTemplate;
  tone: EmailTone;
  patterns: RegExp[];
}> = [
  {
    type: "meeting-invite",
    tone: "formal",
    patterns: [
      /\bmeeting\b.*\bschedule\b/i,
      /\bschedule\s+a\s+(call|meeting|sync)\b/i,
      /\bcalendar\s+invite\b/i,
      /\bavailability\b.*\bmeeting\b/i,
      /\bwould\s+you\s+be\s+available\b/i,
    ],
  },
  {
    type: "follow-up",
    tone: "neutral",
    patterns: [
      /\bfollowing\s+up\b/i,
      /\bjust\s+checking\s+in\b/i,
      /\bcircling\s+back\b/i,
      /\bany\s+update\b/i,
      /\bwanted\s+to\s+check\b/i,
    ],
  },
  {
    type: "status-update",
    tone: "neutral",
    patterns: [
      /\bstatus\s+update\b/i,
      /\bprogress\s+report\b/i,
      /\bweekly\s+update\b/i,
      /\bhere'?s\s+an\s+update\b/i,
      /\bas\s+of\s+today\b/i,
    ],
  },
  {
    type: "introduction",
    tone: "formal",
    patterns: [
      /\blet\s+me\s+introduce\b/i,
      /\bi'?m\s+(writing|reaching\s+out)\b/i,
      /\bplease\s+meet\b/i,
      /\bi\s+wanted\s+to\s+introduce\b/i,
    ],
  },
  {
    type: "apology",
    tone: "apologetic",
    patterns: [
      /\bsincerely\s+apologize\b/i,
      /\bdeepest\s+apologies\b/i,
      /\bI\s+am\s+sorry\b/i,
      /\bplease\s+accept\s+my\s+apolog/i,
    ],
  },
  {
    type: "thank-you",
    tone: "formal",
    patterns: [
      /\bthank\s+you\s+so\s+much\b/i,
      /\bI\s+really\s+appreciate\b/i,
      /\bgrateful\s+for\s+your\b/i,
    ],
  },
  {
    type: "request",
    tone: "formal",
    patterns: [
      /\bwould\s+(you\s+)?kindly\b/i,
      /\bI\s+am\s+writing\s+to\s+request\b/i,
      /\bplease\s+provide\b/i,
      /\brequesting\s+your\s+(help|assistance|support)\b/i,
    ],
  },
  {
    type: "announcement",
    tone: "formal",
    patterns: [
      /\bplease\s+be\s+advised\b/i,
      /\bwe\s+are\s+pleased\s+to\s+announce\b/i,
      /\beffective\s+immediately\b/i,
      /\bimportant\s+announcement\b/i,
    ],
  },
];

/** Maps recipient relationship to a preferred tone. */
const RELATIONSHIP_TONE_MAP: Record<NonNullable<RecipientInfo["relationship"]>, EmailTone> = {
  manager: "formal",
  client: "formal",
  colleague: "neutral",
  friend: "casual",
  unknown: "neutral",
};

// ─── Detection Helpers ────────────────────────────────────────────────────────

/** Counts the number of pattern matches for a given tone in the text. */
function countSignals(text: string, tone: EmailTone): number {
  return TONE_SIGNALS[tone].reduce(
    (acc, pattern) => acc + (pattern.test(text) ? 1 : 0),
    0
  );
}

/** Detects the template type by scanning subject + body for known patterns. */
function detectTemplate(subject: string, body: string): EmailTemplate {
  const combined = `${subject}\n${body}`;
  for (const { type, patterns } of TEMPLATE_PATTERNS) {
    if (patterns.some((p) => p.test(combined))) {
      return type;
    }
  }
  return "none";
}

// ─── Core Detection Function ──────────────────────────────────────────────────

/**
 * Detects the dominant tone of the current email draft.
 *
 * @param subject   Email subject line.
 * @param body      Draft body (partial or complete).
 * @param recipient Recipient information (used for relationship override).
 * @param config    Optional configuration.
 */
export function detectTone(
  subject: string,
  body: string,
  recipient: RecipientInfo,
  config: ToneAdapterConfig = {}
): ToneDetectionResult {
  const enableRecipientOverride = config.enableRecipientOverride ?? true;
  const enableTemplateOverride = config.enableTemplateOverride ?? true;
  const combined = `${subject}\n${body}`;

  // Step 1: Recipient relationship override (highest priority).
  if (enableRecipientOverride && recipient.relationship) {
    const overrideTone = RELATIONSHIP_TONE_MAP[recipient.relationship];
    if (overrideTone !== "neutral") {
      return {
        tone: overrideTone,
        secondaryTone: detectHeuristicTone(combined).tone,
        confidence: 0.85,
        method: "recipient",
      };
    }
  }

  // Step 2: Template detection (second priority).
  if (enableTemplateOverride) {
    const templateType = detectTemplate(subject, body);
    if (templateType !== "none") {
      const templateDef = TEMPLATE_PATTERNS.find((t) => t.type === templateType);
      if (templateDef) {
        return {
          tone: templateDef.tone,
          secondaryTone: detectHeuristicTone(combined).tone,
          confidence: 0.78,
          method: "template",
          templateType,
        };
      }
    }
  }

  // Step 3: Heuristic signal analysis.
  return { ...detectHeuristicTone(combined), method: "heuristic" };
}

/**
 * Pure keyword-based tone detection — no recipient or template context.
 */
function detectHeuristicTone(text: string): Omit<ToneDetectionResult, "method"> {
  const scores: Record<EmailTone, number> = {
    formal: countSignals(text, "formal"),
    casual: countSignals(text, "casual"),
    urgent: countSignals(text, "urgent"),
    apologetic: countSignals(text, "apologetic"),
    neutral: 0,
  };

  const maxScore = Math.max(...(Object.values(scores) as number[]));

  if (maxScore === 0) {
    return { tone: "neutral", secondaryTone: "neutral", confidence: 0.5 };
  }

  // Sort by descending score to pick primary and secondary.
  const ranked = (Object.entries(scores) as [EmailTone, number][])
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a);

  const primaryTone = ranked[0]![0];
  const secondaryTone = ranked[1]?.[0] ?? primaryTone;
  const totalSignals = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = parseFloat((maxScore / totalSignals).toFixed(2));

  return { tone: primaryTone, secondaryTone, confidence };
}

// ─── Tone Adaptation ──────────────────────────────────────────────────────────

/**
 * Word-level adaptation tables used to shift completions between tones.
 * Entries are [pattern, formal replacement, casual replacement].
 */
const FORMAL_TO_CASUAL: [RegExp, string][] = [
  [/\bI am\b/g, "I'm"],
  [/\bI have\b/g, "I've"],
  [/\bI will\b/g, "I'll"],
  [/\bI would\b/g, "I'd"],
  [/\bwe are\b/g, "we're"],
  [/\bwe have\b/g, "we've"],
  [/\bcannot\b/g, "can't"],
  [/\bdo not\b/g, "don't"],
  [/\bwill not\b/g, "won't"],
  [/\bshould not\b/g, "shouldn't"],
  [/\bplease find attached\b/gi, "here's"],
  [/\bKind regards\b/g, "Thanks"],
  [/\bBest regards\b/g, "Cheers"],
  [/\bDear\s+/g, "Hi "],
];

const CASUAL_TO_FORMAL: [RegExp, string][] = [
  [/\bI'm\b/g, "I am"],
  [/\bI've\b/g, "I have"],
  [/\bI'll\b/g, "I will"],
  [/\bI'd\b/g, "I would"],
  [/\bwe're\b/g, "we are"],
  [/\bwe've\b/g, "we have"],
  [/\bcan't\b/g, "cannot"],
  [/\bdon't\b/g, "do not"],
  [/\bwon't\b/g, "will not"],
  [/\bshouldn't\b/g, "should not"],
  [/\bhey\b/gi, "Dear"],
  [/\bThanks\b/g, "Kind regards"],
  [/\bCheers\b/g, "Best regards"],
  [/\basap\b/gi, "as soon as possible"],
  [/\blmk\b/gi, "please let me know"],
  [/\bbtw\b/gi, "by the way"],
];

const URGENT_MARKERS: string[] = [
  "Please respond at your earliest convenience",
  "This is time-sensitive",
  "Your prompt attention is greatly appreciated",
];

const APOLOGETIC_OPENERS: string[] = [
  "I sincerely apologize for the delay",
  "My apologies for any inconvenience caused",
  "I take full responsibility for this oversight",
];

/**
 * Adapts a completion suggestion text to the target tone by performing
 * lightweight lexical substitutions.
 *
 * @param text       Raw completion text from the LLM.
 * @param sourceTone Tone of the current draft (detected by `detectTone`).
 * @param targetTone Desired output tone (usually same as sourceTone;
 *                   override here to force a different register).
 */
export function adaptCompletionToTone(
  text: string,
  sourceTone: EmailTone,
  targetTone: EmailTone
): AdaptedSuggestion {
  if (sourceTone === targetTone) {
    return { original: text, adapted: text, appliedTone: targetTone };
  }

  let adapted = text;

  if (targetTone === "casual") {
    for (const [pattern, replacement] of FORMAL_TO_CASUAL) {
      adapted = adapted.replace(pattern, replacement);
    }
  } else if (targetTone === "formal") {
    for (const [pattern, replacement] of CASUAL_TO_FORMAL) {
      adapted = adapted.replace(pattern, replacement);
    }
  } else if (targetTone === "urgent") {
    // Append urgency marker if not already present.
    const hasUrgencyKeyword = /urgent|immediately|ASAP|deadline/i.test(adapted);
    if (!hasUrgencyKeyword) {
      const marker = URGENT_MARKERS[Math.floor(Math.random() * URGENT_MARKERS.length)]!;
      adapted = adapted.trimEnd() + `. ${marker}.`;
    }
  } else if (targetTone === "apologetic") {
    // Prepend an apology phrase if none is present.
    const hasApology = /apolog|sorry|regret/i.test(adapted);
    if (!hasApology) {
      const opener =
        APOLOGETIC_OPENERS[Math.floor(Math.random() * APOLOGETIC_OPENERS.length)]!;
      adapted = `${opener} — ${adapted.charAt(0).toLowerCase()}${adapted.slice(1)}`;
    }
  }

  return { original: text, adapted, appliedTone: targetTone };
}

// ─── Template Suggestion Helpers ─────────────────────────────────────────────

/** Standard structural suggestions keyed by template type. */
const TEMPLATE_STRUCTURES: Record<EmailTemplate, string[]> = {
  "meeting-invite": [
    "I'd like to schedule a brief meeting to discuss",
    "Would you be available for a 30-minute call on",
    "Please find a calendar invite attached for our sync on",
  ],
  "follow-up": [
    "I wanted to follow up on my previous email regarding",
    "Just checking in to see if you had a chance to review",
    "Circling back on this — any updates you could share would be helpful.",
  ],
  "status-update": [
    "Here is a quick status update on",
    "As of today, we have completed",
    "The current progress is on track:",
  ],
  introduction: [
    "I am reaching out to introduce myself —",
    "My name is [Your Name] and I am",
    "I wanted to take a moment to introduce you to",
  ],
  apology: [
    "I sincerely apologize for the inconvenience caused by",
    "Please accept my deepest apologies for",
    "I take full responsibility for this oversight and will ensure",
  ],
  "thank-you": [
    "Thank you so much for your time and assistance with",
    "I truly appreciate your support regarding",
    "I am grateful for the effort you put into",
  ],
  request: [
    "I am writing to kindly request your assistance with",
    "Would it be possible for you to",
    "I would greatly appreciate it if you could",
  ],
  announcement: [
    "We are pleased to announce that",
    "Please be advised that effective",
    "I am excited to share that",
  ],
  none: [],
};

/**
 * Returns template-based structural suggestions when a known template type
 * is detected.  These are pre-written, not LLM-generated, so they are fast.
 *
 * @param template Detected template type.
 * @param tone     Tone to apply to the suggestions.
 */
export function getTemplateSuggestions(
  template: EmailTemplate,
  tone: EmailTone
): AdaptedSuggestion[] {
  const suggestions = TEMPLATE_STRUCTURES[template];
  if (!suggestions || suggestions.length === 0) return [];

  return suggestions.map((raw) => adaptCompletionToTone(raw, "formal", tone));
}

/**
 * Builds a human-readable tone label string for display in the UI
 * (e.g. "Formal 85%").
 */
export function formatToneLabel(result: ToneDetectionResult): string {
  const pct = Math.round(result.confidence * 100);
  const label = result.tone.charAt(0).toUpperCase() + result.tone.slice(1);
  return `${label} ${pct}%`;
}

/**
 * Returns a short emoji indicator for the detected tone – useful for UI badges.
 */
export function toneEmoji(tone: EmailTone): string {
  const map: Record<EmailTone, string> = {
    formal: "🤝",
    casual: "😊",
    urgent: "⚡",
    apologetic: "🙏",
    neutral: "📝",
  };
  return map[tone];
}
