import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /chat/messages/:userId
   * Returns chat messages for a user, optionally filtered by channel.
   */
  app.get<{
    Params: { userId: string };
    Querystring: { channel?: string };
  }>("/chat/messages/:userId", async (request, reply) => {
    const { userId } = request.params;
    const { channel } = request.query;

    const messages = await prisma.chatMessage.findMany({
      where: {
        userId,
        ...(channel ? { channel } : {}),
      },
      orderBy: { sentAt: "asc" },
    });

    return reply.send({ messages });
  });

  /**
   * POST /chat/messages
   * Sends a new chat message.
   */
  app.post<{
    Body: {
      userId: string;
      channel?: string;
      content: string;
    };
  }>("/chat/messages", async (request, reply) => {
    const { userId, channel = "general", content } = request.body;

    if (!userId || !content) {
      return reply.code(400).send({ error: "userId and content are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const message = await prisma.chatMessage.create({
      data: { userId, channel, content },
    });

    return reply.code(201).send({ message });
  });

  /**
   * DELETE /chat/messages/:id
   * Deletes a chat message.
   */
  app.delete<{ Params: { id: string } }>("/chat/messages/:id", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.chatMessage.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Message not found" });
    }

    await prisma.chatMessage.delete({ where: { id } });
    return reply.code(204).send();
  });
}
