/**
 * Quantsheets Service
 *
 * Provides NLP-based formula processing for the AI Smart Spreadsheet module.
 * Supports natural language commands like:
 *   - "sum column B and put the result in B10"
 *   - "average column C"
 *   - "count column A"
 *   - "clear column D"
 *   - "set B5 to 42"
 *   - "multiply column A by 2 and put in column B"
 */

export type SheetState = Record<string, string | number>;

export type ProcessResult = {
  updatedState: SheetState;
  explanation: string;
  targetCell: string | null;
  operation: string;
};

const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_ROWS = 100;

/**
 * Parses a column letter from a command string.
 * Returns the uppercase column letter, or null if not found.
 */
export function parseColumnFromCommand(command: string): string | null {
  // Match "column X" or "col X" patterns
  const match = /\bcolumn\s+([A-Za-z])\b|\bcol\s+([A-Za-z])\b/i.exec(command);
  if (match) {
    return (match[1] ?? match[2]).toUpperCase();
  }
  // Match standalone single letter like "sum B" or "average C"
  const letterMatch = /\b(sum|average|avg|count|clear|multiply)\s+([A-Za-z])\b/i.exec(command);
  if (letterMatch) {
    return letterMatch[2].toUpperCase();
  }
  return null;
}

/**
 * Parses a target cell reference (e.g., "B10") from a command string.
 * Returns the uppercase cell reference, or null if not found.
 */
export function parseTargetCellFromCommand(command: string): string | null {
  // Match "put ... in B10", "store in C5", "result in A1", "into D3"
  const match = /(?:put|store|result|place|into|in)\s+(?:the\s+result\s+)?(?:in\s+)?([A-Za-z]\d{1,3})\b/i.exec(command);
  if (match) {
    return match[1].toUpperCase();
  }
  // Match "in B10" at end of command
  const endMatch = /\bin\s+([A-Za-z]\d{1,3})\s*$/i.exec(command);
  if (endMatch) {
    return endMatch[1].toUpperCase();
  }
  return null;
}

/**
 * Parses a specific cell reference from a command like "set B5 to 42".
 */
export function parseCellAssignment(
  command: string
): { cell: string; value: string } | null {
  const match = /\bset\s+([A-Za-z]\d{1,3})\s+to\s+(.+)/i.exec(command);
  if (match) {
    return { cell: match[1].toUpperCase(), value: match[2].trim() };
  }
  return null;
}

/**
 * Parses a multiplier from a command like "multiply column A by 2".
 */
export function parseMultiplier(command: string): number | null {
  const match = /\bby\s+([\d.]+)\b/i.exec(command);
  if (match) {
    const val = parseFloat(match[1]);
    return isNaN(val) ? null : val;
  }
  return null;
}

/**
 * Parses a second column target for operations like "put in column B".
 */
export function parseTargetColumnFromCommand(command: string): string | null {
  const match = /(?:put|store|result|place|into)\s+(?:in\s+)?column\s+([A-Za-z])\b/i.exec(command);
  if (match) {
    return match[1].toUpperCase();
  }
  return null;
}

/**
 * Gets all numeric values in a given column from the sheet state.
 */
export function getColumnValues(
  state: SheetState,
  col: string
): { cell: string; value: number }[] {
  const upperCol = col.toUpperCase();
  const results: { cell: string; value: number }[] = [];
  for (let row = 1; row <= MAX_ROWS; row++) {
    const cell = `${upperCol}${row}`;
    const raw = state[cell];
    if (raw !== undefined && raw !== null && raw !== "") {
      const num = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!isNaN(num)) {
        results.push({ cell, value: num });
      }
    }
  }
  return results;
}

/**
 * Finds the first empty cell in a column after its last filled row.
 */
export function findNextEmptyCell(state: SheetState, col: string): string {
  const upperCol = col.toUpperCase();
  let lastRow = 0;
  for (let row = 1; row <= MAX_ROWS; row++) {
    const cell = `${upperCol}${row}`;
    if (state[cell] !== undefined && state[cell] !== null && state[cell] !== "") {
      lastRow = row;
    }
  }
  return `${upperCol}${lastRow + 1}`;
}

/**
 * Detects the primary operation keyword from a command string.
 */
export function detectOperation(command: string): string {
  const lower = command.toLowerCase();
  if (/\bsum\b/.test(lower)) return "sum";
  if (/\baverage\b|\bavg\b|\bmean\b/.test(lower)) return "average";
  if (/\bcount\b/.test(lower)) return "count";
  if (/\bclear\b|\bdelete\b|\berase\b/.test(lower)) return "clear";
  if (/\bset\b/.test(lower)) return "set";
  if (/\bmultiply\b|\btimes\b/.test(lower)) return "multiply";
  if (/\bmin\b|\bminimum\b/.test(lower)) return "min";
  if (/\bmax\b|\bmaximum\b/.test(lower)) return "max";
  return "unknown";
}

/**
 * Main entry point: processes a natural language command against the current
 * sheet state and returns an updated state plus a human-readable explanation.
 */
export function processSheetCommand(
  state: SheetState,
  command: string
): ProcessResult {
  if (!command || command.trim().length === 0) {
    return {
      updatedState: state,
      explanation: "No command provided.",
      targetCell: null,
      operation: "noop",
    };
  }

  const operation = detectOperation(command);
  const updatedState: SheetState = { ...state };

  if (operation === "set") {
    const assignment = parseCellAssignment(command);
    if (!assignment) {
      return {
        updatedState,
        explanation: 'Could not parse "set" command. Try: "set B5 to 42".',
        targetCell: null,
        operation,
      };
    }
    const numVal = parseFloat(assignment.value);
    updatedState[assignment.cell] = isNaN(numVal) ? assignment.value : numVal;
    return {
      updatedState,
      explanation: `Set cell ${assignment.cell} to ${assignment.value}.`,
      targetCell: assignment.cell,
      operation,
    };
  }

  if (operation === "clear") {
    const col = parseColumnFromCommand(command);
    if (!col) {
      return {
        updatedState,
        explanation: 'Could not identify column to clear. Try: "clear column B".',
        targetCell: null,
        operation,
      };
    }
    let cleared = 0;
    for (const key of Object.keys(updatedState)) {
      if (key.startsWith(col) && /^[A-Z]\d+$/.test(key)) {
        delete updatedState[key];
        cleared++;
      }
    }
    return {
      updatedState,
      explanation: `Cleared ${cleared} cell(s) in column ${col}.`,
      targetCell: null,
      operation,
    };
  }

  if (operation === "multiply") {
    const sourceCol = parseColumnFromCommand(command);
    if (!sourceCol) {
      return {
        updatedState,
        explanation: 'Could not identify column to multiply. Try: "multiply column A by 2 and put in column B".',
        targetCell: null,
        operation,
      };
    }
    const multiplier = parseMultiplier(command);
    if (multiplier === null) {
      return {
        updatedState,
        explanation: 'Could not identify multiplier. Try: "multiply column A by 2".',
        targetCell: null,
        operation,
      };
    }
    const destCol = parseTargetColumnFromCommand(command) ?? sourceCol;
    const entries = getColumnValues(state, sourceCol);
    for (const { cell, value } of entries) {
      const rowNum = parseInt(cell.slice(1), 10);
      const destCell = `${destCol}${rowNum}`;
      updatedState[destCell] = parseFloat((value * multiplier).toFixed(10));
    }
    return {
      updatedState,
      explanation: `Multiplied ${entries.length} value(s) in column ${sourceCol} by ${multiplier}${destCol !== sourceCol ? ` and stored in column ${destCol}` : ""}.`,
      targetCell: null,
      operation,
    };
  }

  // sum / average / count / min / max — all aggregate operations
  const col = parseColumnFromCommand(command);
  if (!col) {
    return {
      updatedState,
      explanation: `Could not identify column for "${operation}". Try: "${operation} column B".`,
      targetCell: null,
      operation,
    };
  }

  const entries = getColumnValues(state, col);
  if (entries.length === 0) {
    return {
      updatedState,
      explanation: `No numeric values found in column ${col}.`,
      targetCell: null,
      operation,
    };
  }

  const values = entries.map((e) => e.value);
  let result: number;
  let label: string;

  switch (operation) {
    case "sum": {
      result = values.reduce((a, b) => a + b, 0);
      label = "Sum";
      break;
    }
    case "average": {
      result = values.reduce((a, b) => a + b, 0) / values.length;
      label = "Average";
      break;
    }
    case "count": {
      result = values.length;
      label = "Count";
      break;
    }
    case "min": {
      result = Math.min(...values);
      label = "Min";
      break;
    }
    case "max": {
      result = Math.max(...values);
      label = "Max";
      break;
    }
    default: {
      return {
        updatedState,
        explanation: `Unknown operation: "${operation}". Supported: sum, average, count, min, max, clear, set, multiply.`,
        targetCell: null,
        operation: "unknown",
      };
    }
  }

  const roundedResult = parseFloat(result.toFixed(10));

  // Determine target cell: explicit in command, or next empty in same column
  const explicitTarget = parseTargetCellFromCommand(command);
  const targetCell = explicitTarget ?? findNextEmptyCell(state, col);

  updatedState[targetCell] = roundedResult;

  return {
    updatedState,
    explanation: `${label} of ${values.length} value(s) in column ${col} = ${roundedResult}. Result written to ${targetCell}.`,
    targetCell,
    operation,
  };
}

/** Validates that a SheetState object has string/number values only. */
export function isValidSheetState(obj: unknown): obj is SheetState {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return false;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!/^[A-Za-z]\d{1,3}$/.test(key)) return false;
    if (typeof value !== "string" && typeof value !== "number") return false;
  }
  return true;
}

/** Returns the list of column letters available in the spreadsheet. */
export function getColumnHeaders(count = 10): string[] {
  return COLUMN_LETTERS.slice(0, count).split("");
}
