import { FastifyInstance } from "fastify";
import { PrismaClient } from "../generated/prisma/client";
import { performLivenessCheck } from "../services/livenessService";

interface RegisterBody {
  displayName: string;
  email: string;
  facialMatrixData: string;
}

interface VerifyBody {
  email: string;
  facialMatrixData: string;
}

export default async function authRoutes(
  fastify: FastifyInstance,
  opts: { prisma: PrismaClient }
) {
  const { prisma } = opts;

  /**
   * POST /auth/register
   * Biometric registration - simulates Incode facial liveness SDK.
   * On liveness failure, returns 403 STRICT_BOT_DROP.
   */
  fastify.post<{ Body: RegisterBody }>("/auth/register", async (request, reply) => {
    const { displayName, email, facialMatrixData } = request.body;

    if (!displayName || !email || !facialMatrixData) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: "User already registered" });
    }

    const livenessResult = performLivenessCheck(facialMatrixData);

    if (!livenessResult.passed) {
      return reply.status(403).send({
        error: "STRICT_BOT_DROP",
        reason: livenessResult.reason,
        livenessScore: livenessResult.livenessScore,
      });
    }

    const user = await prisma.user.create({
      data: {
        displayName,
        email,
        biometricHash: livenessResult.biometricHash,
        verified: true,
        livenessGrid: {
          create: {
            facialMatrixHash: livenessResult.facialMatrixHash,
            livenessScore: livenessResult.livenessScore,
            passed: true,
          },
        },
        digitalTwin: {
          create: {
            agentConfig: JSON.stringify({ autoReply: false, summarize: true }),
          },
        },
      },
      include: {
        livenessGrid: true,
        digitalTwin: true,
      },
    });

    return reply.status(201).send({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      verified: user.verified,
      livenessScore: user.livenessGrid?.livenessScore,
    });
  });

  /**
   * POST /auth/verify
   * Re-verify biometric identity for an existing user.
   */
  fastify.post<{ Body: VerifyBody }>("/auth/verify", async (request, reply) => {
    const { email, facialMatrixData } = request.body;

    if (!email || !facialMatrixData) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { livenessGrid: true },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const livenessResult = performLivenessCheck(facialMatrixData);

    if (!livenessResult.passed) {
      return reply.status(403).send({
        error: "STRICT_BOT_DROP",
        reason: livenessResult.reason,
        livenessScore: livenessResult.livenessScore,
      });
    }

    return reply.send({
      id: user.id,
      email: user.email,
      verified: true,
      livenessScore: livenessResult.livenessScore,
    });
  });
}
