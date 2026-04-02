import Fastify from "fastify";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedPrisma = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  ioTDeviceCreate: vi.fn(),
  criticalAlarmFindMany: vi.fn(),
  criticalAlarmFindFirst: vi.fn(),
  criticalAlarmUpdate: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: mockedPrisma.userFindUnique,
    },
    ioTDevice: {
      create: mockedPrisma.ioTDeviceCreate,
    },
    criticalAlarmSession: {
      findMany: mockedPrisma.criticalAlarmFindMany,
      findFirst: mockedPrisma.criticalAlarmFindFirst,
      update: mockedPrisma.criticalAlarmUpdate,
    },
  },
}));

import { iotRoutes } from "../routes/iot";

describe("iotRoutes silence flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject silence without physical dashboard login token", async () => {
    const app = Fastify();
    await app.register(iotRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/iot/user-1/alarms/alarm-1/silence",
      payload: {
        physicalDashboardLoginToken: "short",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      silenced: false,
      status: "PHYSICAL_LOGIN_REQUIRED",
    });
  });

  it("should register an iot device for a valid user", async () => {
    mockedPrisma.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "u@q.com",
    });
    mockedPrisma.ioTDeviceCreate.mockResolvedValue({
      id: "dev-1",
      deviceName: "Apple Watch",
      platform: "apple_watch",
      connectionType: "webbluetooth",
    });

    const app = Fastify();
    await app.register(iotRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/iot/register",
      payload: {
        userId: "user-1",
        deviceName: "Apple Watch",
        platform: "apple_watch",
        endpointRef: "watch://endpoint",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "registered",
      device: {
        id: "dev-1",
        deviceName: "Apple Watch",
        platform: "apple_watch",
        connectionType: "webbluetooth",
      },
    });
  });

  it("should return 404 when registering device for missing user", async () => {
    mockedPrisma.userFindUnique.mockResolvedValue(null);

    const app = Fastify();
    await app.register(iotRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/iot/register",
      payload: {
        userId: "missing-user",
        deviceName: "Sensor",
        platform: "web_iot",
        endpointRef: "iot://sensor",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "User not found" });
  });

  it("should return active alarm sessions for user", async () => {
    mockedPrisma.criticalAlarmFindMany.mockResolvedValue([
      { id: "alarm-1", status: "ACTIVE", dispatches: [] },
    ]);

    const app = Fastify();
    await app.register(iotRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/iot/user-1/alarms/active",
    });

    expect(response.statusCode).toBe(200);
    expect(mockedPrisma.criticalAlarmFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "ACTIVE" },
      include: { dispatches: true },
      orderBy: { triggeredAt: "desc" },
    });
    expect(response.json()).toEqual({
      sessions: [{ id: "alarm-1", status: "ACTIVE", dispatches: [] }],
    });
  });
});
