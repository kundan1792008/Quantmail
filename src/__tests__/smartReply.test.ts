import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the OpenAI module before importing the service so that the
// constructor is replaced for the entire test file.
// vi.hoisted ensures mockCreate is available inside the vi.mock factory.
// ---------------------------------------------------------------------------

const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() };
});

vi.mock("openai", () => {
  const MockOpenAI = vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mockCreate } } };
  });
  return { default: MockOpenAI };
});

// Import after mocking
import { generateSmartReply, ConfigurationError } from "../services/smartReplyService";

// ---------------------------------------------------------------------------
// Tests for generateSmartReply
// ---------------------------------------------------------------------------

describe("generateSmartReply", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws a ConfigurationError when OPENAI_API_KEY is missing", async () => {
    delete process.env["OPENAI_API_KEY"];

    await expect(
      generateSmartReply({ emailContext: "Please send me the report." })
    ).rejects.toThrow(ConfigurationError);
  });

  it("returns a reply with default Professional tone when no tone is given", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Thank you for your email. I will send the report shortly.\n\nBest regards," } }],
    });

    const result = await generateSmartReply({
      emailContext: "Please send me the quarterly report.",
    });

    expect(result.reply).toContain("Thank you");
    expect(result.tone).toBe("Professional");
    expect(result.model).toBeDefined();
  });

  it("passes the specified tone to the model", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Hey! I'll shoot that over to you ASAP." } }],
    });

    const result = await generateSmartReply({
      emailContext: "Can you send me the report?",
      tone: "Casual",
    });

    expect(result.tone).toBe("Casual");
    expect(result.reply).toBeTruthy();

    // Verify the userMessage sent to the API includes the tone
    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMsg = callArgs?.messages?.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("Tone: Casual");
  });

  it("passes the Urgent tone correctly", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "This is urgent – please respond immediately." } }],
    });

    const result = await generateSmartReply({
      emailContext: "The server is down!",
      tone: "Urgent",
    });

    expect(result.tone).toBe("Urgent");
    expect(result.reply).toBeTruthy();
  });

  it("throws when the model returns an empty choices array", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";

    mockCreate.mockResolvedValue({ choices: [] });

    await expect(
      generateSmartReply({ emailContext: "Hello?" })
    ).rejects.toThrow("OpenAI returned an empty choices array");
  });

  it("uses OPENAI_MODEL env var when set", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    process.env["OPENAI_MODEL"] = "gpt-4o";

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Noted." } }],
    });

    await generateSmartReply({ emailContext: "Quick question." });

    const callArgs = mockCreate.mock.calls[0]?.[0] as { model: string };
    expect(callArgs?.model).toBe("gpt-4o");

    delete process.env["OPENAI_MODEL"];
  });

  it("defaults to gpt-4o-mini when OPENAI_MODEL is not set", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    delete process.env["OPENAI_MODEL"];

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Sounds good." } }],
    });

    await generateSmartReply({ emailContext: "Does this work?" });

    const callArgs = mockCreate.mock.calls[0]?.[0] as { model: string };
    expect(callArgs?.model).toBe("gpt-4o-mini");
  });
});
