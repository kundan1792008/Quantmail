import { describe, it, expect } from "vitest";
import {
  computeFacialHash,
  generateMasterIdHash,
  computeLivenessScore,
  verifyBiometric,
  LIVENESS_THRESHOLD,
} from "../src/services/biometric-auth.js";

describe("biometric-auth", () => {
  describe("computeFacialHash", () => {
    it("produces a deterministic SHA-256 hash", () => {
      const hash = computeFacialHash("test-image-data");
      expect(hash).toHaveLength(64); // SHA-256 hex
      expect(computeFacialHash("test-image-data")).toBe(hash);
    });

    it("produces different hashes for different inputs", () => {
      const h1 = computeFacialHash("image-a");
      const h2 = computeFacialHash("image-b");
      expect(h1).not.toBe(h2);
    });
  });

  describe("generateMasterIdHash", () => {
    it("derives the Master ID from facial hash + email", () => {
      const facialHash = computeFacialHash("face-data");
      const masterId = generateMasterIdHash(facialHash, "user@example.com");
      expect(masterId).toHaveLength(64);
    });

    it("is deterministic for the same inputs", () => {
      const facialHash = computeFacialHash("face-data");
      const m1 = generateMasterIdHash(facialHash, "a@b.com");
      const m2 = generateMasterIdHash(facialHash, "a@b.com");
      expect(m1).toBe(m2);
    });

    it("differs when email differs", () => {
      const facialHash = computeFacialHash("face-data");
      const m1 = generateMasterIdHash(facialHash, "a@b.com");
      const m2 = generateMasterIdHash(facialHash, "c@d.com");
      expect(m1).not.toBe(m2);
    });
  });

  describe("computeLivenessScore", () => {
    it("returns 0 for empty data", () => {
      expect(computeLivenessScore("")).toBe(0.0);
    });

    it("returns a low score for very short data", () => {
      expect(computeLivenessScore("abc")).toBeLessThan(LIVENESS_THRESHOLD);
    });

    it("returns a high score for diverse base64-like data", () => {
      const diverseData =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      const score = computeLivenessScore(diverseData.repeat(10));
      expect(score).toBeGreaterThanOrEqual(LIVENESS_THRESHOLD);
    });
  });

  describe("verifyBiometric", () => {
    it("rejects empty image data with STRICT_BOT_DROP", () => {
      const result = verifyBiometric({
        displayName: "Test",
        email: "test@example.com",
        imageData: "",
        captureMethod: "web_camera",
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe("STRICT_BOT_DROP");
    });

    it("accepts valid biometric input", () => {
      const imageData =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".repeat(
          10
        );
      const result = verifyBiometric({
        displayName: "Alice",
        email: "alice@corp.com",
        imageData,
        captureMethod: "capacitor_camera",
      });
      expect(result.verified).toBe(true);
      expect(result.masterIdHash).toHaveLength(64);
      expect(result.facialHash).toHaveLength(64);
    });
  });
});
