import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedPrisma = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  ioTDeviceFindMany: vi.fn(),
  criticalAlarmCreate: vi.fn(),
  criticalAlarmFindFirst: vi.fn(),
  criticalAlarmUpdate: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: mockedPrisma.userFindUnique,
    },
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
import { deriveBiometricHash } from "../utils/crypto";

describe("isCriticalPaymentOrEcosystemTokenAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const email = "user@quantmail.com";
    const facialMatrixHash = "grid-1";
    mockedPrisma.userFindUnique.mockResolvedValue({
      id: "user-1",
      email,
      verified: true,
      biometricHash: deriveBiometricHash(`${email}:${facialMatrixHash}`),
      livenessGrid: {
        facialMatrixHash,
        passed: true,
      },
    });
  });

  it("returns true for critical payment + ecosystem token alert content", () => {
    const result = isCriticalPaymentOrEcosystemTokenAlert(
      "Critical payment alert",
      "Ecosystem token anomaly detected on your account"
    );
    expect(result).toBe(true);
  });

  it("returns false when only one pattern match is present", () => {
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

  it("creates synchronized alarm dispatches for active WebBluetooth devices", async () => {
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
        connectionType: "WebBluetooth",
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

  it("returns strict bot drop when biometric integrity fails", async () => {
    mockedPrisma.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "user@quantmail.com",
      verified: true,
      biometricHash: "mismatch",
      livenessGrid: {
        facialMatrixHash: "grid-1",
        passed: true,
      },
    });
    await expect(
      triggerSynchronizedWebBluetoothAlarm({
        userId: "user-1",
        inboxMessageId: "msg-1",
        subject: "Critical payment alert",
        body: "Ecosystem token anomaly",
      })
    ).rejects.toThrow("STRICT_BOT_DROP");
  });

  it("enforces cryptographic physical login token validation for silencing", async () => {
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
    const { generateMasterSSOToken } = await import("../utils/crypto");
    const token = generateMasterSSOToken("user-1", "quantmail-dev-secret");
    mockedPrisma.criticalAlarmFindFirst.mockResolvedValue(null);

    const result = await silenceCriticalAlarmFromDashboard(
      "user-1",
      "alarm-1",
      token
    );
    expect(result).toEqual({ silenced: false, status: "ALARM_NOT_ACTIVE" });
  });

  it("silences active alarm and updates dispatches when physical login is valid", async () => {
    const { generateMasterSSOToken } = await import("../utils/crypto");
    const token = generateMasterSSOToken("user-1", "quantmail-dev-secret");
    mockedPrisma.criticalAlarmFindFirst.mockResolvedValue({
      id: "alarm-1",
      userId: "user-1",
    });
    mockedPrisma.criticalAlarmUpdate.mockResolvedValue({});

    const result = await silenceCriticalAlarmFromDashboard(
      "user-1",
      "alarm-1",
      token
    );

    expect(mockedPrisma.criticalAlarmUpdate).toHaveBeenCalled();
    expect(result).toEqual({ silenced: true, status: "SILENCED" });
  });
});
