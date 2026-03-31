import { describe, it, expect } from "vitest";
import {
  extractDomain,
  UNVERIFIED_DOMAINS,
} from "../interceptors/InboxInterceptor";

describe("InboxInterceptor", () => {
  describe("extractDomain", () => {
    it("should extract domain from valid email", () => {
      expect(extractDomain("user@gmail.com")).toBe("gmail.com");
    });

    it("should handle uppercase domains", () => {
      expect(extractDomain("user@Gmail.COM")).toBe("gmail.com");
    });

    it("should return empty string for invalid email", () => {
      expect(extractDomain("invalidemail")).toBe("");
    });
  });

  describe("UNVERIFIED_DOMAINS", () => {
    it("should include common generic email domains", () => {
      expect(UNVERIFIED_DOMAINS).toContain("gmail.com");
      expect(UNVERIFIED_DOMAINS).toContain("yahoo.com");
      expect(UNVERIFIED_DOMAINS).toContain("hotmail.com");
    });

    it("should not include custom domains", () => {
      expect(UNVERIFIED_DOMAINS).not.toContain("company.com");
    });
  });
});
