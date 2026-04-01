import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function quanttubeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      userId: string;
      videoTitle: string;
      watchedSeconds: number;
      watchedAt?: string;
    };
  }>("/quanttube/watch-history", async (request, reply) => {
    const { userId, videoTitle, watchedSeconds, watchedAt } = request.body;

    if (!userId || !videoTitle || watchedSeconds === undefined) {
      return reply.code(400).send({
        error: "userId, videoTitle, and watchedSeconds required",
      });
    }

    if (!Number.isFinite(watchedSeconds) || watchedSeconds < 0) {
      return reply.code(400).send({ error: "watchedSeconds must be valid" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const event = await prisma.quanttubeWatchEvent.create({
      data: {
        userId,
        videoTitle,
        watchedSeconds,
        watchedAt: watchedAt ? new Date(watchedAt) : undefined,
      },
    });

    return reply.code(201).send({ event });
  });
}
