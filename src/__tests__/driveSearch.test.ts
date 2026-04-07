import { describe, expect, it } from "vitest";
import {
  semanticSearch,
  MOCK_DRIVE_FILES,
  type DriveFile,
} from "../services/driveSearchService";

describe("semanticSearch", () => {
  it("returns results sorted by descending relevance score", () => {
    const results = semanticSearch("invoice tax", MOCK_DRIVE_FILES);
    expect(results.length).toBeGreaterThan(0);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(
        results[i]!.relevanceScore
      );
    }
  });

  it("finds the tax invoice file for a finance query", () => {
    const results = semanticSearch("invoice from last month");
    const ids = results.map((r) => r.file.id);
    expect(ids).toContain("file-001");
  });

  it("finds the budget forecast for a budget query", () => {
    const results = semanticSearch("budget forecast revenue expenses");
    const ids = results.map((r) => r.file.id);
    expect(ids).toContain("file-004");
  });

  it("finds the investor deck for a fundraising query", () => {
    const results = semanticSearch("investor pitch seed fundraise");
    const ids = results.map((r) => r.file.id);
    expect(ids).toContain("file-009");
  });

  it("finds meeting notes for a meetings query", () => {
    const results = semanticSearch("meeting notes team standup");
    const ids = results.map((r) => r.file.id);
    expect(ids).toContain("file-003");
  });

  it("returns an empty array for a blank query", () => {
    const results = semanticSearch("   ");
    expect(results).toEqual([]);
  });

  it("respects the limit option", () => {
    const results = semanticSearch("document", MOCK_DRIVE_FILES, { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("respects the minScore option and excludes low-scoring files", () => {
    // A very high threshold should return few (or zero) results
    const results = semanticSearch("invoice", MOCK_DRIVE_FILES, {
      minScore: 0.99,
    });
    for (const r of results) {
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0.99);
    }
  });

  it("includes a non-empty matchedSnippet for each result", () => {
    const results = semanticSearch("legal nda contract");
    for (const r of results) {
      expect(r.matchedSnippet.length).toBeGreaterThan(0);
    }
  });

  it("scores are within [0, 1]", () => {
    const results = semanticSearch("product roadmap milestones");
    for (const r of results) {
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(r.relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it("works correctly with a custom file catalogue", () => {
    const customFiles: DriveFile[] = [
      {
        id: "custom-001",
        name: "Cats and Dogs.pdf",
        type: "pdf",
        mimeType: "application/pdf",
        size: 1024,
        modifiedAt: new Date("2026-01-01"),
        tags: ["animals", "pets", "cats", "dogs"],
        snippet: "A study of cat and dog behaviour in urban environments.",
      },
      {
        id: "custom-002",
        name: "Tax Return.pdf",
        type: "pdf",
        mimeType: "application/pdf",
        size: 2048,
        modifiedAt: new Date("2026-02-15"),
        tags: ["tax", "finance", "return"],
        snippet: "Annual tax return filing for FY2025.",
      },
    ];

    const results = semanticSearch("tax finance", customFiles);
    expect(results[0]?.file.id).toBe("custom-002");
  });
});
