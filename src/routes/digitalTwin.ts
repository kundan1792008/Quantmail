import { FastifyInstance } from "fastify";
import { PrismaClient } from "../generated/prisma/client";

interface UpdateTwinBody {
  agentConfig: Record<string, unknown>;
}

interface AutoReplyBody {
  userId: string;
  messageId: string;
  replyBody: string;
}

export default async function digitalTwinRoutes(
  fastify: FastifyInstance,
  opts: { prisma: PrismaClient }
) {
  const { prisma } = opts;

  /**
   * GET /twin/:userId
   * Fetch the Digital Twin and inbox summary for the AI agent.
   */
  fastify.get<{ Params: { userId: string } }>("/twin/:userId", async (request, reply) => {
    const { userId } = request.params;

    const twin = await prisma.digitalTwin.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!twin) {
      return reply.status(404).send({ error: "Digital Twin not found" });
    }

    const recentMessages = await prisma.inboxMessage.findMany({
      where: { userId },
      orderBy: { receivedAt: "desc" },
      take: 10,
    });

    const summary = {
      totalMessages: await prisma.inboxMessage.count({ where: { userId } }),
      recentMessages: recentMessages.map((m) => ({
        id: m.id,
        senderEmail: m.senderEmail,
        subject: m.subject,
        receivedAt: m.receivedAt,
      })),
    };

    return reply.send({
      twin: {
        id: twin.id,
        userId: twin.userId,
        agentConfig: JSON.parse(twin.agentConfig),
        lastSyncAt: twin.lastSyncAt,
      },
      inboxSummary: summary,
    });
  });

  /**
   * PUT /twin/:userId
   * Update Digital Twin agent configuration.
   */
  fastify.put<{ Params: { userId: string }; Body: UpdateTwinBody }>(
    "/twin/:userId",
    async (request, reply) => {
      const { userId } = request.params;
      const { agentConfig } = request.body;

      if (!agentConfig) {
        return reply.status(400).send({ error: "Missing agentConfig" });
      }

      const twin = await prisma.digitalTwin.findUnique({ where: { userId } });

      if (!twin) {
        return reply.status(404).send({ error: "Digital Twin not found" });
      }

      const updated = await prisma.digitalTwin.update({
        where: { userId },
        data: {
          agentConfig: JSON.stringify(agentConfig),
          lastSyncAt: new Date(),
        },
      });

      return reply.send({
        id: updated.id,
        userId: updated.userId,
        agentConfig: JSON.parse(updated.agentConfig),
        lastSyncAt: updated.lastSyncAt,
      });
    }
  );

  /**
   * POST /twin/reply
   * Autonomous agent reply endpoint using x402 transactional formatting.
   * The AI agent uses this to POST replies on behalf of the user.
   */
  fastify.post<{ Body: AutoReplyBody }>("/twin/reply", async (request, reply) => {
    const { userId, messageId, replyBody } = request.body;

    if (!userId || !messageId || !replyBody) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const twin = await prisma.digitalTwin.findUnique({ where: { userId } });

    if (!twin) {
      return reply.status(404).send({ error: "Digital Twin not found" });
    }

    const originalMessage = await prisma.inboxMessage.findUnique({
      where: { id: messageId },
    });

    if (!originalMessage) {
      return reply.status(404).send({ error: "Original message not found" });
    }

    // x402 transactional formatting for autonomous agent replies
    const x402Response = {
      protocol: "x402",
      version: "1.0",
      transaction: {
        type: "AGENT_REPLY",
        userId,
        messageId,
        inReplyTo: originalMessage.senderEmail,
        subject: `Re: ${originalMessage.subject}`,
        body: replyBody,
        timestamp: new Date().toISOString(),
        agentId: twin.id,
      },
    };

    await prisma.digitalTwin.update({
      where: { userId },
      data: { lastSyncAt: new Date() },
    });

    return reply.status(201).send(x402Response);
  });
}
