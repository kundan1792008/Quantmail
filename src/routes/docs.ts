import { randomUUID } from "crypto";
import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { userId: string } }>("/docs/:userId", async (request, reply) => {
    const { userId } = request.params;
    const docs = await prisma.doc.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send({ docs });
  });

  app.get<{ Params: { userId: string; id: string } }>("/docs/:userId/:id", async (request, reply) => {
    const { userId, id } = request.params;
    const doc = await prisma.doc.findFirst({ where: { id, userId } });
    if (!doc) {
      return reply.code(404).send({ error: "Doc not found" });
    }
    return reply.send({ doc });
  });

  app.post<{
    Body: { userId: string; title: string; content?: string };
  }>("/docs", async (request, reply) => {
    const { userId, title, content = "" } = request.body;

    if (!userId || !title) {
      return reply.code(400).send({ error: "userId and title are required" });
    }

    const doc = await prisma.doc.create({ data: { userId, title, content } });
    return reply.code(201).send({ doc });
  });

  app.put<{
    Params: { id: string };
    Body: { userId?: string; title?: string; content?: string };
  }>("/docs/:id", async (request, reply) => {
    const { id } = request.params;
    const { userId, title, content } = request.body;

    const existing = userId
      ? await prisma.doc.findFirst({ where: { id, userId } })
      : await prisma.doc.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Doc not found" });
    }

    const doc = await prisma.doc.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
      },
    });

    return reply.send({ doc });
  });

  app.delete<{ Params: { id: string }; Body: { userId?: string } }>("/docs/:id", async (request, reply) => {
    const { id } = request.params;
    const userId = request.body?.userId;

    const existing = userId
      ? await prisma.doc.findFirst({ where: { id, userId } })
      : await prisma.doc.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Doc not found" });
    }

    await prisma.doc.delete({ where: { id } });
    return reply.send({ status: "deleted" });
  });

  app.post<{ Params: { id: string } }>("/docs/:id/share", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.doc.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Doc not found" });
    }

    const shareToken = randomUUID();
    const doc = await prisma.doc.update({
      where: { id },
      data: { isPublic: true, shareToken },
    });

    return reply.send({ shareToken: doc.shareToken, shareUrl: `/docs/share/${doc.shareToken}` });
  });

  app.get<{ Params: { shareToken: string } }>("/docs/share/:shareToken", async (request, reply) => {
    const { shareToken } = request.params;

    const doc = await prisma.doc.findUnique({
      where: { shareToken },
      select: { id: true, title: true, content: true, createdAt: true, updatedAt: true, isPublic: true },
    });

    if (!doc || !doc.isPublic) {
      return reply.code(404).send({ error: "Shared doc not found" });
    }

    return reply.send({
      doc,
      banner: {
        message: "This was created with Quant Workspace. Get your own AI assistant.",
        signUpUrl: "/signup",
      },
    });
  });
}
