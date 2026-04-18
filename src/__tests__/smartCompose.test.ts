import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock OpenAI before importing services that depend on it.
// ---------------------------------------------------------------------------

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => {
  const MockOpenAI = vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mockCreate } } };
  });
  return { default: MockOpenAI };
});

// Import after mocking
import {
  generateCompletions,
  recordFeedback,
  getFeedbackRecords,
  clearFeedback,
  extractContextWindow,
  isAtSentenceBoundary,
  hasMinimumContext,
  SmartComposeConfigError,
  type ComposeContext,
  type ComposeFeedback,
  type CompletionSuggestion,
} from "../services/SmartComposeEngine";

import {
  detectTone,
  adaptCompletionToTone,
  getTemplateSuggestions,
  formatToneLabel,
  toneEmoji,
  type ToneDetectionResult,
} from "../services/ToneAdapter";

import {
  buildProfile,
  getProfile,
  updateProfileWithEmail,
  deleteProfile,
  suggestGreeting,
  suggestSignOff,
  suggestMeetingSlots,
  serialiseProfile,
  deserialiseProfile,
  buildContextSummary,
  type SentEmail,
} from "../services/ContextLearner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ComposeContext> = {}): ComposeContext {
  return {
    subject: "Q4 revenue review",
    bodyUpToCursor: "Dear Rahul, I wanted to reach out regarding the",
    recipient: { name: "Rahul Sharma", email: "rahul@acme.com" },
    tone: "formal",
    ...overrides,
  };
}

function makeLLMResponse(...completions: string[]) {
  return {
    choices: [{ message: { content: completions.join("\n---SUGGESTION---\n") } }],
  };
}

function makeSentEmails(n: number): SentEmail[] {
  return Array.from({ length: n }, (_, i) => ({
    sentAt: new Date(Date.now() - i * 86400000).toISOString(),
    to: "rahul@acme.com",
    toName: "Rahul Sharma",
    subject: i % 2 === 0 ? "Schedule a meeting" : "Project update",
    body: `Hi Rahul,\n\nI wanted to follow up on the project status. Please find attached the report.\n\nBest regards,\nAlice`,
  }));
}

// ─── SmartComposeEngine Tests ─────────────────────────────────────────────────

describe("SmartComposeEngine", () => {
  const savedEnv = process.env;

  beforeEach(() => {
    process.env = { ...savedEnv };
    mockCreate.mockReset();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("throws SmartComposeConfigError when OPENAI_API_KEY is missing", async () => {
    delete process.env["OPENAI_API_KEY"];
    await expect(generateCompletions(makeContext())).rejects.toThrow(
      SmartComposeConfigError
    );
  });

  it("returns 3 suggestions by default", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        "upcoming financial review.",
        "board meeting scheduled for next week.",
        "Q4 performance metrics you requested."
      )
    );

    const result = await generateCompletions(makeContext());

    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]!.rank).toBe(0);
    expect(result.suggestions[0]!.confidence).toBeGreaterThan(
      result.suggestions[1]!.confidence
    );
  });

  it("respects maxSuggestions config", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        "upcoming financial review.",
        "board meeting scheduled for next week."
      )
    );

    const result = await generateCompletions(makeContext(), { maxSuggestions: 2 });
    expect(result.suggestions.length).toBeLessThanOrEqual(2);
  });

  it("caps maxSuggestions at 5", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue(
      makeLLMResponse("a", "b", "c", "d", "e", "f")
    );

    const result = await generateCompletions(makeContext(), { maxSuggestions: 10 });
    expect(result.suggestions.length).toBeLessThanOrEqual(5);
  });

  it("marks full-sentence suggestions correctly", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        "upcoming financial review.",
        "meeting we discussed earlier"
      )
    );

    const result = await generateCompletions(makeContext());
    expect(result.suggestions[0]!.fullSentence).toBe(true);
    expect(result.suggestions[1]!.fullSentence).toBe(false);
  });

  it("throws when LLM returns empty response", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "" } }] });

    await expect(generateCompletions(makeContext())).rejects.toThrow(
      "SmartComposeEngine: LLM returned an empty response"
    );
  });

  it("returns the correct tone in result", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue(makeLLMResponse("completion text."));

    const result = await generateCompletions(
      makeContext({ tone: "urgent" })
    );
    expect(result.tone).toBe("urgent");
  });

  it("defaults tone to neutral when not specified", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue(makeLLMResponse("some completion."));

    const result = await generateCompletions(
      makeContext({ tone: undefined })
    );
    expect(result.tone).toBe("neutral");
  });

  it("records latencyMs in the result", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    mockCreate.mockResolvedValue(makeLLMResponse("text."));

    const result = await generateCompletions(makeContext());
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("uses OPENAI_MODEL env var when set", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    process.env["OPENAI_MODEL"] = "gpt-4o";
    mockCreate.mockResolvedValue(makeLLMResponse("text."));

    await generateCompletions(makeContext());

    const callArgs = mockCreate.mock.calls[0]?.[0] as { model: string };
    expect(callArgs.model).toBe("gpt-4o");
    delete process.env["OPENAI_MODEL"];
  });

  it("defaults to gpt-4o-mini", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    delete process.env["OPENAI_MODEL"];
    mockCreate.mockResolvedValue(makeLLMResponse("text."));

    await generateCompletions(makeContext());

    const callArgs = mockCreate.mock.calls[0]?.[0] as { model: string };
    expect(callArgs.model).toBe("gpt-4o-mini");
  });
});

// ─── Feedback API Tests ───────────────────────────────────────────────────────

describe("SmartComposeEngine – feedback", () => {
  const userEmail = "test@example.com";

  beforeEach(() => clearFeedback(userEmail));

  function makeFeedback(accepted: boolean): ComposeFeedback {
    const suggestion: CompletionSuggestion = {
      rank: 0,
      text: "upcoming review.",
      confidence: 0.85,
      fullSentence: true,
    };
    return {
      context: makeContext(),
      suggestion,
      accepted,
      timestamp: new Date().toISOString(),
    };
  }

  it("records accepted feedback", () => {
    recordFeedback(userEmail, makeFeedback(true));
    const records = getFeedbackRecords(userEmail);
    expect(records).toHaveLength(1);
    expect(records[0]!.accepted).toBe(true);
  });

  it("records rejected feedback", () => {
    recordFeedback(userEmail, makeFeedback(false));
    const records = getFeedbackRecords(userEmail);
    expect(records[0]!.accepted).toBe(false);
  });

  it("clears feedback for a user", () => {
    recordFeedback(userEmail, makeFeedback(true));
    clearFeedback(userEmail);
    expect(getFeedbackRecords(userEmail)).toHaveLength(0);
  });

  it("does not exceed MAX_FEEDBACK_RECORDS", () => {
    for (let i = 0; i < 520; i++) {
      recordFeedback(userEmail, makeFeedback(true));
    }
    expect(getFeedbackRecords(userEmail).length).toBeLessThanOrEqual(500);
  });
});

// ─── Utility Function Tests ───────────────────────────────────────────────────

describe("SmartComposeEngine – utility functions", () => {
  it("extractContextWindow returns last N paragraphs", () => {
    const body = "Para 1.\n\nPara 2.\n\nPara 3.\n\nPara 4.";
    expect(extractContextWindow(body, 2)).toBe("Para 3.\n\nPara 4.");
  });

  it("extractContextWindow handles fewer paragraphs than requested", () => {
    const body = "Only paragraph.";
    expect(extractContextWindow(body, 5)).toBe("Only paragraph.");
  });

  it("isAtSentenceBoundary returns true for empty string", () => {
    expect(isAtSentenceBoundary("")).toBe(true);
  });

  it("isAtSentenceBoundary returns true after period", () => {
    expect(isAtSentenceBoundary("Hello there.")).toBe(true);
  });

  it("isAtSentenceBoundary returns true after question mark", () => {
    expect(isAtSentenceBoundary("How are you?")).toBe(true);
  });

  it("isAtSentenceBoundary returns false mid-sentence", () => {
    expect(isAtSentenceBoundary("I am writ")).toBe(false);
  });

  it("hasMinimumContext returns true when all fields present", () => {
    const ctx = makeContext({ bodyUpToCursor: "Dear Rahul, please find" });
    expect(hasMinimumContext(ctx)).toBe(true);
  });

  it("hasMinimumContext returns false when body is too short", () => {
    const ctx = makeContext({ bodyUpToCursor: "Hi" });
    expect(hasMinimumContext(ctx)).toBe(false);
  });

  it("hasMinimumContext returns false when subject is empty", () => {
    const ctx = makeContext({ subject: "" });
    expect(hasMinimumContext(ctx)).toBe(false);
  });

  it("hasMinimumContext returns false when recipient email is empty", () => {
    const ctx = makeContext({ recipient: { name: "X", email: "" } });
    expect(hasMinimumContext(ctx)).toBe(false);
  });
});

// ─── ToneAdapter Tests ────────────────────────────────────────────────────────

describe("ToneAdapter – detectTone", () => {
  const recipient = { name: "Bob", email: "bob@example.com" };

  it("detects formal tone from keywords", () => {
    const result = detectTone(
      "Business proposal",
      "Dear Bob, please find attached the proposal. Kind regards,",
      recipient
    );
    expect(result.tone).toBe("formal");
  });

  it("detects casual tone from contractions and informal openers", () => {
    const result = detectTone(
      "Quick question",
      "Hey Bob, can't make it today. No worries though! Cheers",
      recipient
    );
    expect(result.tone).toBe("casual");
  });

  it("detects urgent tone", () => {
    const result = detectTone(
      "URGENT: Server Down",
      "Bob, the production server is down and we need this fixed immediately. ASAP please.",
      recipient
    );
    expect(result.tone).toBe("urgent");
  });

  it("detects apologetic tone", () => {
    const result = detectTone(
      "My apologies",
      "Bob, I sincerely apologize for the oversight. I should have notified you earlier.",
      recipient
    );
    expect(result.tone).toBe("apologetic");
  });

  it("applies recipient manager override to formal", () => {
    const mgr = { name: "Alice", email: "alice@corp.com", relationship: "manager" as const };
    const result = detectTone("Quick note", "Hey, just checking in", mgr);
    expect(result.tone).toBe("formal");
    expect(result.method).toBe("recipient");
  });

  it("applies recipient friend override to casual", () => {
    const friend = { name: "Dave", email: "dave@friend.com", relationship: "friend" as const };
    const result = detectTone("Hi", "Dear David, I am writing to formally request", friend);
    expect(result.tone).toBe("casual");
    expect(result.method).toBe("recipient");
  });

  it("detects meeting-invite template", () => {
    const result = detectTone(
      "Would you be available for a meeting",
      "I would like to schedule a meeting to discuss the project. Please let me know your availability.",
      recipient
    );
    expect(result.templateType).toBe("meeting-invite");
    expect(result.method).toBe("template");
  });

  it("returns neutral when no signals detected", () => {
    const result = detectTone("Re: hi", "Sure.", recipient);
    expect(result.tone).toBe("neutral");
  });

  it("confidence is in [0, 1]", () => {
    const result = detectTone("Test", "I am writing formally.", recipient);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe("ToneAdapter – adaptCompletionToTone", () => {
  it("returns original text unchanged when tones match", () => {
    const result = adaptCompletionToTone("I am ready.", "formal", "formal");
    expect(result.adapted).toBe("I am ready.");
  });

  it("converts formal contractions to casual", () => {
    const result = adaptCompletionToTone("I am unable to attend.", "formal", "casual");
    expect(result.adapted).toContain("I'm");
  });

  it("converts casual contractions to formal", () => {
    const result = adaptCompletionToTone("I can't make it.", "casual", "formal");
    expect(result.adapted).toContain("cannot");
  });

  it("adds urgency marker when adapting to urgent tone", () => {
    const result = adaptCompletionToTone("Please review the document.", "formal", "urgent");
    expect(result.adapted.length).toBeGreaterThan("Please review the document.".length);
  });

  it("adds apology prefix when adapting to apologetic tone without apology", () => {
    const result = adaptCompletionToTone("I missed the deadline.", "neutral", "apologetic");
    expect(/apolog|sorry|regret/i.test(result.adapted)).toBe(true);
  });

  it("does not double-add apology when already apologetic", () => {
    const result = adaptCompletionToTone("I sincerely apologize for this.", "apologetic", "apologetic");
    expect(result.adapted).toBe("I sincerely apologize for this.");
  });
});

describe("ToneAdapter – getTemplateSuggestions", () => {
  it("returns suggestions for meeting-invite template", () => {
    const suggestions = getTemplateSuggestions("meeting-invite", "formal");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]!.appliedTone).toBe("formal");
  });

  it("returns empty array for 'none' template", () => {
    expect(getTemplateSuggestions("none", "neutral")).toHaveLength(0);
  });
});

describe("ToneAdapter – formatting helpers", () => {
  it("formatToneLabel formats correctly", () => {
    const result: ToneDetectionResult = {
      tone: "formal",
      secondaryTone: "neutral",
      confidence: 0.85,
      method: "heuristic",
    };
    expect(formatToneLabel(result)).toBe("Formal 85%");
  });

  it("toneEmoji returns a string for each tone", () => {
    const tones = ["formal", "casual", "urgent", "apologetic", "neutral"] as const;
    for (const t of tones) {
      expect(typeof toneEmoji(t)).toBe("string");
      expect(toneEmoji(t).length).toBeGreaterThan(0);
    }
  });
});

// ─── ContextLearner Tests ─────────────────────────────────────────────────────

describe("ContextLearner – buildProfile", () => {
  const userEmail = "alice@example.com";

  beforeEach(() => deleteProfile(userEmail));

  it("builds a profile from sent emails", () => {
    const emails = makeSentEmails(5);
    const profile = buildProfile(userEmail, emails);
    expect(profile.userEmail).toBe(userEmail);
    expect(profile.recipientProfiles.size).toBeGreaterThan(0);
    expect(profile.vocabulary.size).toBeGreaterThan(0);
  });

  it("extracts phrases with minimum frequency", () => {
    // All emails contain "find attached" twice each → should be in phrases.
    const emails = makeSentEmails(6);
    const profile = buildProfile(userEmail, emails, { minPhraseFrequency: 2 });
    // Phrases should be an array.
    expect(Array.isArray(profile.phrases)).toBe(true);
  });

  it("builds per-recipient profiles with greetings", () => {
    const emails = makeSentEmails(3);
    const profile = buildProfile(userEmail, emails);
    const rp = profile.recipientProfiles.get("rahul@acme.com");
    expect(rp).toBeDefined();
    expect(rp!.emailCount).toBe(3);
  });

  it("computes formality score in [0, 1]", () => {
    const emails = makeSentEmails(4);
    const profile = buildProfile(userEmail, emails);
    expect(profile.formality).toBeGreaterThanOrEqual(0);
    expect(profile.formality).toBeLessThanOrEqual(1);
  });

  it("computes avgSentenceLength > 0", () => {
    const profile = buildProfile(userEmail, makeSentEmails(2));
    expect(profile.avgSentenceLength).toBeGreaterThan(0);
  });

  it("generates calendar slots for weekdays only", () => {
    const profile = buildProfile(userEmail, makeSentEmails(3));
    const hasWeekendSlot = profile.calendarSlots.some((s) => {
      const d = new Date(s.date);
      return d.getDay() === 0 || d.getDay() === 6;
    });
    expect(hasWeekendSlot).toBe(false);
  });

  it("respects vocabularyCap", () => {
    const emails = makeSentEmails(10);
    const profile = buildProfile(userEmail, emails, { vocabularyCap: 20 });
    expect(profile.vocabulary.size).toBeLessThanOrEqual(20);
  });
});

describe("ContextLearner – getProfile / updateProfileWithEmail", () => {
  const userEmail = "bob@example.com";

  beforeEach(() => deleteProfile(userEmail));

  it("returns null before profile is built", () => {
    expect(getProfile(userEmail)).toBeNull();
  });

  it("returns profile after building", () => {
    buildProfile(userEmail, makeSentEmails(2));
    expect(getProfile(userEmail)).not.toBeNull();
  });

  it("updateProfileWithEmail bootstraps when no profile exists", () => {
    const email: SentEmail = {
      sentAt: new Date().toISOString(),
      to: "carol@example.com",
      toName: "Carol",
      subject: "Hello",
      body: "Hi Carol,\n\nJust testing.\n\nBest regards,\nBob",
    };
    const profile = updateProfileWithEmail(userEmail, email);
    expect(profile.userEmail).toBe(userEmail);
  });

  it("updateProfileWithEmail increments email count", () => {
    buildProfile(userEmail, makeSentEmails(2));
    const newEmail: SentEmail = {
      sentAt: new Date().toISOString(),
      to: "rahul@acme.com",
      toName: "Rahul Sharma",
      subject: "Follow up",
      body: "Hi Rahul,\n\nJust following up.\n\nBest regards,\nBob",
    };
    const updated = updateProfileWithEmail(userEmail, newEmail);
    const rp = updated.recipientProfiles.get("rahul@acme.com");
    expect(rp!.emailCount).toBe(3); // 2 from setup + 1 new
  });
});

describe("ContextLearner – suggestion helpers", () => {
  const userEmail = "diana@example.com";

  beforeEach(() => {
    deleteProfile(userEmail);
    buildProfile(userEmail, makeSentEmails(3));
  });

  it("suggestGreeting returns a string", () => {
    const greeting = suggestGreeting(userEmail, "rahul@acme.com");
    expect(typeof greeting).toBe("string");
    expect(greeting.length).toBeGreaterThan(0);
  });

  it("suggestGreeting uses fallback when no profile", () => {
    const greeting = suggestGreeting("unknown@example.com", "anyone@example.com", "Hello,");
    expect(greeting).toBe("Hello,");
  });

  it("suggestSignOff returns a string", () => {
    const signOff = suggestSignOff(userEmail, "rahul@acme.com");
    expect(typeof signOff).toBe("string");
  });

  it("suggestMeetingSlots returns an array", () => {
    const slots = suggestMeetingSlots(userEmail, 3);
    expect(Array.isArray(slots)).toBe(true);
  });

  it("suggestMeetingSlots returns empty array for unknown user", () => {
    expect(suggestMeetingSlots("nobody@example.com", 3)).toHaveLength(0);
  });
});

describe("ContextLearner – serialisation", () => {
  const userEmail = "eve@example.com";

  beforeEach(() => deleteProfile(userEmail));

  it("serialises and deserialises a profile round-trip", () => {
    const profile = buildProfile(userEmail, makeSentEmails(3));
    const serialised = serialiseProfile(profile);
    const restored = deserialiseProfile(serialised as Record<string, unknown>);

    expect(restored.userEmail).toBe(profile.userEmail);
    expect(restored.formality).toBeCloseTo(profile.formality, 5);
    expect(restored.phrases.length).toBe(profile.phrases.length);
    expect(restored.vocabulary.size).toBe(profile.vocabulary.size);
    expect(restored.recipientProfiles.size).toBe(profile.recipientProfiles.size);
  });

  it("buildContextSummary returns a non-empty string", () => {
    buildProfile(userEmail, makeSentEmails(3));
    const summary = buildContextSummary(userEmail, {
      name: "Rahul",
      email: "rahul@acme.com",
    });
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });

  it("buildContextSummary returns empty string when no profile", () => {
    const summary = buildContextSummary("ghost@example.com", {
      name: "X",
      email: "x@example.com",
    });
    expect(summary).toBe("");
  });
});
