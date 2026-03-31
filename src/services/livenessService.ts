import { generateBiometricHash, generateFacialMatrixHash } from "../utils/crypto";

export interface LivenessCheckResult {
  passed: boolean;
  livenessScore: number;
  facialMatrixHash: string;
  biometricHash: string;
  reason?: string;
}

/**
 * Simulates an Incode/Microblink facial liveness SDK check.
 * In production this would call the actual SDK API.
 * The simulation validates that the input contains required facial data
 * and produces a liveness score.
 */
export function performLivenessCheck(facialMatrixData: string): LivenessCheckResult {
  if (!facialMatrixData || facialMatrixData.trim().length === 0) {
    return {
      passed: false,
      livenessScore: 0,
      facialMatrixHash: "",
      biometricHash: "",
      reason: "EMPTY_FACIAL_DATA",
    };
  }

  // Simulate liveness scoring: a real SDK returns a confidence score.
  // We use deterministic scoring based on input characteristics.
  const dataLength = facialMatrixData.length;
  const hasStructuredData = facialMatrixData.includes(":");
  const livenessScore = Math.min(
    1.0,
    (dataLength > 10 ? 0.5 : 0.2) + (hasStructuredData ? 0.4 : 0.1)
  );

  const passed = livenessScore >= 0.7;
  const facialMatrixHash = generateFacialMatrixHash(facialMatrixData);
  const biometricHash = passed ? generateBiometricHash(facialMatrixData) : "";

  return {
    passed,
    livenessScore,
    facialMatrixHash,
    biometricHash,
    reason: passed ? undefined : "STRICT_BOT_DROP",
  };
}
