import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptApiKey } from "../utils/crypto";

// Mock the prisma client used inside ai-router
vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    adminConfig: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../db";
import { resolveAIKey } from "../utils/ai-router";

const ENCRYPTION_SECRET = "quantmail-key-secret";

function makeUserWithKey(provider: "openai" | "anthropic" | "gemini" | "custom") {
  const fields = {
    openaiKey: null as string | null,
    anthropicKey: null as string | null,
    geminiKey: null as string | null,
    customModelUrl: null as string | null,
    customModelKey: null as string | null,
  };

  const encrypted = encryptApiKey("user-test-key-1234", ENCRYPTION_SECRET);

  if (provider === "openai") fields.openaiKey = encrypted;
  else if (provider === "anthropic") fields.anthropicKey = encrypted;
  else if (provider === "gemini") fields.geminiKey = encrypted;
  else if (provider === "custom") {
    fields.customModelKey = encrypted;
    fields.customModelUrl = "https://my-model.example.com/v1";
  }

  return fields;
}

describe("resolveAIKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the user's own OpenAI key when available", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUserWithKey("openai") as never
    );

    const result = await resolveAIKey("user-1", "openai");
    expect(result.key).toBe("user-test-key-1234");
    expect(result.source).toBe("user");
  });

  it("returns the user's own Anthropic key when available", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUserWithKey("anthropic") as never
    );

    const result = await resolveAIKey("user-1", "anthropic");
    expect(result.key).toBe("user-test-key-1234");
    expect(result.source).toBe("user");
  });

  it("falls back to admin global key when user has none", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      openaiKey: null,
      anthropicKey: null,
      geminiKey: null,
      customModelUrl: null,
      customModelKey: null,
    } as never);

    const adminEncrypted = encryptApiKey("admin-global-key-9876", ENCRYPTION_SECRET);
    vi.mocked(prisma.adminConfig.findFirst).mockResolvedValueOnce({
      id: "cfg-1",
      globalOpenaiKey: adminEncrypted,
      globalAnthropicKey: null,
      globalGeminiKey: null,
      customModelUrl: null,
      customModelKey: null,
      updatedBy: "admin-user",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await resolveAIKey("user-1", "openai");
    expect(result.key).toBe("admin-global-key-9876");
    expect(result.source).toBe("admin");
  });

  it("throws when neither user nor admin key exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      openaiKey: null,
      anthropicKey: null,
      geminiKey: null,
      customModelUrl: null,
      customModelKey: null,
    } as never);

    vi.mocked(prisma.adminConfig.findFirst).mockResolvedValueOnce(null);

    await expect(resolveAIKey("user-1", "openai")).rejects.toThrow(
      /No openai API key configured/
    );
  });

  it("throws with /settings guidance when key is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.adminConfig.findFirst).mockResolvedValueOnce(null);

    await expect(resolveAIKey("user-1", "gemini")).rejects.toThrow(/\/settings/);
  });

  it("resolves custom model URL from user config", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUserWithKey("custom") as never
    );

    const result = await resolveAIKey("user-1", "custom");
    expect(result.key).toBe("user-test-key-1234");
    expect(result.source).toBe("user");
    expect(result.customModelUrl).toBe("https://my-model.example.com/v1");
  });

  it("resolves custom model URL from admin config when user has none", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      openaiKey: null,
      anthropicKey: null,
      geminiKey: null,
      customModelUrl: null,
      customModelKey: null,
    } as never);

    vi.mocked(prisma.adminConfig.findFirst).mockResolvedValueOnce({
      id: "cfg-1",
      globalOpenaiKey: null,
      globalAnthropicKey: null,
      globalGeminiKey: null,
      customModelUrl: "https://quant-ai.example.com/v1",
      customModelKey: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const result = await resolveAIKey("user-1", "custom");
    expect(result.key).toBe("https://quant-ai.example.com/v1");
    expect(result.source).toBe("admin");
    expect(result.customModelUrl).toBe("https://quant-ai.example.com/v1");
  });
});
