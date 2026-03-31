import { describe, it, expect } from "vitest";
import { generateBiometricHash, generateFacialMatrixHash } from "../utils/crypto";

describe("Crypto Utils", () => {
  describe("generateFacialMatrixHash", () => {
    it("should generate deterministic hash for same input", () => {
      const hash1 = generateFacialMatrixHash("test-data");
      const hash2 = generateFacialMatrixHash("test-data");
      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different input", () => {
      const hash1 = generateFacialMatrixHash("data-a");
      const hash2 = generateFacialMatrixHash("data-b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("generateBiometricHash", () => {
    it("should generate a non-empty hash", () => {
      const hash = generateBiometricHash("test-data");
      expect(hash).toBeTruthy();
      expect(hash.length).toBeGreaterThan(0);
    });

    it("should generate unique hashes due to salt", () => {
      const hash1 = generateBiometricHash("test-data");
      const hash2 = generateBiometricHash("test-data");
      expect(hash1).not.toBe(hash2);
    });
  });
});
