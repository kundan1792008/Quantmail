import { describe, it, expect } from "vitest";
import { isCriticalPaymentOrEcosystemTokenAlert } from "../services/criticalAlertService";

describe("isCriticalPaymentOrEcosystemTokenAlert", () => {
  it("returns true for critical payment + ecosystem token alert content", () => {
    const result = isCriticalPaymentOrEcosystemTokenAlert(
      "Critical payment alert",
      "Ecosystem token anomaly detected on your account"
    );
    expect(result).toBe(true);
  });

  it("returns false when only one weak signal is present", () => {
    const result = isCriticalPaymentOrEcosystemTokenAlert(
      "Payment update",
      "Monthly statement is available"
    );
    expect(result).toBe(false);
  });

  it("returns true for unauthorized transfer + urgent payment combination", () => {
    const result = isCriticalPaymentOrEcosystemTokenAlert(
      "Urgent payment warning",
      "Potential unauthorized transfer identified"
    );
    expect(result).toBe(true);
  });
});
