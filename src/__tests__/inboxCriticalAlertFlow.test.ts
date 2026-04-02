import { describe, it, expect } from "vitest";
import { isCriticalPaymentOrTokenAlert } from "../services/criticalAlarmService";

describe("inbox critical alert flow", () => {
  it("flags inbox payload with payment compromise indicators", () => {
    const flagged = isCriticalPaymentOrTokenAlert({
      senderEmail: "alerts@quantpay.com",
      recipientEmail: "user@quantmail.com",
      subject: "Unauthorized transfer detected",
      body: "Critical payment alert in your ecosystem wallet",
    });

    expect(flagged).toBe(true);
  });

  it("does not flag normal inbox payload", () => {
    const flagged = isCriticalPaymentOrTokenAlert({
      senderEmail: "newsletter@quantmail.com",
      recipientEmail: "user@quantmail.com",
      subject: "Product digest",
      body: "Your weekly ecosystem update is ready.",
    });

    expect(flagged).toBe(false);
  });
});
