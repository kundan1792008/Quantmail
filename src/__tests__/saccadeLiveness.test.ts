import { describe, it, expect, vi } from "vitest";
import {
  validateSaccadeLiveness,
  type SaccadeSample,
} from "../services/saccadeLivenessService";

/** Helper: creates a sample at a given timestamp with random-ish displacement. */
function makeSample(dx: number, dy: number, timestamp: number): SaccadeSample {
  return { dx, dy, timestamp };
}

describe("validateSaccadeLiveness", () => {
  it("should reject when no samples are provided", () => {
    const result = validateSaccadeLiveness([]);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("NO_SACCADE_DATA");
    expect(result.sampleCount).toBe(0);
  });

  it("should reject when too few samples are in the 30s window", () => {
    const now = Date.now();
    const samples: SaccadeSample[] = [
      makeSample(1.2, 0.5, now - 1000),
      makeSample(0.8, 1.1, now - 2000),
    ];
    const result = validateSaccadeLiveness(samples);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_SACCADE_SAMPLES");
    expect(result.sampleCount).toBe(2);
  });

  it("should reject samples older than 30 seconds", () => {
    const now = Date.now();
    // All samples are 60 seconds old — outside the window
    const samples: SaccadeSample[] = Array.from({ length: 10 }, (_, i) =>
      makeSample(i * 0.3, i * 0.2, now - 60_000 - i * 100)
    );
    const result = validateSaccadeLiveness(samples);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("NO_SACCADE_DATA");
  });

  it("should reject low-entropy saccade data (bot pattern)", () => {
    const now = Date.now();
    // All identical displacements → zero entropy
    const samples: SaccadeSample[] = Array.from({ length: 10 }, (_, i) =>
      makeSample(1.0, 1.0, now - i * 1000)
    );
    const result = validateSaccadeLiveness(samples);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("LOW_SACCADE_ENTROPY");
    expect(result.entropyScore).toBeLessThan(0.6);
  });

  it("should pass for natural high-entropy saccade data", () => {
    const now = Date.now();
    // Diverse displacements simulating real micro-saccades
    const samples: SaccadeSample[] = [
      makeSample(0.1, 0.3, now - 1000),
      makeSample(1.5, 0.2, now - 2000),
      makeSample(0.4, 2.1, now - 3000),
      makeSample(3.0, 0.8, now - 5000),
      makeSample(0.7, 1.7, now - 7000),
      makeSample(2.2, 0.1, now - 9000),
      makeSample(0.3, 3.5, now - 11000),
      makeSample(1.1, 1.0, now - 14000),
      makeSample(0.9, 0.6, now - 18000),
      makeSample(2.8, 2.3, now - 22000),
    ];
    const result = validateSaccadeLiveness(samples);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("HUMAN_VERIFIED");
    expect(result.entropyScore).toBeGreaterThanOrEqual(0.6);
    expect(result.saccadeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sampleCount).toBe(10);
  });

  it("should produce a deterministic saccade hash for the same data", () => {
    const now = Date.now();
    const samples: SaccadeSample[] = [
      makeSample(0.1, 0.3, now - 1000),
      makeSample(1.5, 0.2, now - 2000),
      makeSample(0.4, 2.1, now - 3000),
      makeSample(3.0, 0.8, now - 5000),
      makeSample(0.7, 1.7, now - 7000),
    ];
    const r1 = validateSaccadeLiveness(samples);
    const r2 = validateSaccadeLiveness(samples);
    expect(r1.saccadeHash).toBe(r2.saccadeHash);
  });

  it("should only consider samples within the 30-second window", () => {
    const now = Date.now();
    const oldSamples: SaccadeSample[] = Array.from({ length: 8 }, (_, i) =>
      makeSample(i * 0.5, i * 0.3, now - 60_000 - i * 1000)
    );
    const recentSamples: SaccadeSample[] = [
      makeSample(0.1, 0.3, now - 1000),
      makeSample(1.5, 0.2, now - 2000),
      makeSample(0.4, 2.1, now - 3000),
      makeSample(3.0, 0.8, now - 5000),
      makeSample(0.7, 1.7, now - 7000),
      makeSample(2.2, 0.1, now - 9000),
    ];
    const result = validateSaccadeLiveness([...oldSamples, ...recentSamples]);
    // Only the 6 recent samples should be counted
    expect(result.sampleCount).toBe(6);
  });
});
