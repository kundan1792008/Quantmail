import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.quantmail.app",
  appName: "Quantmail",
  webDir: "dist",
  plugins: {
    Camera: {
      presentationStyle: "popover",
    },
  },
};

export default config;
