import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inboxRoutes } from "../routes/inbox";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
    quanttubeWatchEvent: {
      findMany: vi.fn(),
    },
    shadowInbox: {
      create: vi.fn(),
    },
    inboxMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

describe("inboxRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bypasses shadow interception for relevant promotional mail", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@quantmail.com",
    });
    mockPrisma.quanttubeWatchEvent.findMany.mockResolvedValue([
      {
        videoTitle: "Advanced Robotics Workshop",
        watchedSeconds: 90,
        watchedAt: new Date("2026-04-01T08:30:00.000Z"),
      },
    ]);
    mockPrisma.inboxMessage.create.mockResolvedValue({
      id: "message-1",
    });

    const app = Fastify();
    await app.register(inboxRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/inbox/receive",
      payload: {
        senderEmail: "offers@gmail.com",
        recipientEmail: "user@quantmail.com",
        subject: "Exclusive robotics discount",
        body: "Limited time deal on robotics kits",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "delivered",
      spamFilterBypassed: true,
      relevanceSync: {
        promoted: true,
        matchedKeyword: "robotics",
        presentation: {
          pinToTop: true,
          borderStyle: "glowing-holographic",
        },
      },
    });
    expect(mockPrisma.inboxMessage.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.shadowInbox.create).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns promoted inbox messages ahead of newer standard mail", async () => {
    mockPrisma.inboxMessage.findMany.mockResolvedValue([
      {
        id: "message-1",
        senderEmail: "team@quantmail.com",
        subject: "Daily notes",
        body: "Status update",
        receivedAt: new Date("2026-04-01T11:00:00.000Z"),
      },
      {
        id: "message-2",
        senderEmail: "offers@gmail.com",
        subject: "Exclusive robotics discount",
        body: "Limited time deal on robotics kits",
        receivedAt: new Date("2026-04-01T10:00:00.000Z"),
      },
    ]);
    mockPrisma.quanttubeWatchEvent.findMany.mockResolvedValue([
      {
        videoTitle: "Advanced Robotics Workshop",
        watchedSeconds: 90,
        watchedAt: new Date("2026-04-01T08:30:00.000Z"),
      },
    ]);

    const app = Fastify();
    await app.register(inboxRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/inbox/user-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().messages[0]).toMatchObject({
      id: "message-2",
      relevanceSync: {
        promoted: true,
        presentation: {
          borderStyle: "glowing-holographic",
        },
      },
    });
    expect(response.json().messages[1]).toMatchObject({
      id: "message-1",
    });

    await app.close();
  });
});
