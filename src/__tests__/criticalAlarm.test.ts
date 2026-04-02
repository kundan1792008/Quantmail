import { describe, it, expect } from "vitest";
import { isCriticalPaymentOrTokenAlert } from "../services/criticalAlarmService";

describe("isCriticalPaymentOrTokenAlert", () => {
  it("detects critical payment alert in subject", () => {
    const result = isCriticalPaymentOrTokenAlert({
      senderEmail: "ops@quantpay.com",
      recipientEmail: "user@quantmail.com",
      subject: "Critical payment failed on your account",
      body: "Please check your dashboard",
    });
    expect(result).toBe(true);
  });

  it("detects ecosystem token alert in body", () => {
    const result = isCriticalPaymentOrTokenAlert({
      senderEmail: "guardian@quantchain.io",
      recipientEmail: "user@quantmail.com",
      subject: "Security notice",
      body: "Ecosystem token compromise detected",
    });
    expect(result).toBe(true);
  });

  it("does not flag non-critical messages", () => {
    const result = isCriticalPaymentOrTokenAlert({
      senderEmail: "hello@quantmail.com",
      recipientEmail: "user@quantmail.com",
      subject: "Weekly digest",
      body: "General updates",
    });
    expect(result).toBe(false);
  });
});
