/**
 * Tests for ZeroTrustGateway middleware.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";

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
import {
  zeroTrustGateway,
  zeroTrustGatewayWithLiveness,
  zeroTrustAdminGateway,
} from "../middleware/ZeroTrustGateway";
import { issueSessionTokens } from "../services/SessionManager";

const mockPrisma = prisma as unknown as {
  userSession: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

const MOCK_USER_ID = "zt-user-1";
const MOCK_BIOMETRIC = "c".repeat(64);
const MOCK_FINGERPRINT = { userAgent: "ZeroTrustTest/1.0", ip: "10.0.0.1" };

type ReplyMock = {
  sent: boolean;
  statusCode: number;
  body: unknown;
  code: (n: number) => ReplyMock;
  send: (b: unknown) => ReplyMock;
};

function createReplyMock(): ReplyMock {
  const reply: ReplyMock = {
    sent: false,
    statusCode: 200,
    body: undefined,
    code(n) {
      this.statusCode = n;
      return this;
    },
    send(b) {
      this.body = b;
      this.sent = true;
      return this;
    },
  };
  return reply;
}

function createRequestMock(authHeader?: string): FastifyRequest {
  return {
    headers: { authorization: authHeader },
    ip: "10.0.0.1",
  } as unknown as FastifyRequest;
}

async function issueMockToken(
  livenessLevel: "none" | "basic" | "full" = "basic"
) {
  mockPrisma.userSession.findMany.mockResolvedValue([]);
  mockPrisma.userSession.create.mockResolvedValue({
    id: "zt-session-1",
    refreshTokenId: "zt-rt-1",
    userId: MOCK_USER_ID,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return issueSessionTokens(
    MOCK_USER_ID,
    MOCK_BIOMETRIC,
    MOCK_FINGERPRINT,
    livenessLevel
  );
}

describe("zeroTrustGateway", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects requests with no Authorization header", async () => {
    const req = createRequestMock(undefined);
    const reply = createReplyMock();

    await zeroTrustGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as { error: string }).error).toBe("MISSING_AUTHORIZATION");
  });

  it("rejects requests with malformed Bearer token", async () => {
    const req = createRequestMock("Bearer not.a.valid.token.at.all");
    const reply = createReplyMock();

    await zeroTrustGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as { error: string }).error).toBe("INVALID_TOKEN");
  });

  it("rejects when user not found in database", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue(null);

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as { error: string }).error).toBe(
      "USER_NOT_FOUND_OR_UNVERIFIED"
    );
  });

  it("rejects when biometric hash in token does not match DB", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test",
      role: "USER",
      biometricHash: "wrong-hash",
      verified: true,
    });

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as { error: string }).error).toBe("BIOMETRIC_HASH_MISMATCH");
  });

  it("attaches zeroTrustUser to request for a valid token", async () => {
    const tokens = await issueMockToken("full");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test User",
      role: "USER",
      biometricHash: MOCK_BIOMETRIC,
      verified: true,
    });

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(false);
    const r = req as FastifyRequest & { zeroTrustUser: unknown };
    expect(r.zeroTrustUser).toBeDefined();
    expect((r.zeroTrustUser as { id: string }).id).toBe(MOCK_USER_ID);
  });

  it("rejects unverified users", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test",
      role: "USER",
      biometricHash: MOCK_BIOMETRIC,
      verified: false,
    });

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(403);
  });
});

describe("zeroTrustGatewayWithLiveness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when liveness level is not 'full'", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test",
      role: "USER",
      biometricHash: MOCK_BIOMETRIC,
      verified: true,
    });

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustGatewayWithLiveness(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as { error: string }).error).toBe("LIVENESS_REQUIRED");
  });

  it("passes when liveness level is 'full'", async () => {
    const tokens = await issueMockToken("full");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test",
      role: "USER",
      biometricHash: MOCK_BIOMETRIC,
      verified: true,
    });

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustGatewayWithLiveness(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(false);
  });
});

describe("zeroTrustAdminGateway", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-admin users with 403", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      email: "test@example.com",
      displayName: "Test",
      role: "USER",
      biometricHash: MOCK_BIOMETRIC,
      verified: true,
    });

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustAdminGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as { error: string }).error).toBe("ADMIN_REQUIRED");
  });

  it("passes for admin users", async () => {
    const tokens = await issueMockToken("basic");

    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      email: "admin@example.com",
      displayName: "Admin",
      role: "ADMIN",
      biometricHash: MOCK_BIOMETRIC,
      verified: true,
    });

    const req = createRequestMock(`Bearer ${tokens.accessToken}`);
    const reply = createReplyMock();

    await zeroTrustAdminGateway(req, reply as unknown as FastifyReply);

    expect(reply.sent).toBe(false);
  });
});
