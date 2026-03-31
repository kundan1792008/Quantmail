import { describe, it, expect } from "vitest";
import {
  extractDomain,
  DEFAULT_UNVERIFIED_DOMAINS,
} from "../src/services/InboxInterceptor.js";

describe("InboxInterceptor", () => {
  describe("extractDomain", () => {
    it("extracts domain from a standard email", () => {
      expect(extractDomain("user@gmail.com")).toBe("gmail.com");
    });

    it("lowercases the domain", () => {
      expect(extractDomain("user@YAHOO.COM")).toBe("yahoo.com");
    });

    it("returns empty string for invalid email", () => {
      expect(extractDomain("no-at-sign")).toBe("");
    });
  });

  describe("DEFAULT_UNVERIFIED_DOMAINS", () => {
    it("includes gmail.com and yahoo.com", () => {
      expect(DEFAULT_UNVERIFIED_DOMAINS).toContain("gmail.com");
      expect(DEFAULT_UNVERIFIED_DOMAINS).toContain("yahoo.com");
    });
  });
});
