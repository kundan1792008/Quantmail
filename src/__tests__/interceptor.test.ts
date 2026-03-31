import { describe, it, expect } from "vitest";
import {
  shouldIntercept,
  extractDomain,
  isValidEmail,
  sanitizeBody,
  getUnverifiedDomains,
} from "../interceptors/InboxInterceptor";

describe("extractDomain", () => {
  it("should extract domain from valid email", () => {
    expect(extractDomain("user@example.com")).toBe("example.com");
  });

  it("should handle subdomains", () => {
    expect(extractDomain("user@mail.example.com")).toBe("mail.example.com");
  });

  it("should return empty string for invalid email", () => {
    expect(extractDomain("nope")).toBe("");
    expect(extractDomain("")).toBe("");
  });

  it("should lowercase the domain", () => {
    expect(extractDomain("user@EXAMPLE.COM")).toBe("example.com");
  });
});

describe("isValidEmail", () => {
  it("should accept valid emails", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  it("should reject invalid emails", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
  });
});

describe("sanitizeBody", () => {
  it("should strip HTML tags", () => {
    expect(sanitizeBody("<b>Hello</b>")).toBe("Hello");
    expect(sanitizeBody('<script>alert("xss")</script>')).toBe(
      'alert("xss")'
    );
  });

  it("should truncate to 50000 characters", () => {
    const long = "x".repeat(60000);
    expect(sanitizeBody(long).length).toBe(50000);
  });
});

describe("shouldIntercept", () => {
  it("should intercept gmail.com messages", () => {
    const result = shouldIntercept({
      senderEmail: "someone@gmail.com",
      recipientEmail: "user@quantmail.com",
      subject: "Hello",
      body: "Hi there",
    });
    expect(result.intercepted).toBe(true);
    expect(result.reason).toBe("UNVERIFIED_DOMAIN");
    expect(result.domain).toBe("gmail.com");
  });

  it("should intercept yahoo.com messages", () => {
    const result = shouldIntercept({
      senderEmail: "someone@yahoo.com",
      recipientEmail: "user@quantmail.com",
      subject: "Hi",
      body: "Body",
    });
    expect(result.intercepted).toBe(true);
    expect(result.reason).toBe("UNVERIFIED_DOMAIN");
  });

  it("should allow verified domain messages", () => {
    const result = shouldIntercept({
      senderEmail: "ceo@quantmail.com",
      recipientEmail: "user@quantmail.com",
      subject: "Important",
      body: "Read this",
    });
    expect(result.intercepted).toBe(false);
    expect(result.reason).toBe("ALLOWED");
  });

  it("should intercept invalid sender format", () => {
    const result = shouldIntercept({
      senderEmail: "not-an-email",
      recipientEmail: "user@quantmail.com",
      subject: "Spam",
      body: "Buy now",
    });
    expect(result.intercepted).toBe(true);
    expect(result.reason).toBe("INVALID_SENDER_FORMAT");
  });
});

describe("getUnverifiedDomains", () => {
  it("should include common free email providers", () => {
    const domains = getUnverifiedDomains();
    expect(domains).toContain("gmail.com");
    expect(domains).toContain("yahoo.com");
    expect(domains).toContain("hotmail.com");
    expect(domains).toContain("outlook.com");
  });

  it("should be non-empty", () => {
    expect(getUnverifiedDomains().length).toBeGreaterThan(0);
  });
});

// Red-team attack simulation tests
describe("Shadow DB Red-Team Audit", () => {
  it("should intercept spoofed gmail sender", () => {
    const result = shouldIntercept({
      senderEmail: "admin@gmail.com",
      recipientEmail: "user@quantmail.com",
      subject: "Account Verification Required",
      body: "Click here to verify your account",
    });
    expect(result.intercepted).toBe(true);
  });

  it("should handle email with SQL injection in sender", () => {
    const result = shouldIntercept({
      senderEmail: "user@gmail.com'; DROP TABLE users;--",
      recipientEmail: "user@quantmail.com",
      subject: "Test",
      body: "Test",
    });
    // Invalid email format should be caught
    expect(result.intercepted).toBe(true);
  });

  it("should handle XSS in subject/body through sanitize", () => {
    const body = '<img src=x onerror="alert(1)"><script>document.cookie</script>';
    const sanitized = sanitizeBody(body);
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("<img");
    expect(sanitized).not.toContain("onerror");
  });

  it("should intercept all known free email providers", () => {
    const providers = [
      "gmail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "aol.com",
      "mail.ru",
      "protonmail.com",
    ];
    for (const domain of providers) {
      const result = shouldIntercept({
        senderEmail: `attacker@${domain}`,
        recipientEmail: "target@quantmail.com",
        subject: "Phishing attempt",
        body: "Click here",
      });
      expect(result.intercepted).toBe(true);
      expect(result.reason).toBe("UNVERIFIED_DOMAIN");
    }
  });

  it("should handle extremely long email addresses", () => {
    const longLocal = "a".repeat(10000);
    const result = shouldIntercept({
      senderEmail: `${longLocal}@gmail.com`,
      recipientEmail: "user@quantmail.com",
      subject: "Overflow test",
      body: "Body",
    });
    expect(result.intercepted).toBe(true);
  });

  it("should handle unicode in email domain", () => {
    const result = shouldIntercept({
      senderEmail: "user@gmäil.com",
      recipientEmail: "user@quantmail.com",
      subject: "IDN attack",
      body: "Body",
    });
    // Should not crash; may or may not intercept but must not throw
    expect(typeof result.intercepted).toBe("boolean");
  });

  it("should handle empty body gracefully", () => {
    const result = shouldIntercept({
      senderEmail: "user@gmail.com",
      recipientEmail: "user@quantmail.com",
      subject: "",
      body: "",
    });
    expect(result.intercepted).toBe(true);
  });
});
