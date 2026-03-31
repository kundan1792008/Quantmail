import { describe, it, expect } from "vitest";
import {
  isNativePlatform,
  CAPACITOR_APP_CONFIG,
} from "../src/capacitor/camera-bridge.js";

describe("capacitor camera-bridge", () => {
  describe("isNativePlatform", () => {
    it("returns false in Node.js environment", () => {
      expect(isNativePlatform()).toBe(false);
    });
  });

  describe("CAPACITOR_APP_CONFIG", () => {
    it("has the correct appId", () => {
      expect(CAPACITOR_APP_CONFIG.appId).toBe("com.quantmail.app");
    });

    it("has the correct appName", () => {
      expect(CAPACITOR_APP_CONFIG.appName).toBe("Quantmail");
    });

    it("configures the Camera plugin", () => {
      expect(CAPACITOR_APP_CONFIG.plugins.Camera.presentationStyle).toBe(
        "popover"
      );
    });
  });
});
