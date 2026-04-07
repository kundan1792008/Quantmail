import { describe, it, expect } from "vitest";
import { encryptApiKey, decryptApiKey } from "../utils/crypto";

describe("encryptApiKey / decryptApiKey", () => {
  const secret = "test-secret";

  it("should encrypt and decrypt a key round-trip", () => {
    const original = "sk-openai-test-key-12345";
    const encrypted = encryptApiKey(original, secret);
    expect(encrypted).not.toBe(original);
    const decrypted = decryptApiKey(encrypted, secret);
    expect(decrypted).toBe(original);
  });

  it("should return null when decrypting with wrong secret", () => {
    const encrypted = encryptApiKey("some-key", secret);
    const result = decryptApiKey(encrypted, "wrong-secret");
    expect(result).toBeNull();
  });

  it("should return null for invalid ciphertext", () => {
    const result = decryptApiKey("not-valid-ciphertext", secret);
    expect(result).toBeNull();
  });

  it("should produce different ciphertexts for the same key (nonce-based)", () => {
    const key = "my-api-key";
    const enc1 = encryptApiKey(key, secret);
    const enc2 = encryptApiKey(key, secret);
    // AES with random IV produces different ciphertexts
    expect(enc1).not.toBe(enc2);
    // But both decrypt to the same value
    expect(decryptApiKey(enc1, secret)).toBe(key);
    expect(decryptApiKey(enc2, secret)).toBe(key);
  });

  it("should handle Anthropic-style keys", () => {
    const key = "sk-ant-api03-test-anthropic-key";
    const encrypted = encryptApiKey(key, secret);
    expect(decryptApiKey(encrypted, secret)).toBe(key);
  });

  it("should handle Gemini-style keys", () => {
    const key = "AIzaSy-test-gemini-key-abcdef";
    const encrypted = encryptApiKey(key, secret);
    expect(decryptApiKey(encrypted, secret)).toBe(key);
  });
});
