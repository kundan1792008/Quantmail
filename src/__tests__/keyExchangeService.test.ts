import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  generateEphemeralPair,
  deriveSharedSecret,
  fingerprintPublicKey,
  publicKeysEqual,
  encryptPrivateKey,
  decryptPrivateKey,
  hkdf,
} from "../services/KeyExchangeService";

describe("KeyExchangeService / pure primitives", () => {
  describe("generateKeyPair", () => {
    it("produces a unique P-256 pair with matching fingerprint", () => {
      const pair = generateKeyPair("ECDH_P256");
      expect(pair.algorithm).toBe("ECDH_P256");
      expect(pair.publicKey.length).toBeGreaterThan(0);
      expect(pair.privateKey.length).toBeGreaterThan(0);
      expect(pair.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(pair.fingerprint).toBe(fingerprintPublicKey(pair.publicKey));
    });

    it("supports P-384", () => {
      const pair = generateKeyPair("ECDH_P384");
      expect(pair.algorithm).toBe("ECDH_P384");
      // P-384 public keys are longer than P-256.
      const p256 = generateKeyPair("ECDH_P256");
      expect(Buffer.from(pair.publicKey, "base64url").length).toBeGreaterThan(
        Buffer.from(p256.publicKey, "base64url").length
      );
    });

    it("generates distinct pairs on each call", () => {
      const a = generateEphemeralPair();
      const b = generateEphemeralPair();
      expect(a.privateKey).not.toBe(b.privateKey);
      expect(a.publicKey).not.toBe(b.publicKey);
    });
  });

  describe("deriveSharedSecret", () => {
    it("is symmetric: Alice(priv) ⊕ Bob(pub) === Bob(priv) ⊕ Alice(pub)", () => {
      const alice = generateKeyPair();
      const bob = generateKeyPair();
      const s1 = deriveSharedSecret(alice.privateKey, bob.publicKey, {
        info: "msg-123",
      });
      const s2 = deriveSharedSecret(bob.privateKey, alice.publicKey, {
        info: "msg-123",
      });
      expect(s1.equals(s2)).toBe(true);
    });

    it("yields different secrets for different `info` strings", () => {
      const alice = generateKeyPair();
      const bob = generateKeyPair();
      const s1 = deriveSharedSecret(alice.privateKey, bob.publicKey, {
        info: "msg-1",
      });
      const s2 = deriveSharedSecret(alice.privateKey, bob.publicKey, {
        info: "msg-2",
      });
      expect(s1.equals(s2)).toBe(false);
    });

    it("yields 32 bytes by default and honours custom length", () => {
      const a = generateKeyPair();
      const b = generateKeyPair();
      expect(deriveSharedSecret(a.privateKey, b.publicKey).length).toBe(32);
      expect(
        deriveSharedSecret(a.privateKey, b.publicKey, { length: 64 }).length
      ).toBe(64);
    });
  });

  describe("publicKeysEqual", () => {
    it("true for same key", () => {
      const p = generateKeyPair();
      expect(publicKeysEqual(p.publicKey, p.publicKey)).toBe(true);
    });
    it("false for different keys", () => {
      const a = generateKeyPair();
      const b = generateKeyPair();
      expect(publicKeysEqual(a.publicKey, b.publicKey)).toBe(false);
    });
    it("false for malformed input", () => {
      const a = generateKeyPair();
      expect(publicKeysEqual(a.publicKey, a.publicKey.slice(0, -4))).toBe(false);
    });
  });

  describe("encryptPrivateKey / decryptPrivateKey", () => {
    it("round-trips a private key", () => {
      const pair = generateKeyPair();
      const enc = encryptPrivateKey(pair.privateKey);
      expect(enc.startsWith("v1.")).toBe(true);
      expect(decryptPrivateKey(enc)).toBe(pair.privateKey);
    });

    it("returns null for tampered ciphertext", () => {
      const pair = generateKeyPair();
      const enc = encryptPrivateKey(pair.privateKey);
      const parts = enc.split(".");
      parts[4] = Buffer.from("tampered").toString("base64url");
      expect(decryptPrivateKey(parts.join("."))).toBeNull();
    });

    it("returns null for malformed input", () => {
      expect(decryptPrivateKey("nonsense")).toBeNull();
      expect(decryptPrivateKey("v2.a.b.c.d")).toBeNull();
    });
  });

  describe("hkdf", () => {
    it("produces deterministic output for identical inputs", () => {
      const ikm = Buffer.from("input-key-material");
      const salt = Buffer.from("salt");
      const info = Buffer.from("info");
      const a = hkdf(ikm, salt, info, 32);
      const b = hkdf(ikm, salt, info, 32);
      expect(a.equals(b)).toBe(true);
      expect(a.length).toBe(32);
    });

    it("differs when salt, info, or ikm changes", () => {
      const ikm = Buffer.from("ikm");
      expect(
        hkdf(ikm, Buffer.from("s1"), Buffer.from("i"), 32).equals(
          hkdf(ikm, Buffer.from("s2"), Buffer.from("i"), 32)
        )
      ).toBe(false);
      expect(
        hkdf(ikm, Buffer.from("s"), Buffer.from("i1"), 32).equals(
          hkdf(ikm, Buffer.from("s"), Buffer.from("i2"), 32)
        )
      ).toBe(false);
    });

    it("throws for out-of-range length", () => {
      expect(() =>
        hkdf(Buffer.from("x"), Buffer.from("s"), Buffer.from("i"), 0)
      ).toThrow();
      expect(() =>
        hkdf(Buffer.from("x"), Buffer.from("s"), Buffer.from("i"), 255 * 32 + 1)
      ).toThrow();
    });
  });
});
