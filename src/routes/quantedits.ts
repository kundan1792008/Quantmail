/**
 * Quantedits Integration Routes
 *
 * Exposes endpoints that allow Quantedits to:
 *  1. Record micro-saccade eye movement samples for a user.
 *  2. Request an API key for High-Priority Reel rendering, which
 *     requires successful saccade-based liveness verification.
 *
 * Bot / scraper requests are rejected with HTTP 403 STRICT_BOT_DROP.
 */

import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  validateSaccadeLiveness,
  type SaccadeSample,
} from "../services/saccadeLivenessService";
import { verifyMasterSSOToken } from "../utils/crypto";
import { v4 as uuidv4 } from "uuid";
import CryptoJS from "crypto-js";

const SSO_SECRET = process.env["SSO_SECRET"] || "quantmail-dev-secret";

export async function quanteditsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /quantedits/saccade/record
   *
   * Records micro-saccade eye movement samples for a user session.
   * Called periodically by the Quantedits client to stream saccade data.
   */
  app.post<{
    Body: {
      token: string;
      samples: SaccadeSample[];
    };
  }>("/quantedits/saccade/record", async (request, reply) => {
    const { token, samples } = request.body;

    if (!token) {
      return reply.code(400).send({ error: "token required" });
    }

    if (!Array.isArray(samples) || samples.length === 0) {
      return reply.code(400).send({ error: "samples array required" });
    }

    const userId = verifyMasterSSOToken(token, SSO_SECRET);
    if (!userId) {
      return reply
        .code(403)
        .send({ error: "STRICT_BOT_DROP", message: "Invalid or expired token" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    // Validate and store saccade data
    const validation = validateSaccadeLiveness(samples);

    await prisma.saccadeSession.create({
      data: {
        userId,
        saccadeHash: validation.saccadeHash || "pending",
        sampleCount: validation.sampleCount,
        entropyScore: validation.entropyScore,
      },
    });

    return reply.code(201).send({
      status: "recorded",
      sampleCount: validation.sampleCount,
      entropyScore: validation.entropyScore,
    });
  });

  /**
   * POST /quantedits/reel/apikey
   *
   * Issues a short-lived API key for Quantedits High-Priority Reel rendering.
   *
   * Before granting the key, the endpoint verifies the user's micro-saccade
   * eye movements over the last 30 seconds.  If the saccade data is absent,
   * insufficient, or exhibits low entropy (bot / scraper pattern), the
   * request is rejected with HTTP 403 STRICT_BOT_DROP.
   */
  app.post<{
    Body: {
      token: string;
      samples: SaccadeSample[];
    };
  }>("/quantedits/reel/apikey", async (request, reply) => {
    const { token, samples } = request.body;

    if (!token) {
      return reply.code(400).send({ error: "token required" });
    }

    // Authenticate via SSO token
    const userId = verifyMasterSSOToken(token, SSO_SECRET);
    if (!userId) {
      return reply.code(403).send({
        error: "STRICT_BOT_DROP",
        message: "Invalid or expired SSO token",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (!Array.isArray(samples) || samples.length === 0) {
      return reply.code(403).send({
        error: "STRICT_BOT_DROP",
        message: "No saccade eye movement data provided — bot/scraper rejected",
      });
    }

    // Verify saccade-based human liveness
    const validation = validateSaccadeLiveness(samples);

    // Persist the saccade session for auditing
    await prisma.saccadeSession.create({
      data: {
        userId,
        saccadeHash: validation.saccadeHash || "rejected",
        sampleCount: validation.sampleCount,
        entropyScore: validation.entropyScore,
      },
    });

    if (!validation.passed) {
      return reply.code(403).send({
        error: "STRICT_BOT_DROP",
        message: `Saccade liveness failed: ${validation.reason}`,
        entropyScore: validation.entropyScore,
        sampleCount: validation.sampleCount,
      });
    }

    // Generate a short-lived API key scoped to Quantedits reel rendering
    const apiKeyPayload = JSON.stringify({
      sub: userId,
      scope: "quantedits:reel:high-priority",
      saccadeHash: validation.saccadeHash,
      iat: Date.now(),
      exp: Date.now() + 5 * 60_000, // expires in 5 minutes
      jti: uuidv4(),
    });
    const apiKeySignature = CryptoJS.HmacSHA256(
      apiKeyPayload,
      `${SSO_SECRET}:quantedits`
    ).toString(CryptoJS.enc.Hex);
    const apiKey = `${Buffer.from(apiKeyPayload).toString("base64url")}.${apiKeySignature}`;

    return reply.code(200).send({
      apiKey,
      scope: "quantedits:reel:high-priority",
      userId,
      saccadeVerification: {
        passed: true,
        entropyScore: validation.entropyScore,
        sampleCount: validation.sampleCount,
        saccadeHash: validation.saccadeHash,
      },
    });
  });
}
