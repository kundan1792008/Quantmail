import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  shouldIntercept,
  sanitizeBody,
  type IncomingMessage,
} from "../interceptors/InboxInterceptor";
import { detectCriticalAlert } from "../services/criticalAlertService";
import { triggerSynchronizedAlarmForCriticalAlert } from "../services/iotAlarmService";

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /inbox/receive
   * Webhook handler for incoming email.
   * Unverified domains are dropped to Shadow Inbox.
   */
  app.post<{
    Body: IncomingMessage;
  }>("/inbox/receive", async (request, reply) => {
    const message = request.body;

    if (!message.senderEmail || !message.recipientEmail) {
      return reply
        .code(400)
        .send({ error: "senderEmail and recipientEmail required" });
    }

    const result = shouldIntercept(message);

    if (result.intercepted) {
      await prisma.shadowInbox.create({
        data: {
          senderEmail: message.senderEmail,
          recipientEmail: message.recipientEmail,
          subject: message.subject || "(no subject)",
          body: sanitizeBody(message.body || ""),
          domain: result.domain,
          reason: result.reason,
        },
      });

      return reply.code(200).send({
        status: "intercepted",
        reason: result.reason,
        domain: result.domain,
      });
    }

    // Find the recipient user
    const user = await prisma.user.findUnique({
      where: { email: message.recipientEmail },
    });

    if (!user) {
      return reply.code(404).send({ error: "Recipient not found" });
    }

    const createdMessage = await prisma.inboxMessage.create({
      data: {
        userId: user.id,
        senderEmail: message.senderEmail,
        subject: message.subject || "(no subject)",
        body: sanitizeBody(message.body || ""),
      },
    });

    const criticalSignal = detectCriticalAlert(
      createdMessage.subject,
      createdMessage.body
    );

    if (
      criticalSignal.isCritical &&
      (criticalSignal.category === "PAYMENT" ||
        criticalSignal.category === "ECOSYSTEM_TOKEN")
    ) {
      const alarm = await triggerSynchronizedAlarmForCriticalAlert({
        userId: user.id,
        inboxMessageId: createdMessage.id,
        alertType: criticalSignal.category,
        summary: criticalSignal.summary,
      });

      return reply.code(201).send({
        status: "delivered",
        criticalAlert: {
          triggered: true,
          category: criticalSignal.category,
          alarmSessionId: alarm.alarmSessionId,
          syncGroup: alarm.syncGroup,
          dispatchedDevices: alarm.dispatchedCount,
        },
      });
    }

    return reply.code(201).send({ status: "delivered", criticalAlert: { triggered: false } });
  });

  /**
   * GET /inbox/:userId
   * Retrieves inbox messages for a user.
   */
  app.get<{
    Params: { userId: string };
  }>("/inbox/:userId", async (request, reply) => {
    const { userId } = request.params;

    const messages = await prisma.inboxMessage.findMany({
      where: { userId },
      orderBy: { receivedAt: "desc" },
    });

    return reply.send({ messages });
  });

  /**
   * GET /inbox/shadow/all
   * Returns all shadow inbox entries (for auditing).
   */
  app.get("/inbox/shadow/all", async (_request, reply) => {
    const entries = await prisma.shadowInbox.findMany({
      orderBy: { droppedAt: "desc" },
    });

    return reply.send({ entries });
  });
}
