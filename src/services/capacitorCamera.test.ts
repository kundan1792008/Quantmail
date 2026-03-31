import { describe, it, expect } from "vitest";
import {
  detectPlatform,
  buildCameraOptions,
  stubCapture,
  DEFAULT_CAPTURE_CONFIG,
} from "../services/capacitorCamera.js";

describe("detectPlatform", () => {
  it("returns 'web' in a Node.js environment", () => {
    expect(detectPlatform()).toBe("web");
  });
});

describe("DEFAULT_CAPTURE_CONFIG", () => {
  it("uses the front camera by default", () => {
    expect(DEFAULT_CAPTURE_CONFIG.useFrontCamera).toBe(true);
  });

  it("sets quality to 90", () => {
    expect(DEFAULT_CAPTURE_CONFIG.quality).toBe(90);
  });

  it("uses camera source", () => {
    expect(DEFAULT_CAPTURE_CONFIG.source).toBe("camera");
  });
});

describe("buildCameraOptions", () => {
  it("maps config to Capacitor Camera plugin shape", () => {
    const options = buildCameraOptions();
    expect(options.resultType).toBe("base64");
    expect(options.direction).toBe("FRONT");
    expect(options.source).toBe("CAMERA");
    expect(options.quality).toBe(90);
    expect(options.allowEditing).toBe(false);
    expect(options.presentationStyle).toBe("fullScreen");
  });

  it("respects custom config", () => {
    const options = buildCameraOptions({
      quality: 50,
      useFrontCamera: false,
      width: 1280,
      height: 720,
      source: "prompt",
    });
    expect(options.quality).toBe(50);
    expect(options.direction).toBe("REAR");
    expect(options.source).toBe("PROMPT");
    expect(options.width).toBe(1280);
  });
});

describe("stubCapture", () => {
  it("returns a valid CaptureResult", () => {
    const result = stubCapture();
    expect(result.base64).toBeTruthy();
    expect(result.mimeType).toBe("image/png");
    expect(result.platform).toBe("web");
    expect(result.capturedAt).toBeTruthy();
  });

  it("returns base64-decodable data", () => {
    const result = stubCapture();
    const buf = Buffer.from(result.base64, "base64");
    expect(buf.length).toBeGreaterThan(0);
  });
});
