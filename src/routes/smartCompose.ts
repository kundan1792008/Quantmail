/**
 * Smart Compose Routes
 *
 * REST endpoints for the AI Smart Compose feature:
 *
 *   POST /smart-compose/suggest
 *     Generate sentence-completion suggestions for the current draft.
 *
 *   POST /smart-compose/feedback
 *     Record whether the user accepted or rejected a suggestion (learning loop).
 *
 *   POST /smart-compose/build-profile
 *     Ingest a batch of sent emails to build / refresh the user's writing profile.
 *
 *   GET  /smart-compose/profile/:userEmail
 *     Retrieve a summary of the user's writing profile.
 *
 *   GET  /smart-compose/meeting-slots/:userEmail
 *     Return suggested meeting time slots from the user's calendar patterns.
 *
 *   POST /smart-compose/detect-tone
 *     Detect the dominant tone of a draft without generating completions.
 */

import { FastifyInstance } from "fastify";
import {
  generateCompletions,
  recordFeedback,
  SmartComposeConfigError,
  hasMinimumContext,
  type ComposeContext,
  type ComposeFeedback,
  type CompletionSuggestion,
} from "../services/SmartComposeEngine";
import { detectTone, formatToneLabel, toneEmoji } from "../services/ToneAdapter";
import {
  buildProfile,
  getProfile,
  serialiseProfile,
  suggestMeetingSlots,
  type SentEmail,
} from "../services/ContextLearner";

// ─── Route Definitions ────────────────────────────────────────────────────────

export async function smartComposeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /smart-compose/suggest
   *
   * Generates up to 3 ranked sentence-completion suggestions for the current
   * email draft.
   *
   * Body (JSON):
   *   userEmail       {string}  – Composer's email (required).
   *   subject         {string}  – Email subject (required).
   *   bodyUpToCursor  {string}  – Draft body up to the cursor (required).
   *   recipientEmail  {string}  – Recipient's email address (required).
   *   recipientName   {string}  – Recipient's display name (required).
   *   relationship    {string?} – Recipient relationship hint.
   *   tone            {string?} – Override tone (formal/casual/urgent/apologetic/neutral).
   *   trailingText    {string?} – Text after the cursor.
   *   maxSuggestions  {number?} – 1–5 (default: 3).
   *
   * Response 200:
   *   { suggestions, tone, toneLabel, toneEmoji, model, latencyMs }
   */
  app.post<{
    Body: {
      userEmail: string;
      subject: string;
      bodyUpToCursor: string;
      recipientEmail: string;
      recipientName: string;
      relationship?: string;
      tone?: string;
      trailingText?: string;
      maxSuggestions?: number;
    };
  }>("/smart-compose/suggest", async (request, reply) => {
    const {
      userEmail,
      subject,
      bodyUpToCursor,
      recipientEmail,
      recipientName,
      relationship,
      tone,
      trailingText,
      maxSuggestions,
    } = request.body ?? {};

    if (!userEmail || typeof userEmail !== "string") {
      return reply.code(400).send({ error: "userEmail is required" });
    }
    if (!subject || typeof subject !== "string") {
      return reply.code(400).send({ error: "subject is required" });
    }
    if (typeof bodyUpToCursor !== "string") {
      return reply.code(400).send({ error: "bodyUpToCursor is required" });
    }
    if (!recipientEmail || typeof recipientEmail !== "string") {
      return reply.code(400).send({ error: "recipientEmail is required" });
    }
    if (!recipientName || typeof recipientName !== "string") {
      return reply.code(400).send({ error: "recipientName is required" });
    }

    const context: ComposeContext = {
      subject: subject.trim(),
      bodyUpToCursor,
      recipient: {
        name: recipientName.trim(),
        email: recipientEmail.trim().toLowerCase(),
        relationship: relationship as ComposeContext["recipient"]["relationship"],
      },
      tone: tone as ComposeContext["tone"],
      trailingText,
    };

    // Detect tone if not explicitly provided.
    let resolvedTone = context.tone;
    if (!resolvedTone) {
      const toneResult = detectTone(
        context.subject,
        context.bodyUpToCursor,
        context.recipient
      );
      resolvedTone = toneResult.tone;
      context.tone = resolvedTone;
    }

    // Require minimum context to avoid noisy suggestions.
    if (!hasMinimumContext(context)) {
      return reply.code(422).send({
        error: "Insufficient context: provide a subject, recipient, and at least a few words of body.",
      });
    }

    try {
      const result = await generateCompletions(context, {
        maxSuggestions: maxSuggestions && maxSuggestions > 0 ? Math.min(5, maxSuggestions) : 3,
        enablePersonalisation: true,
      });

      return reply.code(200).send({
        suggestions: result.suggestions,
        tone: result.tone,
        toneLabel: formatToneLabel({ tone: result.tone, secondaryTone: result.tone, confidence: 0.8, method: "heuristic" }),
        toneEmoji: toneEmoji(result.tone),
        model: result.model,
        latencyMs: result.latencyMs,
      });
    } catch (err: unknown) {
      if (err instanceof SmartComposeConfigError) {
        return reply.code(503).send({ error: "AI service not configured: " + err.message });
      }
      app.log.error({ err }, "Smart compose suggestion failed");
      return reply.code(500).send({ error: "Failed to generate completions" });
    }
  });

  /**
   * POST /smart-compose/feedback
   *
   * Records user feedback for a previously shown suggestion.
   *
   * Body (JSON):
   *   userEmail   {string}  – User's email.
   *   context     {object}  – The ComposeContext that produced the suggestion.
   *   suggestion  {object}  – The CompletionSuggestion shown to the user.
   *   accepted    {boolean} – true = Tab (accepted), false = Esc (dismissed).
   *
   * Response 204: No content.
   */
  app.post<{
    Body: {
      userEmail: string;
      context: ComposeContext;
      suggestion: CompletionSuggestion;
      accepted: boolean;
    };
  }>("/smart-compose/feedback", async (request, reply) => {
    const { userEmail, context, suggestion, accepted } = request.body ?? {};

    if (!userEmail || typeof userEmail !== "string") {
      return reply.code(400).send({ error: "userEmail is required" });
    }
    if (!context || typeof context !== "object") {
      return reply.code(400).send({ error: "context is required" });
    }
    if (!suggestion || typeof suggestion !== "object") {
      return reply.code(400).send({ error: "suggestion is required" });
    }
    if (typeof accepted !== "boolean") {
      return reply.code(400).send({ error: "accepted (boolean) is required" });
    }

    const feedback: ComposeFeedback = {
      context,
      suggestion,
      accepted,
      timestamp: new Date().toISOString(),
    };

    recordFeedback(userEmail, feedback);
    return reply.code(204).send();
  });

  /**
   * POST /smart-compose/build-profile
   *
   * Builds or refreshes the user's writing profile from a batch of sent emails.
   *
   * Body (JSON):
   *   userEmail   {string}     – User's email address.
   *   sentEmails  {SentEmail[]} – Array of past sent emails.
   *
   * Response 200:
   *   { profile: { userEmail, updatedAt, phraseCount, recipientCount, formality, calendarSlotCount } }
   */
  app.post<{
    Body: {
      userEmail: string;
      sentEmails: SentEmail[];
    };
  }>("/smart-compose/build-profile", async (request, reply) => {
    const { userEmail, sentEmails } = request.body ?? {};

    if (!userEmail || typeof userEmail !== "string") {
      return reply.code(400).send({ error: "userEmail is required" });
    }
    if (!Array.isArray(sentEmails)) {
      return reply.code(400).send({ error: "sentEmails must be an array" });
    }
    if (sentEmails.length === 0) {
      return reply.code(400).send({ error: "sentEmails must not be empty" });
    }

    const profile = buildProfile(userEmail, sentEmails);
    const summary = {
      userEmail: profile.userEmail,
      updatedAt: profile.updatedAt,
      phraseCount: profile.phrases.length,
      recipientCount: profile.recipientProfiles.size,
      formality: profile.formality,
      calendarSlotCount: profile.calendarSlots.length,
    };

    return reply.code(200).send({ profile: summary });
  });

  /**
   * GET /smart-compose/profile/:userEmail
   *
   * Returns a serialisable summary of the user's writing profile.
   *
   * Response 200: { profile: serialised UserWritingProfile }
   * Response 404: Profile not found.
   */
  app.get<{ Params: { userEmail: string } }>(
    "/smart-compose/profile/:userEmail",
    async (request, reply) => {
      const { userEmail } = request.params;
      const profile = getProfile(decodeURIComponent(userEmail));
      if (!profile) {
        return reply.code(404).send({ error: "Profile not found" });
      }
      return reply.code(200).send({ profile: serialiseProfile(profile) });
    }
  );

  /**
   * GET /smart-compose/meeting-slots/:userEmail
   *
   * Returns suggested meeting time slots for the next 3 days.
   *
   * Response 200: { slots: CalendarSlot[] }
   */
  app.get<{ Params: { userEmail: string } }>(
    "/smart-compose/meeting-slots/:userEmail",
    async (request, reply) => {
      const { userEmail } = request.params;
      const slots = suggestMeetingSlots(decodeURIComponent(userEmail), 3);
      return reply.code(200).send({ slots });
    }
  );

  /**
   * POST /smart-compose/detect-tone
   *
   * Detects the dominant tone of the provided email draft.
   *
   * Body (JSON):
   *   subject         {string}  – Email subject.
   *   body            {string}  – Draft body.
   *   recipientEmail  {string}  – Recipient's email.
   *   recipientName   {string}  – Recipient's display name.
   *   relationship    {string?} – Relationship hint.
   *
   * Response 200:
   *   { tone, secondaryTone, confidence, method, templateType, label, emoji }
   */
  app.post<{
    Body: {
      subject: string;
      body: string;
      recipientEmail: string;
      recipientName: string;
      relationship?: string;
    };
  }>("/smart-compose/detect-tone", async (request, reply) => {
    const { subject, body, recipientEmail, recipientName, relationship } =
      request.body ?? {};

    if (!subject || typeof subject !== "string") {
      return reply.code(400).send({ error: "subject is required" });
    }
    if (!body || typeof body !== "string") {
      return reply.code(400).send({ error: "body is required" });
    }
    if (!recipientEmail || typeof recipientEmail !== "string") {
      return reply.code(400).send({ error: "recipientEmail is required" });
    }
    if (!recipientName || typeof recipientName !== "string") {
      return reply.code(400).send({ error: "recipientName is required" });
    }

    const result = detectTone(subject, body, {
      name: recipientName.trim(),
      email: recipientEmail.trim().toLowerCase(),
      relationship: relationship as Parameters<typeof detectTone>[2]["relationship"],
    });

    return reply.code(200).send({
      ...result,
      label: formatToneLabel(result),
      emoji: toneEmoji(result.tone),
    });
  });
}
