import { describe, it, expect } from "vitest";
import { parseEventFromText } from "../services/calendarParser";

// Fixed reference date: Wednesday 2025-06-04 (Wed = day 3)
const NOW = new Date("2025-06-04T08:00:00.000Z");

describe("parseEventFromText – title extraction", () => {
  it("returns the activity as title", () => {
    const result = parseEventFromText("Coffee with John next Friday at 10 AM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.title.toLowerCase()).toContain("coffee");
    }
  });

  it("uses full prompt as title fallback when stripped text is too short", () => {
    const result = parseEventFromText("at 3 PM", NOW);
    expect("error" in result).toBe(false);
  });

  it("returns error for empty prompt", () => {
    const result = parseEventFromText("", NOW);
    expect("error" in result).toBe(true);
  });

  it("returns error for whitespace-only prompt", () => {
    const result = parseEventFromText("   ", NOW);
    expect("error" in result).toBe(true);
  });
});

describe("parseEventFromText – day resolution", () => {
  it("resolves 'today' to the reference date", () => {
    const result = parseEventFromText("Call today at 3 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getUTCFullYear()).toBe(2025);
      expect(result.startTime.getUTCMonth()).toBe(5); // June = 5
      expect(result.startTime.getUTCDate()).toBe(4);
    }
  });

  it("resolves 'tomorrow' to the next day", () => {
    const result = parseEventFromText("Standup tomorrow at 9 AM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getUTCDate()).toBe(5); // June 5
    }
  });

  it("resolves 'next Friday' to the following Friday", () => {
    // Reference: Wed Jun 4 2025; next Friday = Jun 6 2025 (2 days away)
    const result = parseEventFromText("Coffee with John next Friday at 10 AM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getDay()).toBe(5); // 5 = Friday
    }
  });

  it("resolves 'on Monday' to the next Monday", () => {
    const result = parseEventFromText("Lunch on Monday at 12 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getDay()).toBe(1); // 1 = Monday
    }
  });

  it("defaults to today when no day phrase is present", () => {
    const result = parseEventFromText("Team sync at 2 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getUTCDate()).toBe(4); // same day as NOW
    }
  });
});

describe("parseEventFromText – time resolution", () => {
  it("parses 12-hour AM time", () => {
    const result = parseEventFromText("Meeting today at 10 AM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getHours()).toBe(10);
      expect(result.startTime.getMinutes()).toBe(0);
    }
  });

  it("parses 12-hour PM time", () => {
    const result = parseEventFromText("Lunch today at 1 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getHours()).toBe(13);
    }
  });

  it("parses time with minutes", () => {
    const result = parseEventFromText("Call today at 3:45 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getHours()).toBe(15);
      expect(result.startTime.getMinutes()).toBe(45);
    }
  });

  it("parses noon (12 PM) correctly", () => {
    const result = parseEventFromText("Lunch today at 12 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getHours()).toBe(12);
    }
  });

  it("parses midnight (12 AM) correctly", () => {
    const result = parseEventFromText("Deploy today at 12 AM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getHours()).toBe(0);
    }
  });

  it("defaults to 9 AM when no time phrase is present", () => {
    const result = parseEventFromText("Team sync tomorrow", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getHours()).toBe(9);
    }
  });
});

describe("parseEventFromText – endTime", () => {
  it("sets endTime 1 hour after startTime by default", () => {
    const result = parseEventFromText("Call today at 2 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      const diffMs = result.endTime.getTime() - result.startTime.getTime();
      expect(diffMs).toBe(60 * 60 * 1000);
    }
  });
});

describe("parseEventFromText – real-world prompts", () => {
  it("handles 'Coffee with John next Friday at 10 AM'", () => {
    const result = parseEventFromText("Coffee with John next Friday at 10 AM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getDay()).toBe(5);
      expect(result.startTime.getHours()).toBe(10);
    }
  });

  it("handles 'Team standup tomorrow at 9:30 AM'", () => {
    const result = parseEventFromText("Team standup tomorrow at 9:30 AM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getMinutes()).toBe(30);
      expect(result.startTime.getHours()).toBe(9);
    }
  });

  it("handles 'Doctor appointment on Thursday at 4 PM'", () => {
    const result = parseEventFromText("Doctor appointment on Thursday at 4 PM", NOW);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.startTime.getDay()).toBe(4); // Thursday
      expect(result.startTime.getHours()).toBe(16);
    }
  });
});
