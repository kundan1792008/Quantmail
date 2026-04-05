import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function notesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /notes/:userId
   * Returns all notes for a user.
   */
  app.get<{ Params: { userId: string } }>("/notes/:userId", async (request, reply) => {
    const { userId } = request.params;
    const notes = await prisma.note.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send({ notes });
  });

  /**
   * POST /notes
   * Creates a new note.
   */
  app.post<{
    Body: { userId: string; title: string; content?: string };
  }>("/notes", async (request, reply) => {
    const { userId, title, content = "" } = request.body;

    if (!userId || !title) {
      return reply.code(400).send({ error: "userId and title are required" });
    }

    const note = await prisma.note.create({ data: { userId, title, content } });
    return reply.code(201).send({ note });
  });

  /**
   * PUT /notes/:id
   * Updates a note.
   */
  app.put<{
    Params: { id: string };
    Body: { title?: string; content?: string };
  }>("/notes/:id", async (request, reply) => {
    const { id } = request.params;
    const { title, content } = request.body;

    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Note not found" });
    }

    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
      },
    });

    return reply.send({ note });
  });

  /**
   * DELETE /notes/:id
   * Deletes a note.
   */
  app.delete<{ Params: { id: string } }>("/notes/:id", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Note not found" });
    }

    await prisma.note.delete({ where: { id } });
    return reply.code(204).send();
  });
}
