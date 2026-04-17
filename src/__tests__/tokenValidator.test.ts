/**
 * Tests for TokenValidator – token validation and caching.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("../db", () => ({
  prisma: {
    userSession: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "../db";
import { validateToken, invalidateTokenCache } from "../services/TokenValidator";
import { issueSessionTokens } from "../services/SessionManager";

const mockPrisma = prisma as unknown as {
  userSession: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

const MOCK_USER_ID = "validate-user-1";
const MOCK_BIOMETRIC = "b".repeat(64);
const MOCK_FINGERPRINT = { userAgent: "ValidatorTest/1.0", ip: "192.168.1.1" };

async function issueMockToken(livenessLevel: "none" | "basic" | "full" = "basic") {
  mockPrisma.userSession.findMany.mockResolvedValue([]);
  mockPrisma.userSession.create.mockResolvedValue({
    id: "session-v1",
    refreshTokenId: "rt-v1",
    userId: MOCK_USER_ID,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return issueSessionTokens(MOCK_USER_ID, MOCK_BIOMETRIC, MOCK_FINGERPRINT, livenessLevel);
}

describe("validateToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns invalid result for a random string", async () => {
    const result = await validateToken("not-a-token");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("returns invalid result for an empty token", async () => {
    const result = await validateToken("");
    expect(result.valid).toBe(false);
  });

  it("returns valid result for a legitimate token with matching biometricHash", async () => {
    const tokens = await issueMockToken("full");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "USER",
      verified: true,
      biometricHash: MOCK_BIOMETRIC,
    });

    const result = await validateToken(tokens.accessToken);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(MOCK_USER_ID);
    expect(result.livenessActive).toBe(true);
    expect(result.livenessLevel).toBe("full");
    expect(Array.isArray(result.permissions)).toBe(true);
  });

  it("returns invalid when biometricHash does not match stored hash", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "USER",
      verified: true,
      biometricHash: "different-hash-that-does-not-match",
    });

    invalidateTokenCache(tokens.accessToken);
    const result = await validateToken(tokens.accessToken);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Biometric");
  });

  it("returns invalid when user is not found", async () => {
    const tokens = await issueMockToken();

    mockPrisma.user.findUnique.mockResolvedValue(null);
    invalidateTokenCache(tokens.accessToken);

    const result = await validateToken(tokens.accessToken);
    expect(result.valid).toBe(false);
  });

  it("returns invalid when user is unverified", async () => {
    const tokens = await issueMockToken();

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "USER",
      verified: false,
      biometricHash: MOCK_BIOMETRIC,
    });

    invalidateTokenCache(tokens.accessToken);
    const result = await validateToken(tokens.accessToken);
    expect(result.valid).toBe(false);
  });

  it("caches validation results to avoid repeated DB calls", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "FREE",
      verified: true,
      biometricHash: MOCK_BIOMETRIC,
    });

    invalidateTokenCache(tokens.accessToken);

    // Call twice – second call should use cache
    await validateToken(tokens.accessToken);
    await validateToken(tokens.accessToken);

    // DB should only have been called once
    expect(mockPrisma.user.findUnique).toHaveBeenCalledOnce();
  });

  it("returns correct permissions for ADMIN role", async () => {
    const tokens = await issueMockToken("full");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "ADMIN",
      verified: true,
      biometricHash: MOCK_BIOMETRIC,
    });

    invalidateTokenCache(tokens.accessToken);
    const result = await validateToken(tokens.accessToken);
    expect(result.valid).toBe(true);
    expect(result.permissions).toContain("admin:users");
    expect(result.permissions).toContain("admin:config");
  });

  it("returns correct permissions for FREE role", async () => {
    const tokens = await issueMockToken();

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "FREE",
      verified: true,
      biometricHash: MOCK_BIOMETRIC,
    });

    invalidateTokenCache(tokens.accessToken);
    const result = await validateToken(tokens.accessToken);
    expect(result.valid).toBe(true);
    expect(result.permissions).toContain("read:inbox");
    expect(result.permissions).not.toContain("admin:users");
  });

  it("livenessActive is false for none liveness level", async () => {
    const tokens = await issueMockToken("none");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "USER",
      verified: true,
      biometricHash: MOCK_BIOMETRIC,
    });

    invalidateTokenCache(tokens.accessToken);
    const result = await validateToken(tokens.accessToken);
    expect(result.valid).toBe(true);
    expect(result.livenessActive).toBe(false);
  });
});

describe("invalidateTokenCache", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forces a fresh DB lookup after cache invalidation", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      role: "USER",
      verified: true,
      biometricHash: MOCK_BIOMETRIC,
    });

    // First call populates cache
    invalidateTokenCache(tokens.accessToken);
    await validateToken(tokens.accessToken);

    // Invalidate and call again
    invalidateTokenCache(tokens.accessToken);
    await validateToken(tokens.accessToken);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
