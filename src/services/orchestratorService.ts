import { prisma } from "../db";

export type OrchestratorApp =
  | "mail"
  | "calendar"
  | "drive"
  | "docs"
  | "sheets"
  | "chat"
  | "meet"
  | "tasks"
  | "notes";

export interface OrchestratorAction {
  userId: string;
  sourceApp: OrchestratorApp;
  targetApp: OrchestratorApp;
  action: string;
  payload: Record<string, unknown>;
}

export interface OrchestratorResult {
  success: boolean;
  sourceApp: OrchestratorApp;
  targetApp: OrchestratorApp;
  action: string;
  data?: Record<string, unknown>;
  error?: string;
}

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

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function nextWeekday(dayIndex: number): Date {
  const d = new Date();
  const diff = (dayIndex - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(9, 0, 0, 0);
  return d;
}

function extractTimeFromLine(line: string): Date | null {
  const lower = line.toLowerCase();
  const atTime = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
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

  if (/\btomorrow\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  const nextDay = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (nextDay) {
    const idx = WEEKDAYS.indexOf(nextDay[1]);
    if (idx !== -1) return nextWeekday(idx);
  }

  const iso = line.match(/\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?Z?)\b/);
  if (iso) {
    const d = new Date(iso[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

export function extractEventFromEmail(emailBody: string): ExtractedEvent {
  const lines = emailBody.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let title = "";
  for (const line of lines) {
    const m = line.match(/^(?:meeting|event|call|appointment)[:\s]+(.+)/i);
    if (m) {
      title = m[1].trim();
      break;
    }
  }

  if (!title && lines.length > 0) title = lines[0].substring(0, 120);
  if (!title) title = "Meeting";

  let startTime: Date | null = null;
  for (const line of lines) {
    startTime = extractTimeFromLine(line);
    if (startTime) break;
  }

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

export function generateReportFromSheets(spreadsheetJson: string): GeneratedReport {
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

  if (Array.isArray(rows) && Array.isArray(rows[0])) {
    const table = rows as unknown[][];
    const headers = table[0].map(String);
    const dataRows = table.slice(1);
    lines.push(`Columns: ${headers.join(", ")}`);
    lines.push(`Total rows: ${dataRows.length}`);
    lines.push("");
    for (let col = 0; col < headers.length; col++) {
      const vals = dataRows.map((r) => parseFloat(String(r[col]))).filter((v) => !Number.isNaN(v));
      if (vals.length > 0) {
        const sum = vals.reduce((a, b) => a + b, 0);
        const avg = sum / vals.length;
        lines.push(`${headers[col]}: sum=${sum.toFixed(2)}, avg=${avg.toFixed(2)}, min=${Math.min(...vals)}, max=${Math.max(...vals)}`);
      }
    }
  } else if (Array.isArray(rows)) {
    const objRows = rows as Record<string, unknown>[];
    const keys = Object.keys(objRows[0] ?? {});
    lines.push(`Columns: ${keys.join(", ")}`);
    lines.push(`Total rows: ${objRows.length}`);
    lines.push("");
    for (const key of keys) {
      const vals = objRows.map((r) => parseFloat(String(r[key]))).filter((v) => !Number.isNaN(v));
      if (vals.length > 0) {
        const sum = vals.reduce((a, b) => a + b, 0);
        const avg = sum / vals.length;
        lines.push(`${key}: sum=${sum.toFixed(2)}, avg=${avg.toFixed(2)}, min=${Math.min(...vals)}, max=${Math.max(...vals)}`);
      }
    }
  } else {
    lines.push(`Data summary:\n${JSON.stringify(rows, null, 2).substring(0, 1500)}`);
  }

  return { title: `Spreadsheet Report — ${now}`, content: lines.join("\n") };
}

export async function executeOrchestratorAction(params: OrchestratorAction): Promise<OrchestratorResult> {
  const { userId, sourceApp, targetApp, action, payload } = params;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return { success: false, sourceApp, targetApp, action, error: "User not found" };
  }

  try {
    if (sourceApp === "chat" && targetApp === "tasks" && action === "create_task_from_message") {
      return await chatToTask(userId, sourceApp, targetApp, action, payload);
    }
    if (sourceApp === "meet" && targetApp === "docs" && action === "save_transcript_to_doc") {
      return await meetToDoc(userId, sourceApp, targetApp, action, payload);
    }
    if (sourceApp === "notes" && targetApp === "calendar" && action === "add_note_to_calendar") {
      return await noteToCalendar(userId, sourceApp, targetApp, action, payload);
    }

    return {
      success: false,
      sourceApp,
      targetApp,
      action,
      error: `Unsupported orchestration flow: ${sourceApp} -> ${targetApp} / ${action}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, sourceApp, targetApp, action, error: message };
  }
}

async function chatToTask(
  userId: string,
  sourceApp: OrchestratorApp,
  targetApp: OrchestratorApp,
  action: string,
  payload: Record<string, unknown>
): Promise<OrchestratorResult> {
  const title = typeof payload["title"] === "string" ? payload["title"] : "New Task from Chat";
  const description = typeof payload["description"] === "string" ? payload["description"] : "";
  const dueDate = typeof payload["dueDate"] === "string" ? new Date(payload["dueDate"]) : undefined;

  const task = await prisma.task.create({
    data: { userId, title, description, dueDate: dueDate ?? null },
  });

  return {
    success: true,
    sourceApp,
    targetApp,
    action,
    data: {
      taskId: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
    },
  };
}

async function meetToDoc(
  userId: string,
  sourceApp: OrchestratorApp,
  targetApp: OrchestratorApp,
  action: string,
  payload: Record<string, unknown>
): Promise<OrchestratorResult> {
  const transcript = typeof payload["transcript"] === "string" ? payload["transcript"] : "";
  const meetingTitle = typeof payload["meetingTitle"] === "string" ? payload["meetingTitle"] : "Meeting Transcript";
  const date = new Date().toISOString().slice(0, 10);
  const content = `# ${meetingTitle}\n\n**Date:** ${date}\n\n## Transcript\n\n${transcript}`;

  const doc = await prisma.doc.create({
    data: { userId, title: meetingTitle, content },
  });

  return {
    success: true,
    sourceApp,
    targetApp,
    action,
    data: {
      docId: doc.id,
      title: doc.title,
      createdAt: doc.createdAt.toISOString(),
    },
  };
}

async function noteToCalendar(
  userId: string,
  sourceApp: OrchestratorApp,
  targetApp: OrchestratorApp,
  action: string,
  payload: Record<string, unknown>
): Promise<OrchestratorResult> {
  const title = typeof payload["title"] === "string" ? payload["title"] : "Event from Notes";
  const description = typeof payload["description"] === "string" ? payload["description"] : "";
  const startAtRaw = typeof payload["startAt"] === "string" ? payload["startAt"] : null;
  const endAtRaw = typeof payload["endAt"] === "string" ? payload["endAt"] : null;

  if (!startAtRaw) {
    return { success: false, sourceApp, targetApp, action, error: "startAt is required to create a calendar event" };
  }

  const startAt = new Date(startAtRaw);
  const endAt = endAtRaw ? new Date(endAtRaw) : new Date(startAt.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(startAt.getTime())) {
    return { success: false, sourceApp, targetApp, action, error: "Invalid startAt date" };
  }

  const event = await prisma.calendarEvent.create({
    data: { userId, title, description, startAt, endAt },
  });

  return {
    success: true,
    sourceApp,
    targetApp,
    action,
    data: {
      eventId: event.id,
      title: event.title,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
    },
  };
}
