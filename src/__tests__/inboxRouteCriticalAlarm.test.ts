import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAlarmResult } = vi.hoisted(() => ({
  mockPrisma: {
    shadowInbox: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    inboxMessage: { create: vi.fn() },
  },
  mockAlarmResult: {
    alertId: "alert-1",
    synchronizedTriggerAt: new Date().toISOString(),
    dispatchCount: 2,
    silenceChallenge: "challenge-1",
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

vi.mock("../services/criticalAlarmService", () => ({
  isCriticalPaymentOrTokenAlert: vi.fn(),
  triggerSynchronizedWebBluetoothAlarm: vi.fn(),
}));

import { inboxRoutes } from "../routes/inbox";
import {
  isCriticalPaymentOrTokenAlert,
  triggerSynchronizedWebBluetoothAlarm,
} from "../services/criticalAlarmService";

describe("inbox critical alarm route flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@quantmail.com",
    });
    mockPrisma.inboxMessage.create.mockResolvedValue({ id: "msg-1" });
    mockPrisma.shadowInbox.create.mockResolvedValue({ id: "shadow-1" });
  });

  it("returns delivered_with_critical_alarm when message is critical", async () => {
    vi.mocked(isCriticalPaymentOrTokenAlert).mockReturnValue(true);
    vi.mocked(triggerSynchronizedWebBluetoothAlarm).mockResolvedValue(
      mockAlarmResult
    );

    const app = Fastify();
    await app.register(inboxRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/inbox/receive",
      payload: {
        senderEmail: "ops@quantpay.com",
        recipientEmail: "user@quantmail.com",
        subject: "Critical payment failed",
        body: "Unauthorized transfer detected",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("delivered_with_critical_alarm");
    expect(body.alarm.alertId).toBe("alert-1");
    expect(triggerSynchronizedWebBluetoothAlarm).toHaveBeenCalledTimes(1);
    expect(triggerSynchronizedWebBluetoothAlarm).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredFromMessageId: "msg-1",
      })
    );
  });

  it("returns delivered when message is non-critical", async () => {
    vi.mocked(isCriticalPaymentOrTokenAlert).mockReturnValue(false);

    const app = Fastify();
    await app.register(inboxRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/inbox/receive",
      payload: {
        senderEmail: "ops@quantmail.com",
        recipientEmail: "user@quantmail.com",
        subject: "Weekly digest",
        body: "No alerts",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("delivered");
    expect(triggerSynchronizedWebBluetoothAlarm).not.toHaveBeenCalled();
  });
});
