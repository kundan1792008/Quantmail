import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  extractEventFromEmail,
  generateReportFromSheets,
} from "../services/orchestratorService";

// Valid sources and their supported actions
const ALLOWED_ACTIONS: Record<string, string[]> = {
  mail: ["create_event"],
  sheets: ["summarize_to_doc"],
};

export async function orchestratorRoutes(
  app: FastifyInstance
): Promise<void> {
  /**
   * POST /orchestrator/action
   *
   * Central AI Orchestrator endpoint for cross-app actions.
   *
   * Body:
   *   source  — originating app: 'mail' | 'sheets'
   *   action  — what to do: 'create_event' | 'summarize_to_doc'
   *   payload — free-form text or JSON string processed by the orchestrator
   *   userId  — owner of the resulting record
   */
  app.post<{
    Body: {
      source: string;
      action: string;
      payload: string;
      userId: string;
    };
  }>("/orchestrator/action", async (request, reply) => {
    const { source, action, payload, userId } = request.body;

    if (!source || !action || !payload || !userId) {
      return reply
        .code(400)
        .send({ error: "source, action, payload, and userId are required" });
    }

    const allowedForSource = ALLOWED_ACTIONS[source.toLowerCase()];
    if (!allowedForSource) {
      return reply
        .code(400)
        .send({
          error: `Unknown source '${source}'. Allowed: ${Object.keys(ALLOWED_ACTIONS).join(", ")}`,
        });
    }

    if (!allowedForSource.includes(action.toLowerCase())) {
      return reply.code(400).send({
        error: `Action '${action}' is not allowed for source '${source}'. Allowed: ${allowedForSource.join(", ")}`,
      });
    }

    // Verify the user exists and has passed biometric registration
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (!user.verified) {
      return reply.code(403).send({
        error: "STRICT_BOT_DROP",
        message: "User has not completed biometric verification",
      });
    }

    // ── Mail → Calendar ──────────────────────────────────────────
    if (source.toLowerCase() === "mail" && action.toLowerCase() === "create_event") {
      const event = extractEventFromEmail(payload);

      const calendarEvent = await prisma.calendarEvent.create({
        data: {
          userId,
          title: event.title,
          description: event.description,
          startTime: event.startTime,
          endTime: event.endTime ?? undefined,
        },
      });

      return reply.code(201).send({
        status: "success",
        action: "mail_to_calendar",
        result: calendarEvent,
      });
    }

    // ── Sheets → Docs ────────────────────────────────────────────
    if (source.toLowerCase() === "sheets" && action.toLowerCase() === "summarize_to_doc") {
      const report = generateReportFromSheets(payload);

      const doc = await prisma.doc.create({
        data: {
          userId,
          title: report.title,
          content: report.content,
          sourceType: "sheets",
        },
      });

      return reply.code(201).send({
        status: "success",
        action: "sheets_to_docs",
        result: doc,
      });
    }

    // Should be unreachable due to earlier validation, but keeps TS happy
    return reply.code(500).send({ error: "Unhandled orchestrator action" });
  });

  /**
   * GET /orchestrator/events/:userId
   * Returns all calendar events for a user (most recent first).
   */
  app.get<{
    Params: { userId: string };
  }>("/orchestrator/events/:userId", async (request, reply) => {
    const { userId } = request.params;

    const events = await prisma.calendarEvent.findMany({
      where: { userId },
      orderBy: { startTime: "asc" },
    });

    return reply.send({ events });
  });

  /**
   * GET /orchestrator/docs/:userId
   * Returns all docs created via the orchestrator for a user (newest first).
   */
  app.get<{
    Params: { userId: string };
  }>("/orchestrator/docs/:userId", async (request, reply) => {
    const { userId } = request.params;

    const docs = await prisma.doc.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({ docs });
  });
}
