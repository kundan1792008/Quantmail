/**
 * Unit tests for the Ephemeral E2E Inbox system.
 *
 * These tests cover the pure, database-free utility functions from:
 *   - EphemeralMailService (computeExpiresAt, isExpired, isDestroyed, isBlobSizeValid)
 *   - KeyExchangeService   (generateEphemeralKeyPair, deriveSharedSecret, deriveAesKey,
 *                           generateSalt, deriveMessageKey, fingerprintPublicKey)
 *   - MessageVault         (deriveVaultKey, encryptVaultContent, decryptVaultContent)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  computeExpiresAt,
  isExpired,
  isDestroyed,
  isBlobSizeValid,
} from "../services/EphemeralMailService";

import {
  generateEphemeralKeyPair,
  deriveSharedSecret,
  deriveAesKey,
  generateSalt,
  deriveMessageKey,
  fingerprintPublicKey,
} from "../services/KeyExchangeService";

import {
  deriveVaultKey,
  encryptVaultContent,
  decryptVaultContent,
} from "../services/MessageVault";

// ─── EphemeralMailService: computeExpiresAt ────────────────────────────────────

describe("computeExpiresAt", () => {
  it("returns null for READ_ONCE", () => {
    expect(computeExpiresAt("READ_ONCE")).toBeNull();
  });

  it("returns null for SCREENSHOT_PROOF", () => {
    expect(computeExpiresAt("SCREENSHOT_PROOF")).toBeNull();
  });

  it("returns ~1 hour in the future for TIMER_1H", () => {
    const now = Date.now();
    const expires = computeExpiresAt("TIMER_1H");
    expect(expires).not.toBeNull();
    const diff = expires!.getTime() - now;
    expect(diff).toBeGreaterThan(3_590_000); // at least 59m59s
    expect(diff).toBeLessThan(3_610_000);    // at most 1h0m10s
  });

  it("returns ~24 hours in the future for TIMER_24H", () => {
    const now = Date.now();
    const expires = computeExpiresAt("TIMER_24H");
    expect(expires).not.toBeNull();
    const diff = expires!.getTime() - now;
    expect(diff).toBeGreaterThan(24 * 3_590_000 / 24);
    expect(diff).toBeLessThanOrEqual(24 * 60 * 60 * 1_000 + 5_000);
  });

  it("returns ~7 days in the future for TIMER_7D", () => {
    const now = Date.now();
    const expires = computeExpiresAt("TIMER_7D");
    expect(expires).not.toBeNull();
    const diff = expires!.getTime() - now;
    const sevenDays = 7 * 24 * 60 * 60 * 1_000;
    expect(diff).toBeGreaterThan(sevenDays - 5_000);
    expect(diff).toBeLessThanOrEqual(sevenDays + 5_000);
  });
});

// ─── EphemeralMailService: isExpired ──────────────────────────────────────────

describe("isExpired", () => {
  it("returns false when expiresAt is null", () => {
    expect(isExpired(null)).toBe(false);
  });

  it("returns false when expiry is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isExpired(future)).toBe(false);
  });

  it("returns true when expiry is in the past", () => {
    const past = new Date(Date.now() - 1_000);
    expect(isExpired(past)).toBe(true);
  });

  it("returns true exactly at expiry boundary", () => {
    const boundary = new Date(Date.now() - 1); // 1ms ago
    expect(isExpired(boundary)).toBe(true);
  });
});

// ─── EphemeralMailService: isDestroyed ────────────────────────────────────────

describe("isDestroyed", () => {
  it("returns false when destroyedAt is null", () => {
    expect(isDestroyed(null)).toBe(false);
  });

  it("returns true when destroyedAt is a Date", () => {
    expect(isDestroyed(new Date())).toBe(true);
  });
});

// ─── EphemeralMailService: isBlobSizeValid ────────────────────────────────────

describe("isBlobSizeValid", () => {
  it("accepts small blobs", () => {
    const small = "A".repeat(100);
    expect(isBlobSizeValid(small)).toBe(true);
  });

  it("accepts blobs near the 10 MB limit", () => {
    // 10 MB × 4/3 (base64 overhead) ≈ 13.3 MB in base64 characters
    const nearLimit = "A".repeat(13_000_000);
    expect(isBlobSizeValid(nearLimit)).toBe(true);
  });

  it("rejects blobs over the 10 MB limit", () => {
    // 15 MB worth of base64 characters
    const overLimit = "A".repeat(20_000_000);
    expect(isBlobSizeValid(overLimit)).toBe(false);
  });

  it("accepts empty string", () => {
    expect(isBlobSizeValid("")).toBe(true);
  });
});

// ─── KeyExchangeService: generateEphemeralKeyPair ────────────────────────────

describe("generateEphemeralKeyPair", () => {
  it("returns publicKey and privateKey as strings", () => {
    const kp = generateEphemeralKeyPair();
    expect(typeof kp.publicKey).toBe("string");
    expect(typeof kp.privateKey).toBe("string");
    expect(kp.publicKey.length).toBeGreaterThan(0);
    expect(kp.privateKey.length).toBeGreaterThan(0);
  });

  it("generates unique key pairs each time (forward secrecy)", () => {
    const kp1 = generateEphemeralKeyPair();
    const kp2 = generateEphemeralKeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });

  it("returns base64url-encoded keys (no + or / or = padding)", () => {
    const { publicKey, privateKey } = generateEphemeralKeyPair();
    expect(publicKey).not.toContain("+");
    expect(publicKey).not.toContain("/");
    expect(publicKey).not.toContain("=");
    expect(privateKey).not.toContain("+");
    expect(privateKey).not.toContain("/");
    expect(privateKey).not.toContain("=");
  });
});

// ─── KeyExchangeService: ECDH round-trip ─────────────────────────────────────

describe("ECDH key exchange round-trip", () => {
  it("derives the same shared secret from both sides", () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();

    const aliceShared = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const bobShared = deriveSharedSecret(bob.privateKey, alice.publicKey);

    expect(aliceShared.toString("hex")).toBe(bobShared.toString("hex"));
  });

  it("shared secrets differ for different key pairs (independence)", () => {
    const alice = generateEphemeralKeyPair();
    const bob1 = generateEphemeralKeyPair();
    const bob2 = generateEphemeralKeyPair();

    const shared1 = deriveSharedSecret(alice.privateKey, bob1.publicKey);
    const shared2 = deriveSharedSecret(alice.privateKey, bob2.publicKey);

    expect(shared1.toString("hex")).not.toBe(shared2.toString("hex"));
  });
});

// ─── KeyExchangeService: deriveAesKey ────────────────────────────────────────

describe("deriveAesKey", () => {
  it("returns a 32-byte Buffer (256-bit AES key)", () => {
    const kp = generateEphemeralKeyPair();
    const salt = generateSalt();
    const shared = deriveSharedSecret(kp.privateKey, generateEphemeralKeyPair().publicKey);
    const aesKey = deriveAesKey(shared, salt);

    expect(aesKey).toBeInstanceOf(Buffer);
    expect(aesKey.length).toBe(32);
  });

  it("produces the same key for the same inputs (deterministic)", () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();
    const salt = generateSalt();

    const shared = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const key1 = deriveAesKey(shared, salt);
    const key2 = deriveAesKey(shared, salt);

    expect(key1.toString("hex")).toBe(key2.toString("hex"));
  });

  it("produces different keys for different salts", () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    const shared = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const key1 = deriveAesKey(shared, salt1);
    const key2 = deriveAesKey(shared, salt2);

    expect(key1.toString("hex")).not.toBe(key2.toString("hex"));
  });
});

// ─── KeyExchangeService: deriveMessageKey ────────────────────────────────────

describe("deriveMessageKey", () => {
  it("is symmetric: both parties derive the same key", () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();
    const salt = generateSalt();

    const aliceKey = deriveMessageKey(alice.privateKey, bob.publicKey, salt);
    const bobKey = deriveMessageKey(bob.privateKey, alice.publicKey, salt);

    expect(aliceKey.toString("hex")).toBe(bobKey.toString("hex"));
    expect(aliceKey.length).toBe(32);
  });
});

// ─── KeyExchangeService: generateSalt ────────────────────────────────────────

describe("generateSalt", () => {
  it("returns a non-empty base64url string", () => {
    const salt = generateSalt();
    expect(typeof salt).toBe("string");
    expect(salt.length).toBeGreaterThan(0);
  });

  it("generates unique salts each time", () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    expect(s1).not.toBe(s2);
  });
});

// ─── KeyExchangeService: fingerprintPublicKey ─────────────────────────────────

describe("fingerprintPublicKey", () => {
  it("returns a colon-separated hex fingerprint", () => {
    const { publicKey } = generateEphemeralKeyPair();
    const fp = fingerprintPublicKey(publicKey);
    expect(fp).toMatch(/^[0-9A-F:]+$/);
    expect(fp).toContain(":");
  });

  it("produces the same fingerprint for the same key", () => {
    const { publicKey } = generateEphemeralKeyPair();
    expect(fingerprintPublicKey(publicKey)).toBe(fingerprintPublicKey(publicKey));
  });

  it("produces different fingerprints for different keys", () => {
    const kp1 = generateEphemeralKeyPair();
    const kp2 = generateEphemeralKeyPair();
    expect(fingerprintPublicKey(kp1.publicKey)).not.toBe(
      fingerprintPublicKey(kp2.publicKey)
    );
  });
});

// ─── MessageVault: deriveVaultKey ─────────────────────────────────────────────

describe("deriveVaultKey", () => {
  const originalSecret = process.env["VAULT_ENCRYPTION_SECRET"];

  beforeEach(() => {
    process.env["VAULT_ENCRYPTION_SECRET"] = "test-vault-secret";
  });

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env["VAULT_ENCRYPTION_SECRET"] = originalSecret;
    } else {
      delete process.env["VAULT_ENCRYPTION_SECRET"];
    }
  });

  it("returns a 32-byte Buffer", () => {
    const key = deriveVaultKey("user-1", "cred-abc");
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("is deterministic for same inputs", () => {
    const k1 = deriveVaultKey("user-1", "cred-abc");
    const k2 = deriveVaultKey("user-1", "cred-abc");
    expect(k1.toString("hex")).toBe(k2.toString("hex"));
  });

  it("differs for different userIds", () => {
    const k1 = deriveVaultKey("user-1", "cred-abc");
    const k2 = deriveVaultKey("user-2", "cred-abc");
    expect(k1.toString("hex")).not.toBe(k2.toString("hex"));
  });

  it("differs for different credentialIds", () => {
    const k1 = deriveVaultKey("user-1", "cred-abc");
    const k2 = deriveVaultKey("user-1", "cred-xyz");
    expect(k1.toString("hex")).not.toBe(k2.toString("hex"));
  });

  it("differs when VAULT_ENCRYPTION_SECRET changes", () => {
    process.env["VAULT_ENCRYPTION_SECRET"] = "secret-A";
    const k1 = deriveVaultKey("user-1", "cred-abc");
    process.env["VAULT_ENCRYPTION_SECRET"] = "secret-B";
    const k2 = deriveVaultKey("user-1", "cred-abc");
    expect(k1.toString("hex")).not.toBe(k2.toString("hex"));
  });
});

// ─── MessageVault: encrypt / decrypt round-trip ───────────────────────────────

describe("MessageVault encrypt/decrypt round-trip", () => {
  const userId = "user-vault-test";
  const credId = "cred-test-001";

  beforeEach(() => {
    process.env["VAULT_ENCRYPTION_SECRET"] = "unit-test-vault-secret";
  });

  it("decrypts to original plaintext", () => {
    const plain = "Hello, this is a secret vault message!";
    const vaultKey = deriveVaultKey(userId, credId);
    const encrypted = encryptVaultContent(plain, vaultKey);
    const decrypted = decryptVaultContent(encrypted, vaultKey);
    expect(decrypted).toBe(plain);
  });

  it("handles empty string content", () => {
    const vaultKey = deriveVaultKey(userId, credId);
    const encrypted = encryptVaultContent("", vaultKey);
    const decrypted = decryptVaultContent(encrypted, vaultKey);
    expect(decrypted).toBe("");
  });

  it("handles unicode content", () => {
    const plain = "🔐 Quantmail セキュア メッセージ — Ñoño";
    const vaultKey = deriveVaultKey(userId, credId);
    const encrypted = encryptVaultContent(plain, vaultKey);
    const decrypted = decryptVaultContent(encrypted, vaultKey);
    expect(decrypted).toBe(plain);
  });

  it("handles large content", () => {
    const plain = "x".repeat(100_000);
    const vaultKey = deriveVaultKey(userId, credId);
    const encrypted = encryptVaultContent(plain, vaultKey);
    const decrypted = decryptVaultContent(encrypted, vaultKey);
    expect(decrypted).toBe(plain);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const plain = "same plaintext";
    const vaultKey = deriveVaultKey(userId, credId);
    const enc1 = encryptVaultContent(plain, vaultKey);
    const enc2 = encryptVaultContent(plain, vaultKey);
    expect(enc1.toString("hex")).not.toBe(enc2.toString("hex"));
  });

  it("throws when decrypting with wrong key (authentication failure)", () => {
    const plain = "secret message";
    const correctKey = deriveVaultKey(userId, credId);
    const wrongKey = deriveVaultKey(userId, "wrong-cred");
    const encrypted = encryptVaultContent(plain, correctKey);
    expect(() => decryptVaultContent(encrypted, wrongKey)).toThrow();
  });

  it("throws on truncated / tampered ciphertext", () => {
    const vaultKey = deriveVaultKey(userId, credId);
    const encrypted = encryptVaultContent("data", vaultKey);
    const tampered = encrypted.slice(0, 20); // truncate brutally
    expect(() => decryptVaultContent(tampered, vaultKey)).toThrow();
  });
});

// ─── Forward secrecy property test ────────────────────────────────────────────

describe("Forward secrecy: each message key is independent", () => {
  it("compromising one message key reveals nothing about another", () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    // Message 1: alice sends to bob
    const msg1Key = deriveMessageKey(alice.privateKey, bob.publicKey, salt1);

    // Message 2: fresh key pair for alice (forward secrecy)
    const aliceNew = generateEphemeralKeyPair();
    const msg2Key = deriveMessageKey(aliceNew.privateKey, bob.publicKey, salt2);

    // Keys must be different even though same recipient
    expect(msg1Key.toString("hex")).not.toBe(msg2Key.toString("hex"));

    // Knowing msg1Key doesn't allow deriving msg2Key
    // (structural test: different inputs produce different outputs)
    const msg2KeyAttempt = deriveMessageKey(alice.privateKey, bob.publicKey, salt2);
    expect(msg2Key.toString("hex")).not.toBe(msg2KeyAttempt.toString("hex"));
  });
});
