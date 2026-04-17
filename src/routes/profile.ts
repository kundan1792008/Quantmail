/**
 * Profile Routes
 *
 * CRUD endpoints for user profile data.
 * All routes are protected by the Zero-Trust gateway middleware.
 *
 * GET  /api/profile           – Full profile with devices and security score
 * PATCH /api/profile          – Update display name, avatar, bio
 * GET  /api/profile/security  – Security dashboard: sessions, login history
 * DELETE /api/profile         – GDPR-compliant account deletion (cascade)
 * GET  /api/profile/sessions  – Active sessions
 * DELETE /api/profile/sessions/:id – Revoke a specific session
 */

import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { zeroTrustGateway, zeroTrustGatewayWithLiveness } from "../middleware/ZeroTrustGateway";
import { listActiveSessions, revokeAllSessions, revokeSession } from "../services/SessionManager";
import { listUserCredentials, removeCredential } from "../services/WebAuthnService";

// ─── Helpers ──────────────────────────────────────────────────────

function computeSecurityScore(params: {
  hasPasskey: boolean;
  livenessVerified: boolean;
  activeSessions: number;
}): number {
  let score = 40; // Base score for verified biometric account
  if (params.hasPasskey) score += 30;
  if (params.livenessVerified) score += 20;
  if (params.activeSessions <= 2) score += 10;
  return Math.min(score, 100);
}

// ─── Route registration ────────────────────────────────────────────

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/profile
   * Returns the full user profile including connected devices and security score.
   */
  app.get(
    "/api/profile",
    { preHandler: zeroTrustGateway },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          livenessGrid: true,
          digitalTwin: true,
          webAuthnCredentials: {
            select: {
              id: true,
              name: true,
              deviceType: true,
              backedUp: true,
              createdAt: true,
              lastUsedAt: true,
            },
          },
        },
      });

      if (!user) return reply.code(404).send({ error: "User not found" });

      const activeSessions = await listActiveSessions(userId);

      const securityScore = computeSecurityScore({
        hasPasskey: user.webAuthnCredentials.length > 0,
        livenessVerified: user.livenessGrid?.passed ?? false,
        activeSessions: activeSessions.length,
      });

      return reply.send({
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        verified: user.verified,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        passkeys: user.webAuthnCredentials,
        livenessVerified: user.livenessGrid?.passed ?? false,
        livenessScore: user.livenessGrid?.livenessScore ?? null,
        digitalTwin: user.digitalTwin
          ? { id: user.digitalTwin.id, lastSyncAt: user.digitalTwin.lastSyncAt }
          : null,
        security: {
          score: securityScore,
          activeSessions: activeSessions.length,
        },
      });
    }
  );

  /**
   * PATCH /api/profile
   * Update display name.
   */
  app.patch<{ Body: { displayName?: string } }>(
    "/api/profile",
    { preHandler: zeroTrustGateway },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;
      const { displayName } = request.body;

      if (!displayName || typeof displayName !== "string" || displayName.trim().length < 1) {
        return reply.code(400).send({ error: "displayName must be a non-empty string" });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { displayName: displayName.trim() },
        select: { id: true, displayName: true, email: true, updatedAt: true },
      });

      return reply.send(updated);
    }
  );

  /**
   * GET /api/profile/security
   * Returns the security dashboard: active sessions, login history, passkeys, liveness status.
   */
  app.get(
    "/api/profile/security",
    { preHandler: zeroTrustGateway },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;

      const [user, activeSessions, passkeys, dashboardLogins] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          include: { livenessGrid: true },
        }),
        listActiveSessions(userId),
        listUserCredentials(userId),
        prisma.dashboardPhysicalLogin.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            dashboardOrigin: true,
            loginMethod: true,
            createdAt: true,
            revokedAt: true,
          },
        }),
      ]);

      if (!user) return reply.code(404).send({ error: "User not found" });

      const securityScore = computeSecurityScore({
        hasPasskey: passkeys.length > 0,
        livenessVerified: user.livenessGrid?.passed ?? false,
        activeSessions: activeSessions.length,
      });

      return reply.send({
        securityScore,
        livenessStatus: {
          verified: user.livenessGrid?.passed ?? false,
          score: user.livenessGrid?.livenessScore ?? null,
          capturedAt: user.livenessGrid?.capturedAt ?? null,
        },
        passkeys: passkeys.map((p: {
          id: string;
          name: string;
          deviceType: string;
          backedUp: boolean;
          createdAt: Date;
          lastUsedAt: Date | null;
        }) => ({
          id: p.id,
          name: p.name,
          deviceType: p.deviceType,
          backedUp: p.backedUp,
          createdAt: p.createdAt,
          lastUsedAt: p.lastUsedAt,
        })),
        activeSessions,
        loginHistory: dashboardLogins,
      });
    }
  );

  /**
   * GET /api/profile/sessions
   * Lists all active sessions for the authenticated user.
   */
  app.get(
    "/api/profile/sessions",
    { preHandler: zeroTrustGateway },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;
      const sessions = await listActiveSessions(userId);
      return reply.send({ sessions });
    }
  );

  /**
   * DELETE /api/profile/sessions/:id
   * Revokes a specific session.
   */
  app.delete<{ Params: { id: string } }>(
    "/api/profile/sessions/:id",
    { preHandler: zeroTrustGateway },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;
      const { id } = request.params;

      const revoked = await revokeSession(userId, id);
      if (!revoked) {
        return reply.code(404).send({ error: "Session not found or already revoked" });
      }

      return reply.send({ message: "Session revoked successfully" });
    }
  );

  /**
   * DELETE /api/profile/sessions
   * Revokes all sessions for the user (logout everywhere).
   */
  app.delete(
    "/api/profile/sessions",
    { preHandler: zeroTrustGateway },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;
      const count = await revokeAllSessions(userId);
      return reply.send({ message: `${count} session(s) revoked` });
    }
  );

  /**
   * DELETE /api/profile/passkeys/:id
   * Removes a specific passkey credential.
   */
  app.delete<{ Params: { id: string } }>(
    "/api/profile/passkeys/:id",
    { preHandler: zeroTrustGateway },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;
      const { id } = request.params;

      const removed = await removeCredential(userId, id);
      if (!removed) {
        return reply.code(404).send({ error: "Passkey not found" });
      }

      return reply.send({ message: "Passkey removed successfully" });
    }
  );

  /**
   * DELETE /api/profile
   * GDPR-compliant full account deletion.
   * Requires full liveness verification for this destructive operation.
   * Cascades to all related data via Prisma's onDelete: Cascade.
   */
  app.delete(
    "/api/profile",
    { preHandler: zeroTrustGatewayWithLiveness },
    async (request, reply) => {
      const userId = request.zeroTrustUser!.id;

      // Revoke all sessions first to prevent any in-flight requests
      await revokeAllSessions(userId);

      // Cascade delete is handled by the DB (onDelete: Cascade on all relations)
      // but we explicitly clean up models without cascade to be safe
      await prisma.$transaction([
        prisma.livenessChallenge.deleteMany({ where: { userId } }),
        prisma.pushNotification.deleteMany({ where: { userId } }),
        prisma.saccadeSession.deleteMany({ where: { userId } }),
        prisma.quanttubeWatchEvent.deleteMany({ where: { userId } }),
        prisma.criticalAlert.deleteMany({ where: { userId } }),
        prisma.connectedIoTDevice.deleteMany({ where: { userId } }),
        prisma.deviceToken.deleteMany({ where: { userId } }),
        prisma.dashboardPhysicalLogin.deleteMany({ where: { userId } }),
        prisma.task.deleteMany({ where: { userId } }),
        prisma.chatMessage.deleteMany({ where: { userId } }),
        prisma.note.deleteMany({ where: { userId } }),
        prisma.email.deleteMany({ where: { userId } }),
        prisma.event.deleteMany({ where: { userId } }),
        prisma.calendarEvent.deleteMany({ where: { userId } }),
        prisma.document.deleteMany({ where: { userId } }),
        prisma.doc.deleteMany({ where: { userId } }),
        prisma.file.deleteMany({ where: { userId } }),
        prisma.sheet.deleteMany({ where: { userId } }),
        prisma.driveFile.deleteMany({ where: { userId } }),
        prisma.inboxMessage.deleteMany({ where: { userId } }),
        prisma.userAiSettings.deleteMany({ where: { userId } }),
        prisma.webAuthnCredential.deleteMany({ where: { userId } }),
        prisma.userSession.deleteMany({ where: { userId } }),
        prisma.livenessGrid.deleteMany({ where: { userId } }),
        prisma.digitalTwin.deleteMany({ where: { userId } }),
        prisma.user.delete({ where: { id: userId } }),
      ]);

      return reply.code(200).send({
        message: "Account permanently deleted. All data has been erased in compliance with GDPR.",
      });
    }
  );
}
