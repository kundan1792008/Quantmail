import { describe, it, expect } from "vitest";
import {
  AMPLIFIER_APP_THRESHOLD,
  AMPLIFIER_MULTIPLIER,
  ALL_APP_IDS,
  MAX_SHIELDS,
  MILESTONE_STREAK_DAYS,
  buildStatusMessage,
  daysBetweenUTC,
  isTrinityDay,
  milestoneShieldsEarned,
  transitionStreak,
  utcDateKey,
} from "../services/streakService";
import { AppId } from "../generated/prisma/client";

function day(isoDate: string): Date {
  // `isoDate` is a YYYY-MM-DD string; pin to midnight UTC.
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

describe("utcDateKey / daysBetweenUTC", () => {
  it("normalises timestamps to midnight UTC", () => {
    const key = utcDateKey(new Date("2026-04-17T23:59:59.999Z"));
    expect(key.toISOString()).toBe("2026-04-17T00:00:00.000Z");
  });

  it("ignores clock-time differences across UTC days", () => {
    const a = new Date("2026-04-17T23:00:00.000Z");
    const b = new Date("2026-04-18T01:00:00.000Z");
    expect(daysBetweenUTC(a, b)).toBe(1);
  });

  it("handles month and year boundaries correctly", () => {
    expect(daysBetweenUTC(day("2025-12-31"), day("2026-01-01"))).toBe(1);
    expect(daysBetweenUTC(day("2026-01-31"), day("2026-03-01"))).toBe(29);
  });
});

describe("isTrinityDay", () => {
  it("requires all 9 apps", () => {
    expect(isTrinityDay(ALL_APP_IDS)).toBe(true);
    expect(isTrinityDay(ALL_APP_IDS.slice(0, 8))).toBe(false);
  });

  it("deduplicates repeated app ids", () => {
    const apps = [
      ...ALL_APP_IDS.slice(0, 8),
      AppId.MAIL,
      AppId.MAIL,
    ];
    expect(isTrinityDay(apps)).toBe(false);
    const full = [...ALL_APP_IDS, AppId.MAIL];
    expect(isTrinityDay(full)).toBe(true);
  });
});

describe("transitionStreak", () => {
  const today = day("2026-04-17");
  const yesterday = day("2026-04-16");
  const twoAgo = day("2026-04-15");

  it("starts a streak on first activity", () => {
    const r = transitionStreak({
      lastActiveDate: null,
      currentStreak: 0,
      longestStreak: 0,
      today,
      activeToday: true,
      availableShields: 0,
      autoConsumeShield: false,
    });
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(1);
    expect(r.didReset).toBe(false);
  });

  it("is idempotent for same-day repeats", () => {
    const r = transitionStreak({
      lastActiveDate: today,
      currentStreak: 5,
      longestStreak: 10,
      today,
      activeToday: true,
      availableShields: 0,
      autoConsumeShield: false,
    });
    expect(r.currentStreak).toBe(5);
    expect(r.longestStreak).toBe(10);
    expect(r.shieldConsumed).toBe(false);
  });

  it("advances on consecutive days", () => {
    const r = transitionStreak({
      lastActiveDate: yesterday,
      currentStreak: 5,
      longestStreak: 7,
      today,
      activeToday: true,
      availableShields: 0,
      autoConsumeShield: false,
    });
    expect(r.currentStreak).toBe(6);
    expect(r.longestStreak).toBe(7);
    expect(r.didReset).toBe(false);
  });

  it("raises longestStreak past its old value", () => {
    const r = transitionStreak({
      lastActiveDate: yesterday,
      currentStreak: 10,
      longestStreak: 10,
      today,
      activeToday: true,
      availableShields: 0,
      autoConsumeShield: false,
    });
    expect(r.currentStreak).toBe(11);
    expect(r.longestStreak).toBe(11);
  });

  it("resets when a day is missed with no shield", () => {
    const r = transitionStreak({
      lastActiveDate: twoAgo,
      currentStreak: 47,
      longestStreak: 47,
      today,
      activeToday: true,
      availableShields: 0,
      autoConsumeShield: true,
    });
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(47); // never decrements
    expect(r.didReset).toBe(true);
    expect(r.previousStreak).toBe(47);
    expect(r.shieldConsumed).toBe(false);
  });

  it("does NOT auto-consume shield unless user opted in", () => {
    const r = transitionStreak({
      lastActiveDate: twoAgo,
      currentStreak: 47,
      longestStreak: 47,
      today,
      activeToday: true,
      availableShields: 2,
      autoConsumeShield: false,
    });
    expect(r.currentStreak).toBe(1);
    expect(r.didReset).toBe(true);
    expect(r.shieldConsumed).toBe(false);
  });

  it("auto-consumes shield on 1-day gap when opted in (active today)", () => {
    const r = transitionStreak({
      lastActiveDate: twoAgo,
      currentStreak: 47,
      longestStreak: 47,
      today,
      activeToday: true,
      availableShields: 1,
      autoConsumeShield: true,
    });
    expect(r.currentStreak).toBe(48);
    expect(r.shieldConsumed).toBe(true);
    expect(r.didReset).toBe(false);
  });

  it("auto-consumes shield on 1-day gap when opted in (not active today)", () => {
    // rollForward path: maintenance worker detects yesterday was missed
    // but today is not yet active.
    const r = transitionStreak({
      lastActiveDate: twoAgo,
      currentStreak: 47,
      longestStreak: 47,
      today,
      activeToday: false,
      availableShields: 1,
      autoConsumeShield: true,
    });
    expect(r.currentStreak).toBe(47); // frozen, not incremented
    expect(r.shieldConsumed).toBe(true);
    expect(r.didReset).toBe(false);
  });

  it("resets on 2+ day gap even with shield (single shield cannot cover)", () => {
    const fourAgo = day("2026-04-13");
    const r = transitionStreak({
      lastActiveDate: fourAgo,
      currentStreak: 30,
      longestStreak: 30,
      today,
      activeToday: true,
      availableShields: 2,
      autoConsumeShield: true,
    });
    expect(r.currentStreak).toBe(1);
    expect(r.didReset).toBe(true);
    expect(r.shieldConsumed).toBe(false);
  });

  it("does not mark didReset=true if the user had no prior streak", () => {
    const r = transitionStreak({
      lastActiveDate: day("2026-03-01"),
      currentStreak: 0,
      longestStreak: 5,
      today,
      activeToday: true,
      availableShields: 0,
      autoConsumeShield: false,
    });
    expect(r.didReset).toBe(false); // previousStreak was 0
    expect(r.currentStreak).toBe(1);
  });

  it("inactive user with no shield and gap > 1 day resets to 0", () => {
    const r = transitionStreak({
      lastActiveDate: day("2026-04-10"),
      currentStreak: 8,
      longestStreak: 8,
      today,
      activeToday: false,
      availableShields: 0,
      autoConsumeShield: true,
    });
    expect(r.currentStreak).toBe(0);
    expect(r.didReset).toBe(true);
    expect(r.longestStreak).toBe(8);
  });
});

describe("milestoneShieldsEarned", () => {
  it("returns 0 below the threshold", () => {
    expect(milestoneShieldsEarned(0, 0)).toBe(0);
    expect(milestoneShieldsEarned(MILESTONE_STREAK_DAYS - 1, 0)).toBe(0);
  });

  it("grants one shield at each milestone boundary", () => {
    expect(milestoneShieldsEarned(MILESTONE_STREAK_DAYS, 0)).toBe(1);
    expect(milestoneShieldsEarned(MILESTONE_STREAK_DAYS * 2, 0)).toBe(2);
    expect(
      milestoneShieldsEarned(MILESTONE_STREAK_DAYS * 2, MILESTONE_STREAK_DAYS)
    ).toBe(1);
  });

  it("is idempotent — does not grant a second shield for the same milestone", () => {
    expect(
      milestoneShieldsEarned(MILESTONE_STREAK_DAYS, MILESTONE_STREAK_DAYS)
    ).toBe(0);
  });

  it("never returns a negative count when current falls below last granted", () => {
    // Shouldn't happen in practice (streak resets update nothing) but
    // be defensive.
    expect(milestoneShieldsEarned(5, MILESTONE_STREAK_DAYS * 3)).toBe(0);
  });
});

describe("buildStatusMessage", () => {
  it("uses neutral 'welcome back' copy after a reset", () => {
    const msg = buildStatusMessage({
      currentStreak: 0,
      previousStreak: 47,
      didReset: true,
      isTrinityDay: false,
    });
    expect(msg.toLowerCase()).toContain("welcome back");
    expect(msg).not.toMatch(/lost|urgent|anxiety|hurry/i);
  });

  it("celebrates Trinity Mode without shaming", () => {
    const msg = buildStatusMessage({
      currentStreak: 12,
      isTrinityDay: true,
    });
    expect(msg.toLowerCase()).toContain("trinity mode");
  });

  it("encourages a zero-streak user to start", () => {
    const msg = buildStatusMessage({
      currentStreak: 0,
      isTrinityDay: false,
    });
    expect(msg.toLowerCase()).toMatch(/start/);
  });

  it("shows current streak count when > 1", () => {
    const msg = buildStatusMessage({
      currentStreak: 47,
      isTrinityDay: false,
    });
    expect(msg).toContain("47");
  });
});

describe("module constants", () => {
  it("enforces a 2-shield cap", () => {
    expect(MAX_SHIELDS).toBe(2);
  });

  it("covers all 9 apps", () => {
    expect(ALL_APP_IDS.length).toBe(9);
    // Sanity: no duplicates.
    expect(new Set(ALL_APP_IDS).size).toBe(9);
  });

  it("configures a 2x cross-app amplifier above 3 apps/day", () => {
    expect(AMPLIFIER_APP_THRESHOLD).toBe(3);
    expect(AMPLIFIER_MULTIPLIER).toBe(2);
  });
});
