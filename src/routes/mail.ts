import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function mailRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /mail/:userId
   * Returns all emails for a user, newest first.
   */
  app.get<{ Params: { userId: string } }>(
    "/mail/:userId",
    async (request, reply) => {
      const { userId } = request.params;
      const emails = await prisma.email.findMany({
        where: { userId },
        orderBy: { date: "desc" },
      });
      return reply.send({ emails });
    }
  );

  /**
   * POST /mail
   * Creates a new email record for a user.
   * Body: { userId, subject, snippet?, body, senderId, recipientId }
   */
  app.post<{
    Body: {
      userId: string;
      subject: string;
      snippet?: string;
      body: string;
      senderId: string;
      recipientId: string;
    };
  }>("/mail", async (request, reply) => {
    const { userId, subject, snippet, body, senderId, recipientId } =
      request.body;
    if (!userId || !subject || !body || !senderId || !recipientId) {
      return reply
        .code(400)
        .send({ error: "userId, subject, body, senderId, recipientId required" });
    }
    const email = await prisma.email.create({
      data: { userId, subject, snippet: snippet ?? "", body, senderId, recipientId },
    });
    return reply.code(201).send({ email });
  });

  /**
   * PATCH /mail/:id/read
   * Marks an email as read (scoped to owner).
   */
  app.patch<{ Params: { id: string }; Body: { userId: string } }>(
    "/mail/:id/read",
    async (request, reply) => {
      const { id } = request.params;
      const { userId } = request.body;
      if (!userId) {
        return reply.code(400).send({ error: "userId required" });
      }
      const existing = await prisma.email.findFirst({ where: { id, userId } });
      if (!existing) {
        return reply.code(404).send({ error: "Email not found" });
      }
      const email = await prisma.email.update({
        where: { id },
        data: { isRead: true },
      });
      return reply.send({ email });
    }
  );

  /**
   * PATCH /mail/:id/star
   * Toggles the starred status of an email (scoped to owner).
   */
  app.patch<{ Params: { id: string }; Body: { userId: string; isStarred: boolean } }>(
    "/mail/:id/star",
    async (request, reply) => {
      const { id } = request.params;
      const { userId, isStarred } = request.body;
      if (!userId) {
        return reply.code(400).send({ error: "userId required" });
      }
      const existing = await prisma.email.findFirst({ where: { id, userId } });
      if (!existing) {
        return reply.code(404).send({ error: "Email not found" });
      }
      const email = await prisma.email.update({
        where: { id },
        data: { isStarred },
      });
      return reply.send({ email });
    }
  );

  /**
   * DELETE /mail/:id
   * Deletes an email record (scoped to owner).
   */
  app.delete<{ Params: { id: string }; Body: { userId: string } }>(
    "/mail/:id",
    async (request, reply) => {
      const { id } = request.params;
      const { userId } = request.body;
      if (!userId) {
        return reply.code(400).send({ error: "userId required" });
      }
      const existing = await prisma.email.findFirst({ where: { id, userId } });
      if (!existing) {
        return reply.code(404).send({ error: "Email not found" });
      }
      await prisma.email.delete({ where: { id } });
      return reply.send({ status: "deleted" });
    }
  );
}
