import { describe, it, expect } from "vitest";
import {
  ECOSYSTEM_APPS,
  buildPropagationHeaders,
  MASTER_ID_HEADER,
  PROPAGATION_HEADER,
} from "../src/middleware/master-id-propagation.js";

describe("master-id-propagation", () => {
  describe("ECOSYSTEM_APPS", () => {
    it("lists 8 ecosystem apps", () => {
      expect(ECOSYSTEM_APPS).toHaveLength(8);
    });

    it("includes expected apps", () => {
      expect(ECOSYSTEM_APPS).toContain("quantbrowse-ai");
      expect(ECOSYSTEM_APPS).toContain("quantvault");
      expect(ECOSYSTEM_APPS).toContain("quantpay");
    });
  });

  describe("buildPropagationHeaders", () => {
    it("returns headers with the master ID hash", () => {
      const hash = "abc123";
      const headers = buildPropagationHeaders(hash);
      expect(headers[MASTER_ID_HEADER]).toBe(hash);
      expect(headers[PROPAGATION_HEADER]).toBe(hash);
    });
  });
});
