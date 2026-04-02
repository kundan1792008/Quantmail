import { describe, expect, it } from "vitest";
import { detectCriticalAlert } from "../utils/criticalAlertDetection";

describe("detectCriticalAlert", () => {
  it("detects critical payment alert", () => {
    const result = detectCriticalAlert(
      "Urgent: failed payment detected",
      "A failed payment and fraud risk was detected on your account."
    );

    expect(result.isCritical).toBe(true);
    expect(result.category).toBe("CRITICAL_PAYMENT");
    expect(result.reason).toBe("CRITICAL_PAYMENT_ALERT");
  });

  it("detects ecosystem token alert", () => {
    const result = detectCriticalAlert(
      "Wallet breach warning",
      "Your ecosystem token wallet reports private key exposure."
    );

    expect(result.isCritical).toBe(true);
    expect(result.category).toBe("ECOSYSTEM_TOKEN");
    expect(result.reason).toBe("ECOSYSTEM_TOKEN_ALERT");
  });

  it("returns non-critical for regular email", () => {
    const result = detectCriticalAlert(
      "Weekly update",
      "This is a normal newsletter with no emergency."
    );

    expect(result.isCritical).toBe(false);
    expect(result.category).toBeNull();
    expect(result.reason).toBe("NON_CRITICAL");
  });
});
