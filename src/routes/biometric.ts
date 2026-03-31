import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import {
  computeFacialHash,
  generateMasterIdToken,
  buildPropagationPayload,
} from "../services/identity.js";

interface BiometricRegisterBody {
  email: string;
  displayName?: string;
  /** Base-64 encoded facial capture from Capacitor Camera plugin. */
  facialCapture: string;
  livenessScore: number;
  captureMethod?: string;
}

interface BiometricVerifyBody {
  email: string;
  facialCapture: string;
}

/**
 * Biometric SSO routes.
 *
 * Registration accepts a facial capture (base-64 image from Capacitor's
 * Camera API on iOS/Android or a webcam fallback on desktop) and derives a
 * SHA-256 facial hash that is stored in the LivenessGrid.
 *
 * Verification re-derives the hash and matches it against the stored grid.
 * On success a Master-ID token is issued that propagates to all partner apps.
 */
export async function biometricRoutes(app: FastifyInstance) {
  // ---------- Registration ----------
  app.post(
    "/auth/biometric/register",
    async (
      request: FastifyRequest<{ Body: BiometricRegisterBody }>,
      reply: FastifyReply,
    ) => {
      const {
        email,
        displayName,
        facialCapture,
        livenessScore,
        captureMethod,
      } = request.body;

      if (!email || !facialCapture || livenessScore === undefined) {
        return reply.status(400).send({ error: "missing_fields" });
      }

      // Liveness threshold – reject probable bots / synthetic captures.
      if (livenessScore < 0.85) {
        await prisma.auditLog.create({
          data: {
            action: "biometric_registration_rejected",
            target: email,
            details: JSON.stringify({ livenessScore }),
            severity: "critical",
          },
        });
        return reply.status(403).send({ error: "STRICT_BOT_DROP" });
      }

      const facialHash = computeFacialHash(Buffer.from(facialCapture, "base64"));
      const masterIdToken = generateMasterIdToken();

      const user = await prisma.user.create({
        data: {
          email,
          displayName: displayName ?? null,
          masterIdToken,
          livenessGrid: {
            create: {
              facialHash,
              livenessScore,
              captureMethod: captureMethod ?? "capacitor_camera",
              verified: true,
            },
          },
          digitalTwin: {
            create: {},
          },
        },
        include: { livenessGrid: true, digitalTwin: true },
      });

      const propagation = buildPropagationPayload(masterIdToken, user.id);

      return reply.status(201).send({
        status: "registered",
        userId: user.id,
        masterIdToken,
        propagation,
      });
    },
  );

  // ---------- Verification ----------
  app.post(
    "/auth/biometric/verify",
    async (
      request: FastifyRequest<{ Body: BiometricVerifyBody }>,
      reply: FastifyReply,
    ) => {
      const { email, facialCapture } = request.body;

      if (!email || !facialCapture) {
        return reply.status(400).send({ error: "missing_fields" });
      }

      const user = await prisma.user.findUnique({
        where: { email },
        include: { livenessGrid: true },
      });

      if (!user || !user.livenessGrid) {
        return reply.status(404).send({ error: "user_not_found" });
      }

      const incomingHash = computeFacialHash(
        Buffer.from(facialCapture, "base64"),
      );

      if (incomingHash !== user.livenessGrid.facialHash) {
        await prisma.auditLog.create({
          data: {
            action: "biometric_verification_failed",
            target: email,
            details: "facial_hash_mismatch",
            severity: "high",
          },
        });
        return reply.status(403).send({ error: "STRICT_BOT_DROP" });
      }

      const propagation = buildPropagationPayload(
        user.masterIdToken!,
        user.id,
      );

      return reply.send({
        status: "verified",
        userId: user.id,
        masterIdToken: user.masterIdToken,
        propagation,
      });
    },
  );
}
