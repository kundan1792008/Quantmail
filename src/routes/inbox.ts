/**
 * Inbox Routes – Email ingestion, shadow filtering, and inbox queries
 */

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client/index.js";
import {
  interceptIncomingEmail,
  auditShadowInbox,
  type IncomingEmailPayload,
} from "../services/InboxInterceptor.js";
import { resolveMasterId, propagateMasterId } from "../middleware/master-id-propagation.js";

export async function inboxRoutes(
  app: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  /**
   * POST /inbox/incoming
   * Webhook endpoint that receives incoming email and applies the
   * shadow inbox filter.
   */
  app.post<{ Body: IncomingEmailPayload }>(
    "/inbox/incoming",
    async (request, reply) => {
      const payload = request.body;

      if (!payload.userId || !payload.senderEmail || !payload.subject) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      // Verify that the target user exists
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });
      if (!user) {
        return reply.status(404).send({ error: "Recipient user not found" });
      }

      const result = await interceptIncomingEmail(prisma, payload);
      return reply.send(result);
    }
  );

  /**
   * GET /inbox/messages
   * Returns primary inbox messages for the authenticated user.
   */
  app.get("/inbox/messages", async (request, reply) => {
    const masterIdHash = await resolveMasterId(prisma, request);
    if (!masterIdHash) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { masterIdHash },
    });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const messages = await prisma.inboxMessage.findMany({
      where: { userId: user.id },
      orderBy: { receivedAt: "desc" },
      take: 50,
    });

    propagateMasterId(reply, masterIdHash);
    return reply.send({ messages, count: messages.length });
  });

  /**
   * GET /inbox/shadow
   * Returns shadow inbox messages for the authenticated user.
   */
  app.get("/inbox/shadow", async (request, reply) => {
    const masterIdHash = await resolveMasterId(prisma, request);
    if (!masterIdHash) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { masterIdHash },
    });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const messages = await prisma.shadowMessage.findMany({
      where: { userId: user.id },
      orderBy: { receivedAt: "desc" },
      take: 50,
    });

    propagateMasterId(reply, masterIdHash);
    return reply.send({ messages, count: messages.length });
  });

  /**
   * GET /inbox/summary
   * AI co-pilot endpoint: returns a structured summary of the inbox.
   */
  app.get("/inbox/summary", async (request, reply) => {
    const masterIdHash = await resolveMasterId(prisma, request);
    if (!masterIdHash) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { masterIdHash },
    });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const [inboxCount, shadowCount, recentMessages] = await Promise.all([
      prisma.inboxMessage.count({ where: { userId: user.id } }),
      prisma.shadowMessage.count({ where: { userId: user.id } }),
      prisma.inboxMessage.findMany({
        where: { userId: user.id },
        orderBy: { receivedAt: "desc" },
        take: 10,
        select: {
          id: true,
          senderEmail: true,
          subject: true,
          receivedAt: true,
        },
      }),
    ]);

    propagateMasterId(reply, masterIdHash);
    return reply.send({
      userId: user.id,
      inboxCount,
      shadowCount,
      recentMessages,
    });
  });

  /**
   * POST /inbox/reply
   * AI co-pilot endpoint: posts an autonomous reply (x402 format).
   */
  app.post<{
    Body: {
      messageId: string;
      replyBody: string;
      format?: string;
    };
  }>("/inbox/reply", async (request, reply) => {
    const masterIdHash = await resolveMasterId(prisma, request);
    if (!masterIdHash) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { masterIdHash },
      include: { digitalTwin: true },
    });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const { messageId, replyBody, format } = request.body;
    if (!messageId || !replyBody) {
      return reply.status(400).send({ error: "Missing messageId or replyBody" });
    }

    // Verify the message belongs to this user
    const message = await prisma.inboxMessage.findFirst({
      where: { id: messageId, userId: user.id },
    });
    if (!message) {
      return reply.status(404).send({ error: "Message not found" });
    }

    propagateMasterId(reply, masterIdHash);
    return reply.send({
      sent: true,
      to: message.senderEmail,
      subject: `Re: ${message.subject}`,
      body: replyBody,
      format: format ?? "x402",
      sentBy: user.digitalTwin ? "digital_twin" : "user",
    });
  });

  /**
   * GET /inbox/audit
   * Red-team audit endpoint for the shadow inbox filter.
   */
  app.get("/inbox/audit", async (request, reply) => {
    const masterIdHash = await resolveMasterId(prisma, request);
    if (!masterIdHash) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { masterIdHash },
    });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const audit = await auditShadowInbox(prisma, user.id);
    propagateMasterId(reply, masterIdHash);
    return reply.send(audit);
  });
}
