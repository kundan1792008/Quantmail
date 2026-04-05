/**
 * Quant AI Orchestrator Service
 *
 * Handles cross-app intelligence for the Quantmail Super App:
 *  - mail → calendar: extracts event details from an email body
 *  - sheets → docs:   generates a natural-language report from spreadsheet JSON
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedEvent {
  title: string;
  description: string;
  startTime: Date;
  endTime: Date | null;
}

export interface GeneratedReport {
  title: string;
  content: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Builds a Date set to the next occurrence of the given weekday index.
 */
function nextWeekday(dayIndex: number): Date {
  const d = new Date();
  const diff = (dayIndex - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(9, 0, 0, 0);
  return d;
}

/**
 * Tries to extract a start time from a single text line.
 * Returns null if no recognisable time pattern is found.
 */
function extractTimeFromLine(line: string): Date | null {
  const lower = line.toLowerCase();

  // Pattern: "at H:MM am/pm" or "at H am/pm" or "at H:MM" (24 h)
  const atTime = lower.match(
    /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  );
  if (atTime) {
    let hours = parseInt(atTime[1], 10);
    const minutes = atTime[2] ? parseInt(atTime[2], 10) : 0;
    const period = atTime[3];
    if (period === "pm" && hours < 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // Pattern: standalone "H:MM" or "HH:MM" (24 h or 12 h)
  const clock = lower.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (clock) {
    let hours = parseInt(clock[1], 10);
    const minutes = parseInt(clock[2], 10);
    const period = clock[3];
    if (period === "pm" && hours < 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // Pattern: "tomorrow"
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // Pattern: "next <weekday>"
  const nextDay = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (nextDay) {
    const idx = WEEKDAYS.indexOf(nextDay[1]);
    if (idx !== -1) return nextWeekday(idx);
  }

  // Pattern: ISO date "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SSZ"
  const iso = line.match(/\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?Z?)\b/);
  if (iso) {
    const d = new Date(iso[1]);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

// ─── Mail → Calendar ─────────────────────────────────────────────────────────

/**
 * Extracts an event title and start time from free-form email text.
 *
 * Strategy (priority order):
 *  1. Explicit "Meeting: <title>" / "Event: <title>" / "Call: <title>" prefix
 *     for the title.
 *  2. First non-empty line as fallback title.
 *  3. First line in the body that contains a recognisable time expression.
 *  4. Tomorrow 09:00 as ultimate fallback for the start time.
 */
export function extractEventFromEmail(emailBody: string): ExtractedEvent {
  const lines = emailBody
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // ── 1. Title: explicit prefix ──────────────────────────────────
  let title = "";
  for (const line of lines) {
    const m = line.match(
      /^(?:meeting|event|call|appointment)[:\s]+(.+)/i
    );
    if (m) {
      title = m[1].trim();
      break;
    }
  }

  // ── 2. Title fallback: first line ──────────────────────────────
  if (!title && lines.length > 0) {
    title = lines[0].substring(0, 120);
  }
  if (!title) title = "Meeting";

  // ── 3. Start time: first line with a recognisable time ─────────
  let startTime: Date | null = null;
  for (const line of lines) {
    startTime = extractTimeFromLine(line);
    if (startTime) break;
  }

  // ── 4. Start time fallback: tomorrow 09:00 ─────────────────────
  if (!startTime) {
    startTime = new Date();
    startTime.setDate(startTime.getDate() + 1);
    startTime.setHours(9, 0, 0, 0);
  }

  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  return {
    title,
    description: emailBody.substring(0, 500),
    startTime,
    endTime,
  };
}

// ─── Sheets → Docs ───────────────────────────────────────────────────────────

/**
 * Generates a natural-language summary/report from spreadsheet JSON data.
 *
 * The payload is expected to be a JSON array of row objects or a 2-D array.
 * The function produces a structured plain-text report suitable for saving
 * as a Doc.
 */
export function generateReportFromSheets(
  spreadsheetJson: string
): GeneratedReport {
  let rows: unknown;
  try {
    rows = JSON.parse(spreadsheetJson);
  } catch {
    return {
      title: "Spreadsheet Report",
      content: `Raw data summary:\n\n${spreadsheetJson.substring(0, 2000)}`,
    };
  }

  const lines: string[] = [];
  const now = new Date().toISOString().split("T")[0];

  lines.push(`Spreadsheet Report — ${now}`);
  lines.push("=".repeat(40));

  if (Array.isArray(rows) && rows.length === 0) {
    lines.push("No data found in the spreadsheet.");
    return { title: "Spreadsheet Report", content: lines.join("\n") };
  }

  // 2-D array mode: first row = headers
  if (Array.isArray(rows) && Array.isArray(rows[0])) {
    const table = rows as unknown[][];
    const headers = table[0].map(String);
    const dataRows = table.slice(1);

    lines.push(`Columns: ${headers.join(", ")}`);
    lines.push(`Total rows: ${dataRows.length}`);
    lines.push("");

    // Numeric column statistics
    for (let col = 0; col < headers.length; col++) {
      const vals = dataRows
        .map((r) => parseFloat(String((r as unknown[])[col])))
        .filter((v) => !isNaN(v));
      if (vals.length > 0) {
        const sum = vals.reduce((a, b) => a + b, 0);
        const avg = sum / vals.length;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        lines.push(
          `${headers[col]}: sum=${sum.toFixed(2)}, avg=${avg.toFixed(2)}, min=${min}, max=${max}`
        );
      }
    }

    if (dataRows.length > 0) {
      lines.push("");
      lines.push("Sample rows (first 5):");
      dataRows.slice(0, 5).forEach((row, i) => {
        const cells = (row as unknown[]).map(String).join(" | ");
        lines.push(`  Row ${i + 1}: ${cells}`);
      });
    }
  } else if (Array.isArray(rows)) {
    // Array of objects mode
    const objRows = rows as Record<string, unknown>[];
    const keys = Object.keys(objRows[0] ?? {});

    lines.push(`Columns: ${keys.join(", ")}`);
    lines.push(`Total rows: ${objRows.length}`);
    lines.push("");

    // Numeric column statistics
    for (const key of keys) {
      const vals = objRows
        .map((r) => parseFloat(String(r[key])))
        .filter((v) => !isNaN(v));
      if (vals.length > 0) {
        const sum = vals.reduce((a, b) => a + b, 0);
        const avg = sum / vals.length;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        lines.push(
          `${key}: sum=${sum.toFixed(2)}, avg=${avg.toFixed(2)}, min=${min}, max=${max}`
        );
      }
    }

    lines.push("");
    lines.push("Sample rows (first 5):");
    objRows.slice(0, 5).forEach((row, i) => {
      const cells = keys.map((k) => `${k}=${String(row[k])}`).join(", ");
      lines.push(`  Row ${i + 1}: ${cells}`);
    });
  } else {
    lines.push(`Data summary:\n${JSON.stringify(rows, null, 2).substring(0, 1500)}`);
  }

  const title = `Spreadsheet Report — ${now}`;
  return { title, content: lines.join("\n") };
}
