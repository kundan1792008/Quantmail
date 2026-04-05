import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function driveRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /drive/:userId
   * Returns all drive files for a user.
   */
  app.get<{ Params: { userId: string } }>("/drive/:userId", async (request, reply) => {
    const { userId } = request.params;
    const files = await prisma.driveFile.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ files });
  });

  /**
   * POST /drive
   * Creates a new drive file entry (metadata only; actual upload handled separately).
   */
  app.post<{
    Body: { userId: string; name: string; mimeType: string; size?: number; url: string };
  }>("/drive", async (request, reply) => {
    const { userId, name, mimeType, size = 0, url } = request.body;

    if (!userId || !name || !mimeType || !url) {
      return reply.code(400).send({ error: "userId, name, mimeType, and url are required" });
    }

    const file = await prisma.driveFile.create({
      data: { userId, name, mimeType, size, url },
    });

    return reply.code(201).send({ file });
  });

  /**
   * DELETE /drive/:id
   * Deletes a drive file entry.
   */
  app.delete<{ Params: { id: string } }>("/drive/:id", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.driveFile.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "File not found" });
    }

    await prisma.driveFile.delete({ where: { id } });
    return reply.code(204).send();
  });
}
