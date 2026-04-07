import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { verifyMasterSSOToken, encryptApiKey } from "../utils/crypto";
import { maskStoredKey } from "../utils/maskKey";

const SSO_SECRET = process.env["SSO_SECRET"] || "quantmail-dev-secret";
const ENCRYPTION_SECRET =
  process.env["ENCRYPTION_SECRET"] || "quantmail-key-secret";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /settings/keys
   * Save the authenticated user's AI provider API keys.
   * Keys are encrypted before storage.
   *
   * Authorization: Bearer <ssoToken>
   * Body: { openaiKey?, anthropicKey?, geminiKey?, customModelUrl?, customModelKey? }
   */
  app.post<{
    Body: {
      openaiKey?: string;
      anthropicKey?: string;
      geminiKey?: string;
      customModelUrl?: string;
      customModelKey?: string;
    };
  }>("/settings/keys", {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const authHeader = request.headers["authorization"];
      const token =
        authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        return reply
          .code(401)
          .send({ error: "Authorization token required" });
      }

      const userId = verifyMasterSSOToken(token, SSO_SECRET);
      if (!userId) {
        return reply.code(403).send({ error: "Invalid or expired token" });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      const { openaiKey, anthropicKey, geminiKey, customModelUrl, customModelKey } =
        request.body;

      const updateData: Record<string, string | null> = {};

      if (openaiKey !== undefined) {
        updateData.openaiKey = openaiKey
          ? encryptApiKey(openaiKey, ENCRYPTION_SECRET)
          : null;
      }
      if (anthropicKey !== undefined) {
        updateData.anthropicKey = anthropicKey
          ? encryptApiKey(anthropicKey, ENCRYPTION_SECRET)
          : null;
      }
      if (geminiKey !== undefined) {
        updateData.geminiKey = geminiKey
          ? encryptApiKey(geminiKey, ENCRYPTION_SECRET)
          : null;
      }
      if (customModelUrl !== undefined) {
        updateData.customModelUrl = customModelUrl || null;
      }
      if (customModelKey !== undefined) {
        updateData.customModelKey = customModelKey
          ? encryptApiKey(customModelKey, ENCRYPTION_SECRET)
          : null;
      }

      if (Object.keys(updateData).length === 0) {
        return reply
          .code(400)
          .send({ error: "At least one key field is required" });
      }

      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      return reply.send({
        message: "API keys saved successfully. Your keys are encrypted and stored securely.",
      });
    },
  });

  /**
   * GET /settings/keys
   * Returns the masked status of the authenticated user's saved API keys.
   *
   * Authorization: Bearer <ssoToken>
   */
  app.get("/settings/keys", {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const authHeader = request.headers["authorization"];
      const token =
        authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        return reply
          .code(401)
          .send({ error: "Authorization token required" });
      }

      const userId = verifyMasterSSOToken(token, SSO_SECRET);
      if (!userId) {
        return reply.code(403).send({ error: "Invalid or expired token" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          openaiKey: true,
          anthropicKey: true,
          geminiKey: true,
          customModelUrl: true,
          customModelKey: true,
        },
      });

      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      return reply.send({
        keys: {
          openai: maskStoredKey(user.openaiKey),
          anthropic: maskStoredKey(user.anthropicKey),
          gemini: maskStoredKey(user.geminiKey),
          customModelUrl: user.customModelUrl || null,
          customModel: maskStoredKey(user.customModelKey),
        },
        message:
          "Use your own API key for unlimited access (Your keys are encrypted and stored securely).",
      });
    },
  });
}
