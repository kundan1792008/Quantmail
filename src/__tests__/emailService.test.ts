import { describe, it, expect, beforeEach } from "vitest";
import {
  sendEmail,
  sendInboxNotification,
  getMockSentEmails,
  clearMockSentEmails,
  mockEmailProvider,
} from "../services/emailService";

describe("mockEmailProvider", () => {
  beforeEach(() => {
    clearMockSentEmails();
  });

  it("should return success for a valid email", async () => {
    const result = await mockEmailProvider.send({
      to: "user@example.com",
      subject: "Hello",
      text: "World",
    });
    expect(result.success).toBe(true);
    expect(result.provider).toBe("mock");
    expect(result.messageId).toBeDefined();
  });

  it("should capture sent emails for inspection", async () => {
    await mockEmailProvider.send({
      to: "a@example.com",
      subject: "Test",
      text: "Body",
    });
    const sent = getMockSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.to).toBe("a@example.com");
  });

  it("should accumulate multiple sent emails", async () => {
    await mockEmailProvider.send({ to: "a@test.com", subject: "1", text: "x" });
    await mockEmailProvider.send({ to: "b@test.com", subject: "2", text: "y" });
    expect(getMockSentEmails()).toHaveLength(2);
  });

  it("clearMockSentEmails should empty the log", async () => {
    await mockEmailProvider.send({ to: "a@test.com", subject: "1", text: "x" });
    clearMockSentEmails();
    expect(getMockSentEmails()).toHaveLength(0);
  });
});

describe("sendEmail (default provider – mock in test env)", () => {
  beforeEach(() => {
    clearMockSentEmails();
  });

  it("should send an email successfully", async () => {
    const result = await sendEmail({
      to: "inbox@quantmail.com",
      subject: "Phase 4",
      text: "Integration complete",
    });
    expect(result.success).toBe(true);
  });
});

describe("sendInboxNotification", () => {
  beforeEach(() => {
    clearMockSentEmails();
  });

  it("should send a notification email to the recipient", async () => {
    const result = await sendInboxNotification(
      "user@quantmail.com",
      "sender@corp.com",
      "Important Update"
    );
    expect(result.success).toBe(true);
    const sent = getMockSentEmails();
    expect(sent[0]?.message.to).toBe("user@quantmail.com");
    expect(sent[0]?.message.subject).toContain("Important Update");
  });

  it("should include sender information in the email body", async () => {
    await sendInboxNotification(
      "user@quantmail.com",
      "boss@corp.com",
      "Q4 Review"
    );
    const sent = getMockSentEmails();
    expect(sent[0]?.message.text).toContain("boss@corp.com");
  });
});
