/**
 * Super App AI Routes (Phase 7)
 *
 * Provides three AI-powered endpoints consumed by the Super App modules:
 *
 *  POST /api/docs/ghostwrite  — Stream AI-generated text continuation.
 *  POST /api/calendar/parse   — Extract structured event data from natural language.
 *  POST /api/sheets/process   — Apply natural language commands to a spreadsheet.
 *
 * All routes use the dynamic AI router (lib/ai-router.ts) to resolve the
 * correct API key following the BYOK → Admin fallback priority.
 */

import { FastifyInstance } from "fastify";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, generateObject, generateText } from "ai";
import { z } from "zod";
import { getAIConfig } from "../lib/ai-router";

// ─── Helper ────────────────────────────────────────────────────────────────

/** Default model IDs used when no explicit model is configured. */
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/**
 * Builds the AI provider model instance from an AiConfig.
 * Selects the correct SDK (OpenAI vs Anthropic) based on the resolved provider.
 */
function buildModel(config: Awaited<ReturnType<typeof getAIConfig>>) {
  if (config.provider === "anthropic") {
    const anthropic = createAnthropic({ apiKey: config.apiKey });
    return anthropic(config.modelId);
  }

  // "openai" and "custom" (OpenAI-compatible) both use createOpenAI.
  const openai = createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  return openai(
    config.modelId === "custom" ? DEFAULT_OPENAI_MODEL : config.modelId
  );
}

// ─── Routes ────────────────────────────────────────────────────────────────

export async function superAppRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/docs/ghostwrite
   *
   * Streams an AI-generated text continuation for a Notion-style document.
   *
   * Body: { userId: string; context: string }
   *   userId  — The authenticated user ID (used for key resolution).
   *   context — The document text preceding the cursor position.
   *
   * Response: text/plain streaming (chunked transfer).
   */
  app.post<{
    Body: { userId: string; context: string };
  }>("/api/docs/ghostwrite", async (request, reply) => {
    const { userId, context } = request.body;

    if (!userId || !context) {
      return reply.code(400).send({ error: "userId and context are required" });
    }

    let config: Awaited<ReturnType<typeof getAIConfig>>;
    try {
      config = await getAIConfig(userId);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "AI configuration error";
      return reply.code(401).send({ error: message });
    }

    const model = buildModel(config);

    const result = streamText({
      model,
      system:
        "You are an expert writing assistant. Continue the provided document text naturally and coherently. Return only the continuation — do not repeat or summarise what was already written.",
      prompt: context,
    });

    reply.raw.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    });

    for await (const chunk of result.textStream) {
      reply.raw.write(chunk);
    }

    reply.raw.end();
  });

  /**
   * POST /api/calendar/parse
   *
   * Converts a natural-language event description into structured JSON using
   * strict Zod schema validation so the Calendar UI can consume it directly.
   *
   * Body: { userId: string; text: string }
   *   userId — The authenticated user ID.
   *   text   — Natural language event description, e.g. "Lunch with Amit tomorrow at 1 PM".
   *
   * Response: { title: string; startTime: string; endTime: string }
   */
  app.post<{
    Body: { userId: string; text: string };
  }>("/api/calendar/parse", async (request, reply) => {
    const { userId, text } = request.body;

    if (!userId || !text) {
      return reply.code(400).send({ error: "userId and text are required" });
    }

    let config: Awaited<ReturnType<typeof getAIConfig>>;
    try {
      config = await getAIConfig(userId);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "AI configuration error";
      return reply.code(401).send({ error: message });
    }

    const model = buildModel(config);

    const now = new Date().toISOString();

    const { object } = await generateObject({
      model,
      schema: z.object({
        title: z.string().describe("Short, descriptive event title"),
        startTime: z
          .string()
          .describe("ISO 8601 start date-time of the event"),
        endTime: z
          .string()
          .describe("ISO 8601 end date-time of the event (default 1 hour after start)"),
      }),
      system: `You extract calendar event details from natural language. Today's date and time is ${now}. Always return ISO 8601 date strings for startTime and endTime.`,
      prompt: `Extract the event details from this text: "${text}"`,
    });

    return reply.send(object);
  });

  /**
   * POST /api/sheets/process
   *
   * Applies a natural language command to the current spreadsheet state and
   * returns the updated grid JSON.
   *
   * Body: { userId: string; prompt: string; sheetData: Record<string, string> }
   *   userId    — The authenticated user ID.
   *   prompt    — User instruction, e.g. "Sum all values in column B and put result in B10".
   *   sheetData — Current cell data as { "A1": "100", "B1": "200", … }.
   *
   * Response: { updatedData: Record<string, string> }
   */
  app.post<{
    Body: {
      userId: string;
      prompt: string;
      sheetData: Record<string, string>;
    };
  }>("/api/sheets/process", async (request, reply) => {
    const { userId, prompt, sheetData } = request.body;

    if (!userId || !prompt || !sheetData) {
      return reply
        .code(400)
        .send({ error: "userId, prompt, and sheetData are required" });
    }

    let config: Awaited<ReturnType<typeof getAIConfig>>;
    try {
      config = await getAIConfig(userId);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "AI configuration error";
      return reply.code(401).send({ error: message });
    }

    const model = buildModel(config);

    const sheetJson = JSON.stringify(sheetData);

    const { object } = await generateObject({
      model,
      schema: z.object({
        updatedData: z
          .record(z.string(), z.string())
          .describe(
            "The full updated spreadsheet cell map after applying the command"
          ),
      }),
      system:
        "You are a spreadsheet assistant. Given the current cell data as JSON and a user command, apply the command and return the updated cell map. Preserve all unchanged cells. Cell addresses use Excel notation (A1, B2, …).",
      prompt: `Current spreadsheet data:\n${sheetJson}\n\nUser command: ${prompt}`,
    });

    return reply.send(object);
  });

  /**
   * GET/POST /api/ai/settings/:userId
   *
   * Manages per-user AI key preferences (BYOK settings).
   */
  app.get<{ Params: { userId: string } }>(
    "/api/ai/settings/:userId",
    async (request, reply) => {
      const { userId } = request.params;
      const { prisma } = await import("../db");

      const settings = await prisma.userAiSettings.findUnique({
        where: { userId },
      });

      if (!settings) {
        return reply.send({
          hasOpenaiKey: false,
          hasAnthropicKey: false,
          hasCustomKey: false,
          preferredProvider: "openai",
          customModelUrl: null,
        });
      }

      // Never expose raw key values — return only presence flags.
      return reply.send({
        hasOpenaiKey: Boolean(settings.openaiKey),
        hasAnthropicKey: Boolean(settings.anthropicKey),
        hasCustomKey: Boolean(settings.customModelKey),
        preferredProvider: settings.preferredProvider,
        customModelUrl: settings.customModelUrl,
      });
    }
  );

  app.post<{
    Params: { userId: string };
    Body: {
      openaiKey?: string;
      anthropicKey?: string;
      customModelUrl?: string;
      customModelKey?: string;
      preferredProvider?: string;
    };
  }>("/api/ai/settings/:userId", async (request, reply) => {
    const { userId } = request.params;
    const { prisma } = await import("../db");

    const {
      openaiKey,
      anthropicKey,
      customModelUrl,
      customModelKey,
      preferredProvider,
    } = request.body;

    // Build the update payload with only `string | null` values (no undefined).
    const data: {
      openaiKey?: string | null;
      anthropicKey?: string | null;
      customModelUrl?: string | null;
      customModelKey?: string | null;
      preferredProvider?: string;
    } = {};
    if (openaiKey !== undefined) data.openaiKey = openaiKey || null;
    if (anthropicKey !== undefined) data.anthropicKey = anthropicKey || null;
    if (customModelUrl !== undefined) data.customModelUrl = customModelUrl || null;
    if (customModelKey !== undefined) data.customModelKey = customModelKey || null;
    if (preferredProvider) data.preferredProvider = preferredProvider;

    await prisma.userAiSettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    return reply.send({ success: true });
  });
}

/**
 * Generates text using a resolved AI config (used by Digital Twin and other
 * server-side services that need a simple string response rather than
 * a streaming or structured output).
 */
export async function generateAiText(
  userId: string,
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const config = await getAIConfig(userId);
  const model = buildModel(config);

  const { text } = await generateText({
    model,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    prompt,
  });

  return text;
}
