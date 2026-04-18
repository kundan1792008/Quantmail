/**
 * Streak Service
 *
 * Cross-app engagement streak system for the 9-app Quantmail ecosystem.
 * Design goals:
 *   • Reward consistent usage without punishing absence.  Losing a streak
 *     has NO status penalty — the counter simply resets, and users are
 *     greeted with neutral, encouraging copy the next time they return.
 *   • "Trinity Mode" is a cosmetic flag (golden UI theme) granted when
 *     all 9 apps are used in the same UTC day.  It is never used to
 *     shame users who did not hit it.
 *   • Streak shields protect a missed day.  They are optional: a user
 *     must opt-in (`autoConsumeShield`) before the maintenance worker
 *     will spend one automatically, or they may spend one manually.
 *     Holding more than 2 active shields is prevented.
 *   • Free "milestone" shields are granted every MILESTONE_STREAK_DAYS
 *     consecutive days so the feature is not paywall-dependent.
 *   • Leaderboard participation is opt-in (`shareStreak` defaults to
 *     false on the User model).
 *
 * The module is split into pure helper functions (easy to unit-test with
 * no database) and persistence-aware wrappers that call into Prisma.
 * See `src/__tests__/streakService.test.ts`.
 */

import { prisma } from "../db";
import {
  AppId,
  StreakShieldSource,
  type DailyActivity,
  type StreakShield,
  type UserStreak,
} from "../generated/prisma/client";

// ─── Constants ────────────────────────────────────────────────────

/** All 9 apps in the Quantmail ecosystem. */
export const ALL_APP_IDS: readonly AppId[] = [
  AppId.MAIL,
  AppId.CALENDAR,
  AppId.DRIVE,
  AppId.DOCS,
  AppId.SHEETS,
  AppId.NOTES,
  AppId.TASKS,
  AppId.CHAT,
  AppId.MEET,
] as const;

/** Maximum shields a user may hold at once. */
export const MAX_SHIELDS = 2;

/** Grant a free milestone shield every N consecutive streak days. */
export const MILESTONE_STREAK_DAYS = 14;

/** Apps-used-today threshold for the cross-app amplifier. */
export const AMPLIFIER_APP_THRESHOLD = 3;
export const AMPLIFIER_MULTIPLIER = 2;

/** Number of apps required to trigger cosmetic Trinity Mode for a day. */
export const TRINITY_APP_COUNT = ALL_APP_IDS.length;

/** Milliseconds in one UTC day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Pure helpers ─────────────────────────────────────────────────

/**
 * Returns the UTC calendar-day key for a timestamp as a fresh `Date`
 * pinned to midnight UTC.  Using midnight UTC avoids timezone drift
 * when reasoning about "today" across global users.
 */
export function utcDateKey(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
}

/**
 * Number of whole UTC days between two dates (b - a).  Both dates are
 * first normalised to midnight UTC so that clock-time differences don't
 * affect the result.
 */
export function daysBetweenUTC(a: Date, b: Date): number {
  const aKey = utcDateKey(a).getTime();
  const bKey = utcDateKey(b).getTime();
  return Math.round((bKey - aKey) / MS_PER_DAY);
}

/**
 * True when the given set of app ids covers all 9 apps in the
 * ecosystem (cosmetic Trinity Mode trigger).
 */
export function isTrinityDay(apps: Iterable<AppId>): boolean {
  const unique = new Set<AppId>();
  for (const app of apps) unique.add(app);
  return unique.size === TRINITY_APP_COUNT;
}

export interface StreakTransition {
  /** New `currentStreak` after applying the activity. */
  currentStreak: number;
  /** Updated `longestStreak`. */
  longestStreak: number;
  /** Whether a shield was consumed to preserve the streak. */
  shieldConsumed: boolean;
  /** Whether the streak was reset (gap > 1 day and no shield used). */
  didReset: boolean;
  /** Previous streak value, surfaced for "welcome back" messaging. */
  previousStreak: number;
}

/**
 * Pure streak-transition logic.  Given the prior `lastActiveDate`,
 * `currentStreak`, `longestStreak`, the today date, whether a shield is
 * available and whether the user has opted-in to auto-consume, returns
 * the resulting streak values plus whether a reset or shield-consume
 * event occurred.
 *
 * This is the core state machine for both `recordActivity` (called when
 * a user actually uses an app) and `rollForward` (called nightly by the
 * maintenance worker to detect missed days).
 */
export function transitionStreak(input: {
  lastActiveDate: Date | null;
  currentStreak: number;
  longestStreak: number;
  today: Date;
  /** True when the user is actually active today. */
  activeToday: boolean;
  /** Number of unused shields the user currently holds. */
  availableShields: number;
  /** Whether the user has opted-in to automatic shield consumption. */
  autoConsumeShield: boolean;
}): StreakTransition {
  const {
    lastActiveDate,
    currentStreak,
    longestStreak,
    today,
    activeToday,
    availableShields,
    autoConsumeShield,
  } = input;

  const previousStreak = currentStreak;
  const todayKey = utcDateKey(today);

  // No prior activity at all: first active day starts the streak at 1.
  if (!lastActiveDate) {
    if (!activeToday) {
      return {
        currentStreak: 0,
        longestStreak,
        shieldConsumed: false,
        didReset: false,
        previousStreak,
      };
    }
    const next = 1;
    return {
      currentStreak: next,
      longestStreak: Math.max(longestStreak, next),
      shieldConsumed: false,
      didReset: false,
      previousStreak,
    };
  }

  const gap = daysBetweenUTC(lastActiveDate, todayKey);

  // Same UTC day → idempotent.  The streak already includes today.
  if (gap === 0) {
    return {
      currentStreak,
      longestStreak,
      shieldConsumed: false,
      didReset: false,
      previousStreak,
    };
  }

  // Past activity (should not happen in normal flow but be defensive).
  if (gap < 0) {
    return {
      currentStreak,
      longestStreak,
      shieldConsumed: false,
      didReset: false,
      previousStreak,
    };
  }

  // Yesterday: consecutive day.
  if (gap === 1) {
    if (!activeToday) {
      return {
        currentStreak,
        longestStreak,
        shieldConsumed: false,
        didReset: false,
        previousStreak,
      };
    }
    const next = currentStreak + 1;
    return {
      currentStreak: next,
      longestStreak: Math.max(longestStreak, next),
      shieldConsumed: false,
      didReset: false,
      previousStreak,
    };
  }

  // Exactly one day missed (gap === 2): a single shield can bridge it.
  // Note: we only auto-consume when explicitly opted-in.  Manual
  // shield use goes through `useShield()` instead.
  if (gap === 2 && availableShields > 0 && autoConsumeShield) {
    if (!activeToday) {
      // Holding position: shield preserves streak, no increment yet.
      return {
        currentStreak,
        longestStreak,
        shieldConsumed: true,
        didReset: false,
        previousStreak,
      };
    }
    const next = currentStreak + 1;
    return {
      currentStreak: next,
      longestStreak: Math.max(longestStreak, next),
      shieldConsumed: true,
      didReset: false,
      previousStreak,
    };
  }

  // Gap too large (or no shield available / not opted-in): clean reset.
  const next = activeToday ? 1 : 0;
  return {
    currentStreak: next,
    longestStreak, // never decrements
    shieldConsumed: false,
    didReset: previousStreak > 0,
    previousStreak,
  };
}

/**
 * Returns the number of milestone shields to grant when the streak
 * crosses multiples of `MILESTONE_STREAK_DAYS`.  `lastGranted` is the
 * streak value at which the most recent milestone shield was issued.
 *
 * The cap is applied by the caller (MAX_SHIELDS).
 */
export function milestoneShieldsEarned(
  currentStreak: number,
  lastGranted: number
): number {
  if (currentStreak <= lastGranted) return 0;
  const beforeCount = Math.floor(lastGranted / MILESTONE_STREAK_DAYS);
  const nowCount = Math.floor(currentStreak / MILESTONE_STREAK_DAYS);
  return Math.max(0, nowCount - beforeCount);
}

/**
 * Friendly, non-urgent status message for the current state.  All copy
 * is positive or neutral — no anxiety-inducing countdowns, no shaming.
 */
export function buildStatusMessage(state: {
  currentStreak: number;
  previousStreak?: number;
  didReset?: boolean;
  isTrinityDay: boolean;
}): string {
  if (state.didReset && (state.previousStreak ?? 0) > 0) {
    return `Welcome back — ready to start a new streak?`;
  }
  if (state.isTrinityDay) {
    return `Trinity Mode active — you used all 9 apps today. ✨`;
  }
  if (state.currentStreak === 0) {
    return `Use any Quantmail app today to start your streak.`;
  }
  if (state.currentStreak === 1) {
    return `Day 1 of your streak — nice start! 🔥`;
  }
  return `You're on a ${state.currentStreak}-day streak. 🔥`;
}

// ─── Types ────────────────────────────────────────────────────────

export interface StreakState {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: Date | null;
  shieldCount: number;
  maxShields: number;
  appsUsedToday: AppId[];
  appsUsedTodayCount: number;
  isTrinityDay: boolean;
  trinityDaysTotal: number;
  amplifierActive: boolean;
  amplifierMultiplier: number;
  shareStreak: boolean;
  autoConsumeShield: boolean;
  statusMessage: string;
}

export interface RecordActivityResult {
  state: StreakState;
  /** Was this the first activity of the day (i.e., not a dedupe)? */
  isNewActivityToday: boolean;
  /** Shields newly granted as a result of milestone crossings. */
  shieldsGranted: number;
  /** Did this record cross into Trinity Mode for the first time today? */
  trinityUnlockedToday: boolean;
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  currentStreak: number;
  longestStreak: number;
  isTrinityDayToday: boolean;
}

// ─── Persistence-backed operations ────────────────────────────────

/**
 * Fetches the list of apps the user has used on the given UTC day.
 * Always returns a fresh array; never null.
 */
async function fetchAppsUsedOn(userId: string, day: Date): Promise<AppId[]> {
  const rows = await prisma.dailyActivity.findMany({
    where: { userId, date: utcDateKey(day) },
    select: { appId: true },
  });
  return rows.map((r) => r.appId);
}

/**
 * Counts the number of unused shields held by the user.
 */
async function countActiveShields(userId: string): Promise<number> {
  return prisma.streakShield.count({
    where: { userId, usedAt: null },
  });
}

/**
 * Ensures a `UserStreak` row exists for the user and returns it.  Uses
 * upsert so it is safe to call concurrently.
 */
async function ensureStreakRow(userId: string): Promise<UserStreak> {
  return prisma.userStreak.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

/**
 * Records a usage event for a single app.  Idempotent for the same
 * `(userId, appId, UTC-day)` — repeated calls just bump `lastAt`/`count`.
 *
 * The streak is advanced only on the *first* activity of the UTC day.
 * Milestone shields (see `MILESTONE_STREAK_DAYS`) are granted when the
 * streak crosses the next multiple.
 */
export async function recordActivity(
  userId: string,
  appId: AppId,
  at: Date = new Date()
): Promise<RecordActivityResult> {
  const day = utcDateKey(at);

  // Upsert the activity row.  The `count` column reflects real usage
  // intensity and is handy for analytics; it does not affect streaks.
  const existing = await prisma.dailyActivity.findUnique({
    where: { daily_activity_unique: { userId, appId, date: day } },
  });

  let isNewAppForDay = false;
  if (existing) {
    await prisma.dailyActivity.update({
      where: { id: existing.id },
      data: { count: { increment: 1 }, lastAt: at },
    });
  } else {
    await prisma.dailyActivity.create({
      data: { userId, appId, date: day, firstAt: at, lastAt: at },
    });
    isNewAppForDay = true;
  }

  const appsUsedToday = await fetchAppsUsedOn(userId, day);
  const trinityToday = isTrinityDay(appsUsedToday);

  const streakRow = await ensureStreakRow(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      shareStreak: true,
      autoConsumeShield: true,
    },
  });
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  const availableShields = await countActiveShields(userId);

  const wasStreakAdvancedToday =
    streakRow.lastActiveDate !== null &&
    utcDateKey(streakRow.lastActiveDate).getTime() === day.getTime();

  // Only compute a streak transition when this is the first activity of
  // the day; subsequent activities are pure no-ops for streak state.
  let transition: StreakTransition | null = null;
  let shieldsGranted = 0;
  let trinityUnlockedToday = false;
  const previousTrinityDate = streakRow.lastTrinityDate
    ? utcDateKey(streakRow.lastTrinityDate).getTime()
    : null;

  if (!wasStreakAdvancedToday) {
    transition = transitionStreak({
      lastActiveDate: streakRow.lastActiveDate,
      currentStreak: streakRow.currentStreak,
      longestStreak: streakRow.longestStreak,
      today: day,
      activeToday: true,
      availableShields,
      autoConsumeShield: user.autoConsumeShield,
    });

    // Apply shield consumption (if any) inside the same transaction as
    // the streak update for atomicity.
    await prisma.$transaction(async (tx) => {
      if (transition!.shieldConsumed) {
        const shield = await tx.streakShield.findFirst({
          where: { userId, usedAt: null },
          orderBy: { grantedAt: "asc" },
        });
        if (shield) {
          await tx.streakShield.update({
            where: { id: shield.id },
            data: {
              usedAt: new Date(),
              usedForDate: utcDateKey(
                new Date(day.getTime() - MS_PER_DAY)
              ),
              note: "auto-consumed by streak engine",
            },
          });
        }
      }

      // Milestone shield grants based on the *new* streak value.
      const earned = milestoneShieldsEarned(
        transition!.currentStreak,
        streakRow.lastMilestoneGrant
      );
      if (earned > 0) {
        const existingActive = await tx.streakShield.count({
          where: { userId, usedAt: null },
        });
        const slotsLeft = Math.max(0, MAX_SHIELDS - existingActive);
        const toCreate = Math.min(earned, slotsLeft);
        for (let i = 0; i < toCreate; i++) {
          await tx.streakShield.create({
            data: {
              userId,
              source: StreakShieldSource.MILESTONE,
              note: `granted at ${transition!.currentStreak}-day streak`,
            },
          });
        }
        shieldsGranted = toCreate;
      }

      await tx.userStreak.update({
        where: { userId },
        data: {
          currentStreak: transition!.currentStreak,
          longestStreak: transition!.longestStreak,
          lastActiveDate: day,
          lastMilestoneGrant: Math.max(
            streakRow.lastMilestoneGrant,
            Math.floor(transition!.currentStreak / MILESTONE_STREAK_DAYS) *
              MILESTONE_STREAK_DAYS
          ),
          shieldsGrantedTotal: {
            increment: shieldsGranted,
          },
          shieldCount: existingShieldCountAfter(
            await tx.streakShield.count({
              where: { userId, usedAt: null },
            })
          ),
        },
      });
    });
  }

  // Trinity-day bookkeeping: the first time today's set reaches all 9,
  // increment the lifetime count and record `lastTrinityDate`.
  if (trinityToday && previousTrinityDate !== day.getTime()) {
    await prisma.userStreak.update({
      where: { userId },
      data: {
        trinityDays: { increment: 1 },
        lastTrinityDate: day,
      },
    });
    trinityUnlockedToday = true;
  }

  const state = await getStreakState(userId, at);

  return {
    state,
    isNewActivityToday: isNewAppForDay && appsUsedToday.length === 1,
    shieldsGranted,
    trinityUnlockedToday,
  };
}

/**
 * `shieldCount` is a denormalised cache of active shields.  Centralise
 * clamping here so the value can never exceed the configured max.
 */
function existingShieldCountAfter(count: number): number {
  return Math.min(MAX_SHIELDS, Math.max(0, count));
}

/**
 * Returns the current streak state for a user, including the per-day
 * cross-app amplifier and Trinity Mode flag.  Does not mutate state.
 */
export async function getStreakState(
  userId: string,
  at: Date = new Date()
): Promise<StreakState> {
  const day = utcDateKey(at);

  const [streakRow, apps, shieldCount, user] = await Promise.all([
    ensureStreakRow(userId),
    fetchAppsUsedOn(userId, day),
    countActiveShields(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { shareStreak: true, autoConsumeShield: true },
    }),
  ]);

  if (!user) throw new Error(`User ${userId} not found`);

  const trinity = isTrinityDay(apps);
  const amplifierActive = apps.length >= AMPLIFIER_APP_THRESHOLD;

  return {
    userId,
    currentStreak: streakRow.currentStreak,
    longestStreak: streakRow.longestStreak,
    lastActiveDate: streakRow.lastActiveDate,
    shieldCount,
    maxShields: MAX_SHIELDS,
    appsUsedToday: apps,
    appsUsedTodayCount: apps.length,
    isTrinityDay: trinity,
    trinityDaysTotal: streakRow.trinityDays,
    amplifierActive,
    amplifierMultiplier: amplifierActive ? AMPLIFIER_MULTIPLIER : 1,
    shareStreak: user.shareStreak,
    autoConsumeShield: user.autoConsumeShield,
    statusMessage: buildStatusMessage({
      currentStreak: streakRow.currentStreak,
      isTrinityDay: trinity,
    }),
  };
}

export interface RollForwardResult {
  userId: string;
  previousStreak: number;
  currentStreak: number;
  didReset: boolean;
  shieldConsumed: boolean;
}

/**
 * Advance-or-reset the streak for `today`.  Called by the daily
 * maintenance worker.  Does nothing if the user was already active
 * today.  If the user missed exactly one day AND they have opted-in to
 * auto-consume AND they hold a shield, the shield is spent; otherwise
 * the streak resets cleanly to zero with no status penalty.
 */
export async function rollForward(
  userId: string,
  today: Date = new Date()
): Promise<RollForwardResult> {
  const day = utcDateKey(today);
  const [streakRow, user, availableShields] = await Promise.all([
    ensureStreakRow(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { autoConsumeShield: true },
    }),
    countActiveShields(userId),
  ]);
  if (!user) throw new Error(`User ${userId} not found`);

  // User was active today: nothing to do.
  if (
    streakRow.lastActiveDate &&
    utcDateKey(streakRow.lastActiveDate).getTime() === day.getTime()
  ) {
    return {
      userId,
      previousStreak: streakRow.currentStreak,
      currentStreak: streakRow.currentStreak,
      didReset: false,
      shieldConsumed: false,
    };
  }

  const transition = transitionStreak({
    lastActiveDate: streakRow.lastActiveDate,
    currentStreak: streakRow.currentStreak,
    longestStreak: streakRow.longestStreak,
    today: day,
    activeToday: false,
    availableShields,
    autoConsumeShield: user.autoConsumeShield,
  });

  await prisma.$transaction(async (tx) => {
    if (transition.shieldConsumed) {
      const shield = await tx.streakShield.findFirst({
        where: { userId, usedAt: null },
        orderBy: { grantedAt: "asc" },
      });
      if (shield) {
        await tx.streakShield.update({
          where: { id: shield.id },
          data: {
            usedAt: new Date(),
            usedForDate: utcDateKey(
              new Date(day.getTime() - MS_PER_DAY)
            ),
            note: "auto-consumed by maintenance worker",
          },
        });
      }
    }

    await tx.userStreak.update({
      where: { userId },
      data: {
        currentStreak: transition.currentStreak,
        longestStreak: transition.longestStreak,
        shieldCount: existingShieldCountAfter(
          await tx.streakShield.count({
            where: { userId, usedAt: null },
          })
        ),
      },
    });
  });

  return {
    userId,
    previousStreak: transition.previousStreak,
    currentStreak: transition.currentStreak,
    didReset: transition.didReset,
    shieldConsumed: transition.shieldConsumed,
  };
}

export interface GrantShieldResult {
  granted: boolean;
  shield?: StreakShield;
  reason?: "MAX_SHIELDS_REACHED";
  shieldCount: number;
}

/**
 * Grants a shield to a user from a given source.  Enforces the
 * MAX_SHIELDS cap atomically — callers never need to check the count
 * themselves before calling.
 */
export async function grantShield(
  userId: string,
  source: StreakShieldSource = StreakShieldSource.PROMO,
  note: string = ""
): Promise<GrantShieldResult> {
  const result = await prisma.$transaction(async (tx) => {
    const active = await tx.streakShield.count({
      where: { userId, usedAt: null },
    });
    if (active >= MAX_SHIELDS) {
      return { granted: false as const, shieldCount: active };
    }
    const shield = await tx.streakShield.create({
      data: { userId, source, note },
    });
    await tx.userStreak.upsert({
      where: { userId },
      update: {
        shieldCount: existingShieldCountAfter(active + 1),
        shieldsGrantedTotal: { increment: 1 },
      },
      create: {
        userId,
        shieldCount: existingShieldCountAfter(active + 1),
        shieldsGrantedTotal: 1,
      },
    });
    return { granted: true as const, shield, shieldCount: active + 1 };
  });

  if (!result.granted) {
    return {
      granted: false,
      reason: "MAX_SHIELDS_REACHED",
      shieldCount: result.shieldCount,
    };
  }
  return {
    granted: true,
    shield: result.shield,
    shieldCount: result.shieldCount,
  };
}

export interface UseShieldResult {
  used: boolean;
  reason?: "NO_ACTIVE_SHIELD" | "INVALID_DATE";
  shield?: StreakShield;
  newCurrentStreak?: number;
  shieldCount: number;
}

/**
 * Manually spend a shield to cover a specific missed date.  `missedDate`
 * must be strictly in the past (UTC day).  On success, if the gap
 * between `lastActiveDate` and today is exactly 2 days (i.e., yesterday
 * was missed), the shield preserves the user's current streak.  For
 * larger gaps the shield is still consumed (as a ledger record) but the
 * streak does not retroactively change — by design, we do not encourage
 * users to chain shields to paper over long absences.
 */
export async function useShield(
  userId: string,
  missedDate: Date,
  at: Date = new Date()
): Promise<UseShieldResult> {
  const missed = utcDateKey(missedDate);
  const today = utcDateKey(at);
  if (missed.getTime() >= today.getTime()) {
    const count = await countActiveShields(userId);
    return { used: false, reason: "INVALID_DATE", shieldCount: count };
  }

  const result = await prisma.$transaction(async (tx) => {
    const shield = await tx.streakShield.findFirst({
      where: { userId, usedAt: null },
      orderBy: { grantedAt: "asc" },
    });
    if (!shield) {
      const count = await tx.streakShield.count({
        where: { userId, usedAt: null },
      });
      return { used: false as const, reason: "NO_ACTIVE_SHIELD" as const, shieldCount: count };
    }

    const updated = await tx.streakShield.update({
      where: { id: shield.id },
      data: {
        usedAt: new Date(),
        usedForDate: missed,
        note: "manually applied by user",
      },
    });

    // If the shield covers yesterday and streak was frozen at the last
    // active value, preserve it now by advancing `lastActiveDate`.
    const streakRow = await tx.userStreak.findUnique({ where: { userId } });
    let newCurrent = streakRow?.currentStreak ?? 0;
    if (streakRow && streakRow.lastActiveDate) {
      const gap = daysBetweenUTC(streakRow.lastActiveDate, today);
      // Yesterday was missed: the shield plugs the gap — advance the
      // anchor so tomorrow's activity continues the streak.
      if (gap === 2 && missed.getTime() === streakRow.lastActiveDate.getTime() + MS_PER_DAY) {
        await tx.userStreak.update({
          where: { userId },
          data: {
            lastActiveDate: missed, // anchor to the newly-protected day
          },
        });
      }
    }

    const remaining = await tx.streakShield.count({
      where: { userId, usedAt: null },
    });
    await tx.userStreak.update({
      where: { userId },
      data: { shieldCount: existingShieldCountAfter(remaining) },
    });
    return {
      used: true as const,
      shield: updated,
      newCurrentStreak: newCurrent,
      shieldCount: remaining,
    };
  });

  if (!result.used) {
    return {
      used: false,
      reason: result.reason,
      shieldCount: result.shieldCount,
    };
  }
  return {
    used: true,
    shield: result.shield,
    newCurrentStreak: result.newCurrentStreak,
    shieldCount: result.shieldCount,
  };
}

/**
 * Opt-in leaderboard.  Only users with `shareStreak = true` appear in
 * the results.  No per-friend comparison strings are generated — the
 * caller decides how to present the list.
 */
export async function getLeaderboard(
  limit: number = 20,
  at: Date = new Date()
): Promise<LeaderboardEntry[]> {
  const rows = await prisma.userStreak.findMany({
    where: { user: { shareStreak: true } },
    orderBy: [{ currentStreak: "desc" }, { longestStreak: "desc" }],
    take: Math.max(1, Math.min(100, limit)),
    include: { user: { select: { displayName: true } } },
  });

  const today = utcDateKey(at);
  const todayMs = today.getTime();

  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.user.displayName,
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
    isTrinityDayToday:
      row.lastTrinityDate !== null &&
      utcDateKey(row.lastTrinityDate).getTime() === todayMs,
  }));
}

// ─── Re-exports for callers/tests ─────────────────────────────────

export { AppId, StreakShieldSource };
export type { DailyActivity, StreakShield, UserStreak };
