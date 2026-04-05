import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { randomUUID } from "crypto";

export async function sheetsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /sheets/:userId
   * Returns all sheets for a user.
   */
  app.get<{ Params: { userId: string } }>("/sheets/:userId", async (request, reply) => {
    const { userId } = request.params;
    const sheets = await prisma.sheet.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send({ sheets });
  });

  /**
   * POST /sheets
   * Creates a new sheet.
   */
  app.post<{
    Body: { userId: string; title: string; data?: string };
  }>("/sheets", async (request, reply) => {
    const { userId, title, data = "[]" } = request.body;

    if (!userId || !title) {
      return reply.code(400).send({ error: "userId and title are required" });
    }

    const sheet = await prisma.sheet.create({ data: { userId, title, data } });
    return reply.code(201).send({ sheet });
  });

  /**
   * PUT /sheets/:id
   * Updates a sheet.
   */
  app.put<{
    Params: { id: string };
    Body: { title?: string; data?: string };
  }>("/sheets/:id", async (request, reply) => {
    const { id } = request.params;
    const { title, data } = request.body;

    const existing = await prisma.sheet.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Sheet not found" });
    }

    const sheet = await prisma.sheet.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(data !== undefined && { data }),
      },
    });

    return reply.send({ sheet });
  });

  /**
   * DELETE /sheets/:id
   * Deletes a sheet.
   */
  app.delete<{ Params: { id: string } }>("/sheets/:id", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.sheet.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Sheet not found" });
    }

    await prisma.sheet.delete({ where: { id } });
    return reply.code(204).send();
  });

  /**
   * POST /sheets/:id/share
   * Generates a public share token for a sheet.
   */
  app.post<{ Params: { id: string } }>("/sheets/:id/share", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.sheet.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Sheet not found" });
    }

    const shareToken = randomUUID();
    const sheet = await prisma.sheet.update({
      where: { id },
      data: { isPublic: true, shareToken },
    });

    return reply.send({ shareToken: sheet.shareToken, shareUrl: `/sheets/share/${sheet.shareToken}` });
  });

  /**
   * GET /sheets/share/:shareToken
   * Returns a read-only public view of a shared sheet.
   */
  app.get<{ Params: { shareToken: string } }>("/sheets/share/:shareToken", async (request, reply) => {
    const { shareToken } = request.params;

    const sheet = await prisma.sheet.findUnique({
      where: { shareToken },
      select: { id: true, title: true, data: true, createdAt: true, updatedAt: true, isPublic: true },
    });

    if (!sheet || !sheet.isPublic) {
      return reply.code(404).send({ error: "Shared sheet not found" });
    }

    return reply.send({
      sheet,
      banner: {
        message: "This was created with Quant Workspace. Get your own AI assistant.",
        signUpUrl: "/signup",
      },
    });
  });
}
