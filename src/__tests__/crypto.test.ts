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
    it("should return hash and salt", () => {
      const result = generateBiometricHash("test-data");
      expect(result.hash).toBeTruthy();
      expect(result.hash.length).toBeGreaterThan(0);
      expect(result.salt).toBeTruthy();
      expect(result.salt.length).toBeGreaterThan(0);
    });

    it("should generate unique hashes due to salt", () => {
      const r1 = generateBiometricHash("test-data");
      const r2 = generateBiometricHash("test-data");
      expect(r1.hash).not.toBe(r2.hash);
      expect(r1.salt).not.toBe(r2.salt);
    });
  });
});
