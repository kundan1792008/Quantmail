import { FastifyInstance } from "fastify";
import { PrismaClient } from "../generated/prisma/client";
import {
  interceptMessage,
  IncomingMessage,
} from "../interceptors/InboxInterceptor";

interface IncomingWebhookBody {
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export default async function inboxRoutes(
  fastify: FastifyInstance,
  opts: { prisma: PrismaClient }
) {
  const { prisma } = opts;

  /**
   * POST /inbox/incoming
   * Webhook handler for incoming messages.
   * Unverified domains are dropped to ShadowInbox.
   */
  fastify.post<{ Body: IncomingWebhookBody }>("/inbox/incoming", async (request, reply) => {
    const { senderEmail, recipientEmail, subject, body } = request.body;

    if (!senderEmail || !recipientEmail || !subject) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const message: IncomingMessage = { senderEmail, recipientEmail, subject, body: body || "" };
    const result = await interceptMessage(prisma, message);

    if (result.intercepted) {
      return reply.status(202).send({
        status: "SHADOW_DROPPED",
        reason: result.reason,
        domain: result.domain,
      });
    }

    // If not intercepted, deliver to primary inbox
    const recipient = await prisma.user.findUnique({
      where: { email: recipientEmail },
    });

    if (!recipient) {
      return reply.status(404).send({ error: "Recipient not found" });
    }

    const inboxMessage = await prisma.inboxMessage.create({
      data: {
        userId: recipient.id,
        senderEmail,
        subject,
        body: body || "",
      },
    });

    return reply.status(201).send({
      status: "DELIVERED",
      messageId: inboxMessage.id,
    });
  });

  /**
   * GET /inbox/:userId
   * Get all inbox messages for a user.
   */
  fastify.get<{ Params: { userId: string } }>("/inbox/:userId", async (request, reply) => {
    const { userId } = request.params;

    const messages = await prisma.inboxMessage.findMany({
      where: { userId },
      orderBy: { receivedAt: "desc" },
    });

    return reply.send({ messages });
  });

  /**
   * GET /inbox/shadow
   * Get all shadow inbox entries (admin/debug).
   */
  fastify.get("/inbox/shadow", async (_request, reply) => {
    const entries = await prisma.shadowInbox.findMany({
      orderBy: { droppedAt: "desc" },
    });

    return reply.send({ entries });
  });
}
