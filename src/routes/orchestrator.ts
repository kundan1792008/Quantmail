import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  executeOrchestratorAction,
  extractEventFromEmail,
  generateReportFromSheets,
  type OrchestratorApp,
} from "../services/orchestratorService";
import { checkPaywall, incrementAiCount } from "../services/paywallService";

const ALLOWED_ACTIONS: Record<string, string[]> = {
  mail: ["create_event"],
  sheets: ["summarize_to_doc"],
};

export async function orchestratorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      userId: string;
      source?: string;
      sourceApp?: string;
      targetApp?: string;
      action: string;
      payload?: Record<string, unknown> | string;
    };
  }>("/orchestrator/action", async (request, reply) => {
    const { userId, source, sourceApp, targetApp, action, payload } = request.body;

    if (!userId || !action) {
      return reply.code(400).send({ error: "userId and action are required" });
    }

    if (sourceApp && targetApp) {
      const paywall = await checkPaywall(userId);
      if (!paywall.allowed) {
        return reply.code(402).send({
          error: "paywall",
          message: paywall.message,
          aiCount: paywall.aiCount,
          limit: paywall.limit,
          upgradeUrl: "/upgrade",
        });
      }

      const result = await executeOrchestratorAction({
        userId,
        sourceApp: sourceApp as OrchestratorApp,
        targetApp: targetApp as OrchestratorApp,
        action,
        payload: typeof payload === "object" && payload !== null ? payload : {},
      });

      if (!result.success) {
        return reply.code(422).send({ error: result.error });
      }

      await incrementAiCount(userId);
      return reply.send({ result });
    }

    if (!source || typeof payload !== "string") {
      return reply.code(400).send({ error: "source, action, payload, and userId are required" });
    }

    const allowedForSource = ALLOWED_ACTIONS[source.toLowerCase()];
    if (!allowedForSource || !allowedForSource.includes(action.toLowerCase())) {
      return reply.code(400).send({ error: "Unsupported orchestrator source/action" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (!user.verified) {
      return reply.code(403).send({ error: "STRICT_BOT_DROP", message: "User has not completed biometric verification" });
    }

    if (source.toLowerCase() === "mail" && action.toLowerCase() === "create_event") {
      const event = extractEventFromEmail(payload);
      const calendarEvent = await prisma.calendarEvent.create({
        data: {
          userId,
          title: event.title,
          description: event.description,
          startAt: event.startTime,
          endAt: event.endTime ?? new Date(event.startTime.getTime() + 60 * 60 * 1000),
        },
      });
      return reply.code(201).send({ status: "success", action: "mail_to_calendar", result: calendarEvent });
    }

    const report = generateReportFromSheets(payload);
    const doc = await prisma.doc.create({
      data: { userId, title: report.title, content: report.content },
    });
    return reply.code(201).send({ status: "success", action: "sheets_to_docs", result: doc });
  });

  app.get<{ Params: { userId: string } }>("/paywall/check/:userId", async (request, reply) => {
    const { userId } = request.params;
    const status = await checkPaywall(userId);
    return reply.send(status);
  });

  app.get<{ Params: { userId: string } }>("/orchestrator/events/:userId", async (request, reply) => {
    const { userId } = request.params;
    const events = await prisma.calendarEvent.findMany({ where: { userId }, orderBy: { startAt: "asc" } });
    return reply.send({ events });
  });

  app.get<{ Params: { userId: string } }>("/orchestrator/docs/:userId", async (request, reply) => {
    const { userId } = request.params;
    const docs = await prisma.doc.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return reply.send({ docs });
  });
}
