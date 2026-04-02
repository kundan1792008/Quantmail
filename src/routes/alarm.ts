import { FastifyInstance, preHandlerHookHandler } from "fastify";
import { prisma } from "../db";
import {
  createPhysicalLoginSession,
  silenceAlarmWithPhysicalLogin,
} from "../services/criticalAlertAlarmService";
import {
  DispatchStatus,
  IoTDeviceType,
  type AlarmDeviceDispatch,
  type IoTDevice,
} from "../generated/prisma/client";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

const rateLimitPreHandler: preHandlerHookHandler = async (request, reply) => {
  if (!checkRateLimit(request.ip)) {
    await reply.code(429).send({ error: "Rate limit exceeded" });
  }
};

export async function alarmRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /alarm/devices/register
   * Registers Apple Watch / Capacitor / WebBluetooth IoT device for synchronized alarms.
   */
  app.post<{
    Body: {
      userId: string;
      deviceName: string;
      deviceType: IoTDeviceType;
      deviceFingerprint: string;
      platform: string;
    };
  }>("/alarm/devices/register", async (request, reply) => {
    const { userId, deviceName, deviceType, deviceFingerprint, platform } =
      request.body;

    if (!userId || !deviceName || !deviceType || !deviceFingerprint || !platform) {
      return reply.code(400).send({
        error:
          "userId, deviceName, deviceType, deviceFingerprint and platform required",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const device = await prisma.ioTDevice.upsert({
      where: { deviceFingerprint },
      create: {
        userId,
        deviceName,
        deviceType,
        deviceFingerprint,
        platform,
        alarmCapable: true,
        isConnected: true,
      },
      update: {
        userId,
        deviceName,
        deviceType,
        platform,
        isConnected: true,
        lastSeenAt: new Date(),
      },
    });

    return reply.code(201).send({ device });
  });

  /**
   * GET /alarm/:alarmSessionId/dispatches
   * Poll synchronized alarm dispatch state for all connected devices.
   */
  app.get<{
    Params: { alarmSessionId: string };
  }>("/alarm/:alarmSessionId/dispatches", async (request, reply) => {
    const { alarmSessionId } = request.params;

    const alarm = await prisma.alarmSession.findUnique({
      where: { id: alarmSessionId },
      include: {
        dispatches: {
          include: { iotDevice: true },
          orderBy: { dispatchedAt: "asc" },
        },
      },
    });

    if (!alarm) {
      return reply.code(404).send({ error: "Alarm session not found" });
    }

    return reply.send({
      alarmSessionId: alarm.id,
      status: alarm.status,
      category: alarm.category,
      triggeredAt: alarm.triggeredAt,
      silencedAt: alarm.silencedAt,
      dispatches: alarm.dispatches.map(
        (dispatch: AlarmDeviceDispatch & { iotDevice: IoTDevice }) => ({
        dispatchId: dispatch.id,
        deviceId: dispatch.iotDeviceId,
        deviceName: dispatch.iotDevice.deviceName,
        deviceType: dispatch.iotDevice.deviceType,
        dispatchStatus: dispatch.dispatchStatus,
        commandPayload: dispatch.commandPayload,
        acknowledgedAt: dispatch.acknowledgedAt,
        })
      ),
    });
  });

  /**
   * POST /alarm/:alarmSessionId/device-ack
   * Device-level ack for synchronized WebBluetooth alarm command.
   */
  app.post<{
    Params: { alarmSessionId: string };
    Body: { deviceFingerprint: string };
  }>("/alarm/:alarmSessionId/device-ack", async (request, reply) => {
    const { alarmSessionId } = request.params;
    const { deviceFingerprint } = request.body;

    if (!deviceFingerprint) {
      return reply.code(400).send({ error: "deviceFingerprint required" });
    }

    const device = await prisma.ioTDevice.findUnique({
      where: { deviceFingerprint },
    });
    if (!device) {
      return reply.code(404).send({ error: "IoT device not found" });
    }

    const dispatch = await prisma.alarmDeviceDispatch.findFirst({
      where: { alarmSessionId, iotDeviceId: device.id },
    });
    if (!dispatch) {
      return reply.code(404).send({ error: "Dispatch not found" });
    }

    const updatedDispatch = await prisma.alarmDeviceDispatch.update({
      where: { id: dispatch.id },
      data: {
        dispatchStatus: DispatchStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
      },
    });

    return reply.send({
      status: "acknowledged",
      dispatchId: updatedDispatch.id,
      acknowledgedAt: updatedDispatch.acknowledgedAt,
    });
  });

  /**
   * POST /quantchat/dashboard/physical-login
   * Simulates physical login session from main Quantchat dashboard.
   */
  app.post<{
    Body: { userId: string };
  }>(
    "/quantchat/dashboard/physical-login",
    { preHandler: rateLimitPreHandler },
    async (request, reply) => {
      if (!checkRateLimit(request.ip)) {
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const { userId } = request.body;
      if (!userId) {
        return reply.code(400).send({ error: "userId required" });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      const session = await createPhysicalLoginSession(userId);
      return reply.code(201).send({
        status: "physical_login_verified",
        physicalSessionId: session.sessionId,
        expiresAt: session.expiresAt,
        source: "QUANTCHAT_DASHBOARD_PHYSICAL",
      });
    }
  );

  /**
   * POST /alarm/:alarmSessionId/silence
   * Silences alarm only using physical dashboard login session.
   */
  app.post<{
    Params: { alarmSessionId: string };
    Body: { userId: string; physicalSessionId: string };
  }>(
    "/alarm/:alarmSessionId/silence",
    { preHandler: rateLimitPreHandler },
    async (request, reply) => {
      if (!checkRateLimit(request.ip)) {
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const { alarmSessionId } = request.params;
      const { userId, physicalSessionId } = request.body;

      if (!userId || !physicalSessionId) {
        return reply
          .code(400)
          .send({ error: "userId and physicalSessionId required" });
      }

      const outcome = await silenceAlarmWithPhysicalLogin({
        alarmSessionId,
        userId,
        physicalSessionId,
      });

      if (!outcome.silenced) {
        return reply.code(403).send({
          error: "ALARM_SILENCE_REJECTED",
          reason: outcome.reason,
          policy: "ONLY_QUANTCHAT_PHYSICAL_DASHBOARD_LOGIN",
        });
      }

      return reply.send({
        status: "alarm_silenced",
        reason: outcome.reason,
        policy: "ONLY_QUANTCHAT_PHYSICAL_DASHBOARD_LOGIN",
      });
    }
  );
}
