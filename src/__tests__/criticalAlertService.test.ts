import { describe, expect, it } from "vitest";
import { detectCriticalAlert } from "../services/criticalAlertService";

describe("detectCriticalAlert", () => {
  it("detects critical payment alerts", () => {
    const signal = detectCriticalAlert(
      "Critical payment issue",
      "Urgent debit transaction flagged as fraud"
    );
    expect(signal.isCritical).toBe(true);
    expect(signal.category).toBe("PAYMENT");
  });

  it("detects critical ecosystem token alerts", () => {
    const signal = detectCriticalAlert(
      "Immediate token alert",
      "Critical ecosystem token wallet transfer anomaly"
    );
    expect(signal.isCritical).toBe(true);
    expect(signal.category).toBe("ECOSYSTEM_TOKEN");
  });

  it("does not flag non-critical alerts", () => {
    const signal = detectCriticalAlert(
      "Weekly report",
      "Your normal mailbox digest is ready"
    );
    expect(signal.isCritical).toBe(false);
    expect(signal.category).toBe("GENERAL");
  });
});
