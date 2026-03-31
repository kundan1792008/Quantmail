/**
 * Auth Routes – Biometric Registration & Verification
 */

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client/index.js";
import {
  verifyBiometric,
  type BiometricRegistrationInput,
} from "../services/biometric-auth.js";
import {
  propagateMasterId,
  resolveMasterId,
} from "../middleware/master-id-propagation.js";

export async function authRoutes(
  app: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
  };

  /**
   * POST /auth/register
   * Registers a new user with biometric liveness verification.
   */
  app.post<{
    Body: BiometricRegistrationInput;
  }>("/auth/register", authRateLimit, async (request, reply) => {
    const { displayName, email, imageData, captureMethod } = request.body;

    if (!displayName || !email || !imageData) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: "User already registered" });
    }

    // Run biometric verification
    const result = verifyBiometric({ displayName, email, imageData, captureMethod });

    if (!result.verified) {
      return reply.status(403).send({
        error: "STRICT_BOT_DROP",
        reason: result.reason,
        livenessScore: result.livenessScore,
      });
    }

    // Create user + liveness grid in a transaction
    const user = await prisma.user.create({
      data: {
        displayName,
        email,
        masterIdHash: result.masterIdHash,
        livenessGrid: {
          create: {
            facialHash: result.facialHash,
            livenessScore: result.livenessScore,
            captureMethod,
            verified: true,
          },
        },
        digitalTwin: {
          create: {},
        },
      },
      include: {
        livenessGrid: true,
        digitalTwin: true,
      },
    });

    propagateMasterId(reply, result.masterIdHash);

    return reply.status(201).send({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      masterIdHash: user.masterIdHash,
      livenessVerified: true,
      captureMethod,
    });
  });

  /**
   * POST /auth/verify
   * Verifies a returning user's identity via biometric liveness check.
   */
  app.post<{
    Body: { email: string; imageData: string; captureMethod: string };
  }>("/auth/verify", authRateLimit, async (request, reply) => {
    const { email, imageData, captureMethod } = request.body;

    if (!email || !imageData) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { livenessGrid: true },
    });

    if (!user || !user.livenessGrid) {
      return reply.status(404).send({ error: "User not found" });
    }

    const result = verifyBiometric({
      displayName: user.displayName,
      email,
      imageData,
      captureMethod: captureMethod as "capacitor_camera" | "web_camera",
    });

    if (!result.verified) {
      return reply.status(403).send({
        error: "STRICT_BOT_DROP",
        reason: result.reason,
        livenessScore: result.livenessScore,
      });
    }

    propagateMasterId(reply, user.masterIdHash);

    return reply.send({
      id: user.id,
      masterIdHash: user.masterIdHash,
      verified: true,
    });
  });

  /**
   * GET /auth/resolve
   * Resolves a Master ID from the request header.
   */
  app.get("/auth/resolve", async (request, reply) => {
    const masterIdHash = await resolveMasterId(prisma, request);
    if (!masterIdHash) {
      return reply.status(401).send({ error: "Invalid or missing Master ID" });
    }

    const user = await prisma.user.findUnique({
      where: { masterIdHash },
      select: {
        id: true,
        displayName: true,
        email: true,
        masterIdHash: true,
      },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    propagateMasterId(reply, masterIdHash);
    return reply.send(user);
  });
}
