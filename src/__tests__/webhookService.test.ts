import { describe, it, expect } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from "../webhooks/webhookService";

describe("signWebhookPayload", () => {
  it("should produce a deterministic hex signature", () => {
    const sig = signWebhookPayload('{"event":"test"}', "secret");
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should produce the same signature for the same inputs", () => {
    const payload = '{"event":"inbox.message.received"}';
    const a = signWebhookPayload(payload, "my-secret");
    const b = signWebhookPayload(payload, "my-secret");
    expect(a).toBe(b);
  });

  it("should produce different signatures for different secrets", () => {
    const payload = '{"event":"test"}';
    const a = signWebhookPayload(payload, "secret-a");
    const b = signWebhookPayload(payload, "secret-b");
    expect(a).not.toBe(b);
  });
});

describe("verifyWebhookSignature", () => {
  it("should return true for a valid signature", () => {
    const payload = '{"event":"user.registered","data":{}}';
    const secret = "webhook-secret";
    const sig = signWebhookPayload(payload, secret);
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
  });

  it("should return false for a tampered payload", () => {
    const payload = '{"event":"user.registered","data":{}}';
    const secret = "webhook-secret";
    const sig = signWebhookPayload(payload, secret);
    expect(
      verifyWebhookSignature('{"event":"alarm.triggered","data":{}}', sig, secret)
    ).toBe(false);
  });

  it("should return false for a wrong secret", () => {
    const payload = '{"event":"test"}';
    const sig = signWebhookPayload(payload, "correct-secret");
    expect(verifyWebhookSignature(payload, sig, "wrong-secret")).toBe(false);
  });

  it("should return false for an empty signature", () => {
    const payload = '{"event":"test"}';
    expect(verifyWebhookSignature(payload, "", "secret")).toBe(false);
  });
});
