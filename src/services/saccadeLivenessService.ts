/**
 * Micro-Saccade Liveness Service
 *
 * Validates human presence by analysing micro-saccade eye movement data
 * collected over a rolling 30-second window.  If the movement samples
 * exhibit sufficient entropy (indicating natural, involuntary eye micro-
 * movements) the user is confirmed as a live human.
 *
 * Bot / scraper traffic produces either no saccade data at all or
 * synthetic low-entropy patterns, both of which are rejected instantly.
 */

import { deriveBiometricHash } from "../utils/crypto";

/** Maximum age (ms) of saccade samples to consider valid. */
const SACCADE_WINDOW_MS = 30_000;

/** Minimum number of saccade samples required in the window. */
const MIN_SAMPLE_COUNT = 5;

/** Minimum entropy score (0-1) to pass the liveness check. */
const MIN_ENTROPY_THRESHOLD = 0.6;

/** A single micro-saccade eye movement sample. */
export interface SaccadeSample {
  /** Horizontal displacement (pixels / arbitrary units). */
  dx: number;
  /** Vertical displacement (pixels / arbitrary units). */
  dy: number;
  /** Unix-epoch timestamp (ms) when the sample was captured. */
  timestamp: number;
}

/** Result returned by `validateSaccadeLiveness`. */
export interface SaccadeValidationResult {
  passed: boolean;
  entropyScore: number;
  saccadeHash: string;
  sampleCount: number;
  reason: string;
}

/**
 * Computes Shannon entropy over a set of bucketed saccade displacement
 * magnitudes.  Higher entropy → more natural / human-like movement.
 */
function computeSaccadeEntropy(samples: SaccadeSample[]): number {
  if (samples.length === 0) return 0;

  // Bucket magnitudes into discrete bins (0.5-unit wide)
  const buckets = new Map<number, number>();
  for (const s of samples) {
    const magnitude = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
    const bin = Math.round(magnitude * 2) / 2; // snap to 0.5 increments
    buckets.set(bin, (buckets.get(bin) ?? 0) + 1);
  }

  const total = samples.length;
  let entropy = 0;
  for (const count of buckets.values()) {
    const p = count / total;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Normalise to 0-1 range by dividing by log2(bucketCount)
  const maxEntropy = Math.log2(Math.max(buckets.size, 2));
  return parseFloat(Math.min(entropy / maxEntropy, 1.0).toFixed(4));
}

/**
 * Validates micro-saccade eye movement data to confirm human presence.
 *
 * Rules:
 *  1. At least `MIN_SAMPLE_COUNT` samples must exist.
 *  2. All samples must fall within the last `SACCADE_WINDOW_MS` ms.
 *  3. Computed entropy must meet `MIN_ENTROPY_THRESHOLD`.
 *
 * Returns a `SaccadeValidationResult` with pass/fail and diagnostics.
 */
export function validateSaccadeLiveness(
  samples: SaccadeSample[]
): SaccadeValidationResult {
  const now = Date.now();
  const windowStart = now - SACCADE_WINDOW_MS;

  // Filter to samples within the 30-second window
  const recent = samples.filter((s) => s.timestamp >= windowStart);

  if (recent.length < MIN_SAMPLE_COUNT) {
    return {
      passed: false,
      entropyScore: 0,
      saccadeHash: "",
      sampleCount: recent.length,
      reason:
        recent.length === 0
          ? "NO_SACCADE_DATA"
          : "INSUFFICIENT_SACCADE_SAMPLES",
    };
  }

  const entropyScore = computeSaccadeEntropy(recent);

  // Build a deterministic hash of the saccade session for auditing
  const saccadePayload = recent
    .map((s) => `${s.dx}:${s.dy}:${s.timestamp}`)
    .join("|");
  const saccadeHash = deriveBiometricHash(saccadePayload);

  if (entropyScore < MIN_ENTROPY_THRESHOLD) {
    return {
      passed: false,
      entropyScore,
      saccadeHash,
      sampleCount: recent.length,
      reason: "LOW_SACCADE_ENTROPY",
    };
  }

  return {
    passed: true,
    entropyScore,
    saccadeHash,
    sampleCount: recent.length,
    reason: "HUMAN_VERIFIED",
  };
}
