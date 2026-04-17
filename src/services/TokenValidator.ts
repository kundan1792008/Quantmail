/**
 * Cross-App Token Validator
 *
 * Exposes a POST /api/validate endpoint that other Quant apps can call
 * to verify access tokens. Validation results are cached in-memory for
 * 60 seconds to reduce repeated verification overhead.
 *
 * Response: { valid: true, userId, permissions: [...], livenessActive: true }
 */

import { FastifyInstance } from "fastify";
import { validateAccessToken } from "./SessionManager";
import { prisma } from "../db";

// ─── In-memory validation cache ───────────────────────────────────

interface CacheEntry {
  result: TokenValidationResult;
  cachedAt: number;
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const validationCache = new Map<string, CacheEntry>();

// Purge stale entries periodically to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of validationCache.entries()) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      validationCache.delete(key);
    }
  }
}, CACHE_TTL_MS * 2);

// ─── Types ────────────────────────────────────────────────────────

export interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  permissions?: string[];
  livenessActive?: boolean;
  livenessLevel?: string;
  role?: string;
  error?: string;
}

// ─── Permission resolver ──────────────────────────────────────────

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: [
    "read:inbox",
    "write:inbox",
    "read:drive",
    "write:drive",
    "read:calendar",
    "write:calendar",
    "read:docs",
    "write:docs",
    "read:sheets",
    "write:sheets",
    "admin:users",
    "admin:config",
  ],
  PRO: [
    "read:inbox",
    "write:inbox",
    "read:drive",
    "write:drive",
    "read:calendar",
    "write:calendar",
    "read:docs",
    "write:docs",
    "read:sheets",
    "write:sheets",
  ],
  USER: [
    "read:inbox",
    "write:inbox",
    "read:drive",
    "read:calendar",
    "write:calendar",
    "read:docs",
    "write:docs",
  ],
  FREE: [
    "read:inbox",
    "read:calendar",
    "read:docs",
  ],
};

// ─── Core validation ──────────────────────────────────────────────

/**
 * Validates an access token and returns a structured result.
 * Results are cached for 60 seconds per token.
 */
export async function validateToken(token: string): Promise<TokenValidationResult> {
  // Check cache first
  const cached = validationCache.get(token);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  const payload = validateAccessToken(token);
  if (!payload) {
    const result: TokenValidationResult = { valid: false, error: "Invalid or expired token" };
    validationCache.set(token, { result, cachedAt: Date.now() });
    return result;
  }

  // Verify biometricHash still matches what is stored in the database
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      verified: true,
      biometricHash: true,
    },
  });

  if (!user || !user.verified) {
    const result: TokenValidationResult = { valid: false, error: "User not found or unverified" };
    validationCache.set(token, { result, cachedAt: Date.now() });
    return result;
  }

  if (user.biometricHash !== payload.biometricHash) {
    const result: TokenValidationResult = {
      valid: false,
      error: "Biometric hash mismatch",
    };
    validationCache.set(token, { result, cachedAt: Date.now() });
    return result;
  }

  const livenessActive = payload.livenessLevel !== "none";
  const permissions = ROLE_PERMISSIONS[user.role] ?? ROLE_PERMISSIONS["FREE"];

  const result: TokenValidationResult = {
    valid: true,
    userId: user.id,
    permissions,
    livenessActive,
    livenessLevel: payload.livenessLevel,
    role: user.role,
  };

  validationCache.set(token, { result, cachedAt: Date.now() });
  return result;
}

/**
 * Invalidates any cached validation result for a token.
 * Call this after revoking a session so other apps can't use stale data.
 */
export function invalidateTokenCache(token: string): void {
  validationCache.delete(token);
}

// ─── Fastify route registration ────────────────────────────────────

export async function tokenValidatorRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/validate
   * Cross-app token validation endpoint.
   * Other Quant apps call this to verify access tokens.
   *
   * Body: { token: string }
   * Response: TokenValidationResult
   */
  app.post<{ Body: { token: string } }>(
    "/api/validate",
    {
      config: {
        rateLimit: { max: 500, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { token } = request.body;

      if (!token || typeof token !== "string") {
        return reply.code(400).send({ valid: false, error: "token field required" });
      }

      const result = await validateToken(token);
      return reply.code(result.valid ? 200 : 401).send(result);
    }
  );
}
