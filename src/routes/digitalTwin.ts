import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import type { InboxMessage } from "../generated/prisma/client";

export async function digitalTwinRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /twin/:userId/summary
   * Fetches an inbox summary for the AI agent (Digital Twin).
   */
  app.get<{
    Params: { userId: string };
  }>("/twin/:userId/summary", async (request, reply) => {
    const { userId } = request.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { digitalTwin: true },
    });

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const messages = await prisma.inboxMessage.findMany({
      where: { userId },
      orderBy: { receivedAt: "desc" },
      take: 20,
    });

    const summary = {
      userId: user.id,
      displayName: user.displayName,
      totalMessages: messages.length,
      recentSubjects: messages.map((m: InboxMessage) => ({
        id: m.id,
        subject: m.subject,
        from: m.senderEmail,
        receivedAt: m.receivedAt,
      })),
      twinConfig: user.digitalTwin?.agentConfig || "{}",
    };

    return reply.send(summary);
  });

  /**
   * POST /twin/:userId/reply
   * Autonomous reply endpoint for the AI agent.
   * Uses x402 transactional formatting.
   */
  app.post<{
    Params: { userId: string };
    Body: {
      messageId: string;
      replyBody: string;
    };
  }>("/twin/:userId/reply", async (request, reply) => {
    const { userId } = request.params;
    const { messageId, replyBody } = request.body;

    if (!messageId || !replyBody) {
      return reply
        .code(400)
        .send({ error: "messageId and replyBody required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { digitalTwin: true },
    });

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const original = await prisma.inboxMessage.findUnique({
      where: { id: messageId },
    });

    if (!original || original.userId !== userId) {
      return reply.code(404).send({ error: "Message not found" });
    }

    // x402 transactional format response
    return reply.code(200).send({
      "x-402-transaction": {
        type: "autonomous-reply",
        from: user.email,
        to: original.senderEmail,
        inReplyTo: messageId,
        body: replyBody,
        timestamp: new Date().toISOString(),
        agent: "digital-twin",
        twinId: user.digitalTwin?.id || null,
      },
    });
  });

  /**
   * PUT /twin/:userId/config
   * Updates the Digital Twin agent configuration.
   */
  app.put<{
    Params: { userId: string };
    Body: { agentConfig: string };
  }>("/twin/:userId/config", async (request, reply) => {
    const { userId } = request.params;
    const { agentConfig } = request.body;

    const twin = await prisma.digitalTwin.findUnique({
      where: { userId },
    });

    if (!twin) {
      return reply.code(404).send({ error: "Digital Twin not found" });
    }

    const updated = await prisma.digitalTwin.update({
      where: { userId },
      data: {
        agentConfig: agentConfig || "{}",
        lastSyncAt: new Date(),
      },
    });

    return reply.send({ twin: updated });
  });
}
