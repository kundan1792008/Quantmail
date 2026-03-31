/**
 * Capacitor-aware biometric liveness service.
 *
 * On native iOS/Android (Capacitor runtime), this module invokes the device
 * camera via @capacitor/camera to capture a selfie frame for liveness analysis.
 * On web/server, it falls back to processing a base64 image payload directly.
 */

import { deriveBiometricHash } from "../utils/crypto";

/** Result of a liveness check. */
export interface LivenessResult {
  passed: boolean;
  livenessScore: number;
  facialMatrixHash: string;
  captureSource: "capacitor_native" | "web_upload";
}

/**
 * Checks whether the Capacitor native runtime is available.
 * This is true when the app runs inside an iOS/Android WebView via Capacitor.
 */
export function isCapacitorNative(): boolean {
  // Capacitor injects `window.Capacitor` at runtime in native shells.
  // In a Node/test context this will always be false.
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as Record<string, unknown>)["Capacitor"] === "object"
  );
}

/**
 * Captures an image from the device camera using Capacitor Camera plugin.
 * Only callable when running inside Capacitor native shell.
 * Returns a base64-encoded image string.
 */
export async function captureNativeCameraFrame(): Promise<string> {
  if (!isCapacitorNative()) {
    throw new Error(
      "captureNativeCameraFrame requires Capacitor native runtime (iOS/Android)"
    );
  }
  // Dynamic import so that @capacitor/camera is only resolved in native context
  const { Camera, CameraResultType, CameraSource } = await import(
    "@capacitor/camera"
  );
  const photo = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: CameraSource.Camera,
  });
  if (!photo.base64String) {
    throw new Error("Camera capture returned empty base64 payload");
  }
  return photo.base64String;
}

/**
 * Performs a liveness check on an image payload.
 *
 * Scoring logic (simplified heuristic):
 *  - Rejects payloads that are too small (likely blank/synthetic).
 *  - Computes a facial matrix hash and scores based on entropy.
 *  - A score >= 0.70 is considered passing.
 *
 * In native mode, `imageBase64` may be omitted; the service will capture
 * from the device camera automatically.
 */
export async function performLivenessCheck(
  imageBase64?: string
): Promise<LivenessResult> {
  let captureSource: LivenessResult["captureSource"] = "web_upload";
  let payload = imageBase64;

  if (!payload && isCapacitorNative()) {
    payload = await captureNativeCameraFrame();
    captureSource = "capacitor_native";
  }

  // Minimum size for a realistic base64-encoded facial image (~10 KB)
  if (!payload || payload.length < 1000) {
    return {
      passed: false,
      livenessScore: 0,
      facialMatrixHash: "",
      captureSource,
    };
  }

  const facialMatrixHash = deriveBiometricHash(payload);

  // Placeholder liveness heuristic: entropy-based check on the image payload.
  // In production, replace with a real biometric SDK integration
  // (e.g. Incode, Microblink) for actual facial feature and liveness detection.
  const sample = payload.slice(0, 2048);
  const charSet = new Set(sample.split(""));
  const entropy = charSet.size / 64; // base64 has ~64 unique chars
  const livenessScore = Math.min(parseFloat(entropy.toFixed(4)), 1.0);

  return {
    passed: livenessScore >= 0.7,
    livenessScore,
    facialMatrixHash,
    captureSource,
  };
}
