import { prisma } from "../db";
import { decryptApiKey } from "./crypto";

/** Supported AI provider identifiers. */
export type AIProvider = "openai" | "anthropic" | "gemini" | "custom";

/** Resolved key information returned by the router. */
export interface ResolvedAIKey {
  /** The plaintext API key (or custom model URL for "custom" provider). */
  key: string;
  /** Indicates whether the key came from the user ("user") or the admin ("admin"). */
  source: "user" | "admin";
  /** For the custom provider, the base URL of the model endpoint. */
  customModelUrl?: string;
}

const ENCRYPTION_SECRET =
  process.env["ENCRYPTION_SECRET"] || "quantmail-key-secret";

/**
 * Resolves the API key to use for a given AI provider and user.
 *
 * Resolution order:
 *  1. User's own saved key (decrypted from DB). Cost: $0 for the platform.
 *  2. Admin's global default key or Custom Model URL.
 *  3. Neither found → throws an error directing the user to /settings.
 *
 * @param userId   The ID of the requesting user.
 * @param provider The AI provider ("openai" | "anthropic" | "gemini" | "custom").
 * @returns        ResolvedAIKey with the plaintext key and its source.
 * @throws         Error if no key is available for the requested provider.
 */
export async function resolveAIKey(
  userId: string,
  provider: AIProvider
): Promise<ResolvedAIKey> {
  // ── Step 1: Try the user's own key ───────────────────────────────
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      openaiKey: true,
      anthropicKey: true,
      geminiKey: true,
      customModelUrl: true,
      customModelKey: true,
    },
  });

  if (user) {
    const encryptedUserKey = getUserKeyField(user, provider);
    if (encryptedUserKey) {
      const plaintext = decryptApiKey(encryptedUserKey, ENCRYPTION_SECRET);
      if (plaintext) {
        if (provider === "custom") {
          const customUrl = user.customModelUrl ?? undefined;
          return { key: plaintext, source: "user", customModelUrl: customUrl };
        }
        return { key: plaintext, source: "user" };
      }
    }
  }

  // ── Step 2: Try the admin's global default key ────────────────────
  const adminConfig = await prisma.adminConfig.findFirst({
    orderBy: { updatedAt: "desc" },
  });

  if (adminConfig) {
    const encryptedAdminKey = getAdminKeyField(adminConfig, provider);
    if (encryptedAdminKey) {
      const plaintext = decryptApiKey(encryptedAdminKey, ENCRYPTION_SECRET);
      if (plaintext) {
        if (provider === "custom") {
          const customUrl = adminConfig.customModelUrl ?? undefined;
          return {
            key: plaintext,
            source: "admin",
            customModelUrl: customUrl,
          };
        }
        return { key: plaintext, source: "admin" };
      }
    }

    // For "custom" provider, a URL alone (without a key) may be sufficient
    if (provider === "custom" && adminConfig.customModelUrl) {
      return {
        key: adminConfig.customModelUrl,
        source: "admin",
        customModelUrl: adminConfig.customModelUrl,
      };
    }
  }

  // ── Step 3: No key found ──────────────────────────────────────────
  throw new Error(
    `No ${provider} API key configured. ` +
      `Please add your key at /settings or contact the administrator.`
  );
}

// ── Helpers ───────────────────────────────────────────────────────

type UserKeyFields = {
  openaiKey: string | null;
  anthropicKey: string | null;
  geminiKey: string | null;
  customModelUrl: string | null;
  customModelKey: string | null;
};

type AdminKeyFields = {
  globalOpenaiKey: string | null;
  globalAnthropicKey: string | null;
  globalGeminiKey: string | null;
  customModelUrl: string | null;
  customModelKey: string | null;
};

function getUserKeyField(
  user: UserKeyFields,
  provider: AIProvider
): string | null {
  switch (provider) {
    case "openai":
      return user.openaiKey;
    case "anthropic":
      return user.anthropicKey;
    case "gemini":
      return user.geminiKey;
    case "custom":
      return user.customModelKey;
  }
}

function getAdminKeyField(
  config: AdminKeyFields,
  provider: AIProvider
): string | null {
  switch (provider) {
    case "openai":
      return config.globalOpenaiKey;
    case "anthropic":
      return config.globalAnthropicKey;
    case "gemini":
      return config.globalGeminiKey;
    case "custom":
      return config.customModelKey;
  }
}
