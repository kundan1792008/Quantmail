import { describe, it, expect } from "vitest";
import { performLivenessCheck } from "../services/livenessService";

describe("Liveness Service", () => {
  it("should reject empty facial data", () => {
    const result = performLivenessCheck("");
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("EMPTY_FACIAL_DATA");
    expect(result.livenessScore).toBe(0);
  });

  it("should reject short unstructured data (bot detection)", () => {
    const result = performLivenessCheck("short");
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("STRICT_BOT_DROP");
    expect(result.livenessScore).toBeLessThan(0.7);
  });

  it("should pass valid structured facial matrix data", () => {
    const result = performLivenessCheck("facial_matrix:liveness_grid:depth_map_data");
    expect(result.passed).toBe(true);
    expect(result.livenessScore).toBeGreaterThanOrEqual(0.7);
    expect(result.biometricHash).toBeTruthy();
    expect(result.facialMatrixHash).toBeTruthy();
    expect(result.reason).toBeUndefined();
  });

  it("should generate unique biometric hashes for same input", () => {
    const r1 = performLivenessCheck("facial_matrix:liveness_grid:depth_map");
    const r2 = performLivenessCheck("facial_matrix:liveness_grid:depth_map");
    // Biometric hashes use random salt, so they should differ
    expect(r1.biometricHash).not.toBe(r2.biometricHash);
    // But facial matrix hashes are deterministic
    expect(r1.facialMatrixHash).toBe(r2.facialMatrixHash);
  });
});
