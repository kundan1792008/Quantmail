import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  createDashboardPhysicalLoginToken,
  silenceAlarmWithPhysicalLogin,
} from "../services/iotAlarmService";

export async function iotRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { userId: string };
    Body: {
      name: string;
      protocol: "APPLE_WATCH" | "WEB_BLUETOOTH" | "IOT_BRIDGE";
      endpointRef: string;
    };
  }>("/iot/:userId/devices", async (request, reply) => {
    const { userId } = request.params;
    const { name, protocol, endpointRef } = request.body;

    if (!name || !protocol || !endpointRef) {
      return reply
        .code(400)
        .send({ error: "name, protocol and endpointRef required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const device = await prisma.iotDevice.create({
      data: { userId, name, protocol, endpointRef, active: true },
    });

    return reply.code(201).send({ device });
  });

  app.get<{
    Params: { userId: string };
  }>("/iot/:userId/alarms/active", async (request, reply) => {
    const { userId } = request.params;

    const alarms = await prisma.alarmSession.findMany({
      where: { userId, state: "ACTIVE" },
      include: { alert: true, dispatches: true },
      orderBy: { activatedAt: "desc" },
    });

    return reply.send({ alarms });
  });

  app.post<{
    Params: { userId: string };
  }>("/dashboard/:userId/physical-login", async (request, reply) => {
    const { userId } = request.params;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const token = await createDashboardPhysicalLoginToken(userId);
    return reply.code(201).send({
      status: "PHYSICAL_LOGIN_VERIFIED",
      token,
    });
  });

  app.post<{
    Params: { userId: string; alarmSessionId: string };
    Body: { physicalLoginToken: string };
  }>(
    "/iot/:userId/alarms/:alarmSessionId/silence",
    async (request, reply) => {
      const { userId, alarmSessionId } = request.params;
      const { physicalLoginToken } = request.body;

      if (!physicalLoginToken) {
        return reply.code(400).send({ error: "physicalLoginToken required" });
      }

      try {
        const state = await silenceAlarmWithPhysicalLogin({
          userId,
          alarmSessionId,
          physicalLoginToken,
        });
        return reply.send({ status: state });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        if (message === "PHYSICAL_LOGIN_REQUIRED") {
          return reply.code(403).send({ error: "PHYSICAL_LOGIN_REQUIRED" });
        }
        if (message === "ALARM_SESSION_NOT_FOUND") {
          return reply.code(404).send({ error: "Alarm session not found" });
        }
        return reply.code(500).send({ error: "Failed to silence alarm" });
      }
    }
  );
}
