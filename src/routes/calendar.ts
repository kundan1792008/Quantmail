import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /calendar/:userId
   * Returns all calendar events for a user.
   */
  app.get<{ Params: { userId: string } }>("/calendar/:userId", async (request, reply) => {
    const { userId } = request.params;
    const events = await prisma.calendarEvent.findMany({
      where: { userId },
      orderBy: { startAt: "asc" },
    });
    return reply.send({ events });
  });

  /**
   * POST /calendar
   * Creates a new calendar event.
   */
  app.post<{
    Body: {
      userId: string;
      title: string;
      description?: string;
      startAt: string;
      endAt: string;
    };
  }>("/calendar", async (request, reply) => {
    const { userId, title, description = "", startAt, endAt } = request.body;

    if (!userId || !title || !startAt || !endAt) {
      return reply.code(400).send({ error: "userId, title, startAt, and endAt are required" });
    }

    const event = await prisma.calendarEvent.create({
      data: {
        userId,
        title,
        description,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
      },
    });

    return reply.code(201).send({ event });
  });

  /**
   * PUT /calendar/:id
   * Updates a calendar event.
   */
  app.put<{
    Params: { id: string };
    Body: { title?: string; description?: string; startAt?: string; endAt?: string };
  }>("/calendar/:id", async (request, reply) => {
    const { id } = request.params;
    const { title, description, startAt, endAt } = request.body;

    const existing = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Event not found" });
    }

    const event = await prisma.calendarEvent.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(startAt !== undefined && { startAt: new Date(startAt) }),
        ...(endAt !== undefined && { endAt: new Date(endAt) }),
      },
    });

    return reply.send({ event });
  });

  /**
   * DELETE /calendar/:id
   * Deletes a calendar event.
   */
  app.delete<{ Params: { id: string } }>("/calendar/:id", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.calendarEvent.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Event not found" });
    }

    await prisma.calendarEvent.delete({ where: { id } });
    return reply.code(204).send();
  });
}
