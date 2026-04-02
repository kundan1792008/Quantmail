import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    ioTDevice: {
      create: vi.fn(),
    },
    criticalAlarmSession: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { iotRoutes } from "../routes/iot";

describe("iotRoutes silence flow", () => {
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
});
