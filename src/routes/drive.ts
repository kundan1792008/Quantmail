import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { MOCK_DRIVE_FILES, semanticSearch, type DriveFile } from "../services/driveSearchService";

export async function driveRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { userId: string } }>("/drive/:userId", async (request, reply) => {
    const { userId } = request.params;
    const files = await prisma.driveFile.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return reply.send({ files });
  });

  app.get("/drive/files", async (_request, reply) => {
    const files: DriveFile[] = MOCK_DRIVE_FILES;
    return reply.send({ files, total: files.length });
  });

  app.post<{ Body: { userId: string; name: string; mimeType?: string; type?: string; size?: number; url: string } }>("/drive", async (request, reply) => {
    const { userId, name, mimeType, type, size = 0, url } = request.body;
    const resolvedMimeType = mimeType ?? type;
    if (!userId || !name || !resolvedMimeType || !url) {
      return reply.code(400).send({ error: "userId, name, mimeType, and url are required" });
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reply.code(400).send({ error: "Invalid url format" });
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return reply.code(400).send({ error: "url must use http or https protocol" });
    }
    const file = await prisma.driveFile.create({ data: { userId, name, mimeType: resolvedMimeType, size, url } });
    return reply.code(201).send({ file });
  });

  app.post<{ Body: { query: string; limit?: number; minScore?: number } }>("/drive/search", async (request, reply) => {
    const { query, limit, minScore } = request.body;
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return reply.code(400).send({ error: "query is required and must be a non-empty string" });
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return reply.code(400).send({ error: "limit must be a positive integer" });
    }
    if (minScore !== undefined && (typeof minScore !== "number" || minScore < 0 || minScore > 1)) {
      return reply.code(400).send({ error: "minScore must be a number between 0 and 1" });
    }
    const results = semanticSearch(query.trim(), MOCK_DRIVE_FILES, { limit: limit ?? 10, minScore: minScore ?? 0.1 });
    return reply.send({ query: query.trim(), total: results.length, results });
  });

  app.delete<{ Params: { id: string }; Body: { userId?: string } }>("/drive/:id", async (request, reply) => {
    const { id } = request.params;
    const userId = request.body?.userId;
    const existing = userId ? await prisma.driveFile.findFirst({ where: { id, userId } }) : await prisma.driveFile.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "File not found" });
    await prisma.driveFile.delete({ where: { id } });
    return reply.send({ status: "deleted" });
  });
}
