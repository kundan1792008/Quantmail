/**
 * Streak Routes
 *
 * REST API for the cross-app streak system.  All monetization is
 * optional, all social visibility is opt-in (`shareStreak` on User),
 * and nothing here revokes status, greys out profiles, or induces
 * anxiety.  Shield grants from the PURCHASE source are intentionally
 * *not* created here — that path must go through `paywallService` so
 * that billing is handled consistently with the rest of the app.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import {
  AppId,
  getLeaderboard,
  getStreakState,
  grantShield,
  recordActivity,
  StreakShieldSource,
  useShield,
} from "../services/streakService";

const recordActivitySchema = z.object({
  userId: z.string().min(1),
  appId: z.nativeEnum(AppId),
  at: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
});

const grantShieldSchema = z.object({
  userId: z.string().min(1),
  source: z
    .enum([
      StreakShieldSource.PROMO,
      StreakShieldSource.COMEBACK_GIFT,
      StreakShieldSource.MILESTONE,
      StreakShieldSource.PURCHASE,
    ])
    .default(StreakShieldSource.PROMO),
  note: z.string().max(256).optional(),
});

const useShieldSchema = z.object({
  userId: z.string().min(1),
  missedDate: z.string().datetime(),
});

const settingsSchema = z
  .object({
    shareStreak: z.boolean().optional(),
    autoConsumeShield: z.boolean().optional(),
  })
  .refine(
    (d) => d.shareStreak !== undefined || d.autoConsumeShield !== undefined,
    { message: "At least one of shareStreak / autoConsumeShield is required" }
  );

export async function streakRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /streak/activity
   * Logs a meaningful activity for one of the 9 apps.  Idempotent per
   * (userId, appId, UTC-day).  Each app should call this at most once
   * per user session (and is safe to call more often — no-op effect).
   */
  app.post("/streak/activity", async (request, reply) => {
    const parsed = recordActivitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", issues: parsed.error.issues });
    }
    const { userId, appId, at } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

    const result = await recordActivity(userId, appId, at);
    return reply.send(result);
  });

  /**
   * GET /streak/:userId
   * Returns current streak state: currentStreak, longestStreak,
   * shieldCount, today's apps used, Trinity Mode flag, and a neutral
   * status message suitable for display.
   */
  app.get<{ Params: { userId: string } }>(
    "/streak/:userId",
    async (request, reply) => {
      const { userId } = request.params;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

      const state = await getStreakState(userId);
      return reply.send(state);
    }
  );

  /**
   * GET /streak/leaderboard
   * Opt-in leaderboard.  Only users with shareStreak = true appear.
   */
  app.get<{ Querystring: { limit?: string } }>(
    "/streak/leaderboard",
    async (request, reply) => {
      const limit = Math.max(
        1,
        Math.min(100, parseInt(request.query.limit ?? "20", 10) || 20)
      );
      const entries = await getLeaderboard(limit);
      return reply.send({ entries, count: entries.length });
    }
  );

  /**
   * POST /streak/shield/grant
   * Admin / promo endpoint.  Grants one shield to a user subject to the
   * MAX_SHIELDS cap.  PURCHASE-source grants should normally be issued
   * from the paywall flow after a successful charge.
   */
  app.post("/streak/shield/grant", async (request, reply) => {
    const parsed = grantShieldSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", issues: parsed.error.issues });
    }
    const { userId, source, note } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

    const result = await grantShield(userId, source, note ?? "");
    if (!result.granted) {
      return reply.code(409).send({
        error: result.reason,
        shieldCount: result.shieldCount,
      });
    }
    return reply.code(201).send(result);
  });

  /**
   * POST /streak/shield/use
   * Explicit user-initiated application of a shield to a missed date.
   */
  app.post("/streak/shield/use", async (request, reply) => {
    const parsed = useShieldSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", issues: parsed.error.issues });
    }
    const { userId, missedDate } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

    const result = await useShield(userId, new Date(missedDate));
    if (!result.used) {
      return reply.code(409).send({
        error: result.reason,
        shieldCount: result.shieldCount,
      });
    }
    return reply.send(result);
  });

  /**
   * PATCH /streak/settings/:userId
   * Updates opt-in settings: shareStreak (leaderboard visibility) and
   * autoConsumeShield (let the maintenance worker spend a shield to
   * preserve a one-day gap).  Both default to false.
   */
  app.patch<{ Params: { userId: string } }>(
    "/streak/settings/:userId",
    async (request, reply) => {
      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_INPUT", issues: parsed.error.issues });
      }
      const { userId } = request.params;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND" });

      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(parsed.data.shareStreak !== undefined && {
            shareStreak: parsed.data.shareStreak,
          }),
          ...(parsed.data.autoConsumeShield !== undefined && {
            autoConsumeShield: parsed.data.autoConsumeShield,
          }),
        },
        select: {
          id: true,
          shareStreak: true,
          autoConsumeShield: true,
        },
      });
      return reply.send(updated);
    }
  );
}
