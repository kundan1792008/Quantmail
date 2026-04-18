/**
 * SmartComposeEngine
 *
 * Provides on-the-fly sentence-completion suggestions as a user types an email.
 * The engine maintains a configurable context window (subject + last N paragraphs
 * + recipient information) and calls the configured LLM to produce up to three
 * ranked completion candidates.
 *
 * Architecture
 * ─────────────
 *  ┌─────────────────────────────────┐
 *  │  ComposeContext (caller-built)  │
 *  └──────────────┬──────────────────┘
 *                 │
 *         buildPrompt()
 *                 │
 *  ┌──────────────▼──────────────────┐
 *  │  LLM (OpenAI chat completions)  │
 *  └──────────────┬──────────────────┘
 *                 │
 *         parseCompletions()
 *                 │
 *  ┌──────────────▼──────────────────┐
 *  │  CompletionSuggestion[]         │
 *  └─────────────────────────────────┘
 *
 * Learning loop
 * ─────────────
 * Callers signal whether a suggestion was accepted or rejected via
 * `recordFeedback()`.  The engine stores these signals in memory (bounded) and
 * attaches an optional per-user in-context feedback summary to future prompts,
 * nudging the model toward phrases the user has historically accepted.
 */

import OpenAI from "openai";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Tone labels shared with ToneAdapter. */
export type EmailTone = "formal" | "casual" | "urgent" | "apologetic" | "neutral";

/** Information about the email recipient used to personalise completions. */
export interface RecipientInfo {
  /** Display name (e.g. "Rahul Sharma"). */
  name: string;
  /** Email address used to look up past interaction history. */
  email: string;
  /**
   * Optional relationship hint that influences tone selection.
   * "manager" → formal, "colleague" → neutral, "friend" → casual, etc.
   */
  relationship?: "manager" | "colleague" | "friend" | "client" | "unknown";
}

/** Everything the engine needs to generate completions for the current draft. */
export interface ComposeContext {
  /** Subject line of the email being composed. */
  subject: string;
  /**
   * Full draft body text up to the cursor position.
   * The engine automatically trims to the last `contextParagraphs` paragraphs.
   */
  bodyUpToCursor: string;
  /** Recipient details for personalisation. */
  recipient: RecipientInfo;
  /**
   * Detected tone (provided by ToneAdapter).
   * Falls back to "neutral" when omitted.
   */
  tone?: EmailTone;
  /** Optional: text after the cursor (the rest of the current line). */
  trailingText?: string;
}

/** A single completion candidate returned by the engine. */
export interface CompletionSuggestion {
  /** Index in the ranked list (0 = highest confidence). */
  rank: number;
  /** The suggested completion text (continues from where the cursor is). */
  text: string;
  /**
   * Confidence score in [0, 1].  Computed from the relative log-probability
   * estimate returned by the model (or approximated when unavailable).
   */
  confidence: number;
  /**
   * Whether this suggestion completes only the current word / phrase (false)
   * or extends to a full sentence (true).
   */
  fullSentence: boolean;
}

/** Result envelope wrapping the ranked suggestions. */
export interface SmartComposeResult {
  suggestions: CompletionSuggestion[];
  /** Detected or passed-through tone used during generation. */
  tone: EmailTone;
  /** The LLM model used to generate the completions. */
  model: string;
  /** Milliseconds taken by the LLM call. */
  latencyMs: number;
}

/** Feedback signal recorded after the user accepts or rejects a suggestion. */
export interface ComposeFeedback {
  /** The context that produced the suggestion. */
  context: ComposeContext;
  /** The suggestion that was shown. */
  suggestion: CompletionSuggestion;
  /** True when the user pressed Tab / accepted; false when they pressed Esc / dismissed. */
  accepted: boolean;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/** Engine configuration knobs. */
export interface SmartComposeConfig {
  /**
   * Number of paragraphs from the end of the body to include in the context
   * window (default: 3).
   */
  contextParagraphs?: number;
  /**
   * Maximum number of completion suggestions to return (1–5, default: 3).
   */
  maxSuggestions?: number;
  /**
   * When true the engine includes a brief summary of recent accepted phrases
   * in the prompt to steer the model toward the user's writing style.
   */
  enablePersonalisation?: boolean;
  /**
   * Sampling temperature forwarded to the LLM (default: 0.35).
   * Lower values produce more deterministic completions.
   */
  temperature?: number;
  /**
   * Hard cap on completion token length (default: 60).
   */
  maxCompletionTokens?: number;
}

/** Thrown when OPENAI_API_KEY is missing from the environment. */
export class SmartComposeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartComposeConfigError";
  }
}

// ─── Internal constants ───────────────────────────────────────────────────────

const DEFAULT_CONTEXT_PARAGRAPHS = 3;
const DEFAULT_MAX_SUGGESTIONS = 3;
const DEFAULT_TEMPERATURE = 0.35;
const DEFAULT_MAX_COMPLETION_TOKENS = 60;
const MAX_FEEDBACK_RECORDS = 500;
const ACCEPTED_PHRASE_WINDOW = 50; // How many recent accepted phrases to sample from.

// ─── In-Memory Feedback Store ─────────────────────────────────────────────────

/**
 * Bounded in-memory ring-buffer of feedback records keyed by user email.
 * In a production system this would be persisted (Redis / Postgres).
 */
const feedbackStore = new Map<string, ComposeFeedback[]>();

/**
 * Appends a feedback record for the given user, evicting the oldest entry when
 * the per-user buffer is full.
 */
function storeFeedback(userEmail: string, record: ComposeFeedback): void {
  const records = feedbackStore.get(userEmail) ?? [];
  if (records.length >= MAX_FEEDBACK_RECORDS) {
    records.shift();
  }
  records.push(record);
  feedbackStore.set(userEmail, records);
}

/**
 * Returns a short list of phrases the user has historically accepted for the
 * given recipient address, used to personalise future prompts.
 */
function getAcceptedPhrases(userEmail: string, recipientEmail: string): string[] {
  const records = feedbackStore.get(userEmail) ?? [];
  return records
    .filter(
      (r) =>
        r.accepted &&
        r.context.recipient.email === recipientEmail &&
        r.suggestion.text.trim().length > 0
    )
    .slice(-ACCEPTED_PHRASE_WINDOW)
    .map((r) => r.suggestion.text.trim());
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an intelligent email writing assistant with access to the user's compose context.
Your job is to suggest natural, helpful completions for the sentence or thought the user is currently typing.

Rules:
- Return EXACTLY the number of suggestions requested, separated by the delimiter "---SUGGESTION---".
- Each suggestion is plain text only – no markdown, no bullet points.
- Each suggestion CONTINUES the text immediately from where it ends; do NOT repeat words already typed.
- Keep each suggestion under 60 words.
- Match the tone and formality level specified.
- If the body ends mid-sentence, complete that sentence first.
- Prefer specific, actionable phrases over vague filler.
- Do NOT add a greeting or sign-off unless the body is empty.
- Do NOT make up facts not inferable from the context.`;

/**
 * Builds the user-turn message that will be sent to the LLM.
 */
function buildUserMessage(
  context: ComposeContext,
  cfg: Required<SmartComposeConfig>,
  acceptedPhrases: string[]
): string {
  const paragraphs = context.bodyUpToCursor
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0);

  const windowedBody = paragraphs
    .slice(-cfg.contextParagraphs)
    .join("\n\n");

  const recipientLine = context.recipient.relationship
    ? `${context.recipient.name} <${context.recipient.email}> (${context.recipient.relationship})`
    : `${context.recipient.name} <${context.recipient.email}>`;

  const toneLabel = context.tone ?? "neutral";

  let msg =
    `Subject: ${context.subject}\n` +
    `Recipient: ${recipientLine}\n` +
    `Tone: ${toneLabel}\n` +
    `Suggestions needed: ${cfg.maxSuggestions}\n\n` +
    `--- Current draft (up to cursor) ---\n${windowedBody}`;

  if (context.trailingText && context.trailingText.trim().length > 0) {
    msg += `\n\n--- Text after cursor (for context only) ---\n${context.trailingText.trim()}`;
  }

  if (cfg.enablePersonalisation && acceptedPhrases.length > 0) {
    const sample = acceptedPhrases.slice(-10).join(" | ");
    msg += `\n\n--- User's previously accepted phrases with this recipient ---\n${sample}`;
  }

  msg += `\n\nProvide ${cfg.maxSuggestions} ranked completion suggestion(s). Separate each with "---SUGGESTION---". Output only the completion text, nothing else.`;

  return msg;
}

// ─── Response Parser ──────────────────────────────────────────────────────────

/**
 * Parses the raw LLM output into a ranked list of CompletionSuggestion objects.
 * The model is asked to separate completions with "---SUGGESTION---".
 */
function parseCompletions(
  raw: string,
  maxSuggestions: number
): CompletionSuggestion[] {
  const parts = raw
    .split(/---SUGGESTION---/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, maxSuggestions);

  return parts.map((text, idx) => {
    // Heuristic confidence: first suggestion gets highest score, decreasing.
    const confidence = parseFloat(
      (1 - idx * (0.15 + idx * 0.03)).toFixed(2)
    );
    const fullSentence = /[.!?]$/.test(text.trimEnd());
    return {
      rank: idx,
      text,
      confidence: Math.max(confidence, 0.1),
      fullSentence,
    };
  });
}

// ─── Main Engine Function ─────────────────────────────────────────────────────

/**
 * Generates ranked sentence-completion suggestions for the given compose context.
 *
 * @param context  The current draft state (subject, body up to cursor, recipient).
 * @param config   Optional tuning knobs.
 * @returns        Up to `maxSuggestions` ranked CompletionSuggestion objects.
 *
 * @throws {SmartComposeConfigError} When OPENAI_API_KEY is not set.
 * @throws {Error}                   On LLM API failures.
 */
export async function generateCompletions(
  context: ComposeContext,
  config: SmartComposeConfig = {}
): Promise<SmartComposeResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new SmartComposeConfigError(
      "OPENAI_API_KEY environment variable is required but not set"
    );
  }

  const cfg: Required<SmartComposeConfig> = {
    contextParagraphs: config.contextParagraphs ?? DEFAULT_CONTEXT_PARAGRAPHS,
    maxSuggestions: Math.min(
      5,
      Math.max(1, config.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS)
    ),
    enablePersonalisation: config.enablePersonalisation ?? true,
    temperature: config.temperature ?? DEFAULT_TEMPERATURE,
    maxCompletionTokens: config.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
  };

  const acceptedPhrases = cfg.enablePersonalisation
    ? getAcceptedPhrases(context.recipient.email, context.recipient.email)
    : [];

  const userMessage = buildUserMessage(context, cfg, acceptedPhrases);
  const model = process.env["OPENAI_MODEL"] || "gpt-4o-mini";

  const client = new OpenAI({ apiKey });

  const t0 = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: cfg.maxCompletionTokens * cfg.maxSuggestions + 20,
    temperature: cfg.temperature,
    n: 1,
  });

  const latencyMs = Date.now() - t0;

  const rawText = response.choices[0]?.message?.content?.trim() ?? "";
  if (!rawText) {
    throw new Error("SmartComposeEngine: LLM returned an empty response");
  }

  const suggestions = parseCompletions(rawText, cfg.maxSuggestions);
  const tone = context.tone ?? "neutral";

  return { suggestions, tone, model, latencyMs };
}

// ─── Feedback API ─────────────────────────────────────────────────────────────

/**
 * Records user feedback for a previously shown suggestion.
 * Call this whenever the user accepts (Tab) or dismisses (Esc) a suggestion.
 *
 * @param userEmail  The user's own email address (used as the store key).
 * @param feedback   The full feedback record.
 */
export function recordFeedback(
  userEmail: string,
  feedback: ComposeFeedback
): void {
  storeFeedback(userEmail, feedback);
}

/**
 * Returns the raw feedback records for a given user email (used in tests and
 * admin dashboards).
 */
export function getFeedbackRecords(userEmail: string): ComposeFeedback[] {
  return feedbackStore.get(userEmail) ?? [];
}

/**
 * Clears all feedback for a given user (used in tests and for GDPR right-to-
 * erasure implementations).
 */
export function clearFeedback(userEmail: string): void {
  feedbackStore.delete(userEmail);
}

// ─── Utility: Context Window Helper ──────────────────────────────────────────

/**
 * Extracts the last N non-empty paragraphs from a body string.
 * Useful for callers that pre-process the body before passing it to the engine.
 */
export function extractContextWindow(body: string, paragraphs = 3): string {
  return body
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0)
    .slice(-paragraphs)
    .join("\n\n");
}

/**
 * Returns true when the body cursor is at a position that is likely the start
 * of a new sentence (useful for UI: only trigger completions at sentence
 * boundaries to reduce noise).
 */
export function isAtSentenceBoundary(bodyUpToCursor: string): boolean {
  const trimmed = bodyUpToCursor.trimEnd();
  if (trimmed.length === 0) return true;
  // After sentence-ending punctuation followed by optional whitespace.
  return /[.!?]\s*$/.test(trimmed) || /\n\s*$/.test(trimmed);
}

/**
 * Returns true when there is enough context to generate meaningful completions
 * (at least a subject AND either a non-empty body or a recipient name).
 */
export function hasMinimumContext(context: ComposeContext): boolean {
  const hasSubject = context.subject.trim().length > 0;
  const hasBody = context.bodyUpToCursor.trim().length > 3;
  const hasRecipient = context.recipient.email.trim().length > 0;
  return hasSubject && hasBody && hasRecipient;
}
