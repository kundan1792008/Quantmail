import { describe, expect, it } from "vitest";
import {
  evaluateInboxRelevanceSync,
  isPromotionalEmail,
  rankInboxMessagesByRelevance,
} from "../services/inboxRelevanceSync";

const TODAY = new Date("2026-04-01T12:00:00.000Z");

describe("isPromotionalEmail", () => {
  it("detects promotional language", () => {
    expect(
      isPromotionalEmail({
        senderEmail: "marketing@gmail.com",
        subject: "Limited time deal on AI tools",
        body: "Exclusive offer just for you",
      })
    ).toBe(true);
  });

  it("does not flag normal correspondence", () => {
    expect(
      isPromotionalEmail({
        senderEmail: "ceo@quantmail.com",
        subject: "Project sync notes",
        body: "Let's review the launch plan tomorrow",
      })
    ).toBe(false);
  });
});

describe("evaluateInboxRelevanceSync", () => {
  it("promotes promotional mail matching a watched Quanttube keyword from today", () => {
    const result = evaluateInboxRelevanceSync(
      {
        senderEmail: "offers@gmail.com",
        subject: "Exclusive discount for robotics builders",
        body: "Shop now for the best robotics kits",
      },
      [
        {
          videoTitle: "Advanced Robotics Workshop",
          watchedSeconds: 88,
          watchedAt: new Date("2026-04-01T08:30:00.000Z"),
        },
      ],
      TODAY
    );

    expect(result.promoted).toBe(true);
    expect(result.matchedKeyword).toBe("robotics");
    expect(result.matchedVideoTitle).toBe("Advanced Robotics Workshop");
    expect(result.presentation.pinToTop).toBe(true);
    expect(result.presentation.borderStyle).toBe("glowing-holographic");
  });

  it("does not promote when the watch time is 45 seconds or less", () => {
    const result = evaluateInboxRelevanceSync(
      {
        senderEmail: "offers@gmail.com",
        subject: "Exclusive discount for robotics builders",
        body: "Shop now for the best robotics kits",
      },
      [
        {
          videoTitle: "Advanced Robotics Workshop",
          watchedSeconds: 45,
          watchedAt: new Date("2026-04-01T08:30:00.000Z"),
        },
      ],
      TODAY
    );

    expect(result.promoted).toBe(false);
    expect(result.presentation.borderStyle).toBe("standard");
  });

  it("does not promote when the watched video is from a prior day", () => {
    const result = evaluateInboxRelevanceSync(
      {
        senderEmail: "offers@gmail.com",
        subject: "Exclusive discount for robotics builders",
        body: "Shop now for the best robotics kits",
      },
      [
        {
          videoTitle: "Advanced Robotics Workshop",
          watchedSeconds: 120,
          watchedAt: new Date("2026-03-31T23:00:00.000Z"),
        },
      ],
      TODAY
    );

    expect(result.promoted).toBe(false);
  });
});

describe("rankInboxMessagesByRelevance", () => {
  it("pins synchronized promotional mail above newer non-promotional messages", () => {
    const ranked = rankInboxMessagesByRelevance(
      [
        {
          id: "1",
          senderEmail: "team@quantmail.com",
          subject: "Daily engineering notes",
          body: "Status update",
          receivedAt: new Date("2026-04-01T11:00:00.000Z"),
        },
        {
          id: "2",
          senderEmail: "offers@gmail.com",
          subject: "Limited time robotics discount",
          body: "Buy now and save big on robotics gear",
          receivedAt: new Date("2026-04-01T10:00:00.000Z"),
        },
      ],
      [
        {
          videoTitle: "Advanced Robotics Workshop",
          watchedSeconds: 92,
          watchedAt: new Date("2026-04-01T08:30:00.000Z"),
        },
      ],
      TODAY
    );

    expect(ranked[0]?.id).toBe("2");
    expect(ranked[0]?.relevanceSync.presentation.borderStyle).toBe(
      "glowing-holographic"
    );
    expect(ranked[1]?.id).toBe("1");
  });
});
