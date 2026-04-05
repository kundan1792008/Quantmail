/**
 * Shared Auth Middleware
 *
 * Reusable Fastify preHandler hooks for verifying Master SSO tokens.
 * Import `requireAuth` or `requireAdmin` in any route file to protect endpoints.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { verifyMasterSSOToken } from "../utils/crypto";
import { prisma } from "../db";

const SSO_SECRET = process.env["SSO_SECRET"] || "quantmail-dev-secret";

/** Shape of the authenticated user attached to the request. */
export interface AuthenticatedUser {
  id: string;
  displayName: string;
  email: string;
  verified: boolean;
  role: string;
}

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns null if the header is absent or malformed.
 */
export function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Fastify preHandler – verifies the SSO token and attaches the user to the request.
 * Responds with 401 if the token is missing or invalid, 404 if the user is not found.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    return reply
      .code(401)
      .send({ error: "Authorization token required" });
  }

  const userId = verifyMasterSSOToken(token, SSO_SECRET);
  if (!userId) {
    return reply
      .code(401)
      .send({ error: "Invalid or expired token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      displayName: true,
      email: true,
      verified: true,
      role: true,
    },
  });

  if (!user) {
    return reply.code(404).send({ error: "User not found" });
  }

  (request as FastifyRequest & { user: AuthenticatedUser }).user = user;
}

/**
 * Fastify preHandler – same as requireAuth but additionally enforces the ADMIN role.
 * Responds with 403 if the authenticated user is not an admin.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await requireAuth(request, reply);
  // If requireAuth already sent a reply (error), stop processing.
  if (reply.sent) return;

  const authedRequest = request as FastifyRequest & {
    user: AuthenticatedUser;
  };
  if (authedRequest.user.role !== "ADMIN") {
    return reply.code(403).send({ error: "Admin access required" });
  }
}
