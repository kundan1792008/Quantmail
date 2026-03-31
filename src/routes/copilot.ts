import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { isValidMasterIdToken } from "../services/identity.js";

/**
 * Co-Pilot routes – allow the AI agent (Digital Twin) to interact with a
 * user's inbox and post autonomous replies.
 */
export async function copilotRoutes(app: FastifyInstance) {
  // ---------- Inbox summary ----------
  app.get(
    "/copilot/:userId/inbox",
    async (
      request: FastifyRequest<{ Params: { userId: string } }>,
      reply: FastifyReply,
    ) => {
      const { userId } = request.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { messages: true, digitalTwin: true },
      });

      if (!user) {
        return reply.status(404).send({ error: "user_not_found" });
      }

      return reply.send({
        userId: user.id,
        totalMessages: user.messages.length,
        unread: user.messages.filter((m) => !m.isRead).length,
        messages: user.messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          subject: m.subject,
          isRead: m.isRead,
          createdAt: m.createdAt,
        })),
      });
    },
  );

  // ---------- Autonomous reply (x402 transactional format) ----------
  app.post(
    "/copilot/:userId/reply",
    async (
      request: FastifyRequest<{
        Params: { userId: string };
        Body: {
          masterIdToken: string;
          replyTo: string;
          body: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { userId } = request.params;
      const { masterIdToken, replyTo, body } = request.body;

      if (!masterIdToken || !replyTo || !body) {
        return reply.status(400).send({ error: "missing_fields" });
      }

      if (!isValidMasterIdToken(masterIdToken)) {
        return reply.status(400).send({ error: "invalid_master_id_token" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || user.masterIdToken !== masterIdToken) {
        return reply.status(403).send({ error: "unauthorized" });
      }

      // Log the autonomous reply action
      await prisma.auditLog.create({
        data: {
          action: "copilot_reply",
          target: replyTo,
          details: JSON.stringify({
            userId,
            bodyLength: body.length,
            format: "x402",
          }),
          severity: "info",
        },
      });

      return reply.status(201).send({
        status: "sent",
        format: "x402",
        replyTo,
        bodyPreview: body.slice(0, 100),
      });
    },
  );
}
