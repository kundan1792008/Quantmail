/**
 * calendarParser.ts
 *
 * Mock AI natural-language parser for Quanttime (AI Smart Calendar).
 *
 * Accepts a free-text prompt such as "Coffee with John next Friday at 10 AM"
 * and returns a structured event payload: { title, startTime, endTime }.
 *
 * When a real AI SDK (Vercel AI SDK / OpenAI) is available, replace
 * parseEventFromText() with an LLM call; the output shape remains identical.
 */

export interface ParsedEvent {
  title: string;
  startTime: Date;
  endTime: Date;
}

export interface ParseError {
  error: string;
}

export type ParseResult = ParsedEvent | ParseError;

const DEFAULT_EVENT_HOUR = 9;

// ─── Time keyword maps ────────────────────────────────────────────

const DAY_OFFSETS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  "day after tomorrow": 2,
};

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Returns the next occurrence of a given weekday (0=Sun … 6=Sat)
 * relative to `from`. If today is the target weekday, returns *next* week.
 */
function nextWeekday(dayIndex: number, from: Date, forceNext = false): Date {
  const result = new Date(from);
  result.setHours(0, 0, 0, 0);
  const current = result.getDay();
  let diff = dayIndex - current;
  if (diff <= 0 || forceNext) diff += 7;
  result.setDate(result.getDate() + diff);
  return result;
}

// ─── Core parser ─────────────────────────────────────────────────

/**
 * Parses a natural-language scheduling prompt into a structured event.
 *
 * Examples handled:
 *   "Coffee with John next Friday at 10 AM"
 *   "Team standup tomorrow at 9:30 AM"
 *   "Lunch on Monday at 12 PM"
 *   "Call today at 3:45 PM"
 *
 * Default duration is 1 hour unless an end-time phrase is present.
 *
 * @param prompt - Raw user input
 * @param now    - Reference timestamp (defaults to `new Date()`; injectable for tests)
 */
export function parseEventFromText(
  prompt: string,
  now: Date = new Date()
): ParseResult {
  const text = prompt.trim();
  if (!text) {
    return { error: "Prompt must not be empty." };
  }

  // ── 1. Extract event title ──────────────────────────────────────
  // Strip temporal phrases from the front to leave the activity description.
  const titleRaw = text
    .replace(
      /\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      ""
    )
    .replace(/\b(today|tomorrow|day after tomorrow)\b/gi, "")
    .replace(/\b(on|at|from|for)\b\s+\d{1,2}(:\d{2})?\s*(am|pm)?/gi, "")
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const title = titleRaw.length >= 2 ? titleRaw : text;

  // ── 2. Resolve the calendar day ────────────────────────────────
  const lowerText = text.toLowerCase();
  let baseDate: Date = new Date(now);
  baseDate.setHours(0, 0, 0, 0);

  // Relative: "today" / "tomorrow"
  let dayResolved = false;
  for (const [keyword, offset] of Object.entries(DAY_OFFSETS)) {
    if (lowerText.includes(keyword)) {
      baseDate.setDate(baseDate.getDate() + offset);
      dayResolved = true;
      break;
    }
  }

  // Weekday: "next Friday" / "on Monday" / plain "Friday"
  if (!dayResolved) {
    const forceNext = /\bnext\b/.test(lowerText);
    for (let i = 0; i < WEEKDAY_NAMES.length; i++) {
      if (lowerText.includes(WEEKDAY_NAMES[i])) {
        baseDate = nextWeekday(i, now, forceNext);
        dayResolved = true;
        break;
      }
    }
  }

  // Default to today if no day phrase found
  if (!dayResolved) {
    baseDate.setDate(now.getDate());
  }

  // ── 3. Extract clock time (e.g. "10 AM", "3:45 PM", "14:00") ──
  const timePattern = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?\b/;
  const timeMatch = text.match(timePattern);

  let hours = DEFAULT_EVENT_HOUR;
  let minutes = 0;

  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { error: "Could not parse a valid time from the prompt." };
  }

  // ── 4. Build start / end Date objects ──────────────────────────
  const startTime = new Date(baseDate);
  startTime.setHours(hours, minutes, 0, 0);

  const endTime = new Date(startTime);
  endTime.setHours(endTime.getHours() + 1); // default 1-hour duration

  return { title, startTime, endTime };
}
