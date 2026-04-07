/**
 * AI Router — Dynamic API Key Resolver (BYOK Architecture)
 *
 * Resolution order:
 *  1. User's own key stored in UserAiSettings (BYOK — zero server cost).
 *  2. Admin / platform global key from environment variables.
 *  3. Throws an error with a user-friendly message so callers can return 401.
 */

import { prisma } from "../db";

export interface AiConfig {
  apiKey: string;
  baseURL?: string;
  provider: "openai" | "anthropic" | "custom";
  modelId: string;
}

/** Default model IDs used when no explicit model is configured. */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022";

/**
 * Resolves the best available AI configuration for the given user.
 * Prefers the user's own BYOK key; falls back to the platform admin key.
 *
 * Environment variables are read at call time so that runtime changes
 * (e.g. in tests) are always reflected correctly.
 *
 * @throws Error with message "Please configure your AI API Key in the Settings panel."
 *         when no key is available.
 */
export async function getAIConfig(userId: string): Promise<AiConfig> {
  // 1. Attempt to load user-level settings.
  const userSettings = await prisma.userAiSettings.findUnique({
    where: { userId },
  });

  if (userSettings) {
    const preferred = userSettings.preferredProvider;

    if (preferred === "anthropic" && userSettings.anthropicKey) {
      return {
        apiKey: userSettings.anthropicKey,
        provider: "anthropic",
        modelId: DEFAULT_ANTHROPIC_MODEL,
      };
    }

    if (
      preferred === "custom" &&
      userSettings.customModelKey &&
      userSettings.customModelUrl
    ) {
      return {
        apiKey: userSettings.customModelKey,
        baseURL: userSettings.customModelUrl,
        provider: "custom",
        modelId: "custom",
      };
    }

    if (userSettings.openaiKey) {
      return {
        apiKey: userSettings.openaiKey,
        provider: "openai",
        modelId: DEFAULT_OPENAI_MODEL,
      };
    }
  }

  // 2. Fall back to admin / environment keys (read at call time).
  const adminCustomKey = process.env["CUSTOM_AI_API_KEY"];
  const adminCustomUrl = process.env["CUSTOM_AI_BASE_URL"];
  const adminOpenaiKey = process.env["OPENAI_API_KEY"];
  const adminAnthropicKey = process.env["ANTHROPIC_API_KEY"];

  if (adminCustomKey && adminCustomUrl) {
    return {
      apiKey: adminCustomKey,
      baseURL: adminCustomUrl,
      provider: "custom",
      modelId: "custom",
    };
  }

  if (adminOpenaiKey) {
    return {
      apiKey: adminOpenaiKey,
      provider: "openai",
      modelId: DEFAULT_OPENAI_MODEL,
    };
  }

  if (adminAnthropicKey) {
    return {
      apiKey: adminAnthropicKey,
      provider: "anthropic",
      modelId: DEFAULT_ANTHROPIC_MODEL,
    };
  }

  // 3. No key available.
  throw new Error(
    "Please configure your AI API Key in the Settings panel."
  );
}
