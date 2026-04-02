import { describe, it, expect } from "vitest";
import { deriveBiometricHash } from "../utils/crypto";

describe("physical login token format", () => {
  it("matches deterministic hash shape used by physical login tokens", () => {
    const token = deriveBiometricHash("user:test-seed");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});
