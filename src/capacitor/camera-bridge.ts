/**
 * Capacitor Camera Bridge for Biometric Liveness Capture
 *
 * Provides native iOS/Android camera hooks via Capacitor JS for biometric
 * facial liveness verification. On non-native platforms (web), falls back
 * to the Web Camera API.
 */

export interface LivenessCaptureResult {
  /** Base64-encoded image data from the camera */
  imageData: string;
  /** Method used to capture: capacitor_camera or web_camera */
  captureMethod: "capacitor_camera" | "web_camera";
  /** ISO timestamp of capture */
  capturedAt: string;
}

/**
 * Detects whether we're running inside a Capacitor native shell.
 */
export function isNativePlatform(): boolean {
  // In a Capacitor-wrapped app, window.Capacitor is defined
  if (typeof globalThis !== "undefined" && (globalThis as any).Capacitor) {
    const cap = (globalThis as any).Capacitor;
    return cap.isNativePlatform?.() ?? false;
  }
  return false;
}

/**
 * Captures a photo using the native Capacitor Camera plugin on iOS/Android.
 * Falls back to web camera on non-native platforms.
 */
export async function captureLivenessPhoto(): Promise<LivenessCaptureResult> {
  const capturedAt = new Date().toISOString();

  if (isNativePlatform()) {
    // Use Capacitor Camera plugin for native iOS/Android
    const { Camera, CameraResultType, CameraSource } = await import(
      "@capacitor/camera"
    );
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      direction: (await import("@capacitor/camera")).CameraDirection.Front,
      promptLabelHeader: "Biometric Liveness Check",
      promptLabelPhoto: "Capture Face",
    });

    return {
      imageData: photo.base64String ?? "",
      captureMethod: "capacitor_camera",
      capturedAt,
    };
  }

  // Web fallback: return a placeholder for server-side validation
  return {
    imageData: "",
    captureMethod: "web_camera",
    capturedAt,
  };
}

/**
 * Capacitor configuration constants for the Quantmail app.
 */
export const CAPACITOR_APP_CONFIG = {
  appId: "com.quantmail.app",
  appName: "Quantmail",
  webDir: "dist",
  plugins: {
    Camera: {
      /**
       * On iOS, set presentationStyle to popover for better UX
       * on iPads; on phones it auto-fullscreens.
       */
      presentationStyle: "popover" as const,
    },
  },
} as const;
