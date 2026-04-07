/**
 * Tests for Phase 7: Real AI Engine Integration
 *
 * Covers:
 *  - getAIConfig resolution order (user BYOK → admin env → error)
 *  - /api/docs/ghostwrite request validation
 *  - /api/calendar/parse request validation
 *  - /api/sheets/process request validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── AI Router unit tests ──────────────────────────────────────────────────

describe("getAIConfig — resolution order", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns user BYOK openai key when present", async () => {
    vi.doMock("../db", () => ({
      prisma: {
        userAiSettings: {
          findUnique: vi.fn().mockResolvedValue({
            preferredProvider: "openai",
            openaiKey: "sk-user-test",
            anthropicKey: null,
            customModelUrl: null,
            customModelKey: null,
          }),
        },
      },
    }));

    const { getAIConfig } = await import("../lib/ai-router");
    const config = await getAIConfig("user-1");

    expect(config.apiKey).toBe("sk-user-test");
    expect(config.provider).toBe("openai");
  });

  it("returns user BYOK anthropic key when preferred provider is anthropic", async () => {
    vi.doMock("../db", () => ({
      prisma: {
        userAiSettings: {
          findUnique: vi.fn().mockResolvedValue({
            preferredProvider: "anthropic",
            openaiKey: null,
            anthropicKey: "sk-ant-user",
            customModelUrl: null,
            customModelKey: null,
          }),
        },
      },
    }));

    const { getAIConfig } = await import("../lib/ai-router");
    const config = await getAIConfig("user-2");

    expect(config.apiKey).toBe("sk-ant-user");
    expect(config.provider).toBe("anthropic");
  });

  it("falls back to admin OpenAI env key when user has no key", async () => {
    vi.doMock("../db", () => ({
      prisma: {
        userAiSettings: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      },
    }));

    process.env["OPENAI_API_KEY"] = "sk-admin-openai";
    delete process.env["CUSTOM_AI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];

    const { getAIConfig } = await import("../lib/ai-router");
    const config = await getAIConfig("user-3");

    expect(config.apiKey).toBe("sk-admin-openai");
    expect(config.provider).toBe("openai");

    delete process.env["OPENAI_API_KEY"];
  });

  it("throws a user-friendly error when no key is available", async () => {
    vi.doMock("../db", () => ({
      prisma: {
        userAiSettings: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      },
    }));

    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["CUSTOM_AI_API_KEY"];
    delete process.env["CUSTOM_AI_BASE_URL"];

    const { getAIConfig } = await import("../lib/ai-router");
    await expect(getAIConfig("user-no-key")).rejects.toThrow(
      "Please configure your AI API Key in the Settings panel."
    );
  });

  it("prefers custom model when preferred provider is custom", async () => {
    vi.doMock("../db", () => ({
      prisma: {
        userAiSettings: {
          findUnique: vi.fn().mockResolvedValue({
            preferredProvider: "custom",
            openaiKey: null,
            anthropicKey: null,
            customModelUrl: "https://my-llm.example.com/v1",
            customModelKey: "sk-custom-123",
          }),
        },
      },
    }));

    const { getAIConfig } = await import("../lib/ai-router");
    const config = await getAIConfig("user-custom");

    expect(config.apiKey).toBe("sk-custom-123");
    expect(config.baseURL).toBe("https://my-llm.example.com/v1");
    expect(config.provider).toBe("custom");
  });
});

// ─── Superapp route validation tests ─────────────────────────────────────
// These tests mock the ai-router module directly so no real AI calls are made.

describe("/api/docs/ghostwrite — input validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires userId and context", async () => {
    vi.doMock("../lib/ai-router", () => ({
      getAIConfig: vi.fn().mockResolvedValue({
        apiKey: "sk-test",
        provider: "openai",
        modelId: "gpt-4o-mini",
      }),
    }));

    const Fastify = (await import("fastify")).default;
    const { superAppRoutes } = await import("../routes/superapp");

    const app = Fastify();
    await app.register(superAppRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/docs/ghostwrite",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/required/i);
  });

  it("returns 401 when no API key is configured", async () => {
    vi.doMock("../lib/ai-router", () => ({
      getAIConfig: vi.fn().mockRejectedValue(
        new Error("Please configure your AI API Key in the Settings panel.")
      ),
    }));

    const Fastify = (await import("fastify")).default;
    const { superAppRoutes } = await import("../routes/superapp");

    const app = Fastify();
    await app.register(superAppRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/docs/ghostwrite",
      payload: { userId: "u1", context: "Hello world" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toContain("Settings panel");
  });
});

describe("/api/calendar/parse — input validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("requires userId and text", async () => {
    vi.doMock("../lib/ai-router", () => ({
      getAIConfig: vi.fn().mockResolvedValue({
        apiKey: "sk-test",
        provider: "openai",
        modelId: "gpt-4o-mini",
      }),
    }));

    const Fastify = (await import("fastify")).default;
    const { superAppRoutes } = await import("../routes/superapp");

    const app = Fastify();
    await app.register(superAppRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/parse",
      payload: { userId: "u1" }, // missing text
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/required/i);
  });

  it("returns 401 when no API key is configured", async () => {
    vi.doMock("../lib/ai-router", () => ({
      getAIConfig: vi.fn().mockRejectedValue(
        new Error("Please configure your AI API Key in the Settings panel.")
      ),
    }));

    const Fastify = (await import("fastify")).default;
    const { superAppRoutes } = await import("../routes/superapp");

    const app = Fastify();
    await app.register(superAppRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/parse",
      payload: { userId: "u1", text: "Lunch tomorrow at noon" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toContain("Settings panel");
  });
});

describe("/api/sheets/process — input validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("requires userId, prompt, and sheetData", async () => {
    vi.doMock("../lib/ai-router", () => ({
      getAIConfig: vi.fn().mockResolvedValue({
        apiKey: "sk-test",
        provider: "openai",
        modelId: "gpt-4o-mini",
      }),
    }));

    const Fastify = (await import("fastify")).default;
    const { superAppRoutes } = await import("../routes/superapp");

    const app = Fastify();
    await app.register(superAppRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/sheets/process",
      payload: { userId: "u1", prompt: "sum B" }, // missing sheetData
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/required/i);
  });

  it("returns 401 when no API key is configured", async () => {
    vi.doMock("../lib/ai-router", () => ({
      getAIConfig: vi.fn().mockRejectedValue(
        new Error("Please configure your AI API Key in the Settings panel.")
      ),
    }));

    const Fastify = (await import("fastify")).default;
    const { superAppRoutes } = await import("../routes/superapp");

    const app = Fastify();
    await app.register(superAppRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/api/sheets/process",
      payload: { userId: "u1", prompt: "sum B", sheetData: { A1: "10" } },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toContain("Settings panel");
  });
});

