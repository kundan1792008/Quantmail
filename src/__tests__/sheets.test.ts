import { describe, it, expect } from "vitest";
import {
  processSheetCommand,
  parseColumnFromCommand,
  parseTargetCellFromCommand,
  parseCellAssignment,
  parseMultiplier,
  detectOperation,
  getColumnValues,
  findNextEmptyCell,
  isValidSheetState,
  getColumnHeaders,
  type SheetState,
} from "../services/sheetsService";

// ─── parseColumnFromCommand ──────────────────────────────────────────────────

describe("parseColumnFromCommand", () => {
  it("extracts column letter from 'column X' syntax", () => {
    expect(parseColumnFromCommand("sum column B and put in B10")).toBe("B");
    expect(parseColumnFromCommand("average column C")).toBe("C");
  });

  it("extracts column letter from 'col X' shorthand", () => {
    expect(parseColumnFromCommand("sum col D")).toBe("D");
  });

  it("extracts column from 'sum B' shorthand", () => {
    expect(parseColumnFromCommand("sum B")).toBe("B");
    expect(parseColumnFromCommand("average C")).toBe("C");
    expect(parseColumnFromCommand("count A")).toBe("A");
  });

  it("returns null when no column is found", () => {
    expect(parseColumnFromCommand("do something")).toBeNull();
    expect(parseColumnFromCommand("")).toBeNull();
  });

  it("is case-insensitive and returns uppercase", () => {
    expect(parseColumnFromCommand("sum column b")).toBe("B");
    expect(parseColumnFromCommand("SUM COL e")).toBe("E");
  });
});

// ─── parseTargetCellFromCommand ──────────────────────────────────────────────

describe("parseTargetCellFromCommand", () => {
  it("extracts target from 'put the result in B10'", () => {
    expect(parseTargetCellFromCommand("sum column B and put the result in B10")).toBe("B10");
  });

  it("extracts target from 'store in C5'", () => {
    expect(parseTargetCellFromCommand("average column C store in C5")).toBe("C5");
  });

  it("extracts target from 'in D3' at end", () => {
    expect(parseTargetCellFromCommand("sum column A in D3")).toBe("D3");
  });

  it("returns null when no target cell found", () => {
    expect(parseTargetCellFromCommand("sum column B")).toBeNull();
    expect(parseTargetCellFromCommand("")).toBeNull();
  });

  it("returns uppercase cell reference", () => {
    expect(parseTargetCellFromCommand("put result in b10")).toBe("B10");
  });
});

// ─── parseCellAssignment ─────────────────────────────────────────────────────

describe("parseCellAssignment", () => {
  it("parses 'set B5 to 42'", () => {
    expect(parseCellAssignment("set B5 to 42")).toEqual({ cell: "B5", value: "42" });
  });

  it("parses 'set A1 to hello world'", () => {
    expect(parseCellAssignment("set A1 to hello world")).toEqual({
      cell: "A1",
      value: "hello world",
    });
  });

  it("returns null when pattern not found", () => {
    expect(parseCellAssignment("sum column B")).toBeNull();
    expect(parseCellAssignment("")).toBeNull();
  });

  it("returns uppercase cell reference", () => {
    expect(parseCellAssignment("set c3 to 99")).toEqual({ cell: "C3", value: "99" });
  });
});

// ─── parseMultiplier ─────────────────────────────────────────────────────────

describe("parseMultiplier", () => {
  it("parses integer multiplier from 'by 2'", () => {
    expect(parseMultiplier("multiply column A by 2")).toBe(2);
  });

  it("parses float multiplier from 'by 1.5'", () => {
    expect(parseMultiplier("multiply column B by 1.5")).toBe(1.5);
  });

  it("returns null when no multiplier found", () => {
    expect(parseMultiplier("multiply column A")).toBeNull();
    expect(parseMultiplier("sum column B")).toBeNull();
  });
});

// ─── detectOperation ─────────────────────────────────────────────────────────

describe("detectOperation", () => {
  it("detects 'sum'", () => {
    expect(detectOperation("sum column B")).toBe("sum");
    expect(detectOperation("SUM COLUMN B")).toBe("sum");
  });

  it("detects 'average' and aliases", () => {
    expect(detectOperation("average column C")).toBe("average");
    expect(detectOperation("avg C")).toBe("average");
    expect(detectOperation("mean of column A")).toBe("average");
  });

  it("detects 'count'", () => {
    expect(detectOperation("count column A")).toBe("count");
  });

  it("detects 'clear' and aliases", () => {
    expect(detectOperation("clear column D")).toBe("clear");
    expect(detectOperation("delete column E")).toBe("clear");
    expect(detectOperation("erase column F")).toBe("clear");
  });

  it("detects 'set'", () => {
    expect(detectOperation("set B5 to 10")).toBe("set");
  });

  it("detects 'multiply' and alias", () => {
    expect(detectOperation("multiply column A by 3")).toBe("multiply");
    expect(detectOperation("times column A by 2")).toBe("multiply");
  });

  it("detects 'min' and 'max'", () => {
    expect(detectOperation("min of column B")).toBe("min");
    expect(detectOperation("max column C")).toBe("max");
    expect(detectOperation("minimum column A")).toBe("min");
    expect(detectOperation("maximum column B")).toBe("max");
  });

  it("returns 'unknown' for unrecognised commands", () => {
    expect(detectOperation("do something weird")).toBe("unknown");
  });
});

// ─── getColumnValues ─────────────────────────────────────────────────────────

describe("getColumnValues", () => {
  const state: SheetState = {
    A1: 10,
    A2: 20,
    A3: "30",
    A4: "hello",
    B1: 5,
  };

  it("returns numeric values from a column", () => {
    const values = getColumnValues(state, "A");
    expect(values).toHaveLength(3);
    expect(values.map((v) => v.value)).toEqual([10, 20, 30]);
  });

  it("ignores non-numeric cells", () => {
    const values = getColumnValues(state, "A");
    const cells = values.map((v) => v.cell);
    expect(cells).not.toContain("A4");
  });

  it("returns empty array for a column with no numeric data", () => {
    expect(getColumnValues(state, "Z")).toHaveLength(0);
  });

  it("is case-insensitive for column letter", () => {
    const upper = getColumnValues(state, "A");
    const lower = getColumnValues(state, "a");
    expect(upper).toEqual(lower);
  });
});

// ─── findNextEmptyCell ───────────────────────────────────────────────────────

describe("findNextEmptyCell", () => {
  it("returns row 1 for an empty column", () => {
    expect(findNextEmptyCell({}, "A")).toBe("A1");
  });

  it("returns the row after the last populated row", () => {
    const state: SheetState = { A1: 1, A2: 2, A3: 3 };
    expect(findNextEmptyCell(state, "A")).toBe("A4");
  });

  it("ignores gaps — uses last populated row", () => {
    const state: SheetState = { A1: 1, A3: 3 }; // A2 is empty
    expect(findNextEmptyCell(state, "A")).toBe("A4");
  });
});

// ─── isValidSheetState ───────────────────────────────────────────────────────

describe("isValidSheetState", () => {
  it("accepts valid cell-keyed objects", () => {
    expect(isValidSheetState({ A1: 10, B2: "hello", C10: 3.14 })).toBe(true);
  });

  it("rejects objects with invalid keys", () => {
    expect(isValidSheetState({ AA1: 10 })).toBe(false);
    expect(isValidSheetState({ "1A": 10 })).toBe(false);
    expect(isValidSheetState({ hello: 10 })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isValidSheetState(null)).toBe(false);
    expect(isValidSheetState([1, 2, 3])).toBe(false);
    expect(isValidSheetState("string")).toBe(false);
  });

  it("accepts empty object", () => {
    expect(isValidSheetState({})).toBe(true);
  });
});

// ─── getColumnHeaders ────────────────────────────────────────────────────────

describe("getColumnHeaders", () => {
  it("returns 10 headers by default", () => {
    const headers = getColumnHeaders();
    expect(headers).toHaveLength(10);
    expect(headers[0]).toBe("A");
    expect(headers[9]).toBe("J");
  });

  it("respects count parameter", () => {
    expect(getColumnHeaders(3)).toEqual(["A", "B", "C"]);
    expect(getColumnHeaders(1)).toEqual(["A"]);
    expect(getColumnHeaders(26)).toHaveLength(26);
  });
});

// ─── processSheetCommand ─────────────────────────────────────────────────────

describe("processSheetCommand — sum", () => {
  const state: SheetState = { B1: 10, B2: 20, B3: 30 };

  it("sums a column and writes to the explicit target cell", () => {
    const result = processSheetCommand(state, "Sum column B and put the result in B10");
    expect(result.operation).toBe("sum");
    expect(result.updatedState["B10"]).toBe(60);
    expect(result.targetCell).toBe("B10");
    expect(result.explanation).toContain("60");
  });

  it("sums a column and writes to the next empty cell when no target given", () => {
    const result = processSheetCommand(state, "Sum column B");
    expect(result.operation).toBe("sum");
    expect(result.updatedState["B4"]).toBe(60);
    expect(result.targetCell).toBe("B4");
  });

  it("returns explanation when no numeric data in column", () => {
    const result = processSheetCommand({ A1: "hello" }, "sum column A");
    expect(result.updatedState["A1"]).toBe("hello");
    expect(result.explanation).toMatch(/no numeric/i);
  });
});

describe("processSheetCommand — average", () => {
  const state: SheetState = { C1: 10, C2: 20, C3: 30 };

  it("computes average of a column", () => {
    const result = processSheetCommand(state, "average column C");
    expect(result.operation).toBe("average");
    expect(result.updatedState["C4"]).toBe(20);
  });

  it("supports 'avg' alias", () => {
    const result = processSheetCommand(state, "avg C in C10");
    expect(result.updatedState["C10"]).toBe(20);
  });
});

describe("processSheetCommand — count", () => {
  it("counts numeric cells in a column", () => {
    const state: SheetState = { A1: 1, A2: 2, A3: "text", A4: 3 };
    const result = processSheetCommand(state, "count column A");
    expect(result.operation).toBe("count");
    expect(result.updatedState["A5"]).toBe(3);
  });
});

describe("processSheetCommand — min/max", () => {
  const state: SheetState = { D1: 5, D2: 1, D3: 9 };

  it("finds min of a column", () => {
    const result = processSheetCommand(state, "min of column D");
    expect(result.operation).toBe("min");
    expect(result.updatedState["D4"]).toBe(1);
  });

  it("finds max of a column", () => {
    const result = processSheetCommand(state, "max column D");
    expect(result.operation).toBe("max");
    expect(result.updatedState["D4"]).toBe(9);
  });
});

describe("processSheetCommand — clear", () => {
  it("clears all cells in a column", () => {
    const state: SheetState = { E1: 1, E2: 2, E3: 3, F1: "keep" };
    const result = processSheetCommand(state, "clear column E");
    expect(result.operation).toBe("clear");
    expect(result.updatedState["E1"]).toBeUndefined();
    expect(result.updatedState["E2"]).toBeUndefined();
    expect(result.updatedState["F1"]).toBe("keep");
  });

  it("returns explanation if no column found", () => {
    const result = processSheetCommand({}, "clear");
    expect(result.explanation).toMatch(/could not identify/i);
  });
});

describe("processSheetCommand — set", () => {
  it("sets a cell to a numeric value", () => {
    const result = processSheetCommand({}, "set B5 to 42");
    expect(result.operation).toBe("set");
    expect(result.updatedState["B5"]).toBe(42);
    expect(result.targetCell).toBe("B5");
  });

  it("sets a cell to a string value", () => {
    const result = processSheetCommand({}, "set A1 to hello");
    expect(result.updatedState["A1"]).toBe("hello");
  });

  it("returns error explanation for malformed set command", () => {
    const result = processSheetCommand({}, "set something");
    expect(result.explanation).toMatch(/could not parse/i);
  });
});

describe("processSheetCommand — multiply", () => {
  it("multiplies column values in-place by a factor", () => {
    const state: SheetState = { A1: 2, A2: 3, A3: 4 };
    const result = processSheetCommand(state, "multiply column A by 2");
    expect(result.operation).toBe("multiply");
    expect(result.updatedState["A1"]).toBe(4);
    expect(result.updatedState["A2"]).toBe(6);
    expect(result.updatedState["A3"]).toBe(8);
  });

  it("multiplies into a different column", () => {
    const state: SheetState = { A1: 5, A2: 10 };
    const result = processSheetCommand(state, "multiply column A by 3 and put in column B");
    expect(result.updatedState["B1"]).toBe(15);
    expect(result.updatedState["B2"]).toBe(30);
    // original column A should be unchanged
    expect(result.updatedState["A1"]).toBe(5);
  });
});

describe("processSheetCommand — empty/invalid command", () => {
  it("handles empty command string gracefully", () => {
    const state: SheetState = { A1: 1 };
    const result = processSheetCommand(state, "");
    expect(result.operation).toBe("noop");
    expect(result.updatedState).toEqual(state);
  });

  it("handles whitespace-only command gracefully", () => {
    const result = processSheetCommand({}, "   ");
    expect(result.operation).toBe("noop");
  });

  it("handles unknown operation with a helpful message", () => {
    const result = processSheetCommand({ A1: 1 }, "sort column A");
    expect(result.explanation).toMatch(/unknown/i);
  });
});

describe("processSheetCommand — does not mutate original state", () => {
  it("returns a new state object, not the original", () => {
    const original: SheetState = { A1: 10, A2: 20 };
    const result = processSheetCommand(original, "sum column A");
    expect(result.updatedState).not.toBe(original);
    expect(original["A3"]).toBeUndefined();
  });
});
