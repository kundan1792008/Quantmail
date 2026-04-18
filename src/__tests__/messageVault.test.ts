import { describe, it, expect } from "vitest";
import {
  deriveVaultKey,
  wrapKey,
  unwrapKey,
  mintUnlockToken,
  verifyUnlockToken,
  VAULT_CAPACITY,
} from "../services/MessageVault";
import { randomBytes } from "node:crypto";

describe("MessageVault / key wrapping", () => {
  describe("deriveVaultKey", () => {
    it("is deterministic per user", () => {
      const a = deriveVaultKey("user-1");
      const b = deriveVaultKey("user-1");
      expect(a.equals(b)).toBe(true);
      expect(a.length).toBe(32);
    });

    it("is distinct per user", () => {
      const a = deriveVaultKey("user-1");
      const b = deriveVaultKey("user-2");
      expect(a.equals(b)).toBe(false);
    });
  });

  describe("wrapKey / unwrapKey", () => {
    const plainKey = randomBytes(32).toString("base64url");

    it("round-trips", () => {
      const wrapped = wrapKey(plainKey, "user-1");
      expect(unwrapKey(wrapped, "user-1")).toBe(plainKey);
    });

    it("cannot be unwrapped by a different user", () => {
      const wrapped = wrapKey(plainKey, "user-1");
      expect(unwrapKey(wrapped, "user-2")).toBeNull();
    });

    it("returns null when auth tag is tampered", () => {
      const wrapped = wrapKey(plainKey, "user-1");
      const tampered = {
        ...wrapped,
        authTag: Buffer.alloc(16, 0).toString("base64url"),
      };
      expect(unwrapKey(tampered, "user-1")).toBeNull();
    });

    it("rejects non-32-byte plaintext keys", () => {
      const short = randomBytes(16).toString("base64url");
      expect(() => wrapKey(short, "user-1")).toThrow();
    });
  });
});

describe("MessageVault / unlock tokens", () => {
  it("mints and verifies a fresh token", () => {
    const token = mintUnlockToken("user-abc");
    expect(verifyUnlockToken(token)).toBe("user-abc");
  });

  it("rejects tampered tokens", () => {
    const token = mintUnlockToken("user-abc");
    const parts = token.split(".");
    parts[1] = "user-xyz";
    expect(verifyUnlockToken(parts.join("."))).toBeNull();
  });

  it("rejects tokens past their expiry", () => {
    const past = new Date(Date.now() - 10 * 60 * 1000);
    const token = mintUnlockToken("user-abc", past);
    expect(verifyUnlockToken(token)).toBeNull();
  });

  it("rejects tokens with the wrong version", () => {
    const token = mintUnlockToken("user-abc");
    const parts = token.split(".");
    parts[0] = "v2";
    expect(verifyUnlockToken(parts.join("."))).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyUnlockToken("not-a-token")).toBeNull();
    expect(verifyUnlockToken("v1.u.0.0.")).toBeNull();
  });
});

describe("MessageVault / capacity constant", () => {
  it("is set to 100 as required by issue #45", () => {
    expect(VAULT_CAPACITY).toBe(100);
  });
});
