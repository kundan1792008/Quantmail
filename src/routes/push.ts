import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import {
  NotificationStatus,
  type PushNotification,
} from "../generated/prisma/client";
import {
  registerDeviceToken,
  sweepAndAggress,
} from "../services/pushAggressor";

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { userId: string; token: string; platform: string };
  }>("/push/register", async (request, reply) => {
    const { userId, token, platform } = request.body;
    if (!userId || !token || !platform) {
      return reply
        .code(400)
        .send({ error: "userId, token, and platform required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    await registerDeviceToken({ userId, token, platform });
    return reply.code(201).send({ status: "registered", token });
  });

  app.get<{
    Params: { userId: string };
  }>("/push/queue/:userId", async (request, reply) => {
    const { userId } = request.params;
    const queue: PushNotification[] = await prisma.pushNotification.findMany({
      where: {
        userId,
        status: { in: [NotificationStatus.QUEUED, NotificationStatus.DISPATCHED] },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });

    return reply.send({ queue });
  });

  app.get<{
    Params: { challengeId: string };
  }>("/push/challenge/:challengeId/quantads", async (request, reply) => {
    const { challengeId } = request.params;
    const challenge = await prisma.livenessChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        userId: true,
        quantadsTarget: true,
        quantchatTitle: true,
        quantchatBody: true,
        status: true,
      },
    });

    if (!challenge) {
      return reply.code(404).send({ error: "Challenge not found" });
    }

    return reply.send({
      challengeId,
      quantadsTarget: challenge.quantadsTarget,
      bannerTitle: challenge.quantchatTitle,
      bannerBody: challenge.quantchatBody,
      status: challenge.status,
    });
  });

  app.post<{
    Params: { notificationId: string };
  }>("/push/ack/:notificationId", async (request, reply) => {
    const { notificationId } = request.params;
    const notification = await prisma.pushNotification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      return reply.code(404).send({ error: "Notification not found" });
    }

    await prisma.pushNotification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
      },
    });

    return reply.send({ status: "acknowledged" });
  });

  app.post("/push/aggressor/run", async (_request, reply) => {
    const scanned = await sweepAndAggress();
    return reply.send({ scanned });
  });
}
