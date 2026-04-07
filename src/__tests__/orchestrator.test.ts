import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_FREE_LIMIT, checkPaywall, incrementAiCount } from "../services/paywallService";
import {
  executeOrchestratorAction,
  extractEventFromEmail,
  generateReportFromSheets,
} from "../services/orchestratorService";

vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    task: { create: vi.fn() },
    doc: { create: vi.fn() },
    calendarEvent: { create: vi.fn() },
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
  beforeEach(() => vi.clearAllMocks());

  it("blocks FREE users at the limit", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "FREE", aiCount: AI_FREE_LIMIT });
    const result = await checkPaywall("u1");
    expect(result.allowed).toBe(false);
  });

  it("increments AI usage", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    await incrementAiCount("u1");
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { aiCount: { increment: 1 } },
    });
  });
});

describe("orchestratorService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a task from chat", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
    mockPrisma.task.create.mockResolvedValue({ id: "t1", title: "Frontend task", status: "TODO", createdAt: new Date() });

    const result = await executeOrchestratorAction({
      userId: "u1",
      sourceApp: "chat",
      targetApp: "tasks",
      action: "create_task_from_message",
      payload: { title: "Frontend task" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.taskId).toBe("t1");
  });

  it("extracts an event from email text", () => {
    const event = extractEventFromEmail("Meeting: Q3 Budget Review\nPlease join tomorrow at 3 PM.");
    expect(event.title).toBe("Q3 Budget Review");
    expect(event.startTime).toBeInstanceOf(Date);
  });

  it("generates a spreadsheet report", () => {
    const report = generateReportFromSheets(JSON.stringify([{ revenue: 10 }, { revenue: 15 }]));
    expect(report.title).toMatch(/Spreadsheet Report/);
    expect(report.content).toMatch(/revenue/i);
  });
});
