import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedPrisma = vi.hoisted(() => ({
  ioTDeviceFindMany: vi.fn(),
  criticalAlarmCreate: vi.fn(),
  criticalAlarmFindFirst: vi.fn(),
  criticalAlarmUpdate: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    ioTDevice: {
      findMany: mockedPrisma.ioTDeviceFindMany,
    },
    criticalAlarmSession: {
      create: mockedPrisma.criticalAlarmCreate,
      findFirst: mockedPrisma.criticalAlarmFindFirst,
      update: mockedPrisma.criticalAlarmUpdate,
    },
  },
}));

import {
  isCriticalPaymentOrEcosystemTokenAlert,
  triggerSynchronizedWebBluetoothAlarm,
  silenceCriticalAlarmFromDashboard,
} from "../services/criticalAlertService";

describe("isCriticalPaymentOrEcosystemTokenAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true for critical payment + ecosystem token alert content", () => {
    const result = isCriticalPaymentOrEcosystemTokenAlert(
      "Critical payment alert",
      "Ecosystem token anomaly detected on your account"
    );
    expect(result).toBe(true);
  });

  it("returns false when only one weak signal is present", () => {
    const result = isCriticalPaymentOrEcosystemTokenAlert(
      "Payment update",
      "Monthly statement is available"
    );
    expect(result).toBe(false);
  });

  it("returns true for unauthorized transfer + urgent payment combination", () => {
    const result = isCriticalPaymentOrEcosystemTokenAlert(
      "Urgent payment warning",
      "Potential unauthorized transfer identified"
    );
    expect(result).toBe(true);
  });

  it("creates synchronized alarm dispatches for active webbluetooth devices", async () => {
    mockedPrisma.ioTDeviceFindMany.mockResolvedValue([
      { id: "dev-1" },
      { id: "dev-2" },
    ]);
    mockedPrisma.criticalAlarmCreate.mockResolvedValue({
      id: "alarm-1",
    });

    const result = await triggerSynchronizedWebBluetoothAlarm({
      userId: "user-1",
      inboxMessageId: "msg-1",
      subject: "Critical payment alert",
      body: "Ecosystem token anomaly",
    });

    expect(mockedPrisma.ioTDeviceFindMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        active: true,
        connectionType: "webbluetooth",
      },
    });
    expect(mockedPrisma.criticalAlarmCreate).toHaveBeenCalled();
    expect(result).toEqual({
      alarmSessionId: "alarm-1",
      synchronizedDevices: 2,
      requiresPhysicalDashboardLogin: true,
    });
  });

  it("supports alarm creation when user has no active devices", async () => {
    mockedPrisma.ioTDeviceFindMany.mockResolvedValue([]);
    mockedPrisma.criticalAlarmCreate.mockResolvedValue({
      id: "alarm-empty",
    });

    const result = await triggerSynchronizedWebBluetoothAlarm({
      userId: "user-1",
      inboxMessageId: "msg-2",
      subject: "Critical payment",
      body: "ecosystem token compromise",
    });

    expect(result.synchronizedDevices).toBe(0);
    expect(result.alarmSessionId).toBe("alarm-empty");
  });

  it("enforces physical login token minimum for silencing", async () => {
    const result = await silenceCriticalAlarmFromDashboard(
      "user-1",
      "alarm-1",
      "tiny-token"
    );
    expect(result).toEqual({
      silenced: false,
      status: "PHYSICAL_LOGIN_REQUIRED",
    });
  });

  it("returns not active when no matching active alarm is found", async () => {
    mockedPrisma.criticalAlarmFindFirst.mockResolvedValue(null);

    const result = await silenceCriticalAlarmFromDashboard(
      "user-1",
      "alarm-1",
      "physical-login-token-1234"
    );
    expect(result).toEqual({ silenced: false, status: "ALARM_NOT_ACTIVE" });
  });

  it("silences active alarm and updates dispatches when physical login is valid", async () => {
    mockedPrisma.criticalAlarmFindFirst.mockResolvedValue({
      id: "alarm-1",
      userId: "user-1",
    });
    mockedPrisma.criticalAlarmUpdate.mockResolvedValue({});

    const result = await silenceCriticalAlarmFromDashboard(
      "user-1",
      "alarm-1",
      "physical-login-token-1234"
    );

    expect(mockedPrisma.criticalAlarmUpdate).toHaveBeenCalled();
    expect(result).toEqual({ silenced: true, status: "SILENCED" });
  });
});
