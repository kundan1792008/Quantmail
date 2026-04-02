import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  silenceAlarmFromDashboardPhysicalLogin,
  triggerSynchronizedWebBluetoothAlarm,
} from "../services/criticalAlarmService";

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
      return reply.code(400).send({ error: "userId, subject, and body required" });
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
    const { userId, dashboardOrigin, deviceProof, sessionMinutes = 10 } =
      request.body;

    if (!userId || !dashboardOrigin || !deviceProof) {
      return reply
        .code(400)
        .send({ error: "userId, dashboardOrigin, and deviceProof required" });
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
        expiresAt: new Date(Date.now() + sessionMinutes * 60_000),
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
    };
  }>("/iot/alarm/silence", async (request, reply) => {
    const { userId, alertId, dashboardSessionId } = request.body;
    if (!userId || !alertId || !dashboardSessionId) {
      return reply.code(400).send({
        error: "userId, alertId, and dashboardSessionId are required",
      });
    }

    const result = await silenceAlarmFromDashboardPhysicalLogin({
      userId,
      alertId,
      dashboardSessionId,
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
