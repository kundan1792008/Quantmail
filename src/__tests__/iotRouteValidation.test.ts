import Fastify from "fastify";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    connectedIoTDevice: { upsert: vi.fn() },
    dashboardPhysicalLogin: { create: vi.fn() },
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

vi.mock("../services/criticalAlarmService", () => ({
  triggerSynchronizedWebBluetoothAlarm: vi.fn(),
  silenceAlarmFromDashboardPhysicalLogin: vi.fn(),
}));

import { iotRoutes } from "../routes/iot";

const DEVICE_PROOF_HMAC_SECRET =
  process.env["DEVICE_PROOF_HMAC_SECRET"] || "quantmail-device-proof-dev-secret";

function buildDeviceProof(userId: string, origin: string): string {
  return createHmac("sha256", DEVICE_PROOF_HMAC_SECRET)
    .update(`${userId}:${origin}`)
    .digest("hex");
}

describe("iot route validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    mockPrisma.dashboardPhysicalLogin.create.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  });

  it("rejects sessionMinutes below lower bound", async () => {
    const app = Fastify();
    await app.register(iotRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/dashboard/physical-login",
      payload: {
        userId: "user-1",
        dashboardOrigin: "https://quantchat.example",
        deviceProof: buildDeviceProof("user-1", "https://quantchat.example"),
        sessionMinutes: 0,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects sessionMinutes above upper bound", async () => {
    const app = Fastify();
    await app.register(iotRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/dashboard/physical-login",
      payload: {
        userId: "user-1",
        dashboardOrigin: "https://quantchat.example",
        deviceProof: buildDeviceProof("user-1", "https://quantchat.example"),
        sessionMinutes: 61,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects non-finite sessionMinutes", async () => {
    const app = Fastify();
    await app.register(iotRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/dashboard/physical-login",
      payload: {
        userId: "user-1",
        dashboardOrigin: "https://quantchat.example",
        deviceProof: buildDeviceProof("user-1", "https://quantchat.example"),
        sessionMinutes: "not-a-number",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid deviceProof", async () => {
    const app = Fastify();
    await app.register(iotRoutes);

    const res = await app.inject({
      method: "POST",
      url: "/dashboard/physical-login",
      payload: {
        userId: "user-1",
        dashboardOrigin: "https://quantchat.example",
        deviceProof: "invalid-proof",
        sessionMinutes: 10,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("INVALID_DEVICE_PROOF");
  });
});
