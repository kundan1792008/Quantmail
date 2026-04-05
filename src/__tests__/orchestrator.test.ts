import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkPaywall, incrementAiCount, AI_FREE_LIMIT } from "../services/paywallService";
import { executeOrchestratorAction } from "../services/orchestratorService";

// Mock prisma
vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    task: {
      create: vi.fn(),
    },
    doc: {
      create: vi.fn(),
    },
    calendarEvent: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "../db";

const mockPrisma = prisma as {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  task: { create: ReturnType<typeof vi.fn> };
  doc: { create: ReturnType<typeof vi.fn> };
  calendarEvent: { create: ReturnType<typeof vi.fn> };
};

describe("paywallService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkPaywall", () => {
    it("returns not allowed when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await checkPaywall("nonexistent");
      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/not found/i);
    });

    it("allows PRO user regardless of aiCount", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "PRO", aiCount: 200 });
      const result = await checkPaywall("u1");
      expect(result.allowed).toBe(true);
      expect(result.aiCount).toBe(200);
    });

    it("allows FREE user under the limit", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "FREE", aiCount: 10 });
      const result = await checkPaywall("u1");
      expect(result.allowed).toBe(true);
    });

    it("blocks FREE user at or above limit", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "FREE", aiCount: AI_FREE_LIMIT });
      const result = await checkPaywall("u1");
      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/upgrade/i);
    });

    it("exposes the correct limit", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "FREE", aiCount: 0 });
      const result = await checkPaywall("u1");
      expect(result.limit).toBe(AI_FREE_LIMIT);
    });
  });

  describe("incrementAiCount", () => {
    it("calls prisma.user.update with increment", async () => {
      mockPrisma.user.update.mockResolvedValue({});
      await incrementAiCount("u1");
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { aiCount: { increment: 1 } },
      });
    });
  });
});

describe("orchestratorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("chat -> tasks", () => {
    it("creates a task from a chat message", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
      mockPrisma.task.create.mockResolvedValue({
        id: "t1",
        title: "Frontend task",
        status: "TODO",
        createdAt: new Date("2025-01-01"),
      });

      const result = await executeOrchestratorAction({
        userId: "u1",
        sourceApp: "chat",
        targetApp: "tasks",
        action: "create_task_from_message",
        payload: { title: "Frontend task", description: "I'll do the frontend by tomorrow" },
      });

      expect(result.success).toBe(true);
      expect(result.data?.taskId).toBe("t1");
      expect(result.data?.title).toBe("Frontend task");
    });

    it("returns error when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await executeOrchestratorAction({
        userId: "missing",
        sourceApp: "chat",
        targetApp: "tasks",
        action: "create_task_from_message",
        payload: { title: "Task" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/user not found/i);
    });
  });

  describe("meet -> docs", () => {
    it("saves a transcript to a doc", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
      mockPrisma.doc.create.mockResolvedValue({
        id: "d1",
        title: "Q1 Review",
        createdAt: new Date("2025-01-01"),
      });

      const result = await executeOrchestratorAction({
        userId: "u1",
        sourceApp: "meet",
        targetApp: "docs",
        action: "save_transcript_to_doc",
        payload: { meetingTitle: "Q1 Review", transcript: "Alice: Good morning. Bob: Let's start." },
      });

      expect(result.success).toBe(true);
      expect(result.data?.docId).toBe("d1");
    });
  });

  describe("notes -> calendar", () => {
    it("creates a calendar event from a note", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
      mockPrisma.calendarEvent.create.mockResolvedValue({
        id: "e1",
        title: "Investor meeting",
        startAt: new Date("2025-04-11T10:00:00Z"),
        endAt: new Date("2025-04-11T11:00:00Z"),
        createdAt: new Date("2025-01-01"),
      });

      const result = await executeOrchestratorAction({
        userId: "u1",
        sourceApp: "notes",
        targetApp: "calendar",
        action: "add_note_to_calendar",
        payload: {
          title: "Investor meeting",
          startAt: "2025-04-11T10:00:00Z",
          endAt: "2025-04-11T11:00:00Z",
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.eventId).toBe("e1");
    });

    it("returns error when startAt is missing", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
      const result = await executeOrchestratorAction({
        userId: "u1",
        sourceApp: "notes",
        targetApp: "calendar",
        action: "add_note_to_calendar",
        payload: { title: "Meeting" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/startAt/i);
    });

    it("returns error when startAt is invalid", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
      const result = await executeOrchestratorAction({
        userId: "u1",
        sourceApp: "notes",
        targetApp: "calendar",
        action: "add_note_to_calendar",
        payload: { title: "Meeting", startAt: "not-a-date" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid/i);
    });
  });

  describe("unsupported flows", () => {
    it("returns error for unsupported orchestration flow", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
      const result = await executeOrchestratorAction({
        userId: "u1",
        sourceApp: "drive",
        targetApp: "sheets",
        action: "unknown_action",
        payload: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unsupported/i);
    });
  });
});
