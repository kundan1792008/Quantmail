import { describe, it, expect } from "vitest";
import {
  propagateMasterIdToAll,
  verifyPropagatedId,
  PROPAGATION_TARGETS,
} from "../utils/masterIdPropagation";

describe("Master ID Propagation", () => {
  const userId = "user-abc-123";
  const secret = "test-propagation-secret";

  it("should generate payloads for all 8 target apps", () => {
    const payloads = propagateMasterIdToAll(userId, secret);
    expect(payloads).toHaveLength(8);
    expect(PROPAGATION_TARGETS).toHaveLength(8);
  });

  it("should include all expected target app names", () => {
    const payloads = propagateMasterIdToAll(userId, secret);
    const names = payloads.map((p) => p.targetApp);
    expect(names).toContain("quantbrowse-ai");
    expect(names).toContain("quantpay");
    expect(names).toContain("quantcloud");
    expect(names).toContain("quantsocial");
    expect(names).toContain("quantvault");
    expect(names).toContain("quanthealth");
    expect(names).toContain("quantlearn");
    expect(names).toContain("quantwork");
  });

  it("should produce unique tokens per app", () => {
    const payloads = propagateMasterIdToAll(userId, secret);
    const tokens = payloads.map((p) => p.token);
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(8);
  });

  it("should verify a propagated token for the correct app", () => {
    const payloads = propagateMasterIdToAll(userId, secret);
    for (const payload of payloads) {
      const result = verifyPropagatedId(
        payload.token,
        payload.targetApp,
        secret
      );
      expect(result).toBe(userId);
    }
  });

  it("should reject a token verified against the wrong app", () => {
    const payloads = propagateMasterIdToAll(userId, secret);
    // Verify quantpay token against quantcloud should fail
    const quantpayPayload = payloads.find((p) => p.targetApp === "quantpay")!;
    const result = verifyPropagatedId(
      quantpayPayload.token,
      "quantcloud",
      secret
    );
    expect(result).toBeNull();
  });

  it("should reject a token with wrong secret", () => {
    const payloads = propagateMasterIdToAll(userId, secret);
    const result = verifyPropagatedId(
      payloads[0].token,
      payloads[0].targetApp,
      "wrong-secret"
    );
    expect(result).toBeNull();
  });

  it("each payload should include the userId and issuedAt timestamp", () => {
    const before = Date.now();
    const payloads = propagateMasterIdToAll(userId, secret);
    const after = Date.now();

    for (const payload of payloads) {
      expect(payload.userId).toBe(userId);
      expect(payload.issuedAt).toBeGreaterThanOrEqual(before);
      expect(payload.issuedAt).toBeLessThanOrEqual(after);
    }
  });
});
