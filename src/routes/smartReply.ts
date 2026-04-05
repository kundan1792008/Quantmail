import { FastifyInstance } from "fastify";
import { generateSmartReply, ConfigurationError } from "../services/smartReplyService";

export async function smartReplyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /smart-reply/generate
   *
   * Generates an AI-powered email reply using OpenAI.
   *
   * Body:
   *   emailContext {string} – Full text of the email to reply to (required).
   *   tone         {string} – Optional tone: "Professional" | "Casual" | "Urgent"
   *                           Defaults to "Professional".
   *
   * Returns:
   *   { reply: string, tone: string, model: string }
   *
   * Errors:
   *   400 – Missing or empty emailContext.
   *   503 – OPENAI_API_KEY not configured.
   */
  app.post<{
    Body: {
      emailContext: string;
      tone?: string;
    };
  }>("/smart-reply/generate", async (request, reply) => {
    const { emailContext, tone } = request.body ?? {};

    if (!emailContext || typeof emailContext !== "string") {
      return reply.code(400).send({ error: "emailContext is required" });
    }
    if (emailContext.trim() === "") {
      return reply.code(400).send({ error: "emailContext must not be empty" });
    }

    try {
      const result = await generateSmartReply({
        emailContext: emailContext.trim(),
        // tone is optional; blank or whitespace falls back to "Professional" intentionally.
        tone: tone?.trim() || "Professional",
      });

      return reply.code(200).send(result);
    } catch (err: unknown) {
      if (err instanceof ConfigurationError) {
        return reply
          .code(503)
          .send({ error: "AI service not configured: " + err.message });
      }

      app.log.error({ err }, "Smart reply generation failed");
      return reply.code(500).send({ error: "Failed to generate reply" });
    }
  });
}
