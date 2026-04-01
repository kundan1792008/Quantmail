import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  shouldIntercept,
  sanitizeBody,
  type IncomingMessage,
} from "../interceptors/InboxInterceptor";
import {
  evaluateInboxRelevanceSync,
  rankInboxMessagesByRelevance,
  startOfDay,
} from "../services/inboxRelevanceSync";

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
    const sanitizedBody = sanitizeBody(message.body || "");

    if (!message.senderEmail || !message.recipientEmail) {
      return reply
        .code(400)
        .send({ error: "senderEmail and recipientEmail required" });
    }

    const result = shouldIntercept(message);
    const user = await prisma.user.findUnique({
      where: { email: message.recipientEmail },
    });
    const watchEvents = user
      ? await prisma.quanttubeWatchEvent.findMany({
          where: {
            userId: user.id,
            watchedAt: {
              gte: startOfDay(new Date()),
            },
          },
          orderBy: { watchedAt: "desc" },
        })
      : [];
    const relevanceSync = user
      ? evaluateInboxRelevanceSync(
          {
            senderEmail: message.senderEmail,
            subject: message.subject || "(no subject)",
            body: sanitizedBody,
          },
          watchEvents
        )
      : null;

    if (result.intercepted && !relevanceSync?.promoted) {
      await prisma.shadowInbox.create({
        data: {
          senderEmail: message.senderEmail,
          recipientEmail: message.recipientEmail,
          subject: message.subject || "(no subject)",
          body: sanitizedBody,
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

    if (!user) {
      return reply.code(404).send({ error: "Recipient not found" });
    }

    await prisma.inboxMessage.create({
      data: {
        userId: user.id,
        senderEmail: message.senderEmail,
        subject: message.subject || "(no subject)",
        body: sanitizedBody,
      },
    });

    return reply.code(201).send({
      status: "delivered",
      relevanceSync: relevanceSync ?? {
        promoted: false,
        matchedKeyword: null,
        matchedVideoTitle: null,
        presentation: {
          pinToTop: false,
          borderStyle: "standard",
        },
      },
      spamFilterBypassed: Boolean(result.intercepted && relevanceSync?.promoted),
    });
  });

  /**
   * GET /inbox/:userId
   * Retrieves inbox messages for a user.
   */
  app.get<{
    Params: { userId: string };
  }>("/inbox/:userId", async (request, reply) => {
    const { userId } = request.params;

    const [messages, watchEvents] = await Promise.all([
      prisma.inboxMessage.findMany({
        where: { userId },
        orderBy: { receivedAt: "desc" },
      }),
      prisma.quanttubeWatchEvent.findMany({
        where: {
          userId,
          watchedAt: {
            gte: startOfDay(new Date()),
          },
        },
        orderBy: { watchedAt: "desc" },
      }),
    ]);

    return reply.send({
      messages: rankInboxMessagesByRelevance(messages, watchEvents),
    });
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
