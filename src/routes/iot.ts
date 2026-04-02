import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { silenceCriticalAlarmFromDashboard } from "../services/criticalAlertService";
import { deriveBiometricHash } from "../utils/crypto";

export async function iotRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      userId: string;
      deviceName: string;
      platform: "apple_watch" | "ios" | "android" | "web_iot";
      endpointRef: string;
      connectionType?: "WebBluetooth";
    };
  }>("/iot/register", async (request, reply) => {
    const { userId, deviceName, platform, endpointRef, connectionType } =
      request.body;

    if (!userId || !deviceName || !platform || !endpointRef) {
      return reply.code(400).send({
        error: "userId, deviceName, platform, endpointRef required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { livenessGrid: true },
    });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (!user.verified || !user.livenessGrid || !user.livenessGrid.passed) {
      return reply.code(403).send({ error: "STRICT_BOT_DROP" });
    }
    const expectedBiometricHash = deriveBiometricHash(
      `${user.email}:${user.livenessGrid.facialMatrixHash}`
    );
    if (expectedBiometricHash !== user.biometricHash) {
      return reply.code(403).send({ error: "STRICT_BOT_DROP" });
    }

    const device = await prisma.ioTDevice.create({
      data: {
        userId,
        deviceName,
        platform,
        endpointRef,
        connectionType: connectionType || "WebBluetooth",
        active: true,
      },
    });

    return reply.code(201).send({
      status: "registered",
      device: {
        id: device.id,
        deviceName: device.deviceName,
        platform: device.platform,
        connectionType: device.connectionType,
      },
    });
  });

  app.get<{
    Params: { userId: string };
  }>("/iot/:userId/alarms/active", async (request, reply) => {
    const { userId } = request.params;

    const sessions = await prisma.criticalAlarmSession.findMany({
      where: {
        userId,
        status: "ACTIVE",
      },
      include: {
        dispatches: true,
      },
      orderBy: { triggeredAt: "desc" },
    });

    return reply.send({ sessions });
  });

  app.post<{
    Params: { userId: string; alarmSessionId: string };
    Body: { physicalDashboardLoginToken: string };
  }>(
    "/iot/:userId/alarms/:alarmSessionId/silence",
    async (request, reply) => {
      const { userId, alarmSessionId } = request.params;
      const { physicalDashboardLoginToken } = request.body;

      const result = await silenceCriticalAlarmFromDashboard(
        userId,
        alarmSessionId,
        physicalDashboardLoginToken
      );

      if (!result.silenced) {
        const code =
          result.status === "PHYSICAL_LOGIN_REQUIRED"
            ? 403
            : result.status === "ALARM_NOT_ACTIVE"
              ? 404
              : 400;
        return reply.code(code).send(result);
      }

      return reply.send(result);
    }
  );
}
