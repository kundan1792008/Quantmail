import { describe, it, expect } from "vitest";
import {
  deriveBiometricHash,
  generateMasterSSOToken,
  verifyMasterSSOToken,
  hashSecret,
  verifySecret,
} from "../utils/crypto";

describe("deriveBiometricHash", () => {
  it("should produce a deterministic hex hash", () => {
    const hash = deriveBiometricHash("test-matrix-data");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should produce the same hash for the same input", () => {
    const a = deriveBiometricHash("same-input");
    const b = deriveBiometricHash("same-input");
    expect(a).toBe(b);
  });

  it("should produce different hashes for different inputs", () => {
    const a = deriveBiometricHash("input-a");
    const b = deriveBiometricHash("input-b");
    expect(a).not.toBe(b);
  });
});

describe("Master SSO Token", () => {
  const secret = "test-secret";
  const userId = "user-123";

  it("should generate a token with two dot-separated parts", () => {
    const token = generateMasterSSOToken(userId, secret);
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it("should verify a valid token and return the userId", () => {
    const token = generateMasterSSOToken(userId, secret);
    const result = verifyMasterSSOToken(token, secret);
    expect(result).toBe(userId);
  });

  it("should reject a token with wrong secret", () => {
    const token = generateMasterSSOToken(userId, secret);
    const result = verifyMasterSSOToken(token, "wrong-secret");
    expect(result).toBeNull();
  });

  it("should reject a tampered token", () => {
    const token = generateMasterSSOToken(userId, secret);
    const tampered = token.slice(0, -4) + "XXXX";
    const result = verifyMasterSSOToken(tampered, secret);
    expect(result).toBeNull();
  });

  it("should reject malformed tokens", () => {
    expect(verifyMasterSSOToken("", secret)).toBeNull();
    expect(verifyMasterSSOToken("single-part", secret)).toBeNull();
    expect(verifyMasterSSOToken("a.b.c", secret)).toBeNull();
  });
});

describe("Argon2 key derivation", () => {
  it("hashSecret should produce a string starting with $argon2id$", async () => {
    const hash = await hashSecret("super-secret");
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it("verifySecret should return true for a matching secret", async () => {
    const hash = await hashSecret("my-password");
    const result = await verifySecret(hash, "my-password");
    expect(result).toBe(true);
  });

  it("verifySecret should return false for a wrong secret", async () => {
    const hash = await hashSecret("correct-password");
    const result = await verifySecret(hash, "wrong-password");
    expect(result).toBe(false);
  });

  it("verifySecret should return false for a garbage hash", async () => {
    const result = await verifySecret("not-a-hash", "anything");
    expect(result).toBe(false);
  });

  it("hashSecret should produce different hashes for the same input (salted)", async () => {
    const a = await hashSecret("same-input");
    const b = await hashSecret("same-input");
    expect(a).not.toBe(b);
  });
});
