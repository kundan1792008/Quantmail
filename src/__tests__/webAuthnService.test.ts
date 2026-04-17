/**
 * Tests for WebAuthnService – registration and authentication options,
 * credential management. Full attestation/assertion verification requires
 * a real authenticator, so those paths are covered via integration stubs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma client so tests run without a real DB
vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    webAuthnCredential: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock @simplewebauthn/server to avoid authenticator dependency
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: "mock-challenge-base64",
    rp: { name: "Quantmail", id: "localhost" },
    user: { id: "user123", name: "test@example.com", displayName: "Test User" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 60000,
    attestation: "none",
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: "cred-id-abc",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
      },
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: "auth-challenge-base64",
    timeout: 60000,
    allowCredentials: [{ id: "cred-id-abc", type: "public-key", transports: ["usb"] }],
    userVerification: "preferred",
    rpId: "localhost",
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  }),
}));

import { prisma } from "../db";
import {
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  listUserCredentials,
  removeCredential,
} from "../services/WebAuthnService";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  webAuthnCredential: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

describe("generatePasskeyRegistrationOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns registration options for a valid user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user123",
      email: "test@example.com",
      displayName: "Test User",
      webAuthnCredentials: [],
    });

    const options = await generatePasskeyRegistrationOptions("user123");
    expect(options).toBeDefined();
    expect(options).toHaveProperty("challenge");
  });

  it("throws if user not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(generatePasskeyRegistrationOptions("nonexistent")).rejects.toThrow("User not found");
  });

  it("excludes already-registered credentials from options", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user123",
      email: "test@example.com",
      displayName: "Test User",
      webAuthnCredentials: [
        { credentialId: "existing-cred", transports: '["usb"]' },
      ],
    });

    const { generateRegistrationOptions } = await import("@simplewebauthn/server");
    await generatePasskeyRegistrationOptions("user123");
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: expect.arrayContaining([
          expect.objectContaining({ id: "existing-cred" }),
        ]),
      })
    );
  });
});

describe("verifyPasskeyRegistration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies and stores a valid registration response", async () => {
    mockPrisma.webAuthnCredential.create.mockResolvedValue({ id: "cred-record-1" });

    // Need to set up a challenge first via generatePasskeyRegistrationOptions
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user123",
      email: "test@example.com",
      displayName: "Test User",
      webAuthnCredentials: [],
    });
    await generatePasskeyRegistrationOptions("user123");

    const result = await verifyPasskeyRegistration(
      "user123",
      {
        id: "cred-id-abc",
        rawId: "cred-id-abc",
        response: {
          clientDataJSON: "mock",
          attestationObject: "mock",
          transports: ["usb"],
        },
        type: "public-key",
        clientExtensionResults: {},
      } as unknown as import("@simplewebauthn/server").RegistrationResponseJSON,
      "My Security Key"
    );

    expect(result.verified).toBe(true);
    expect(result.credentialId).toBe("cred-id-abc");
    expect(mockPrisma.webAuthnCredential.create).toHaveBeenCalledOnce();
  });

  it("fails if no active challenge exists", async () => {
    await expect(
      verifyPasskeyRegistration(
        "user-no-challenge",
        {} as import("@simplewebauthn/server").RegistrationResponseJSON
      )
    ).rejects.toThrow(/challenge/i);
  });
});

describe("generatePasskeyAuthenticationOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns authentication options when credentials exist", async () => {
    mockPrisma.webAuthnCredential.findMany.mockResolvedValue([
      {
        credentialId: "cred-id-abc",
        transports: '["usb"]',
        publicKey: "mock-pk",
        counter: BigInt(0),
      },
    ]);
    const options = await generatePasskeyAuthenticationOptions("user123");
    expect(options).toBeDefined();
    expect(options).toHaveProperty("challenge");
  });

  it("throws if user has no registered credentials", async () => {
    mockPrisma.webAuthnCredential.findMany.mockResolvedValue([]);
    await expect(generatePasskeyAuthenticationOptions("user123")).rejects.toThrow(
      /No passkeys registered/
    );
  });
});

describe("verifyPasskeyAuthentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies authentication and updates counter", async () => {
    mockPrisma.webAuthnCredential.findMany.mockResolvedValue([
      {
        credentialId: "cred-id-abc",
        transports: '["usb"]',
        publicKey: "mock-pk",
        counter: BigInt(0),
      },
    ]);
    // Generate challenge first
    await generatePasskeyAuthenticationOptions("user123");

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: "cred-record-1",
      userId: "user123",
      credentialId: "cred-id-abc",
      publicKey: "bW9jaw==",
      counter: BigInt(0),
      transports: '["usb"]',
    });
    mockPrisma.webAuthnCredential.update.mockResolvedValue({});

    const result = await verifyPasskeyAuthentication("user123", {
      id: "cred-id-abc",
      rawId: "cred-id-abc",
      response: { clientDataJSON: "mock", authenticatorData: "mock", signature: "mock" },
      type: "public-key",
      clientExtensionResults: {},
    } as unknown as import("@simplewebauthn/server").AuthenticationResponseJSON);

    expect(result.verified).toBe(true);
    expect(mockPrisma.webAuthnCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ counter: BigInt(1) }) })
    );
  });

  it("throws if credential does not belong to user", async () => {
    mockPrisma.webAuthnCredential.findMany.mockResolvedValue([
      { credentialId: "cred-id-abc", transports: "[]", publicKey: "pk", counter: BigInt(0) },
    ]);
    await generatePasskeyAuthenticationOptions("user123");

    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: "cred-record-1",
      userId: "other-user",
      credentialId: "cred-id-abc",
      publicKey: "bW9jaw==",
      counter: BigInt(0),
      transports: "[]",
    });

    await expect(
      verifyPasskeyAuthentication("user123", {
        id: "cred-id-abc",
        rawId: "cred-id-abc",
        response: { clientDataJSON: "mock", authenticatorData: "mock", signature: "mock" },
        type: "public-key",
        clientExtensionResults: {},
      } as unknown as import("@simplewebauthn/server").AuthenticationResponseJSON)
    ).rejects.toThrow(/does not belong/);
  });
});

describe("listUserCredentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty array when no credentials exist", async () => {
    mockPrisma.webAuthnCredential.findMany.mockResolvedValue([]);
    const creds = await listUserCredentials("user123");
    expect(creds).toEqual([]);
  });

  it("returns mapped credentials", async () => {
    const now = new Date();
    mockPrisma.webAuthnCredential.findMany.mockResolvedValue([
      {
        id: "rec-1",
        credentialId: "cred-1",
        publicKey: "pk1",
        counter: BigInt(5),
        transports: '["internal"]',
        deviceType: "multiDevice",
        backedUp: true,
        name: "MacBook Touch ID",
        createdAt: now,
        lastUsedAt: now,
      },
    ]);
    const creds = await listUserCredentials("user123");
    expect(creds).toHaveLength(1);
    expect(creds[0]?.name).toBe("MacBook Touch ID");
    expect(creds[0]?.backedUp).toBe(true);
  });
});

describe("removeCredential", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes a credential that belongs to the user", async () => {
    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: "rec-1",
      userId: "user123",
    });
    mockPrisma.webAuthnCredential.delete.mockResolvedValue({});

    const result = await removeCredential("user123", "rec-1");
    expect(result).toBe(true);
    expect(mockPrisma.webAuthnCredential.delete).toHaveBeenCalledWith({
      where: { id: "rec-1" },
    });
  });

  it("returns false if credential belongs to a different user", async () => {
    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: "rec-1",
      userId: "other-user",
    });
    const result = await removeCredential("user123", "rec-1");
    expect(result).toBe(false);
    expect(mockPrisma.webAuthnCredential.delete).not.toHaveBeenCalled();
  });

  it("returns false if credential not found", async () => {
    mockPrisma.webAuthnCredential.findUnique.mockResolvedValue(null);
    const result = await removeCredential("user123", "nonexistent");
    expect(result).toBe(false);
  });
});
