import { describe, it, expect } from "vitest";
import {
  generateMessageKey,
  encryptPayload,
  decryptPayload,
  destructionPolicy,
  constantTimeEquals,
} from "../services/EphemeralMailService";

describe("EphemeralMailService / crypto primitives", () => {
  describe("generateMessageKey", () => {
    it("produces a 32-byte base64url key", () => {
      const k = generateMessageKey();
      expect(Buffer.from(k, "base64url").length).toBe(32);
    });

    it("produces unique keys per call", () => {
      const a = generateMessageKey();
      const b = generateMessageKey();
      expect(a).not.toBe(b);
    });
  });

  describe("encryptPayload / decryptPayload", () => {
    it("round-trips a UTF-8 plaintext", () => {
      const key = generateMessageKey();
      const payload = encryptPayload("Hello, Quantmail ✉️", key);
      expect(payload.algorithm).toBe("AES-256-GCM");
      expect(decryptPayload(payload, key)).toBe("Hello, Quantmail ✉️");
    });

    it("produces a fresh IV per encryption", () => {
      const key = generateMessageKey();
      const a = encryptPayload("same plaintext", key);
      const b = encryptPayload("same plaintext", key);
      expect(a.iv).not.toBe(b.iv);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it("returns null when decrypted with a different key", () => {
      const key1 = generateMessageKey();
      const key2 = generateMessageKey();
      const payload = encryptPayload("secret", key1);
      expect(decryptPayload(payload, key2)).toBeNull();
    });

    it("returns null when the auth tag is tampered with", () => {
      const key = generateMessageKey();
      const payload = encryptPayload("secret", key);
      const tampered = {
        ...payload,
        authTag: Buffer.alloc(16, 0).toString("base64url"),
      };
      expect(decryptPayload(tampered, key)).toBeNull();
    });

    it("rejects payloads with an unknown algorithm", () => {
      const key = generateMessageKey();
      const payload = encryptPayload("secret", key);
      expect(
        decryptPayload({ ...payload, algorithm: "AES-128-CBC" as never }, key)
      ).toBeNull();
    });

    it("rejects invalid key sizes", () => {
      const shortKey = Buffer.alloc(16).toString("base64url");
      expect(() => encryptPayload("hi", shortKey)).toThrow();
    });
  });

  describe("destructionPolicy", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    it("READ_ONCE has no expiry and maxReads = 1", () => {
      expect(destructionPolicy("READ_ONCE", now)).toEqual({
        expiresAt: null,
        maxReads: 1,
      });
    });

    it("SCREENSHOT_PROOF has no expiry and maxReads = 1", () => {
      expect(destructionPolicy("SCREENSHOT_PROOF", now)).toEqual({
        expiresAt: null,
        maxReads: 1,
      });
    });

    it("TIMER_1H expires 1 hour from now", () => {
      const p = destructionPolicy("TIMER_1H", now);
      expect(p.expiresAt?.getTime()).toBe(now.getTime() + 60 * 60 * 1000);
      expect(p.maxReads).toBeGreaterThan(1);
    });

    it("TIMER_24H expires 24 hours from now", () => {
      const p = destructionPolicy("TIMER_24H", now);
      expect(p.expiresAt?.getTime()).toBe(
        now.getTime() + 24 * 60 * 60 * 1000
      );
    });

    it("TIMER_7D expires 7 days from now", () => {
      const p = destructionPolicy("TIMER_7D", now);
      expect(p.expiresAt?.getTime()).toBe(
        now.getTime() + 7 * 24 * 60 * 60 * 1000
      );
    });
  });

  describe("constantTimeEquals", () => {
    it("returns true for equal strings", () => {
      expect(constantTimeEquals("abc", "abc")).toBe(true);
    });

    it("returns false for different strings", () => {
      expect(constantTimeEquals("abc", "abd")).toBe(false);
    });

    it("returns false for different lengths", () => {
      expect(constantTimeEquals("abc", "abcd")).toBe(false);
    });
  });
});
