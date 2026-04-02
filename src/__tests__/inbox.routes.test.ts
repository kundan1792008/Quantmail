import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedPrisma = vi.hoisted(() => ({
  shadowInboxCreate: vi.fn(),
  userFindUnique: vi.fn(),
  inboxMessageCreate: vi.fn(),
  inboxMessageFindMany: vi.fn(),
  shadowInboxFindMany: vi.fn(),
}));

const mockedAlertService = vi.hoisted(() => ({
  isCriticalAlert: vi.fn(),
  triggerAlarm: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    shadowInbox: {
      create: mockedPrisma.shadowInboxCreate,
      findMany: mockedPrisma.shadowInboxFindMany,
    },
    user: {
      findUnique: mockedPrisma.userFindUnique,
    },
    inboxMessage: {
      create: mockedPrisma.inboxMessageCreate,
      findMany: mockedPrisma.inboxMessageFindMany,
    },
  },
}));

vi.mock("../services/criticalAlertService", () => ({
  isCriticalPaymentOrEcosystemTokenAlert: mockedAlertService.isCriticalAlert,
  triggerSynchronizedWebBluetoothAlarm: mockedAlertService.triggerAlarm,
}));

import { inboxRoutes } from "../routes/inbox";

describe("inboxRoutes critical alarm integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers synchronized alarm for critical alert messages", async () => {
    mockedPrisma.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "user@quantmail.com",
    });
    mockedPrisma.inboxMessageCreate.mockResolvedValue({
      id: "msg-1",
      userId: "user-1",
      subject: "Critical payment alert",
      body: "ecosystem token compromise",
    });
    mockedAlertService.isCriticalAlert.mockReturnValue(true);
    mockedAlertService.triggerAlarm.mockResolvedValue({
      alarmSessionId: "alarm-1",
      synchronizedDevices: 3,
      requiresPhysicalDashboardLogin: true,
    });

    const app = Fastify();
    await app.register(inboxRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/inbox/receive",
      payload: {
        senderEmail: "ops@verified-domain.com",
        recipientEmail: "user@quantmail.com",
        subject: "Critical payment alert",
        body: "ecosystem token compromise",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockedAlertService.triggerAlarm).toHaveBeenCalledWith({
      userId: "user-1",
      inboxMessageId: "msg-1",
      subject: "Critical payment alert",
      body: "ecosystem token compromise",
    });
    expect(response.json()).toEqual({
      status: "delivered",
      criticalAlarmTriggered: true,
      alarm: {
        alarmSessionId: "alarm-1",
        synchronizedDevices: 3,
        requiresPhysicalDashboardLogin: true,
      },
    });
  });

  it("does not trigger alarm for non-critical messages", async () => {
    mockedPrisma.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "user@quantmail.com",
    });
    mockedPrisma.inboxMessageCreate.mockResolvedValue({
      id: "msg-2",
      userId: "user-1",
      subject: "Normal update",
      body: "hello",
    });
    mockedAlertService.isCriticalAlert.mockReturnValue(false);

    const app = Fastify();
    await app.register(inboxRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/inbox/receive",
      payload: {
        senderEmail: "ops@verified-domain.com",
        recipientEmail: "user@quantmail.com",
        subject: "Normal update",
        body: "hello",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockedAlertService.triggerAlarm).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      status: "delivered",
      criticalAlarmTriggered: false,
      alarm: null,
    });
  });
});
