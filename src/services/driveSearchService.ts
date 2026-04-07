/**
 * Quantdrive — AI Semantic Search Service
 *
 * Provides a mock semantic search over a catalogue of dummy drive files.
 * When a real vector database (e.g. Pinecone) is integrated, replace
 * `semanticSearch` with actual embedding + cosine-similarity logic.
 */

export type DriveFileType = "folder" | "document" | "spreadsheet" | "image" | "pdf" | "video" | "audio" | "archive";

export interface DriveFile {
  id: string;
  name: string;
  type: DriveFileType;
  mimeType: string;
  /** File size in bytes (undefined for folders) */
  size?: number;
  modifiedAt: Date;
  /** Semantic tags used for mock similarity scoring */
  tags: string[];
  /** A short excerpt / preview of the file content */
  snippet: string;
}

export interface DriveSearchResult {
  file: DriveFile;
  /** Normalised relevance score in [0, 1] */
  relevanceScore: number;
  /** The most relevant excerpt that matched the query */
  matchedSnippet: string;
}

// ---------------------------------------------------------------------------
// Dummy catalogue
// ---------------------------------------------------------------------------

export const MOCK_DRIVE_FILES: DriveFile[] = [
  {
    id: "file-001",
    name: "Q1 Tax Invoice — April 2025.pdf",
    type: "pdf",
    mimeType: "application/pdf",
    size: 204_800,
    modifiedAt: new Date("2025-04-15T09:30:00.000Z"),
    tags: ["tax", "invoice", "finance", "q1", "april", "2025", "payment"],
    snippet:
      "Invoice #INV-2025-0412 — Total due: $4,200.00. Tax reference: TXN-9921. Payment deadline: 30 April 2025.",
  },
  {
    id: "file-002",
    name: "Project Alpha — Design Brief.docx",
    type: "document",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 87_040,
    modifiedAt: new Date("2025-06-01T14:00:00.000Z"),
    tags: [
      "project",
      "alpha",
      "design",
      "brief",
      "ui",
      "ux",
      "wireframe",
      "scope",
    ],
    snippet:
      "This brief outlines the design requirements for Project Alpha. Core deliverables include responsive wireframes, a component library, and accessibility audit.",
  },
  {
    id: "file-003",
    name: "Team Meeting Notes — March 2025.docx",
    type: "document",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 43_520,
    modifiedAt: new Date("2025-03-20T11:15:00.000Z"),
    tags: [
      "meeting",
      "notes",
      "team",
      "march",
      "2025",
      "standup",
      "retrospective",
    ],
    snippet:
      "Discussed Q1 retrospective findings. Action items: migrate CI pipeline by end of month, review hiring plan for Q2.",
  },
  {
    id: "file-004",
    name: "Budget Forecast FY2026.xlsx",
    type: "spreadsheet",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 128_000,
    modifiedAt: new Date("2025-07-10T08:45:00.000Z"),
    tags: [
      "budget",
      "forecast",
      "finance",
      "fy2026",
      "spreadsheet",
      "revenue",
      "expenses",
    ],
    snippet:
      "FY2026 projected revenue: $2.4M. Operating expenses capped at $1.1M. EBITDA target: 35%.",
  },
  {
    id: "file-005",
    name: "Product Roadmap 2025–2026.pdf",
    type: "pdf",
    mimeType: "application/pdf",
    size: 512_000,
    modifiedAt: new Date("2025-05-22T16:00:00.000Z"),
    tags: [
      "roadmap",
      "product",
      "2025",
      "2026",
      "milestones",
      "features",
      "launch",
    ],
    snippet:
      "Phase 1 (Q3 2025): Core authentication & inbox. Phase 2 (Q4 2025): Calendar, Drive, and AI assistant integrations. Phase 3 (Q1 2026): Mobile native wrap.",
  },
  {
    id: "file-006",
    name: "Brand Assets",
    type: "folder",
    mimeType: "application/x-directory",
    modifiedAt: new Date("2025-08-05T10:00:00.000Z"),
    tags: ["brand", "assets", "logo", "design", "marketing"],
    snippet: "Contains logo files, colour palettes, typography guidelines.",
  },
  {
    id: "file-007",
    name: "User Research — Interview Transcripts.docx",
    type: "document",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 320_000,
    modifiedAt: new Date("2025-09-14T13:30:00.000Z"),
    tags: [
      "user",
      "research",
      "interview",
      "ux",
      "feedback",
      "pain points",
      "onboarding",
    ],
    snippet:
      'Participant P-07: "The onboarding flow is confusing — I could not find where to import my existing emails." Common theme: discoverability of advanced features.',
  },
  {
    id: "file-008",
    name: "Server Architecture Diagram.png",
    type: "image",
    mimeType: "image/png",
    size: 2_048_000,
    modifiedAt: new Date("2025-10-03T09:00:00.000Z"),
    tags: ["architecture", "server", "diagram", "infrastructure", "backend"],
    snippet:
      "High-level system diagram showing microservices, message queues, and database clusters.",
  },
  {
    id: "file-009",
    name: "Investor Deck — Seed Round.pdf",
    type: "pdf",
    mimeType: "application/pdf",
    size: 7_340_032,
    modifiedAt: new Date("2025-11-20T17:00:00.000Z"),
    tags: [
      "investor",
      "deck",
      "seed",
      "fundraise",
      "pitch",
      "startup",
      "valuation",
    ],
    snippet:
      "Slide 8: Addressable market — $48B by 2028. Slide 12: Traction — 10 K beta users, 42% week-over-week growth.",
  },
  {
    id: "file-010",
    name: "Legal — NDA Template.docx",
    type: "document",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 65_536,
    modifiedAt: new Date("2025-12-01T12:00:00.000Z"),
    tags: ["legal", "nda", "contract", "agreement", "confidentiality"],
    snippet:
      "This Non-Disclosure Agreement is entered into between [Party A] and [Party B] for the purpose of protecting confidential information.",
  },
  {
    id: "file-011",
    name: "Analytics Dashboard — Weekly Report.xlsx",
    type: "spreadsheet",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 95_232,
    modifiedAt: new Date("2025-12-10T08:00:00.000Z"),
    tags: [
      "analytics",
      "dashboard",
      "weekly",
      "report",
      "kpi",
      "metrics",
      "growth",
    ],
    snippet:
      "Weekly active users: 8,412 (+12%). Email send volume: 1.2M. Average session duration: 7m 34s.",
  },
  {
    id: "file-012",
    name: "Hiring Plan Q1 2026.pdf",
    type: "pdf",
    mimeType: "application/pdf",
    size: 153_600,
    modifiedAt: new Date("2026-01-05T10:30:00.000Z"),
    tags: ["hiring", "plan", "q1", "2026", "recruitment", "headcount", "hr"],
    snippet:
      "Q1 2026 target: 6 new hires across Engineering (×4), Design (×1), and Growth (×1). Budget allocated: $480K.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "of", "to", "and",
  "or", "for", "with", "by", "from", "be", "was", "are", "were", "that",
  "this", "i", "me", "my", "we", "you", "your", "he", "she", "they",
  "find", "show", "get", "give", "look", "search", "where", "what",
  "which", "some", "any", "all", "as", "do", "did", "does", "have",
  "has", "had",
]);

/** Tokenise a string into lower-case, non-stop-word terms. */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Computes a mock semantic similarity score between a query and a file.
 *
 * Strategy (in place of a real embedding model):
 *   1. Extract tokens from the query.
 *   2. Check how many tokens appear in the file's name, tags, and snippet.
 *   3. Normalise by query token count to produce a [0, 1] score.
 *   4. Give a small bonus for recency (files modified in the last 6 months).
 */
function scoreFile(queryTokens: string[], file: DriveFile): number {
  if (queryTokens.length === 0) return 0;

  const corpus =
    `${file.name} ${file.tags.join(" ")} ${file.snippet}`.toLowerCase();

  let hits = 0;
  for (const token of queryTokens) {
    if (corpus.includes(token)) hits += 1;
  }

  let score = hits / queryTokens.length;

  // Recency bonus — up to +0.10 for very recent files
  const ageMs = Date.now() - file.modifiedAt.getTime();
  const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
  if (ageMs < sixMonthsMs) {
    score += 0.1 * (1 - ageMs / sixMonthsMs);
  }

  return Math.min(score, 1);
}

/**
 * Finds the most relevant sentence in the file's snippet for the query.
 */
function extractMatchedSnippet(queryTokens: string[], file: DriveFile): string {
  const sentences = file.snippet
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 0);

  let bestSentence = file.snippet.slice(0, 120);
  let bestHits = -1;

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const hits = queryTokens.filter((t) => lower.includes(t)).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestSentence = sentence;
    }
  }

  return bestSentence;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SemanticSearchOptions {
  /** Minimum relevance score to include in results (default 0.1) */
  minScore?: number;
  /** Maximum number of results to return (default 10) */
  limit?: number;
}

/**
 * Runs a mock semantic search over the drive file catalogue.
 *
 * @param query  Natural language search query.
 * @param files  File catalogue to search (defaults to `MOCK_DRIVE_FILES`).
 * @param opts   Optional tuning parameters.
 * @returns      Results sorted by descending relevance score.
 */
export function semanticSearch(
  query: string,
  files: DriveFile[] = MOCK_DRIVE_FILES,
  opts: SemanticSearchOptions = {}
): DriveSearchResult[] {
  const minScore = opts.minScore ?? 0.1;
  const limit = opts.limit ?? 10;

  const queryTokens = tokenise(query);

  if (queryTokens.length === 0) {
    return [];
  }

  const scored: DriveSearchResult[] = [];

  for (const file of files) {
    const relevanceScore = scoreFile(queryTokens, file);
    if (relevanceScore >= minScore) {
      scored.push({
        file,
        relevanceScore: Math.round(relevanceScore * 1000) / 1000,
        matchedSnippet: extractMatchedSnippet(queryTokens, file),
      });
    }
  }

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored.slice(0, limit);
}
