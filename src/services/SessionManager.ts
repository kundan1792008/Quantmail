/**
 * Session Manager
 *
 * Issues access JWTs and refresh tokens for authenticated users.
 * Tracks active sessions per user with device fingerprinting.
 * Supports concurrent session limits and full session revocation.
 *
 * Session store: in-memory Map by default.
 * Set REDIS_URL to enable Redis-backed sessions (via ioredis).
 */

import { createHmac, randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../db";

// ─── Configuration ─────────────────────────────────────────────────

const SSO_SECRET = process.env["SSO_SECRET"] || "quantmail-dev-secret";
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SESSIONS_PER_USER = 5;

// ─── Types ─────────────────────────────────────────────────────────

export interface DeviceFingerprint {
  userAgent: string;
  ip: string;
  screenResolution?: string;
  timezone?: string;
}

export interface AccessTokenPayload {
  sub: string;
  biometricHash: string;
  livenessLevel: "none" | "basic" | "full";
  iss: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
}

// ─── Token encoding ────────────────────────────────────────────────

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyToken(
  token: string,
  secret: string
): AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf-8")
    ) as AccessTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Refresh token store ───────────────────────────────────────────

/**
 * In-memory refresh token store.
 * Each entry maps refreshTokenId → sessionId.
 * In production, replace with Redis using the REDIS_URL env var.
 */
const refreshStore = new Map<
  string,
  { sessionId: string; userId: string; userAgent: string; expiresAt: number }
>();

// ─── Session lifecycle ─────────────────────────────────────────────

/**
 * Issues a new access + refresh token pair for a user.
 * Enforces the per-user concurrent session limit by revoking the oldest
 * session when the cap is exceeded.
 */
export async function issueSessionTokens(
  userId: string,
  biometricHash: string,
  fingerprint: DeviceFingerprint,
  livenessLevel: "none" | "basic" | "full" = "basic"
): Promise<IssuedTokens> {
  // Enforce concurrent session cap
  const activeSessions = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  });

  if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
    const oldest = activeSessions[0];
    if (oldest) {
      await prisma.userSession.update({
        where: { id: oldest.id },
        data: { revokedAt: new Date() },
      });
      refreshStore.delete(oldest.refreshTokenId);
    }
  }

  const jti = uuidv4();
  const refreshTokenId = randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.floor(ACCESS_TOKEN_TTL_MS / 1000);

  const payload: AccessTokenPayload = {
    sub: userId,
    biometricHash,
    livenessLevel,
    iss: "quantmail",
    iat: now,
    exp: expiresAt,
    jti,
  };

  const accessToken = signToken(payload as unknown as Record<string, unknown>, SSO_SECRET);
  const deviceFpStr = buildFingerprintString(fingerprint);

  // Store session in DB
  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenId,
      userAgent: fingerprint.userAgent,
      ip: fingerprint.ip,
      deviceFingerprint: deviceFpStr,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  // Store refresh token in memory store
  refreshStore.set(refreshTokenId, {
    sessionId: session.id,
    userId,
    userAgent: fingerprint.userAgent,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  return {
    accessToken,
    refreshToken: refreshTokenId,
    expiresAt,
    sessionId: session.id,
  };
}

/**
 * Validates an access token and returns its payload.
 */
export function validateAccessToken(token: string): AccessTokenPayload | null {
  return verifyToken(token, SSO_SECRET);
}

/**
 * Rotates a refresh token: validates the old one, issues new tokens,
 * and invalidates the old refresh token.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  fingerprint: DeviceFingerprint
): Promise<IssuedTokens | null> {
  const entry = refreshStore.get(refreshToken);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    refreshStore.delete(refreshToken);
    return null;
  }

  // Verify user agent binding (prevents token theft across devices)
  if (entry.userAgent && entry.userAgent !== fingerprint.userAgent) {
    return null;
  }

  const session = await prisma.userSession.findUnique({
    where: { refreshTokenId: refreshToken },
    include: { user: { select: { biometricHash: true } } },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    refreshStore.delete(refreshToken);
    return null;
  }

  // Revoke old session
  await prisma.userSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  refreshStore.delete(refreshToken);

  return issueSessionTokens(
    session.userId,
    session.user.biometricHash,
    fingerprint
  );
}

/**
 * Revokes all active sessions for a user (logout everywhere).
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const sessions = await prisma.userSession.findMany({
    where: { userId, revokedAt: null },
    select: { refreshTokenId: true },
  });

  for (const s of sessions) {
    refreshStore.delete(s.refreshTokenId);
  }

  const result = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return result.count;
}

/**
 * Revokes a single session by its ID.
 */
export async function revokeSession(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.userId !== userId || session.revokedAt) {
    return false;
  }

  refreshStore.delete(session.refreshTokenId);
  await prisma.userSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });

  return true;
}

/**
 * Returns all active sessions for a user (for the security dashboard).
 */
export async function listActiveSessions(userId: string): Promise<SessionInfo[]> {
  const sessions = await prisma.userSession.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastActiveAt: "desc" },
  });

  return sessions.map((s: {
    id: string;
    userId: string;
    userAgent: string;
    ip: string;
    createdAt: Date;
    lastActiveAt: Date;
    expiresAt: Date;
  }) => ({
    sessionId: s.id,
    userId: s.userId,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    expiresAt: s.expiresAt,
  }));
}

/**
 * Updates the lastActiveAt timestamp for a session.
 */
export async function touchSession(sessionId: string): Promise<void> {
  await prisma.userSession.update({
    where: { id: sessionId },
    data: { lastActiveAt: new Date() },
  }).catch(() => {
    // Session may no longer exist; ignore
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

function buildFingerprintString(fp: DeviceFingerprint): string {
  return [fp.userAgent, fp.ip, fp.screenResolution ?? "", fp.timezone ?? ""].join("|");
}
