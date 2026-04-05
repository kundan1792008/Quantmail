import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /tasks/:userId
   * Returns all tasks for a user.
   */
  app.get<{ Params: { userId: string } }>("/tasks/:userId", async (request, reply) => {
    const { userId } = request.params;
    const tasks = await prisma.task.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ tasks });
  });

  /**
   * POST /tasks
   * Creates a new task.
   */
  app.post<{
    Body: {
      userId: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      dueDate?: string;
    };
  }>("/tasks", async (request, reply) => {
    const { userId, title, description, status, priority, dueDate } = request.body;

    if (!userId || !title) {
      return reply.code(400).send({ error: "userId and title are required" });
    }

    const task = await prisma.task.create({
      data: {
        userId,
        title,
        description: description ?? "",
        status: (status as "TODO" | "IN_PROGRESS" | "DONE") ?? "TODO",
        priority: (priority as "LOW" | "MEDIUM" | "HIGH") ?? "MEDIUM",
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    return reply.code(201).send({ task });
  });

  /**
   * PUT /tasks/:id
   * Updates a task.
   */
  app.put<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      dueDate?: string | null;
    };
  }>("/tasks/:id", async (request, reply) => {
    const { id } = request.params;
    const { title, description, status, priority, dueDate } = request.body;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status: status as "TODO" | "IN_PROGRESS" | "DONE" }),
        ...(priority !== undefined && { priority: priority as "LOW" | "MEDIUM" | "HIGH" }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      },
    });

    return reply.send({ task });
  });

  /**
   * DELETE /tasks/:id
   * Deletes a task.
   */
  app.delete<{ Params: { id: string } }>("/tasks/:id", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Task not found" });
    }

    await prisma.task.delete({ where: { id } });
    return reply.code(204).send();
  });
}
