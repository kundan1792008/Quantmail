import { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../db";
import {
  silenceAlarmFromDashboardPhysicalLogin,
  triggerSynchronizedWebBluetoothAlarm,
} from "../services/criticalAlarmService";

const MILLISECONDS_PER_MINUTE = 60_000;
const MIN_PHYSICAL_SESSION_MINUTES = 1;
const MAX_PHYSICAL_SESSION_MINUTES = 60;
const IOT_RATE_LIMIT_WINDOW_MS = 60_000;
const IOT_RATE_LIMIT_MAX = 20;
const iotRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const SILENCE_RATE_LIMIT_WINDOW_MS = 60_000;
const SILENCE_RATE_LIMIT_MAX = 10;
const silenceRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const DEVICE_PROOF_HMAC_SECRET =
  process.env["DEVICE_PROOF_HMAC_SECRET"] || "quantmail-device-proof-dev-secret";

function sweepExpiredRateLimitEntries(
  now: number,
  map: Map<string, { count: number; resetAt: number }>
): void {
  for (const [key, value] of map.entries()) {
    if (now > value.resetAt) {
      map.delete(key);
    }
  }
}

function checkIotRateLimit(ip: string): boolean {
  const now = Date.now();
  sweepExpiredRateLimitEntries(now, iotRateLimitMap);
  const entry = iotRateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    iotRateLimitMap.set(ip, { count: 1, resetAt: now + IOT_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= IOT_RATE_LIMIT_MAX;
}

function checkSilenceRateLimit(key: string): boolean {
  const now = Date.now();
  sweepExpiredRateLimitEntries(now, silenceRateLimitMap);
  const entry = silenceRateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    silenceRateLimitMap.set(key, {
      count: 1,
      resetAt: now + SILENCE_RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }
  entry.count += 1;
  return entry.count <= SILENCE_RATE_LIMIT_MAX;
}

function deriveExpectedDeviceProof(
  userId: string,
  dashboardOrigin: string
): string {
  return createHmac("sha256", DEVICE_PROOF_HMAC_SECRET)
    .update(`${userId}:${dashboardOrigin}`)
    .digest("hex");
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function iotRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      userId: string;
      deviceName: string;
      deviceIdentifier: string;
      deviceType: "APPLE_WATCH" | "IOT_DEVICE";
      capacitorDeviceId?: string;
      webBluetoothEnabled?: boolean;
    };
  }>("/iot/register", async (request, reply) => {
    const {
      userId,
      deviceName,
      deviceIdentifier,
      deviceType,
      capacitorDeviceId,
      webBluetoothEnabled,
    } = request.body;

    if (!userId || !deviceName || !deviceIdentifier || !deviceType) {
      return reply.code(400).send({
        error:
          "userId, deviceName, deviceIdentifier, and deviceType are required",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const device = await prisma.connectedIoTDevice.upsert({
      where: {
        userId_deviceIdentifier: { userId, deviceIdentifier },
      },
      update: {
        deviceName,
        deviceType,
        capacitorDeviceId,
        webBluetoothEnabled: webBluetoothEnabled ?? true,
        isActive: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        deviceName,
        deviceIdentifier,
        deviceType,
        capacitorDeviceId,
        webBluetoothEnabled: webBluetoothEnabled ?? true,
      },
    });

    return reply.code(201).send({ device });
  });

  app.post<{
    Body: {
      userId: string;
      source?: string;
      subject: string;
      body: string;
    };
  }>("/iot/alarm/trigger", async (request, reply) => {
    const { userId, source = "manual", subject, body } = request.body;
    if (!userId || !subject || !body) {
      return reply
        .code(400)
        .send({ error: "userId, subject, and body are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const result = await triggerSynchronizedWebBluetoothAlarm({
      userId,
      source,
      subject,
      body,
    });

    return reply.code(201).send({
      status: "triggered",
      protocol: "WEB_BLUETOOTH",
      synchronized: true,
      ...result,
    });
  });

  app.post<{
    Body: {
      userId: string;
      dashboardOrigin: string;
      deviceProof: string;
      sessionMinutes?: number;
    };
  }>("/dashboard/physical-login", async (request, reply) => {
    if (!checkIotRateLimit(request.ip)) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const { userId, dashboardOrigin, deviceProof, sessionMinutes = 10 } =
      request.body;

    if (!userId || !dashboardOrigin || !deviceProof) {
      return reply
        .code(400)
        .send({ error: "userId, dashboardOrigin, and deviceProof required" });
    }
    if (
      !Number.isFinite(sessionMinutes) ||
      sessionMinutes < MIN_PHYSICAL_SESSION_MINUTES ||
      sessionMinutes > MAX_PHYSICAL_SESSION_MINUTES
    ) {
      return reply.code(400).send({
        error: `sessionMinutes must be between ${MIN_PHYSICAL_SESSION_MINUTES} and ${MAX_PHYSICAL_SESSION_MINUTES}`,
      });
    }
    const expectedProof = deriveExpectedDeviceProof(userId, dashboardOrigin);
    if (!safeEquals(deviceProof, expectedProof)) {
      return reply.code(403).send({ error: "INVALID_DEVICE_PROOF" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const session = await prisma.dashboardPhysicalLogin.create({
      data: {
        userId,
        dashboardOrigin,
        deviceProof,
        expiresAt: new Date(Date.now() + sessionMinutes * MILLISECONDS_PER_MINUTE),
      },
    });

    return reply.code(201).send({
      status: "physical_login_verified",
      dashboardSessionId: session.id,
      expiresAt: session.expiresAt,
    });
  });

  app.post<{
    Body: {
      userId: string;
      alertId: string;
      dashboardSessionId: string;
      silenceChallenge: string;
    };
  }>("/iot/alarm/silence", async (request, reply) => {
    if (!checkIotRateLimit(request.ip)) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const { userId, alertId, dashboardSessionId, silenceChallenge } = request.body;
    if (!userId || !alertId || !dashboardSessionId || !silenceChallenge) {
      return reply.code(400).send({
        error:
          "userId, alertId, dashboardSessionId, and silenceChallenge are required",
      });
    }
    const silenceKey = `${request.ip}:${userId}:${dashboardSessionId}`;
    if (!checkSilenceRateLimit(silenceKey)) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }

    const result = await silenceAlarmFromDashboardPhysicalLogin({
      userId,
      alertId,
      dashboardSessionId,
      silenceChallenge,
    });

    if (!result.silenced) {
      const isAuthError = result.reason === "PHYSICAL_DASHBOARD_LOGIN_REQUIRED";
      return reply.code(isAuthError ? 403 : 404).send({
        error: result.reason,
      });
    }

    return reply.send({
      status: "silenced",
      alarmSilencedBy: "physical_dashboard_login",
    });
  });
}
