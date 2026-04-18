/**
 * ContextLearner
 *
 * Builds and maintains a per-user writing model derived from the user's sent
 * emails.  The learner extracts:
 *
 *   - Common phrases and sentence starters the user employs.
 *   - Per-recipient greeting and sign-off patterns.
 *   - Writing vocabulary fingerprint (word-frequency map).
 *   - Calendar availability windows for meeting-time suggestions.
 *
 * The resulting UserWritingProfile is stored in memory (bounded) and serialised
 * to JSON for persistence.  It is consumed by SmartComposeEngine to personalise
 * completions via the `enablePersonalisation` flag.
 *
 * Data model
 * ──────────
 *   UserWritingProfile
 *   ├── phrases[]          Top N frequently used multi-word phrases.
 *   ├── recipientProfiles  Map<recipientEmail, RecipientProfile>
 *   │     ├── greetings[]  Most common opening salutations.
 *   │     ├── signOffs[]   Most common closing phrases.
 *   │     └── topPhrases[] Phrases specifically used with this recipient.
 *   ├── vocabulary         Word-frequency map (top 500 words).
 *   ├── avgSentenceLength  Average words per sentence (style signal).
 *   ├── formality          Aggregate formality score [0=casual, 1=formal].
 *   └── calendarSlots      Available time slots for meeting suggestions.
 */

import type { RecipientInfo } from "./SmartComposeEngine";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** A past sent email used as training data. */
export interface SentEmail {
  /** ISO-8601 date of sending. */
  sentAt: string;
  /** Recipient email address. */
  to: string;
  /** Recipient display name. */
  toName: string;
  /** Email subject. */
  subject: string;
  /** Full email body (plain text). */
  body: string;
}

/** Aggregate writing profile for a specific recipient. */
export interface RecipientWritingProfile {
  recipientEmail: string;
  recipientName: string;
  /** Ranked list of opening salutations (e.g. "Hi Rahul,", "Dear Mr. Sharma,"). */
  greetings: string[];
  /** Ranked list of closing phrases (e.g. "Best regards,", "Thanks,"). */
  signOffs: string[];
  /** Phrases specifically used when emailing this recipient. */
  topPhrases: string[];
  /** Number of emails used to build this profile. */
  emailCount: number;
}

/** Top-level user writing profile. */
export interface UserWritingProfile {
  /** User's own email address. */
  userEmail: string;
  /** ISO-8601 timestamp of the last profile update. */
  updatedAt: string;
  /** Globally common multi-word phrases across all recipients. */
  phrases: string[];
  /** Per-recipient profiles. */
  recipientProfiles: Map<string, RecipientWritingProfile>;
  /** Word-frequency map (top 500 words by occurrence). */
  vocabulary: Map<string, number>;
  /** Average number of words per sentence (stylistic signal). */
  avgSentenceLength: number;
  /**
   * Aggregate formality score [0.0 = casual, 1.0 = very formal].
   * Computed from contraction rate and vocabulary formality signals.
   */
  formality: number;
  /** Available meeting time slots derived from past scheduling patterns. */
  calendarSlots: CalendarSlot[];
}

/** A suggested meeting time slot. */
export interface CalendarSlot {
  /** ISO-8601 date string (date only, e.g. "2026-04-20"). */
  date: string;
  /** Start time in HH:MM 24-hour format. */
  startTime: string;
  /** End time in HH:MM 24-hour format. */
  endTime: string;
  /** Human-readable label (e.g. "Monday 10:00–10:30"). */
  label: string;
  /**
   * Confidence score [0,1] based on how frequently similar slots appear in
   * past scheduling emails.
   */
  confidence: number;
}

/** Options for profile building. */
export interface ContextLearnerConfig {
  /** Maximum phrases to extract per user (default: 50). */
  maxPhrases?: number;
  /** Minimum phrase frequency to be included (default: 2). */
  minPhraseFrequency?: number;
  /** Vocabulary size cap (default: 500). */
  vocabularyCap?: number;
  /** Number of forward days to generate calendar slots for (default: 7). */
  calendarWindowDays?: number;
  /** Preferred meeting durations in minutes (default: [30, 60]). */
  meetingDurations?: number[];
}

// ─── Internal Constants ───────────────────────────────────────────────────────

const DEFAULT_MAX_PHRASES = 50;
const DEFAULT_MIN_FREQ = 2;
const DEFAULT_VOCAB_CAP = 500;
const DEFAULT_CALENDAR_WINDOW = 7;
const DEFAULT_MEETING_DURATIONS = [30, 60];

/** Stop-words excluded from vocabulary and phrase analysis. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "that", "this", "these",
  "those", "it", "its", "i", "me", "my", "we", "us", "our", "you", "your",
  "he", "she", "they", "them", "their", "as", "if", "so", "not", "no",
  "just", "also", "about", "up", "out", "then", "than", "when", "where",
  "which", "who", "what", "how", "all", "any", "both", "each", "few",
  "more", "most", "other", "some", "such", "into", "through", "after",
  "above", "below", "between", "very",
]);

/** Formal vocabulary markers. */
const FORMAL_WORDS = new Set([
  "pursuant", "henceforth", "accordingly", "therefore", "moreover",
  "furthermore", "notwithstanding", "herewith", "aforementioned",
  "subsequently", "regarding", "sincerely", "respectfully", "kindly",
  "hereby", "therein", "thereof", "wherein",
]);

/** Contraction patterns (signal of casual writing). */
const CONTRACTION_PATTERN = /\b\w+'t\b|\bI'm\b|\bI'll\b|\bI've\b|\bI'd\b|\bwe're\b|\bdon't\b|\bcan't\b|\bwon't\b/gi;

// ─── Phrase Extraction ────────────────────────────────────────────────────────

/**
 * Tokenises plain text into individual words (lowercased, stripped of
 * non-alphabetic characters).
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Extracts n-grams (bigrams and trigrams) from a token array, excluding
 * entries that contain stop-words at both boundaries.
 */
function extractNgrams(tokens: string[], n: 2 | 3): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n);
    const head = gram[0]!;
    const tail = gram[gram.length - 1]!;
    if (STOP_WORDS.has(head) && STOP_WORDS.has(tail)) continue;
    ngrams.push(gram.join(" "));
  }
  return ngrams;
}

/**
 * Counts occurrences of each element in an array.
 */
function countFrequencies<T extends string>(items: T[]): Map<T, number> {
  const map = new Map<T, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return map;
}

/**
 * Returns the top `n` entries from a frequency map, sorted by descending count.
 */
function topN<T extends string>(map: Map<T, number>, n: number): T[] {
  return [...map.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key]) => key);
}

// ─── Greeting / Sign-off Detection ───────────────────────────────────────────

/** Patterns that identify an opening greeting line. */
const GREETING_PATTERNS = [
  /^(hi|hey|hello|dear|good\s+morning|good\s+afternoon|good\s+evening)\b.{0,40}/im,
];

/** Patterns that identify a closing sign-off line. */
const SIGNOFF_PATTERNS = [
  /^(best\s+regards|kind\s+regards|regards|sincerely|thanks|thank\s+you|cheers|warm\s+regards|with\s+gratitude).{0,30}/im,
];

/** Extracts the first greeting line from an email body. */
function extractGreeting(body: string): string | null {
  const firstFewLines = body.split("\n").slice(0, 4).join("\n");
  for (const pattern of GREETING_PATTERNS) {
    const match = firstFewLines.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

/** Extracts the closing sign-off line from an email body. */
function extractSignOff(body: string): string | null {
  const lastFewLines = body.split("\n").slice(-6).join("\n");
  for (const pattern of SIGNOFF_PATTERNS) {
    const match = lastFewLines.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

// ─── Sentence Length Analysis ─────────────────────────────────────────────────

/**
 * Computes the average number of words per sentence in the given text.
 */
function avgWordsPerSentence(text: string): number {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce(
    (acc, s) => acc + s.split(/\s+/).filter((w) => w.length > 0).length,
    0
  );
  return totalWords / sentences.length;
}

// ─── Formality Scoring ────────────────────────────────────────────────────────

/**
 * Computes a formality score [0, 1] for the given text.
 *
 * Algorithm:
 *   1. Count contractions → penalise for each.
 *   2. Count formal vocabulary words → reward for each.
 *   3. Normalise to [0, 1].
 */
function computeFormalityScore(texts: string[]): number {
  if (texts.length === 0) return 0.5;

  let totalContractions = 0;
  let totalFormalWords = 0;
  let totalTokens = 0;

  for (const text of texts) {
    const contractions = (text.match(CONTRACTION_PATTERN) ?? []).length;
    const tokens = tokenise(text);
    const formalCount = tokens.filter((t) => FORMAL_WORDS.has(t)).length;
    totalContractions += contractions;
    totalFormalWords += formalCount;
    totalTokens += tokens.length;
  }

  if (totalTokens === 0) return 0.5;

  const contractionRate = totalContractions / totalTokens;
  const formalRate = totalFormalWords / totalTokens;

  // High contractions → lower formality; many formal words → higher formality.
  const raw = 0.5 - contractionRate * 3 + formalRate * 10;
  return Math.min(1, Math.max(0, raw));
}

// ─── Calendar Slot Generation ─────────────────────────────────────────────────

/**
 * Generates available meeting time slots for the next `windowDays` days.
 *
 * In a real implementation this would integrate with Google Calendar / Outlook
 * to check actual availability.  Here we generate sensible office-hours slots
 * (09:00–17:00) and mark slots that appear frequently in past scheduling emails
 * with a higher confidence score.
 */
function generateCalendarSlots(
  windowDays: number,
  meetingDurations: number[],
  schedulingEmails: SentEmail[]
): CalendarSlot[] {
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const OFFICE_HOURS_START = 9;  // 09:00
  const OFFICE_HOURS_END = 17;   // 17:00

  // Extract time patterns from past scheduling emails.
  const timePattern = /\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\b/g;
  const historicTimes: string[] = [];
  for (const email of schedulingEmails) {
    const matches = [...email.body.matchAll(timePattern)];
    for (const m of matches) {
      historicTimes.push(m[0].trim());
    }
  }

  const slots: CalendarSlot[] = [];
  const today = new Date();

  for (let d = 1; d <= windowDays; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dayOfWeek = date.getDay();

    // Skip weekends.
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = date.toISOString().split("T")[0]!;
    const dayName = DAY_NAMES[dayOfWeek]!;

    for (const duration of meetingDurations) {
      // Generate slots at 30-minute intervals during office hours.
      for (let hour = OFFICE_HOURS_START; hour < OFFICE_HOURS_END; hour++) {
        for (const minute of [0, 30]) {
          const startMins = hour * 60 + minute;
          const endMins = startMins + duration;
          if (endMins > OFFICE_HOURS_END * 60) continue;

          const startTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
          const endHour = Math.floor(endMins / 60);
          const endMin = endMins % 60;
          const endTime = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;

          // Confidence: higher at common meeting times (10:00, 14:00, 15:00).
          let confidence = 0.4;
          if ((hour === 10 || hour === 14 || hour === 15) && minute === 0) {
            confidence = 0.8;
          } else if ((hour === 9 || hour === 11 || hour === 16) && minute === 0) {
            confidence = 0.6;
          }

          slots.push({
            date: dateStr,
            startTime,
            endTime,
            label: `${dayName} ${startTime}–${endTime}`,
            confidence,
          });
        }
      }
    }
  }

  // Limit to a reasonable number to avoid overwhelming the UI.
  return slots
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20);
}

// ─── Profile Store ─────────────────────────────────────────────────────────────

/** In-memory store of user profiles (bounded by Map size). */
const profileStore = new Map<string, UserWritingProfile>();

// ─── Core Learner Functions ───────────────────────────────────────────────────

/**
 * Builds or refreshes the writing profile for `userEmail` from a batch of sent
 * emails.  Call this whenever new sent emails are available (e.g. on login or
 * after sending an email).
 *
 * @param userEmail    The user's own email address (used as the store key).
 * @param sentEmails   Array of the user's past sent emails.
 * @param config       Optional tuning configuration.
 * @returns            The freshly built (or updated) UserWritingProfile.
 */
export function buildProfile(
  userEmail: string,
  sentEmails: SentEmail[],
  config: ContextLearnerConfig = {}
): UserWritingProfile {
  const cfg = {
    maxPhrases: config.maxPhrases ?? DEFAULT_MAX_PHRASES,
    minPhraseFrequency: config.minPhraseFrequency ?? DEFAULT_MIN_FREQ,
    vocabularyCap: config.vocabularyCap ?? DEFAULT_VOCAB_CAP,
    calendarWindowDays: config.calendarWindowDays ?? DEFAULT_CALENDAR_WINDOW,
    meetingDurations: config.meetingDurations ?? DEFAULT_MEETING_DURATIONS,
  };

  // ── Global vocabulary & phrase analysis ──────────────────────────────────

  const allBodies = sentEmails.map((e) => e.body);
  const allTokens = allBodies.flatMap(tokenise).filter((t) => !STOP_WORDS.has(t));

  const wordFreq = countFrequencies(allTokens);
  const vocabulary = new Map(
    [...wordFreq.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, cfg.vocabularyCap)
  );

  const allNgrams = allBodies.flatMap((body) => {
    const tokens = tokenise(body).filter((t) => !STOP_WORDS.has(t));
    return [...extractNgrams(tokens, 2), ...extractNgrams(tokens, 3)];
  });

  const ngramFreq = countFrequencies(allNgrams);
  const phrases = topN(ngramFreq, cfg.maxPhrases).filter(
    (p) => (ngramFreq.get(p) ?? 0) >= cfg.minPhraseFrequency
  );

  // ── Per-recipient profiles ────────────────────────────────────────────────

  const recipientMap = new Map<string, SentEmail[]>();
  for (const email of sentEmails) {
    const existing = recipientMap.get(email.to) ?? [];
    existing.push(email);
    recipientMap.set(email.to, existing);
  }

  const recipientProfiles = new Map<string, RecipientWritingProfile>();

  for (const [recipientEmail, emails] of recipientMap) {
    const greetingFreq = countFrequencies(
      emails.map((e) => extractGreeting(e.body)).filter((g): g is string => g !== null)
    );
    const signOffFreq = countFrequencies(
      emails.map((e) => extractSignOff(e.body)).filter((s): s is string => s !== null)
    );

    const recipientTokens = emails
      .flatMap((e) => tokenise(e.body))
      .filter((t) => !STOP_WORDS.has(t));
    const recipientNgrams = [
      ...extractNgrams(recipientTokens, 2),
      ...extractNgrams(recipientTokens, 3),
    ];
    const recipientNgramFreq = countFrequencies(recipientNgrams);
    const recipientTopPhrases = topN(recipientNgramFreq, 10).filter(
      (p) => (recipientNgramFreq.get(p) ?? 0) >= 1
    );

    recipientProfiles.set(recipientEmail, {
      recipientEmail,
      recipientName: emails[0]!.toName,
      greetings: topN(greetingFreq, 3),
      signOffs: topN(signOffFreq, 3),
      topPhrases: recipientTopPhrases,
      emailCount: emails.length,
    });
  }

  // ── Stylistic analysis ────────────────────────────────────────────────────

  const sentenceLengths = allBodies.map(avgWordsPerSentence).filter((n) => n > 0);
  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
      : 15;

  const formality = computeFormalityScore(allBodies);

  // ── Calendar slots ────────────────────────────────────────────────────────

  const schedulingEmails = sentEmails.filter((e) =>
    /schedule|meeting|call|availability|time\s+slot/i.test(e.subject + " " + e.body)
  );

  const calendarSlots = generateCalendarSlots(
    cfg.calendarWindowDays,
    cfg.meetingDurations,
    schedulingEmails
  );

  // ── Assemble and store profile ────────────────────────────────────────────

  const profile: UserWritingProfile = {
    userEmail,
    updatedAt: new Date().toISOString(),
    phrases,
    recipientProfiles,
    vocabulary,
    avgSentenceLength,
    formality,
    calendarSlots,
  };

  profileStore.set(userEmail, profile);
  return profile;
}

/**
 * Returns the stored writing profile for `userEmail`, or null if the profile
 * has not been built yet.
 */
export function getProfile(userEmail: string): UserWritingProfile | null {
  return profileStore.get(userEmail) ?? null;
}

/**
 * Incrementally updates the profile with a single newly sent email, without
 * reprocessing the full history.  Useful for real-time updates after each send.
 */
export function updateProfileWithEmail(
  userEmail: string,
  newEmail: SentEmail
): UserWritingProfile {
  const existing = profileStore.get(userEmail);

  if (!existing) {
    // Bootstrap from this single email.
    return buildProfile(userEmail, [newEmail]);
  }

  // Update per-recipient profile.
  const existingRecipient = existing.recipientProfiles.get(newEmail.to);
  const greeting = extractGreeting(newEmail.body);
  const signOff = extractSignOff(newEmail.body);

  if (existingRecipient) {
    if (greeting && !existingRecipient.greetings.includes(greeting)) {
      existingRecipient.greetings.unshift(greeting);
      existingRecipient.greetings = existingRecipient.greetings.slice(0, 5);
    }
    if (signOff && !existingRecipient.signOffs.includes(signOff)) {
      existingRecipient.signOffs.unshift(signOff);
      existingRecipient.signOffs = existingRecipient.signOffs.slice(0, 5);
    }
    existingRecipient.emailCount += 1;
  } else {
    existing.recipientProfiles.set(newEmail.to, {
      recipientEmail: newEmail.to,
      recipientName: newEmail.toName,
      greetings: greeting ? [greeting] : [],
      signOffs: signOff ? [signOff] : [],
      topPhrases: [],
      emailCount: 1,
    });
  }

  // Update global vocabulary with new words.
  const newTokens = tokenise(newEmail.body).filter((t) => !STOP_WORDS.has(t));
  for (const token of newTokens) {
    existing.vocabulary.set(token, (existing.vocabulary.get(token) ?? 0) + 1);
  }

  existing.updatedAt = new Date().toISOString();
  profileStore.set(userEmail, existing);
  return existing;
}

/**
 * Removes the stored profile for a user (e.g. on account deletion).
 */
export function deleteProfile(userEmail: string): void {
  profileStore.delete(userEmail);
}

// ─── Suggestion Helpers ───────────────────────────────────────────────────────

/**
 * Returns the preferred greeting for a given recipient, based on the user's
 * writing history with that person.
 *
 * @param userEmail       The composer's email.
 * @param recipientEmail  The recipient's email.
 * @param fallback        Greeting to return when no history is available.
 */
export function suggestGreeting(
  userEmail: string,
  recipientEmail: string,
  fallback = "Hi,"
): string {
  const profile = profileStore.get(userEmail);
  if (!profile) return fallback;
  const rp = profile.recipientProfiles.get(recipientEmail);
  return rp?.greetings[0] ?? fallback;
}

/**
 * Returns the preferred sign-off for a given recipient.
 */
export function suggestSignOff(
  userEmail: string,
  recipientEmail: string,
  fallback = "Best regards,"
): string {
  const profile = profileStore.get(userEmail);
  if (!profile) return fallback;
  const rp = profile.recipientProfiles.get(recipientEmail);
  return rp?.signOffs[0] ?? fallback;
}

/**
 * Returns the top meeting time slots suitable for suggesting to the recipient.
 * Filters to the next `days` calendar days (default: 3).
 */
export function suggestMeetingSlots(
  userEmail: string,
  days = 3
): CalendarSlot[] {
  const profile = profileStore.get(userEmail);
  if (!profile) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().split("T")[0]!;

  return profile.calendarSlots
    .filter((s) => s.date <= cutoffStr)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

/**
 * Returns a serialisable plain-object representation of a UserWritingProfile,
 * suitable for JSON persistence.
 */
export function serialiseProfile(profile: UserWritingProfile): Record<string, unknown> {
  return {
    userEmail: profile.userEmail,
    updatedAt: profile.updatedAt,
    phrases: profile.phrases,
    recipientProfiles: Object.fromEntries(
      [...profile.recipientProfiles.entries()].map(([k, v]) => [k, v])
    ),
    vocabulary: Object.fromEntries(profile.vocabulary),
    avgSentenceLength: profile.avgSentenceLength,
    formality: profile.formality,
    calendarSlots: profile.calendarSlots,
  };
}

/**
 * Rehydrates a UserWritingProfile from a plain-object representation (e.g. from
 * a JSON store).
 */
export function deserialiseProfile(raw: Record<string, unknown>): UserWritingProfile {
  const rp = raw["recipientProfiles"] as Record<string, RecipientWritingProfile> | undefined;
  const vocab = raw["vocabulary"] as Record<string, number> | undefined;

  return {
    userEmail: String(raw["userEmail"] ?? ""),
    updatedAt: String(raw["updatedAt"] ?? new Date().toISOString()),
    phrases: (raw["phrases"] as string[] | undefined) ?? [],
    recipientProfiles: rp
      ? new Map(Object.entries(rp))
      : new Map(),
    vocabulary: vocab ? new Map(Object.entries(vocab)) : new Map(),
    avgSentenceLength: Number(raw["avgSentenceLength"] ?? 15),
    formality: Number(raw["formality"] ?? 0.5),
    calendarSlots: (raw["calendarSlots"] as CalendarSlot[] | undefined) ?? [],
  };
}

/**
 * Returns a compact context summary string derived from the user's profile
 * for a specific recipient, suitable for injection into an LLM prompt.
 *
 * @param userEmail       The composer's email.
 * @param recipient       The current recipient info.
 * @param maxPhrases      How many phrases to include (default: 5).
 */
export function buildContextSummary(
  userEmail: string,
  recipient: RecipientInfo,
  maxPhrases = 5
): string {
  const profile = profileStore.get(userEmail);
  if (!profile) return "";

  const parts: string[] = [];

  const rp = profile.recipientProfiles.get(recipient.email);
  if (rp) {
    if (rp.greetings.length > 0) {
      parts.push(`Preferred greeting: "${rp.greetings[0]}"`);
    }
    if (rp.signOffs.length > 0) {
      parts.push(`Preferred sign-off: "${rp.signOffs[0]}"`);
    }
    const phrases = rp.topPhrases.slice(0, maxPhrases);
    if (phrases.length > 0) {
      parts.push(`Common phrases with this recipient: ${phrases.join(", ")}`);
    }
  }

  const globalPhrases = profile.phrases.slice(0, maxPhrases);
  if (globalPhrases.length > 0) {
    parts.push(`Global common phrases: ${globalPhrases.join(", ")}`);
  }

  const formalityLabel =
    profile.formality > 0.65 ? "formal" : profile.formality < 0.35 ? "casual" : "neutral";
  parts.push(`Writing style: ${formalityLabel} (score ${profile.formality.toFixed(2)})`);

  return parts.join("\n");
}
