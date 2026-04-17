/**
 * Tests for SessionManager – token issuance, validation, rotation and revocation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("../db", () => ({
  prisma: {
    userSession: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "../db";
import {
  issueSessionTokens,
  validateAccessToken,
  rotateRefreshToken,
  revokeAllSessions,
  revokeSession,
  listActiveSessions,
} from "../services/SessionManager";

const mockPrisma = prisma as unknown as {
  userSession: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

const MOCK_USER_ID = "user-abc-123";
const MOCK_BIOMETRIC_HASH = "a".repeat(64);
const MOCK_FINGERPRINT = { userAgent: "TestAgent/1.0", ip: "127.0.0.1" };

function mockSessionCreate(sessionId = "session-1", refreshTokenId = "rt-1") {
  mockPrisma.userSession.findMany.mockResolvedValue([]);
  mockPrisma.userSession.create.mockResolvedValue({
    id: sessionId,
    refreshTokenId,
    userId: MOCK_USER_ID,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}

describe("issueSessionTokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues access token and refresh token", async () => {
    mockSessionCreate();
    const tokens = await issueSessionTokens(
      MOCK_USER_ID,
      MOCK_BIOMETRIC_HASH,
      MOCK_FINGERPRINT
    );

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.sessionId).toBe("session-1");
    expect(typeof tokens.expiresAt).toBe("number");
  });

  it("access token contains correct claims", async () => {
    mockSessionCreate();
    const tokens = await issueSessionTokens(
      MOCK_USER_ID,
      MOCK_BIOMETRIC_HASH,
      MOCK_FINGERPRINT,
      "full"
    );

    const payload = validateAccessToken(tokens.accessToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(MOCK_USER_ID);
    expect(payload!.biometricHash).toBe(MOCK_BIOMETRIC_HASH);
    expect(payload!.livenessLevel).toBe("full");
    expect(payload!.iss).toBe("quantmail");
  });

  it("enforces max session limit by revoking the oldest session", async () => {
    const oldSessions = Array.from({ length: 5 }, (_, i) => ({
      id: `session-${i}`,
      refreshTokenId: `rt-${i}`,
      userId: MOCK_USER_ID,
    }));
    mockPrisma.userSession.findMany.mockResolvedValue(oldSessions);
    mockPrisma.userSession.update.mockResolvedValue({});
    mockPrisma.userSession.create.mockResolvedValue({
      id: "session-new",
      refreshTokenId: "rt-new",
      userId: MOCK_USER_ID,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await issueSessionTokens(MOCK_USER_ID, MOCK_BIOMETRIC_HASH, MOCK_FINGERPRINT);

    // Should have revoked the oldest (first) session
    expect(mockPrisma.userSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "session-0" },
        data: { revokedAt: expect.any(Date) },
      })
    );
  });
});

describe("validateAccessToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns payload for a valid token", async () => {
    mockSessionCreate();
    const tokens = await issueSessionTokens(
      MOCK_USER_ID,
      MOCK_BIOMETRIC_HASH,
      MOCK_FINGERPRINT
    );
    const payload = validateAccessToken(tokens.accessToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(MOCK_USER_ID);
  });

  it("returns null for a tampered token", async () => {
    mockSessionCreate();
    const tokens = await issueSessionTokens(
      MOCK_USER_ID,
      MOCK_BIOMETRIC_HASH,
      MOCK_FINGERPRINT
    );
    const tampered = tokens.accessToken.slice(0, -5) + "XXXXX";
    const payload = validateAccessToken(tampered);
    expect(payload).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(validateAccessToken("")).toBeNull();
  });

  it("returns null for a token with wrong number of parts", () => {
    expect(validateAccessToken("only.two")).toBeNull();
  });
});

describe("revokeAllSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes all active sessions for a user", async () => {
    mockPrisma.userSession.findMany.mockResolvedValue([
      { refreshTokenId: "rt-1" },
      { refreshTokenId: "rt-2" },
    ]);
    mockPrisma.userSession.updateMany.mockResolvedValue({ count: 2 });

    const count = await revokeAllSessions(MOCK_USER_ID);
    expect(count).toBe(2);
    expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: MOCK_USER_ID }),
        data: { revokedAt: expect.any(Date) },
      })
    );
  });

  it("returns 0 when no active sessions exist", async () => {
    mockPrisma.userSession.findMany.mockResolvedValue([]);
    mockPrisma.userSession.updateMany.mockResolvedValue({ count: 0 });

    const count = await revokeAllSessions(MOCK_USER_ID);
    expect(count).toBe(0);
  });
});

describe("revokeSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes a specific session belonging to the user", async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: MOCK_USER_ID,
      refreshTokenId: "rt-1",
      revokedAt: null,
    });
    mockPrisma.userSession.update.mockResolvedValue({});

    const result = await revokeSession(MOCK_USER_ID, "session-1");
    expect(result).toBe(true);
  });

  it("returns false for a session belonging to another user", async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "other-user",
      refreshTokenId: "rt-1",
      revokedAt: null,
    });

    const result = await revokeSession(MOCK_USER_ID, "session-1");
    expect(result).toBe(false);
  });

  it("returns false for an already-revoked session", async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: MOCK_USER_ID,
      refreshTokenId: "rt-1",
      revokedAt: new Date(),
    });

    const result = await revokeSession(MOCK_USER_ID, "session-1");
    expect(result).toBe(false);
  });

  it("returns false when session not found", async () => {
    mockPrisma.userSession.findUnique.mockResolvedValue(null);
    const result = await revokeSession(MOCK_USER_ID, "nonexistent");
    expect(result).toBe(false);
  });
});

describe("listActiveSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns mapped session info objects", async () => {
    const now = new Date();
    mockPrisma.userSession.findMany.mockResolvedValue([
      {
        id: "s1",
        userId: MOCK_USER_ID,
        userAgent: "Firefox/120",
        ip: "10.0.0.1",
        createdAt: now,
        lastActiveAt: now,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    ]);

    const sessions = await listActiveSessions(MOCK_USER_ID);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.userAgent).toBe("Firefox/120");
    expect(sessions[0]?.ip).toBe("10.0.0.1");
  });

  it("returns empty array when no active sessions", async () => {
    mockPrisma.userSession.findMany.mockResolvedValue([]);
    const sessions = await listActiveSessions(MOCK_USER_ID);
    expect(sessions).toEqual([]);
  });
});

describe("rotateRefreshToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an unknown refresh token", async () => {
    const result = await rotateRefreshToken("unknown-token", MOCK_FINGERPRINT);
    expect(result).toBeNull();
  });

  it("rotates a valid refresh token and returns new tokens", async () => {
    // First issue tokens to populate the in-memory store
    mockPrisma.userSession.findMany.mockResolvedValue([]);
    mockPrisma.userSession.create.mockResolvedValue({
      id: "session-1",
      refreshTokenId: "rt-issued",
      userId: MOCK_USER_ID,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const initial = await issueSessionTokens(
      MOCK_USER_ID,
      MOCK_BIOMETRIC_HASH,
      MOCK_FINGERPRINT
    );

    // Set up mock for rotation
    mockPrisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      userId: MOCK_USER_ID,
      refreshTokenId: initial.refreshToken,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      user: { biometricHash: MOCK_BIOMETRIC_HASH },
    });
    mockPrisma.userSession.update.mockResolvedValue({});
    // Reset for new session creation
    mockPrisma.userSession.findMany.mockResolvedValue([]);
    mockPrisma.userSession.create.mockResolvedValue({
      id: "session-2",
      refreshTokenId: "rt-new",
      userId: MOCK_USER_ID,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const rotated = await rotateRefreshToken(initial.refreshToken, MOCK_FINGERPRINT);
    expect(rotated).not.toBeNull();
    expect(rotated!.accessToken).toBeTruthy();
    expect(rotated!.refreshToken).not.toBe(initial.refreshToken);
  });
});
