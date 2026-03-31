import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import {
  classifySender,
  extractDomain,
} from "../services/identity.js";

interface IncomingMailPayload {
  senderEmail: string;
  recipientId: string;
  subject: string;
  body: string;
}

/**
 * InboxInterceptor – Webhook handler that inspects every inbound message.
 *
 * Messages from verified sender domains pass through to the primary inbox
 * (the Message table).  Everything else is diverted to the Shadow table and
 * an AuditLog entry is created for later red-team review.
 */
export async function inboxInterceptorRoutes(app: FastifyInstance) {
  app.post(
    "/webhook/inbox",
    async (
      request: FastifyRequest<{ Body: IncomingMailPayload }>,
      reply: FastifyReply,
    ) => {
      const { senderEmail, recipientId, subject, body } = request.body;

      if (!senderEmail || !recipientId || !subject) {
        return reply.status(400).send({ error: "missing_fields" });
      }

      const classification = classifySender(senderEmail);

      // Verified sender → primary inbox
      if (classification === null) {
        const message = await prisma.message.create({
          data: { userId: recipientId, sender: senderEmail, subject, body },
        });
        return reply.status(201).send({ status: "delivered", id: message.id });
      }

      // Unverified / blocked → Shadow table
      const shadow = await prisma.shadow.create({
        data: {
          senderEmail,
          senderDomain: extractDomain(senderEmail),
          recipientId,
          subject,
          body,
          reason: classification.reason,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "shadow_intercept",
          target: senderEmail,
          details: JSON.stringify({
            shadowId: shadow.id,
            reason: classification.reason,
          }),
          severity: classification.severity,
        },
      });

      return reply
        .status(202)
        .send({ status: "intercepted", reason: classification.reason });
    },
  );
}
