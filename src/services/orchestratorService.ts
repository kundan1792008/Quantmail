import { prisma } from "../db";

export type OrchestratorApp = "mail" | "calendar" | "drive" | "docs" | "sheets" | "chat" | "meet" | "tasks" | "notes";

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

/**
 * Executes a cross-app AI orchestration action.
 * Supported flows:
 *   - chat -> tasks   : Creates a task from a chat message (action: "create_task_from_message")
 *   - meet -> docs    : Saves a meeting transcript to a doc (action: "save_transcript_to_doc")
 *   - notes -> calendar: Parses a note date and creates a calendar event (action: "add_note_to_calendar")
 */
export async function executeOrchestratorAction(
  params: OrchestratorAction
): Promise<OrchestratorResult> {
  const { userId, sourceApp, targetApp, action, payload } = params;

  // Verify user exists
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
    data: {
      userId,
      title,
      description,
      dueDate: dueDate ?? null,
    },
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
    data: {
      userId,
      title: meetingTitle,
      content,
    },
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
  const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000; // 1 hour
  const endAt = endAtRaw ? new Date(endAtRaw) : new Date(startAt.getTime() + DEFAULT_EVENT_DURATION_MS);

  if (isNaN(startAt.getTime())) {
    return { success: false, sourceApp, targetApp, action, error: "Invalid startAt date" };
  }

  const event = await prisma.calendarEvent.create({
    data: {
      userId,
      title,
      description,
      startAt,
      endAt,
    },
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
