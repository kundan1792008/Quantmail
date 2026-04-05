import { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function meetRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /meet/transcript
   * Saves a meeting transcript.
   * The orchestrator route handles converting a transcript to a Doc.
   * This endpoint stores a chat message in a dedicated "meet" channel as a transcript record.
   */
  app.post<{
    Body: { userId: string; meetingTitle: string; transcript: string };
  }>("/meet/transcript", async (request, reply) => {
    const { userId, meetingTitle, transcript } = request.body;

    if (!userId || !meetingTitle || !transcript) {
      return reply.code(400).send({ error: "userId, meetingTitle, and transcript are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    // Save transcript as a chat message in the "meet-transcripts" channel
    const record = await prisma.chatMessage.create({
      data: {
        userId,
        channel: "meet-transcripts",
        content: JSON.stringify({ meetingTitle, transcript }),
      },
    });

    return reply.code(201).send({
      id: record.id,
      meetingTitle,
      savedAt: record.sentAt,
      hint: "Use POST /orchestrator/action with action='save_transcript_to_doc' to save this to Docs.",
    });
  });

  /**
   * GET /meet/transcripts/:userId
   * Returns saved meeting transcripts for a user.
   */
  app.get<{ Params: { userId: string } }>("/meet/transcripts/:userId", async (request, reply) => {
    const { userId } = request.params;

    const records = await prisma.chatMessage.findMany({
      where: { userId, channel: "meet-transcripts" },
      orderBy: { sentAt: "desc" },
    });

    const transcripts = records.map((r) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(r.content) as Record<string, unknown>;
      } catch {
        parsed = { raw: r.content };
      }
      return { id: r.id, sentAt: r.sentAt, ...parsed };
    });

    return reply.send({ transcripts });
  });
}
