/**
 * Zero-Trust API Gateway Middleware
 *
 * All requests to protected Quant app endpoints pass through this middleware.
 * Validates:
 *  1. Authorization header contains a valid JWT access token.
 *  2. JWT contains a biometricHash claim matching the user's stored hash.
 *  3. Liveness level is acceptable for the requested resource.
 *
 * Rate limiting and CORS are handled at the Fastify plugin level (server.ts).
 * This middleware adds the per-user and per-endpoint Zero-Trust checks.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { extractBearerToken } from "./authMiddleware";
import { validateAccessToken, touchSession } from "../services/SessionManager";
import { prisma } from "../db";

// ─── Types ────────────────────────────────────────────────────────

export interface ZeroTrustUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  biometricHash: string;
  livenessLevel: "none" | "basic" | "full";
  sessionId?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    zeroTrustUser?: ZeroTrustUser;
  }
}

// ─── Zero-Trust preHandler ─────────────────────────────────────────

/**
 * Core Zero-Trust gateway preHandler.
 * Validates the access token, verifies the biometric hash claim,
 * and attaches the authenticated context to the request.
 */
export async function zeroTrustGateway(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    return reply.code(401).send({
      error: "MISSING_AUTHORIZATION",
      message: "Authorization header with Bearer token is required",
    });
  }

  const payload = validateAccessToken(token);
  if (!payload) {
    return reply.code(401).send({
      error: "INVALID_TOKEN",
      message: "Access token is invalid or expired",
    });
  }

  // Verify issuer
  if (payload.iss !== "quantmail") {
    return reply.code(401).send({
      error: "INVALID_ISSUER",
      message: "Token was not issued by Quantmail",
    });
  }

  // Fetch user and verify biometric hash claim
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      biometricHash: true,
      verified: true,
    },
  });

  if (!user || !user.verified) {
    return reply.code(403).send({
      error: "USER_NOT_FOUND_OR_UNVERIFIED",
      message: "User account not found or not verified",
    });
  }

  // Critical: the biometricHash in the token must match the DB value.
  // A mismatch means the token was forged or the user re-enrolled.
  if (user.biometricHash !== payload.biometricHash) {
    return reply.code(403).send({
      error: "BIOMETRIC_HASH_MISMATCH",
      message: "Biometric identity verification failed",
    });
  }

  // Attach the zero-trust context to the request
  request.zeroTrustUser = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    biometricHash: user.biometricHash,
    livenessLevel: payload.livenessLevel,
  };
}

/**
 * Stricter gateway variant that additionally requires full liveness verification.
 * Use for high-privilege operations (e.g., deleting an account, revoking sessions).
 */
export async function zeroTrustGatewayWithLiveness(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await zeroTrustGateway(request, reply);
  if (reply.sent) return;

  const user = request.zeroTrustUser!;
  if (user.livenessLevel !== "full") {
    return reply.code(403).send({
      error: "LIVENESS_REQUIRED",
      message: "Full biometric liveness verification required for this operation",
    });
  }
}

/**
 * Admin-only Zero-Trust gate.
 * First runs the standard zeroTrustGateway, then enforces the ADMIN role.
 */
export async function zeroTrustAdminGateway(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await zeroTrustGateway(request, reply);
  if (reply.sent) return;

  const user = request.zeroTrustUser!;
  if (user.role !== "ADMIN") {
    return reply.code(403).send({
      error: "ADMIN_REQUIRED",
      message: "Administrator privileges required",
    });
  }
}
