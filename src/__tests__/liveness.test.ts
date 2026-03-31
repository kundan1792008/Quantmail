import { describe, it, expect } from "vitest";
import { performLivenessCheck, isCapacitorNative } from "../services/livenessService";

describe("isCapacitorNative", () => {
  it("should return false in a Node.js test environment", () => {
    expect(isCapacitorNative()).toBe(false);
  });
});

describe("performLivenessCheck", () => {
  it("should fail for empty payload", async () => {
    const result = await performLivenessCheck("");
    expect(result.passed).toBe(false);
    expect(result.livenessScore).toBe(0);
    expect(result.captureSource).toBe("web_upload");
  });

  it("should fail for very short payload (synthetic/blank image)", async () => {
    const result = await performLivenessCheck("abc");
    expect(result.passed).toBe(false);
    expect(result.livenessScore).toBe(0);
  });

  it("should fail for payload under minimum biometric size", async () => {
    const result = await performLivenessCheck("x".repeat(999));
    expect(result.passed).toBe(false);
    expect(result.livenessScore).toBe(0);
  });

  it("should pass for a sufficiently entropic base64 payload", async () => {
    // Generate a realistic-looking base64 payload with high entropy
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let payload = "";
    for (let i = 0; i < 2048; i++) {
      payload += chars[i % chars.length];
    }
    const result = await performLivenessCheck(payload);
    expect(result.passed).toBe(true);
    expect(result.livenessScore).toBeGreaterThanOrEqual(0.7);
    expect(result.facialMatrixHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.captureSource).toBe("web_upload");
  });

  it("should fail for a low-entropy payload (all same characters)", async () => {
    const payload = "A".repeat(2000);
    const result = await performLivenessCheck(payload);
    expect(result.passed).toBe(false);
    expect(result.livenessScore).toBeLessThan(0.7);
  });

  it("should return a facial matrix hash on pass", async () => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let payload = "";
    for (let i = 0; i < 1500; i++) {
      payload += chars[Math.floor(Math.random() * chars.length)];
    }
    const result = await performLivenessCheck(payload);
    if (result.passed) {
      expect(result.facialMatrixHash).toBeTruthy();
    }
  });
});
