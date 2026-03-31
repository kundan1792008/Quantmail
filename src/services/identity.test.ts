import { describe, it, expect } from "vitest";
import {
  extractDomain,
  isDomainVerified,
  isDomainBlocked,
  classifySender,
  computeFacialHash,
  generateMasterIdToken,
  isValidMasterIdToken,
  buildPropagationPayload,
  PARTNER_APPS,
} from "../services/identity.js";

describe("extractDomain", () => {
  it("extracts domain from valid email", () => {
    expect(extractDomain("user@example.com")).toBe("example.com");
  });

  it("handles subdomains", () => {
    expect(extractDomain("admin@mail.quantmail.io")).toBe("mail.quantmail.io");
  });

  it("returns empty string for invalid email", () => {
    expect(extractDomain("noatsign")).toBe("");
  });

  it("uses last @ for emails with multiple @", () => {
    expect(extractDomain("bad@@domain.com")).toBe("domain.com");
  });
});

describe("isDomainVerified", () => {
  it("returns true for quantmail.io", () => {
    expect(isDomainVerified("quantmail.io")).toBe(true);
  });

  it("returns true for infinitytrinity.io", () => {
    expect(isDomainVerified("infinitytrinity.io")).toBe(true);
  });

  it("returns false for gmail.com", () => {
    expect(isDomainVerified("gmail.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isDomainVerified("Quantmail.IO")).toBe(true);
  });
});

describe("isDomainBlocked", () => {
  it("returns true for blocked domains", () => {
    expect(isDomainBlocked("spam-factory.test")).toBe(true);
    expect(isDomainBlocked("phish.example")).toBe(true);
  });

  it("returns false for non-blocked domains", () => {
    expect(isDomainBlocked("gmail.com")).toBe(false);
  });
});

describe("classifySender", () => {
  it("returns null for verified senders", () => {
    expect(classifySender("user@quantmail.io")).toBeNull();
  });

  it("flags invalid sender addresses", () => {
    const result = classifySender("noatsign");
    expect(result).toEqual({ reason: "invalid_sender_address", severity: "high" });
  });

  it("flags blocked domains as critical", () => {
    const result = classifySender("attacker@spam-factory.test");
    expect(result).toEqual({ reason: "blocked_domain", severity: "critical" });
  });

  it("flags unverified domains", () => {
    const result = classifySender("user@gmail.com");
    expect(result).toEqual({ reason: "unverified_domain", severity: "medium" });
  });

  it("flags yahoo.com as unverified", () => {
    const result = classifySender("user@yahoo.com");
    expect(result).toEqual({ reason: "unverified_domain", severity: "medium" });
  });
});

describe("computeFacialHash", () => {
  it("returns a hex SHA-256 hash", () => {
    const hash = computeFacialHash(Buffer.from("test-face-data"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces deterministic output", () => {
    const a = computeFacialHash(Buffer.from("same"));
    const b = computeFacialHash(Buffer.from("same"));
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = computeFacialHash(Buffer.from("face-a"));
    const b = computeFacialHash(Buffer.from("face-b"));
    expect(a).not.toBe(b);
  });
});

describe("generateMasterIdToken", () => {
  it("returns a token with qm_mid_ prefix", () => {
    const token = generateMasterIdToken();
    expect(token.startsWith("qm_mid_")).toBe(true);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateMasterIdToken()));
    expect(tokens.size).toBe(10);
  });
});

describe("isValidMasterIdToken", () => {
  it("validates correct tokens", () => {
    const token = generateMasterIdToken();
    expect(isValidMasterIdToken(token)).toBe(true);
  });

  it("rejects invalid tokens", () => {
    expect(isValidMasterIdToken("bad-token")).toBe(false);
    expect(isValidMasterIdToken("qm_mid_tooshort")).toBe(false);
    expect(isValidMasterIdToken("")).toBe(false);
  });
});

describe("buildPropagationPayload", () => {
  it("returns an entry for each partner app", () => {
    const payload = buildPropagationPayload("qm_mid_abc", "user-1");
    expect(payload).toHaveLength(PARTNER_APPS.length);
    expect(payload).toHaveLength(8);
  });

  it("includes master ID token and user ID in every entry", () => {
    const payload = buildPropagationPayload("qm_mid_xyz", "user-2");
    for (const entry of payload) {
      expect(entry.masterIdToken).toBe("qm_mid_xyz");
      expect(entry.userId).toBe("user-2");
      expect(entry.propagatedAt).toBeDefined();
    }
  });

  it("covers all 8 partner apps", () => {
    const payload = buildPropagationPayload("tok", "uid");
    const apps = payload.map((p) => p.app);
    expect(apps).toContain("quantbrowse-ai");
    expect(apps).toContain("quantvault");
    expect(apps).toContain("quantpay");
    expect(apps).toContain("quantdocs");
    expect(apps).toContain("quantmeet");
    expect(apps).toContain("quantcloud");
    expect(apps).toContain("quantguard");
    expect(apps).toContain("quantanalytics");
  });
});
