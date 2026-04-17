import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { performLivenessCheck } from "../services/livenessService";
import {
  deriveBiometricHash,
  encryptApiKey,
  generateMasterSSOToken,
  verifyMasterSSOToken,
} from "../utils/crypto";
import { propagateMasterIdToAll } from "../utils/masterIdPropagation";
import {
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  listUserCredentials,
} from "../services/WebAuthnService";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { issueSessionTokens } from "../services/SessionManager";

const SSO_SECRET = process.env["SSO_SECRET"] || "quantmail-dev-secret";
const ENCRYPTION_SECRET =
  process.env["ENCRYPTION_SECRET"] || "quantmail-key-secret";
const AUTH_RATE_LIMIT_MAX = Number(process.env["AUTH_RATE_LIMIT_MAX"] || 5);
const AUTH_RATE_LIMIT_WINDOW = process.env["AUTH_RATE_LIMIT_WINDOW"] || "1 minute";

/** Brute-force guard: max 5 auth attempts per minute per IP. */
const AUTH_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: AUTH_RATE_LIMIT_MAX,
      timeWindow: AUTH_RATE_LIMIT_WINDOW,
    },
  },
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /auth/register
   * Biometric registration using facial liveness check.
   * On Capacitor native, the camera is invoked automatically.
   * On web, a base64 image payload must be provided.
   */
  app.post<{
    Body: {
      displayName: string;
      email: string;
      imageBase64?: string;
    };
  }>("/auth/register", AUTH_RATE_LIMIT, async (request, reply) => {
    const { displayName, email, imageBase64 } = request.body;

    if (!displayName || !email) {
      return reply.code(400).send({ error: "displayName and email required" });
    }

    const liveness = await performLivenessCheck(imageBase64);

    if (!liveness.passed) {
      return reply.code(403).send({
        error: "STRICT_BOT_DROP",
        message: "Biometric liveness check failed",
        livenessScore: liveness.livenessScore,
        captureSource: liveness.captureSource,
      });
    }

    const biometricHash = deriveBiometricHash(
      `${email}:${liveness.facialMatrixHash}`
    );

    const existing = await prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      return reply.code(409).send({ error: "User already registered" });
    }

    const user = await prisma.user.create({
      data: {
        displayName,
        email,
        biometricHash,
        verified: true,
        livenessGrid: {
          create: {
            facialMatrixHash: encryptApiKey(
              liveness.facialMatrixHash,
              ENCRYPTION_SECRET
            ),
            livenessScore: liveness.livenessScore,
            passed: true,
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

    const token = generateMasterSSOToken(user.id, SSO_SECRET);
    const propagation = propagateMasterIdToAll(user.id, SSO_SECRET);

    return reply.code(201).send({
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        verified: user.verified,
        captureSource: liveness.captureSource,
      },
      ssoToken: token,
      propagation,
    });
  });

  /**
   * POST /auth/verify
   * Verifies a Master SSO token and returns the associated user.
   */
  app.post<{
    Body: { token: string };
  }>("/auth/verify", {
    config: {
      rateLimit: {
        max: AUTH_RATE_LIMIT_MAX,
        timeWindow: AUTH_RATE_LIMIT_WINDOW,
      },
    },
    handler: async (request, reply) => {
    const { token } = request.body;
    if (!token) {
      return reply.code(400).send({ error: "token required" });
    }

    const userId = verifyMasterSSOToken(token, SSO_SECRET);
    if (!userId) {
      return reply.code(403).send({ error: "Invalid or expired token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        verified: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    return reply.send({ user });
    },
  });

  // ─── WebAuthn / Passkey Routes ──────────────────────────────────

  /**
   * POST /auth/webauthn/register/options
   * Generates passkey registration options for a user.
   * Authorization: Bearer <ssoToken>
   */
  app.post("/auth/webauthn/register/options", {
    config: {
      rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW },
    },
    handler: async (request, reply) => {
      const authHeader = request.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return reply.code(401).send({ error: "Authorization token required" });

      const userId = verifyMasterSSOToken(token, SSO_SECRET);
      if (!userId) return reply.code(401).send({ error: "Invalid or expired token" });

      try {
        const options = await generatePasskeyRegistrationOptions(userId);
        return reply.send(options);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Failed to generate options" });
      }
    },
  });

  /**
   * POST /auth/webauthn/register/verify
   * Verifies and stores a passkey registration response.
   * Authorization: Bearer <ssoToken>
   * Body: { response: RegistrationResponseJSON, credentialName?: string }
   */
  app.post<{ Body: { response: RegistrationResponseJSON; credentialName?: string } }>(
    "/auth/webauthn/register/verify",
    {
      config: {
        rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW },
      },
      handler: async (request, reply) => {
        const authHeader = request.headers["authorization"];
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return reply.code(401).send({ error: "Authorization token required" });

        const userId = verifyMasterSSOToken(token, SSO_SECRET);
        if (!userId) return reply.code(401).send({ error: "Invalid or expired token" });

        const { response, credentialName } = request.body;
        if (!response) return reply.code(400).send({ error: "response field required" });

        try {
          const result = await verifyPasskeyRegistration(userId, response, credentialName);
          if (!result.verified) {
            return reply.code(400).send({ error: "Passkey registration verification failed" });
          }
          return reply.code(201).send({
            message: "Passkey registered successfully",
            credentialId: result.credentialId,
          });
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : "Registration failed" });
        }
      },
    }
  );

  /**
   * POST /auth/webauthn/authenticate/options
   * Generates passkey authentication options for a user.
   * Body: { email: string }
   */
  app.post<{ Body: { email: string } }>("/auth/webauthn/authenticate/options", {
    config: {
      rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW },
    },
    handler: async (request, reply) => {
      const { email } = request.body;
      if (!email) return reply.code(400).send({ error: "email required" });

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        // Return generic error to prevent user enumeration
        return reply.code(400).send({ error: "No passkeys found for this account" });
      }

      try {
        const options = await generatePasskeyAuthenticationOptions(user.id);
        return reply.send(options);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "Failed to generate options" });
      }
    },
  });

  /**
   * POST /auth/webauthn/authenticate/verify
   * Verifies a passkey authentication response and issues session tokens.
   * Body: { email: string, response: AuthenticationResponseJSON }
   */
  app.post<{ Body: { email: string; response: AuthenticationResponseJSON } }>(
    "/auth/webauthn/authenticate/verify",
    {
      config: {
        rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW },
      },
      handler: async (request, reply) => {
        const { email, response } = request.body;
        if (!email || !response) {
          return reply.code(400).send({ error: "email and response fields required" });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          return reply.code(404).send({ error: "User not found" });
        }

        try {
          const result = await verifyPasskeyAuthentication(user.id, response);
          if (!result.verified) {
            return reply.code(401).send({ error: "Passkey authentication failed" });
          }

          const ip = (request.headers["x-forwarded-for"] as string) || request.ip || "";
          const userAgent = request.headers["user-agent"] || "";

          const tokens = await issueSessionTokens(
            user.id,
            user.biometricHash,
            { userAgent, ip },
            "full"
          );

          return reply.send({
            user: { id: user.id, displayName: user.displayName, email: user.email },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            sessionId: tokens.sessionId,
          });
        } catch (err) {
          return reply
            .code(401)
            .send({ error: err instanceof Error ? err.message : "Authentication failed" });
        }
      },
    }
  );

  /**
   * GET /auth/webauthn/credentials
   * Lists passkeys registered for the authenticated user.
   * Authorization: Bearer <ssoToken>
   */
  app.get(
    "/auth/webauthn/credentials",
    { preHandler: async (request, reply) => {
      const authHeader = request.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return reply.code(401).send({ error: "Authorization token required" });
      const userId = verifyMasterSSOToken(token, SSO_SECRET);
      if (!userId) return reply.code(401).send({ error: "Invalid or expired token" });
      (request as Record<string, unknown> & typeof request)._authedUserId = userId;
    }},
    async (request, reply) => {
      const userId = (request as Record<string, unknown> & typeof request)._authedUserId as string;
      const credentials = await listUserCredentials(userId);
      return reply.send({
        credentials: credentials.map((c) => ({
          id: c.id,
          name: c.name,
          deviceType: c.deviceType,
          backedUp: c.backedUp,
          createdAt: c.createdAt,
          lastUsedAt: c.lastUsedAt,
        })),
      });
    }
  );

  /**
   * POST /auth/refresh
   * Issues a new access token using a valid refresh token.
   * Body: { refreshToken: string }
   */
  app.post<{ Body: { refreshToken: string } }>("/auth/refresh", {
    config: {
      rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW },
    },
    handler: async (request, reply) => {
      const { refreshToken } = request.body;
      if (!refreshToken) return reply.code(400).send({ error: "refreshToken required" });

      const ip = (request.headers["x-forwarded-for"] as string) || request.ip || "";
      const userAgent = request.headers["user-agent"] || "";

      const { rotateRefreshToken } = await import("../services/SessionManager");
      const tokens = await rotateRefreshToken(refreshToken, { userAgent, ip });

      if (!tokens) {
        return reply.code(401).send({ error: "Invalid or expired refresh token" });
      }

      return reply.send({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        sessionId: tokens.sessionId,
      });
    },
  });
}
