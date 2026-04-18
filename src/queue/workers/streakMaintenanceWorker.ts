/**
 * Streak Maintenance Worker
 *
 * Runs once per UTC day (typically at 00:05 UTC) and rolls each active
 * user's streak forward.  Behaviour is intentionally low-pressure:
 *
 *   • A user who was active the previous UTC day has their streak left
 *     untouched; today's first activity will advance it.
 *   • A user who missed exactly one day AND has opted-in to
 *     `autoConsumeShield` AND holds at least one active shield will
 *     have a shield consumed and their streak preserved.
 *   • Any other gap resets the streak to 0 with no side-effects —
 *     no badge revocation, no ELO decay, no "ghost mode" flag.
 *
 * When a streak resets, a neutral `streak.welcome_back` webhook is
 * dispatched so downstream services (e.g. product emails) can deliver
 * an encouraging message next time the user visits.  There are no push
 * notifications, no countdowns, and no urgent copy.
 *
 * Run standalone:
 *   npx tsx src/queue/workers/streakMaintenanceWorker.ts
 */

import { Worker, type Job } from "bullmq";
import { prisma } from "../../db";
import { rollForward, utcDateKey } from "../../services/streakService";
import { dispatchWebhookEvent } from "../../webhooks/webhookService";
import {
  QUEUE_NAMES,
  redisConnection,
  type StreakMaintenanceJobData,
} from "../queues";

const CONCURRENCY = parseInt(
  process.env["STREAK_WORKER_CONCURRENCY"] || "1",
  10
);

/** Milliseconds in one UTC day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Users with any activity in the last N days are considered "active". */
const ACTIVE_USER_WINDOW_DAYS = parseInt(
  process.env["STREAK_ACTIVE_USER_WINDOW_DAYS"] || "30",
  10
);

export interface StreakMaintenanceSummary {
  forDate: string;
  usersProcessed: number;
  streaksReset: number;
  shieldsConsumed: number;
  errors: Array<{ userId: string; error: string }>;
}

/**
 * Resolves the list of user ids to process.  When `userIds` is supplied
 * on the job, that subset is used verbatim; otherwise all users that
 * have activity in the recent window (or hold a streak row with a
 * non-zero current streak) are included.
 */
async function resolveTargetUsers(
  data: StreakMaintenanceJobData,
  today: Date
): Promise<string[]> {
  if (data.userIds && data.userIds.length > 0) return data.userIds;

  const windowStart = utcDateKey(
    new Date(today.getTime() - ACTIVE_USER_WINDOW_DAYS * MS_PER_DAY)
  );

  const [recent, withStreak] = await Promise.all([
    prisma.dailyActivity.findMany({
      where: { date: { gte: windowStart } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.userStreak.findMany({
      where: { currentStreak: { gt: 0 } },
      select: { userId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const r of recent) ids.add(r.userId);
  for (const r of withStreak) ids.add(r.userId);
  return Array.from(ids);
}

/**
 * Core maintenance routine.  Exported for the fallback path in
 * `enqueueStreakMaintenance` when Redis is unavailable, and for tests.
 */
export async function runStreakMaintenance(
  data: StreakMaintenanceJobData = {}
): Promise<StreakMaintenanceSummary> {
  const today = data.forDate ? new Date(data.forDate) : new Date();
  const todayKey = utcDateKey(today);

  const userIds = await resolveTargetUsers(data, today);

  const summary: StreakMaintenanceSummary = {
    forDate: todayKey.toISOString(),
    usersProcessed: 0,
    streaksReset: 0,
    shieldsConsumed: 0,
    errors: [],
  };

  for (const userId of userIds) {
    try {
      const result = await rollForward(userId, todayKey);
      summary.usersProcessed += 1;
      if (result.shieldConsumed) summary.shieldsConsumed += 1;
      if (result.didReset) {
        summary.streaksReset += 1;
        // Neutral, positive-framed event.  Downstream receivers should
        // use encouraging copy — e.g., "Welcome back, start a new streak".
        try {
          await dispatchWebhookEvent("streak.welcome_back", {
            userId,
            previousStreak: result.previousStreak,
            resetAt: todayKey.toISOString(),
            tone: "neutral",
            suggestedCopy:
              "Welcome back — use any Quantmail app today to start a new streak.",
          });
        } catch (err) {
          // Webhook failures should never prevent streak maintenance
          // from making progress on subsequent users.
          console.warn(
            "[StreakMaintenanceWorker] webhook dispatch failed:",
            err instanceof Error ? err.message : err
          );
        }
      }
    } catch (err) {
      summary.errors.push({
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

async function processJob(
  job: Job<StreakMaintenanceJobData>
): Promise<StreakMaintenanceSummary> {
  console.log(
    `[StreakMaintenanceWorker] Processing job ${job.id} for ${
      job.data.forDate ?? "today"
    }`
  );
  const summary = await runStreakMaintenance(job.data);
  console.log(
    `[StreakMaintenanceWorker] Done: processed=${summary.usersProcessed}, reset=${summary.streaksReset}, shieldsConsumed=${summary.shieldsConsumed}, errors=${summary.errors.length}`
  );
  return summary;
}

let worker: Worker<StreakMaintenanceJobData, StreakMaintenanceSummary> | null =
  null;

export function startStreakMaintenanceWorker(): Worker<
  StreakMaintenanceJobData,
  StreakMaintenanceSummary
> | null {
  try {
    worker = new Worker<StreakMaintenanceJobData, StreakMaintenanceSummary>(
      QUEUE_NAMES.STREAK_MAINTENANCE,
      processJob,
      {
        connection: redisConnection,
        concurrency: CONCURRENCY,
      }
    );

    worker.on("completed", (job) => {
      console.log(`[StreakMaintenanceWorker] Job ${job.id} completed.`);
    });

    worker.on("failed", (job, err) => {
      console.error(
        `[StreakMaintenanceWorker] Job ${job?.id} failed: ${err.message}`
      );
    });

    worker.on("error", (err) => {
      console.error("[StreakMaintenanceWorker] Worker error:", err.message);
    });

    console.log(
      `[StreakMaintenanceWorker] Started. Queue: "${QUEUE_NAMES.STREAK_MAINTENANCE}", concurrency: ${CONCURRENCY}.`
    );
    return worker;
  } catch (err) {
    console.warn(
      "[StreakMaintenanceWorker] Failed to start worker. Redis may be unavailable.",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function stopStreakMaintenanceWorker(): Promise<void> {
  return worker ? worker.close() : Promise.resolve();
}

// ─── Standalone entry point ───────────────────────────────────────

if (require.main === module) {
  const w = startStreakMaintenanceWorker();
  if (!w) {
    console.error("[StreakMaintenanceWorker] Could not start. Exiting.");
    process.exit(1);
  }

  const shutdown = async () => {
    console.log("[StreakMaintenanceWorker] Shutting down…");
    await stopStreakMaintenanceWorker();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
