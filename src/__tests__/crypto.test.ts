import { describe, it, expect } from "vitest";
import {
  deriveBiometricHash,
  generateMasterSSOToken,
  verifyMasterSSOToken,
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

  it("should reject expired token when maxAge is enforced", async () => {
    const token = generateMasterSSOToken(userId, secret);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = verifyMasterSSOToken(token, secret, 1);
    expect(result).toBeNull();
  });
});
