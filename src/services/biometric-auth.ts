import crypto from "node:crypto";

/**
 * Biometric Authentication Service
 *
 * Handles facial liveness verification and Master ID generation.
 * The Master ID hash is a cryptographic identity that propagates
 * across all apps in the Infinity Trinity ecosystem.
 */

const LIVENESS_THRESHOLD = 0.75;

export interface BiometricRegistrationInput {
  displayName: string;
  email: string;
  imageData: string;
  captureMethod: "capacitor_camera" | "web_camera";
}

export interface BiometricVerificationResult {
  verified: boolean;
  facialHash: string;
  livenessScore: number;
  masterIdHash: string;
  reason?: string;
}

/**
 * Computes a SHA-256 hash from the facial image data to create a
 * unique cryptographic hash for the Liveness_Grid.
 */
export function computeFacialHash(imageData: string): string {
  return crypto.createHash("sha256").update(imageData).digest("hex");
}

/**
 * Generates the cross-app Master ID hash from the facial hash + email.
 * This hash propagates implicitly to all other connected apps.
 */
export function generateMasterIdHash(facialHash: string, email: string): string {
  return crypto
    .createHash("sha256")
    .update(`${facialHash}:${email}`)
    .digest("hex");
}

/**
 * Simulates a liveness score analysis. In production, this would call
 * an SDK like Incode/Microblink for facial liveness detection.
 *
 * Returns a score between 0.0 and 1.0.
 */
export function computeLivenessScore(imageData: string): number {
  if (!imageData || imageData.length === 0) {
    return 0.0;
  }

  // A non-trivial image (base64 data) gets a high liveness score.
  // In production, replace with real ML-based liveness detection.
  const entropy = computeDataEntropy(imageData);
  return Math.min(1.0, entropy);
}

/**
 * Runs the full biometric verification pipeline.
 */
export function verifyBiometric(
  input: BiometricRegistrationInput
): BiometricVerificationResult {
  const facialHash = computeFacialHash(input.imageData);
  const livenessScore = computeLivenessScore(input.imageData);
  const masterIdHash = generateMasterIdHash(facialHash, input.email);

  if (livenessScore < LIVENESS_THRESHOLD) {
    return {
      verified: false,
      facialHash,
      livenessScore,
      masterIdHash,
      reason: "STRICT_BOT_DROP",
    };
  }

  return {
    verified: true,
    facialHash,
    livenessScore,
    masterIdHash,
  };
}

/**
 * Simple entropy measure for image data to approximate liveness.
 * Real implementations use neural-network-based liveness detection.
 */
function computeDataEntropy(data: string): number {
  if (data.length < 16) return 0.1;

  const freq = new Map<string, number>();
  for (const char of data) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / data.length;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize: max entropy for base64 is ~6 bits/char
  return Math.min(1.0, entropy / 6.0);
}

export { LIVENESS_THRESHOLD };
