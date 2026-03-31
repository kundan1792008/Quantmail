/**
 * Capacitor Camera Bridge
 *
 * Abstracts the native iOS/Android camera hooks provided by
 * @capacitor/camera so that the biometric SSO flow works identically
 * on web (via getUserMedia) and on native platforms (via Capacitor).
 *
 * This module is designed to be imported by the frontend client.  In
 * the Node.js backend context it exports type definitions and stub
 * utilities for testing / server-side rendering.
 */

/** Configuration for a biometric camera capture session. */
export interface CaptureConfig {
  /** Quality percentage (1-100). */
  quality: number;
  /** Use the front-facing camera for facial liveness. */
  useFrontCamera: boolean;
  /** Maximum width in pixels. */
  width: number;
  /** Maximum height in pixels. */
  height: number;
  /** Capture source strategy. */
  source: "camera" | "prompt";
}

/** Result returned after a successful capture. */
export interface CaptureResult {
  /** Base-64 encoded image data. */
  base64: string;
  /** MIME type of the captured image. */
  mimeType: string;
  /** Which platform provided the capture. */
  platform: "ios" | "android" | "web";
  /** Timestamp of the capture. */
  capturedAt: string;
}

/** Default capture configuration for biometric liveness checks. */
export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  quality: 90,
  useFrontCamera: true,
  width: 640,
  height: 480,
  source: "camera",
};

/**
 * Determine the current runtime platform.
 *
 * In a real Capacitor app this would call `Capacitor.getPlatform()`.
 * The server-side stub always returns "web".
 */
export function detectPlatform(): CaptureResult["platform"] {
  // When running inside Capacitor on a device the global
  // `Capacitor` object is injected automatically.
  if (
    typeof globalThis !== "undefined" &&
    "Capacitor" in globalThis
  ) {
    const cap = (globalThis as Record<string, unknown>)["Capacitor"] as {
      getPlatform?: () => string;
    };
    const platform = cap.getPlatform?.();
    if (platform === "ios") return "ios";
    if (platform === "android") return "android";
  }
  return "web";
}

/**
 * Build the Capacitor Camera plugin options object.
 *
 * This translates our `CaptureConfig` into the shape expected by
 * `@capacitor/camera`'s `Camera.getPhoto()` method.
 */
export function buildCameraOptions(config: CaptureConfig = DEFAULT_CAPTURE_CONFIG) {
  return {
    quality: config.quality,
    allowEditing: false,
    resultType: "base64" as const,
    source: config.source === "camera" ? "CAMERA" : "PROMPT",
    direction: config.useFrontCamera ? "FRONT" : "REAR",
    width: config.width,
    height: config.height,
    presentationStyle: "fullScreen" as const,
  };
}

/**
 * Server-side stub for capturing a biometric image.
 *
 * On the actual device this function would call:
 *   const photo = await Camera.getPhoto(buildCameraOptions(config));
 *
 * Here we return a deterministic stub for testing the SSO pipeline
 * end-to-end without a physical camera.
 */
export function stubCapture(
  config: CaptureConfig = DEFAULT_CAPTURE_CONFIG,
): CaptureResult {
  // A minimal 1×1 transparent PNG as base-64 for testing.
  const STUB_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4" +
    "2mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  return {
    base64: STUB_BASE64,
    mimeType: "image/png",
    platform: detectPlatform(),
    capturedAt: new Date().toISOString(),
  };
}
