import { describe, it, expect } from "vitest";
import {
  extractEventFromEmail,
  generateReportFromSheets,
} from "../services/orchestratorService";

// ─── extractEventFromEmail ────────────────────────────────────────────────────

describe("extractEventFromEmail", () => {
  it("extracts title from explicit 'Meeting:' prefix", () => {
    const body = "Meeting: Q3 Budget Review\nPlease join us tomorrow at 3 PM.";
    const event = extractEventFromEmail(body);
    expect(event.title).toBe("Q3 Budget Review");
  });

  it("extracts title from explicit 'Call:' prefix", () => {
    const body = "Call: Onboarding session\nat 10 AM";
    const event = extractEventFromEmail(body);
    expect(event.title).toBe("Onboarding session");
  });

  it("extracts start time from 'at HH AM/PM' pattern", () => {
    const body = "Team sync at 2 PM tomorrow";
    const event = extractEventFromEmail(body);
    expect(event.startTime).toBeInstanceOf(Date);
    expect(event.startTime.getHours()).toBe(14);
  });

  it("extracts start time from HH:MM pattern", () => {
    const body = "Meeting: Standup\nWe meet at 09:30 every morning";
    const event = extractEventFromEmail(body);
    expect(event.startTime.getHours()).toBe(9);
    expect(event.startTime.getMinutes()).toBe(30);
  });

  it("parses ISO date string in body", () => {
    const body = "Appointment confirmed for 2026-06-15T14:00:00Z";
    const event = extractEventFromEmail(body);
    expect(event.startTime).toBeInstanceOf(Date);
    expect(event.startTime.getFullYear()).toBe(2026);
  });

  it("falls back to tomorrow 09:00 when no date found", () => {
    const body = "Please review the attached document and provide feedback.";
    const event = extractEventFromEmail(body);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(event.startTime.getDate()).toBe(tomorrow.getDate());
    expect(event.startTime.getHours()).toBe(9);
  });

  it("defaults title to first line when no prefix", () => {
    const body = "Project Kick-off\nLet us meet next Monday";
    const event = extractEventFromEmail(body);
    expect(event.title).toBe("Project Kick-off");
  });

  it("sets endTime to startTime + 1 hour", () => {
    const body = "Meeting: Demo\nat 3 PM";
    const event = extractEventFromEmail(body);
    expect(event.endTime).not.toBeNull();
    const diffMs = event.endTime!.getTime() - event.startTime.getTime();
    expect(diffMs).toBe(60 * 60 * 1000);
  });

  it("stores description as truncated email body", () => {
    const body = "a".repeat(1000);
    const event = extractEventFromEmail(body);
    expect(event.description.length).toBeLessThanOrEqual(500);
  });

  it("handles empty string gracefully", () => {
    const event = extractEventFromEmail("");
    expect(event.title).toBeTruthy();
    expect(event.startTime).toBeInstanceOf(Date);
  });
});

// ─── generateReportFromSheets ─────────────────────────────────────────────────

describe("generateReportFromSheets", () => {
  it("generates a report from an array of objects", () => {
    const data = JSON.stringify([
      { product: "Widget A", sales: 100, revenue: 500 },
      { product: "Widget B", sales: 200, revenue: 1000 },
    ]);
    const report = generateReportFromSheets(data);
    expect(report.title).toMatch(/Spreadsheet Report/);
    expect(report.content).toContain("product");
    expect(report.content).toContain("revenue");
    expect(report.content).toContain("sum=1500.00");
  });

  it("generates a report from a 2-D array", () => {
    const data = JSON.stringify([
      ["Name", "Score"],
      ["Alice", 95],
      ["Bob", 80],
    ]);
    const report = generateReportFromSheets(data);
    expect(report.content).toContain("Name");
    expect(report.content).toContain("Score");
    expect(report.content).toContain("avg=87.50");
  });

  it("handles empty array", () => {
    const report = generateReportFromSheets("[]");
    expect(report.content).toContain("No data found");
  });

  it("handles invalid JSON gracefully", () => {
    const report = generateReportFromSheets("{not valid json}");
    expect(report.title).toBe("Spreadsheet Report");
    expect(report.content).toContain("Raw data summary");
  });

  it("includes sample rows (first 5 only)", () => {
    const data = JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({ idx: i, val: i * 2 }))
    );
    const report = generateReportFromSheets(data);
    // Row 5 should appear but Row 6 should not
    expect(report.content).toContain("Row 5");
    expect(report.content).not.toContain("Row 6");
  });

  it("returns non-empty title and content for valid data", () => {
    const data = JSON.stringify([{ x: 1 }, { x: 2 }]);
    const report = generateReportFromSheets(data);
    expect(report.title.length).toBeGreaterThan(0);
    expect(report.content.length).toBeGreaterThan(0);
  });
});
