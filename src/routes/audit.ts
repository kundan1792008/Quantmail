import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";

/**
 * Shadow DB audit routes.
 *
 * These endpoints allow security engineers to continuously review intercepted
 * messages, inspect audit logs, and run automated red-team validation checks
 * against the spam filter.
 */
export async function auditRoutes(app: FastifyInstance) {
  // ---------- List shadow entries ----------
  app.get(
    "/audit/shadow",
    async (
      request: FastifyRequest<{
        Querystring: { limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const limit = Math.min(Number(request.query.limit) || 50, 200);
      const offset = Number(request.query.offset) || 0;

      const [entries, total] = await Promise.all([
        prisma.shadow.findMany({
          take: limit,
          skip: offset,
          orderBy: { interceptedAt: "desc" },
        }),
        prisma.shadow.count(),
      ]);

      return reply.send({ total, limit, offset, entries });
    },
  );

  // ---------- List audit logs ----------
  app.get(
    "/audit/logs",
    async (
      request: FastifyRequest<{
        Querystring: { severity?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const limit = Math.min(Number(request.query.limit) || 50, 200);
      const offset = Number(request.query.offset) || 0;
      const severity = request.query.severity;

      const where = severity ? { severity } : {};

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: "desc" },
        }),
        prisma.auditLog.count({ where }),
      ]);

      return reply.send({ total, limit, offset, logs });
    },
  );

  // ---------- Red-team validation endpoint ----------
  app.post(
    "/audit/redteam/validate",
    async (
      _request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      // Run automated checks against the Shadow DB to ensure the filter
      // catches known attack patterns.
      const redTeamPayloads = [
        { email: "attacker@spam-factory.test", expectedReason: "blocked_domain" },
        { email: "phisher@phish.example", expectedReason: "blocked_domain" },
        { email: "random@gmail.com", expectedReason: "unverified_domain" },
        { email: "user@yahoo.com", expectedReason: "unverified_domain" },
        { email: "noatsign", expectedReason: "invalid_sender_address" },
      ];

      const { classifySender } = await import("../services/identity.js");

      const results = redTeamPayloads.map((payload) => {
        const classification = classifySender(payload.email);
        const actualReason = classification?.reason ?? "none";
        return {
          email: payload.email,
          expectedReason: payload.expectedReason,
          actualReason,
          pass: actualReason === payload.expectedReason,
        };
      });

      const allPass = results.every((r) => r.pass);

      await prisma.auditLog.create({
        data: {
          action: "redteam_validation",
          target: "shadow_filter",
          details: JSON.stringify({ allPass, results }),
          severity: allPass ? "info" : "critical",
        },
      });

      return reply.send({
        status: allPass ? "all_checks_passed" : "some_checks_failed",
        results,
      });
    },
  );
}
