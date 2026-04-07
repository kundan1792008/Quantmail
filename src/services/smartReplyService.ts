/**
 * Smart Reply Service
 *
 * Wraps the OpenAI Chat Completions API to generate context-aware email
 * replies.  The service requires the OPENAI_API_KEY environment variable.
 * If the key is absent a descriptive error is thrown so misconfigured
 * deployments fail loudly rather than silently.
 */

import OpenAI from "openai";

export type Tone = "Professional" | "Casual" | "Urgent" | string;

export interface SmartReplyRequest {
  /** Full text of the email being replied to. */
  emailContext: string;
  /** Optional tone directive (default: "Professional"). */
  tone?: Tone;
}

export interface SmartReplyResult {
  reply: string;
  tone: string;
  model: string;
}

/** Thrown when a required environment variable (e.g. OPENAI_API_KEY) is missing. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const SYSTEM_PROMPT = `You are a highly efficient executive assistant.
Your sole task is to draft a concise, polite, and relevant email reply based
ONLY on the email context provided by the user.
Rules:
- Address the key points raised in the original email.
- Do NOT introduce information not present in the email context.
- Keep the reply under 200 words.
- Use plain text – no markdown, no bullet points unless the original email uses them.
- Close professionally (e.g. "Best regards," followed by a blank signature line).`;

/**
 * Generates an AI smart reply for the given email context.
 *
 * @throws {ConfigurationError} When OPENAI_API_KEY is missing.
 * @throws {Error} When the API call fails or returns an unexpected response.
 */
export async function generateSmartReply(
  request: SmartReplyRequest
): Promise<SmartReplyResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new ConfigurationError(
      "OPENAI_API_KEY environment variable is required but not set"
    );
  }

  const { emailContext, tone = "Professional" } = request;

  const client = new OpenAI({ apiKey });

  const userMessage = `Tone: ${tone}\n\nEmail to reply to:\n${emailContext}`;

  const model = process.env["OPENAI_MODEL"] || "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 400,
    temperature: 0.4,
  });

  if (!response.choices || response.choices.length === 0) {
    throw new Error("OpenAI returned an empty choices array");
  }

  const reply = response.choices[0]?.message?.content?.trim() ?? "";

  return { reply, tone, model };
}
