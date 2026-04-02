import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  createDashboardPhysicalLoginToken,
  silenceAlarmWithPhysicalLogin,
} from "../services/iotAlarmService";
import { verifyMasterSSOToken } from "../utils/crypto";

const SSO_SECRET = process.env["SSO_SECRET"];
if (!SSO_SECRET) {
  throw new Error("SSO_SECRET environment variable is required");
}
const REQUIRED_SSO_SECRET: string = SSO_SECRET;

function getUserIdFromAuthorizationHeader(
  authorizationHeader: string | undefined
): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return verifyMasterSSOToken(token, REQUIRED_SSO_SECRET);
}

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
    const authenticatedUserId = getUserIdFromAuthorizationHeader(
      request.headers.authorization
    );
    if (!authenticatedUserId || authenticatedUserId !== userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (!name || !protocol || !endpointRef) {
      return reply
        .code(400)
        .send({ error: "name, protocol, and endpointRef required" });
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
    const authenticatedUserId = getUserIdFromAuthorizationHeader(
      request.headers.authorization
    );
    if (!authenticatedUserId || authenticatedUserId !== userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const alarms = await prisma.alarmSession.findMany({
      where: { userId, state: "ACTIVE" },
      include: { alert: true, dispatches: true },
      orderBy: { activatedAt: "desc" },
    });

    return reply.send({ alarms });
  });

  app.post<{
    Params: { userId: string };
  }>("/dashboard/:userId/physical-login", {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params;
      const authenticatedUserId = getUserIdFromAuthorizationHeader(
        request.headers.authorization
      );
      if (!authenticatedUserId || authenticatedUserId !== userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      const token = await createDashboardPhysicalLoginToken(userId);
      return reply.code(201).send({
        status: "PHYSICAL_LOGIN_VERIFIED",
        token,
      });
    },
  });

  app.post<{
    Params: { userId: string; alarmSessionId: string };
    Body: { physicalLoginToken: string };
  }>("/iot/:userId/alarms/:alarmSessionId/silence", {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const { userId, alarmSessionId } = request.params;
      const { physicalLoginToken } = request.body;
      const authenticatedUserId = getUserIdFromAuthorizationHeader(
        request.headers.authorization
      );
      if (!authenticatedUserId || authenticatedUserId !== userId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

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
        if (
          message === "PHYSICAL_LOGIN_NOT_FOUND" ||
          message === "PHYSICAL_LOGIN_EXPIRED"
        ) {
          return reply.code(403).send({ error: message });
        }
        if (message === "ALARM_SESSION_NOT_FOUND") {
          return reply.code(404).send({ error: "Alarm session not found" });
        }
        return reply.code(500).send({ error: "Failed to silence alarm" });
      }
    },
  });
}
