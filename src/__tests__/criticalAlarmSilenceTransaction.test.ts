import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    dashboardPhysicalLogin: { findFirst: vi.fn() },
    criticalAlert: { findUnique: vi.fn(), update: vi.fn() },
    alarmDispatch: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

import { silenceAlarmFromDashboardPhysicalLogin } from "../services/criticalAlarmService";

describe("silenceAlarmFromDashboardPhysicalLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.dashboardPhysicalLogin.findFirst.mockResolvedValue({
      id: "session-1",
    });
    mockPrisma.criticalAlert.findUnique.mockResolvedValue({
      id: "alert-1",
      userId: "user-1",
      alarmStatus: "ACTIVE",
      silenceChallenge: "challenge-1",
    });
    mockPrisma.criticalAlert.update.mockResolvedValue({});
    mockPrisma.alarmDispatch.updateMany.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([]);
  });

  it("updates alert and all dispatches in one transaction", async () => {
    const result = await silenceAlarmFromDashboardPhysicalLogin({
      userId: "user-1",
      alertId: "alert-1",
      dashboardSessionId: "session-1",
      silenceChallenge: "challenge-1",
    });

    expect(result.silenced).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.criticalAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert-1" },
        data: expect.objectContaining({
          alarmStatus: "SILENCED",
          silencedAt: expect.any(Date),
        }),
      })
    );
    expect(mockPrisma.alarmDispatch.updateMany).toHaveBeenCalledWith({
      where: { alertId: "alert-1" },
      data: { status: "SILENCED" },
    });
  });

  it("rejects silence when challenge does not match", async () => {
    const result = await silenceAlarmFromDashboardPhysicalLogin({
      userId: "user-1",
      alertId: "alert-1",
      dashboardSessionId: "session-1",
      silenceChallenge: "bad-challenge",
    });

    expect(result.silenced).toBe(false);
    expect(result.reason).toBe("INVALID_SILENCE_CHALLENGE");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
