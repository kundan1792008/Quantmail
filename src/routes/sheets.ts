/**
 * Quantsheets Routes
 *
 * Exposes endpoints for the AI Smart Spreadsheet module:
 *   POST /sheets/process  — Process a natural language command against the
 *                           current spreadsheet state and return the updated
 *                           state with an explanation.
 *   GET  /sheets/columns  — Returns the default column headers (A–J).
 */

import { FastifyInstance } from "fastify";
import {
  processSheetCommand,
  isValidSheetState,
  getColumnHeaders,
  type SheetState,
} from "../services/sheetsService";

export async function sheetsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /sheets/process
   *
   * Body:
   *   state   — Current spreadsheet data, keyed by cell reference (e.g. { "A1": 10, "B1": "hello" })
   *   command — Natural language instruction (e.g. "Sum column B and put the result in B10")
   *
   * Response:
   *   updatedState — New spreadsheet data after applying the command
   *   explanation  — Human-readable description of what was computed
   *   targetCell   — Cell that received the result (null if not applicable)
   *   operation    — Detected operation keyword
   */
  app.post<{
    Body: {
      state: unknown;
      command: string;
    };
  }>("/sheets/process", async (request, reply) => {
    const { state, command } = request.body;

    if (!command || typeof command !== "string") {
      return reply.code(400).send({ error: "command (string) is required" });
    }

    if (command.trim().length > 500) {
      return reply
        .code(400)
        .send({ error: "command must be 500 characters or fewer" });
    }

    // Accept an empty or missing state as an empty spreadsheet
    const normalizedState: SheetState = state === undefined || state === null
      ? {}
      : state as SheetState;

    if (!isValidSheetState(normalizedState) && Object.keys(normalizedState).length > 0) {
      return reply.code(400).send({
        error:
          "state must be an object mapping valid cell references (e.g. \"A1\") to string or number values",
      });
    }

    const result = processSheetCommand(normalizedState, command.trim());

    return reply.code(200).send(result);
  });

  /**
   * GET /sheets/columns
   *
   * Returns the default column headers for the spreadsheet grid (A–J).
   * Accepts an optional `count` query parameter (1–26).
   */
  app.get<{
    Querystring: { count?: string };
  }>("/sheets/columns", async (request, reply) => {
    const rawCount = request.query.count;
    let count = 10;
    if (rawCount !== undefined) {
      const parsed = parseInt(rawCount, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 26) {
        return reply
          .code(400)
          .send({ error: "count must be an integer between 1 and 26" });
      }
      count = parsed;
    }
    return reply.code(200).send({ columns: getColumnHeaders(count) });
  });
}
