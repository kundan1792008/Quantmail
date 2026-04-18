/**
 * Unit tests for ai_core/gemma_engine.ts
 *
 * Covers:
 *  - Pure statistical helpers
 *  - Feature extraction from behaviour patterns
 *  - Rule-based heuristics
 *  - Threat-level mapping
 *  - ModelCacheManager (with mocked Cache API)
 *  - GemmaEngine lifecycle (load, analyzeThreats, dispose)
 *  - Memory budget enforcement
 *  - Error handling for unloaded engine
 *  - dispose() nulls all retained buffers (no memory leak)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  computeMean,
  computeVariance,
  computeEntropy,
  extractFeatures,
  applyHeuristics,
  scoresToLevel,
  ModelCacheManager,
  CpuFallbackBackend,
  GemmaEngine,
  type BehaviorPattern,
  type InferenceBackend,
} from "../../ai_core/gemma_engine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePattern(
  type: BehaviorPattern["type"],
  timestamp: number,
  features: Record<string, number> = {},
): BehaviorPattern {
  return { type, timestamp, features };
}

function makeKeystrokes(count: number, intervalMs: number): BehaviorPattern[] {
  return Array.from({ length: count }, (_, i) =>
    makePattern("keystroke", i * intervalMs, { dwellTimeMs: 80, flightTimeMs: 120 }),
  );
}

// ─── computeMean ─────────────────────────────────────────────────────────────

describe("computeMean", () => {
  it("returns 0 for an empty array", () => {
    expect(computeMean([])).toBe(0);
  });

  it("returns the single element for a one-element array", () => {
    expect(computeMean([42])).toBe(42);
  });

  it("computes the correct mean", () => {
    expect(computeMean([1, 2, 3, 4, 5])).toBe(3);
  });

  it("handles negative values", () => {
    expect(computeMean([-5, 5])).toBe(0);
  });
});

// ─── computeVariance ─────────────────────────────────────────────────────────

describe("computeVariance", () => {
  it("returns 0 for an empty array", () => {
    expect(computeVariance([])).toBe(0);
  });

  it("returns 0 for a single-element array", () => {
    expect(computeVariance([100])).toBe(0);
  });

  it("returns 0 for a constant array", () => {
    expect(computeVariance([5, 5, 5, 5])).toBe(0);
  });

  it("computes population variance correctly", () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → mean 5, variance 4
    expect(computeVariance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4, 5);
  });
});

// ─── computeEntropy ──────────────────────────────────────────────────────────

describe("computeEntropy", () => {
  it("returns 0 for an empty array", () => {
    expect(computeEntropy([])).toBe(0);
  });

  it("returns 0 for a deterministic distribution [1]", () => {
    expect(computeEntropy([1])).toBe(0);
  });

  it("returns maximum entropy for a uniform distribution", () => {
    // Uniform over 4 outcomes → H = log2(4) = 2 bits
    expect(computeEntropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2, 5);
  });

  it("ignores zero-probability events", () => {
    // Same as uniform [0.5, 0.5] → H = 1 bit
    expect(computeEntropy([0.5, 0, 0.5])).toBeCloseTo(1, 5);
  });
});

// ─── extractFeatures ─────────────────────────────────────────────────────────

describe("extractFeatures", () => {
  it("returns a zero vector for an empty pattern list", () => {
    const v = extractFeatures([]);
    expect(v.length).toBe(10);
    for (const x of v) expect(x).toBe(0);
  });

  it("computes correct event-type proportions", () => {
    const patterns: BehaviorPattern[] = [
      makePattern("keystroke", 0),
      makePattern("keystroke", 100),
      makePattern("mouse",     200),
      makePattern("network",   300),
    ];
    const v = extractFeatures(patterns);
    expect(v[2]).toBeCloseTo(0.5);  // keystroke proportion
    expect(v[3]).toBeCloseTo(0.25); // mouse proportion
    expect(v[4]).toBeCloseTo(0.25); // network proportion
    expect(v[5]).toBe(0);           // interaction proportion
  });

  it("computes mean inter-event interval", () => {
    // 5 events 100 ms apart → 4 intervals of 100 ms → mean = 100
    const patterns = makeKeystrokes(5, 100);
    const v = extractFeatures(patterns);
    expect(v[0]).toBeCloseTo(100, 1);
  });

  it("computes zero variance for perfectly uniform intervals", () => {
    const patterns = makeKeystrokes(10, 50);
    const v = extractFeatures(patterns);
    expect(v[1]).toBeCloseTo(0, 5);
  });

  it("computes event rate", () => {
    // 11 events over 1000 ms → 10 events/sec (interval count = 10, each 100 ms)
    const patterns = makeKeystrokes(11, 100);
    const v = extractFeatures(patterns);
    // span = 1000 ms, events = 11 → rate = 11/1000 * 1000 = 11 events/sec
    expect(v[9]).toBeCloseTo(11, 0);
  });

  it("handles a single pattern without crashing", () => {
    const v = extractFeatures([makePattern("mouse", 500, { speedPxPerMs: 2 })]);
    expect(v.length).toBe(10);
    expect(v[0]).toBe(0); // no intervals
  });
});

// ─── applyHeuristics ─────────────────────────────────────────────────────────

describe("applyHeuristics", () => {
  it("returns no signals for an empty pattern list", () => {
    const features = extractFeatures([]);
    expect(applyHeuristics([], features)).toHaveLength(0);
  });

  it("detects SUPERHUMAN_SPEED for sub-10 ms mean intervals", () => {
    // 20 events with 5 ms spacing → mean interval = 5 ms
    const patterns = makeKeystrokes(20, 5);
    const features = extractFeatures(patterns);
    const signals = applyHeuristics(patterns, features);
    const types = signals.map((s) => s.type);
    expect(types).toContain("SUPERHUMAN_SPEED");
  });

  it("detects MECHANICAL_TIMING for near-zero interval variance", () => {
    // 10 events with perfectly uniform 200 ms spacing
    const patterns = makeKeystrokes(10, 200);
    const features = extractFeatures(patterns);
    const signals = applyHeuristics(patterns, features);
    const types = signals.map((s) => s.type);
    expect(types).toContain("MECHANICAL_TIMING");
  });

  it("detects HIGH_EVENT_RATE for > 100 events/sec", () => {
    // 201 events over 1 second → rate > 100 events/sec
    const patterns = Array.from({ length: 201 }, (_, i) =>
      makePattern("mouse", i * 5),
    );
    const features = extractFeatures(patterns);
    const signals = applyHeuristics(patterns, features);
    const types = signals.map((s) => s.type);
    expect(types).toContain("HIGH_EVENT_RATE");
  });

  it("detects HEADLESS_BROWSER_PATTERN for keystroke-only sessions", () => {
    const patterns = makeKeystrokes(15, 300);
    const features = extractFeatures(patterns);
    const signals = applyHeuristics(patterns, features);
    const types = signals.map((s) => s.type);
    expect(types).toContain("HEADLESS_BROWSER_PATTERN");
  });

  it("detects SINGLE_TYPE_STREAM for 20+ single-type events", () => {
    const patterns = makeKeystrokes(25, 300);
    const features = extractFeatures(patterns);
    const signals = applyHeuristics(patterns, features);
    const types = signals.map((s) => s.type);
    expect(types).toContain("SINGLE_TYPE_STREAM");
  });

  it("does not flag legitimate mixed-input patterns", () => {
    // Mix of human-paced keystrokes and mouse events
    const patterns: BehaviorPattern[] = [
      ...makeKeystrokes(5, 300),
      ...Array.from({ length: 5 }, (_, i) =>
        makePattern("mouse", 1500 + i * 400, { speedPxPerMs: 1.5 }),
      ),
    ];
    const features = extractFeatures(patterns);
    const signals = applyHeuristics(patterns, features);
    // None of the bot-specific signals should fire for natural input
    const botTypes = [
      "SUPERHUMAN_SPEED",
      "MECHANICAL_TIMING",
      "HIGH_EVENT_RATE",
    ];
    for (const t of botTypes) {
      expect(signals.map((s) => s.type)).not.toContain(t);
    }
  });

  it("all signals have confidence in [0, 1]", () => {
    const patterns = makeKeystrokes(20, 5);
    const features = extractFeatures(patterns);
    const signals = applyHeuristics(patterns, features);
    for (const s of signals) {
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ─── scoresToLevel ────────────────────────────────────────────────────────────

describe("scoresToLevel", () => {
  it("maps 0 to none", () => expect(scoresToLevel(0)).toBe("none"));
  it("maps 0.14 to none", () => expect(scoresToLevel(0.14)).toBe("none"));
  it("maps 0.15 to low", () => expect(scoresToLevel(0.15)).toBe("low"));
  it("maps 0.34 to low", () => expect(scoresToLevel(0.34)).toBe("low"));
  it("maps 0.35 to medium", () => expect(scoresToLevel(0.35)).toBe("medium"));
  it("maps 0.59 to medium", () => expect(scoresToLevel(0.59)).toBe("medium"));
  it("maps 0.60 to high", () => expect(scoresToLevel(0.60)).toBe("high"));
  it("maps 0.79 to high", () => expect(scoresToLevel(0.79)).toBe("high"));
  it("maps 0.80 to critical", () => expect(scoresToLevel(0.80)).toBe("critical"));
  it("maps 1.0 to critical", () => expect(scoresToLevel(1.0)).toBe("critical"));
});

// ─── CpuFallbackBackend ───────────────────────────────────────────────────────

describe("CpuFallbackBackend", () => {
  it("isAvailable() always returns true", async () => {
    const backend = new CpuFallbackBackend();
    expect(await backend.isAvailable()).toBe(true);
  });

  it("infer() returns a Float32Array of length 5", async () => {
    const backend = new CpuFallbackBackend();
    const features = extractFeatures(makeKeystrokes(5, 100));
    const output = await backend.infer(features);
    expect(output).toBeInstanceOf(Float32Array);
    expect(output.length).toBe(5);
  });

  it("output probabilities sum to approximately 1", async () => {
    const backend = new CpuFallbackBackend();
    const features = extractFeatures(makeKeystrokes(5, 100));
    const output = await backend.infer(features);
    const sum = Array.from(output).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it("all output probabilities are non-negative", async () => {
    const backend = new CpuFallbackBackend();
    const output = await backend.infer(new Float32Array(10).fill(0.5));
    for (const p of output) {
      expect(p).toBeGreaterThanOrEqual(0);
    }
  });

  it("dispose() does not throw", () => {
    const backend = new CpuFallbackBackend();
    expect(() => backend.dispose()).not.toThrow();
  });
});

// ─── ModelCacheManager ───────────────────────────────────────────────────────

describe("ModelCacheManager", () => {
  it("isCacheApiAvailable() returns false when caches is not defined", () => {
    const mgr = new ModelCacheManager();
    expect(mgr.isCacheApiAvailable()).toBe(false);
  });

  it("isCached() returns false when Cache API is unavailable", async () => {
    const mgr = new ModelCacheManager();
    expect(await mgr.isCached("https://example.com/model.gguf")).toBe(false);
  });

  it("getFromCache() returns null when Cache API is unavailable", async () => {
    const mgr = new ModelCacheManager();
    const result = await mgr.getFromCache("https://example.com/model.gguf");
    expect(result).toBeNull();
  });

  describe("with mocked Cache API", () => {
    const MODEL_URL = "https://example.com/model.gguf";
    const MOCK_BUFFER = new ArrayBuffer(1024);

    let mockCache: {
      match: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockCache = {
        match: vi.fn(),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
      };

      vi.stubGlobal("caches", {
        open: vi.fn().mockResolvedValue(mockCache),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("isCacheApiAvailable() returns true when caches is defined", () => {
      const mgr = new ModelCacheManager();
      expect(mgr.isCacheApiAvailable()).toBe(true);
    });

    it("isCached() returns false when cache has no matching entry", async () => {
      mockCache.match.mockResolvedValue(undefined);
      const mgr = new ModelCacheManager();
      expect(await mgr.isCached(MODEL_URL)).toBe(false);
    });

    it("isCached() returns true when cache has a matching entry", async () => {
      mockCache.match.mockResolvedValue(new Response(MOCK_BUFFER));
      const mgr = new ModelCacheManager();
      expect(await mgr.isCached(MODEL_URL)).toBe(true);
    });

    it("getFromCache() returns ArrayBuffer from cached response", async () => {
      mockCache.match.mockResolvedValue(
        new Response(MOCK_BUFFER.slice(0)),
      );
      const mgr = new ModelCacheManager();
      const result = await mgr.getFromCache(MODEL_URL);
      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it("getFromCache() returns null when entry is not cached", async () => {
      mockCache.match.mockResolvedValue(null);
      const mgr = new ModelCacheManager();
      expect(await mgr.getFromCache(MODEL_URL)).toBeNull();
    });

    it("fetchAndCache() stores the fetched buffer in the cache", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(MOCK_BUFFER.slice(0), { status: 200 }),
        ),
      );

      const mgr = new ModelCacheManager();
      const buffer = await mgr.fetchAndCache(MODEL_URL);

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(mockCache.put).toHaveBeenCalledOnce();
    });

    it("fetchAndCache() throws on non-OK HTTP response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
      );

      const mgr = new ModelCacheManager();
      await expect(mgr.fetchAndCache(MODEL_URL)).rejects.toThrow(
        /HTTP 404/,
      );
    });

    it("evict() removes the entry from the cache", async () => {
      const mgr = new ModelCacheManager();
      await mgr.evict(MODEL_URL);
      expect(mockCache.delete).toHaveBeenCalledWith(MODEL_URL);
    });
  });
});

// ─── GemmaEngine ─────────────────────────────────────────────────────────────

/** Minimal mock backend for engine tests. */
function makeMockBackend(
  probabilities = new Float32Array([0.9, 0.05, 0.03, 0.01, 0.01]),
): InferenceBackend {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    infer: vi.fn().mockResolvedValue(probabilities),
    dispose: vi.fn(),
  };
}

/** Mock cache manager that returns a small in-memory buffer. */
function makeMockCacheManager(bufferSize = 1024): ModelCacheManager {
  const buf = new ArrayBuffer(bufferSize);
  const mgr = new ModelCacheManager();
  mgr.getFromCache = vi.fn().mockResolvedValue(buf);
  mgr.fetchAndCache = vi.fn().mockResolvedValue(buf);
  return mgr;
}

describe("GemmaEngine", () => {
  it("isReady() returns false before load()", () => {
    const engine = new GemmaEngine({}, makeMockCacheManager());
    expect(engine.isReady()).toBe(false);
  });

  it("load() sets isReady() to true", async () => {
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(makeMockBackend());
    expect(engine.isReady()).toBe(true);
    engine.dispose();
  });

  it("load() is idempotent", async () => {
    const backend = makeMockBackend();
    const cacheMgr = makeMockCacheManager();
    const engine = new GemmaEngine({}, cacheMgr);

    await engine.load(backend);
    await engine.load(backend); // second call should be a no-op

    expect(cacheMgr.getFromCache).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("analyzeThreats() throws when engine is not loaded", async () => {
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await expect(engine.analyzeThreats([])).rejects.toThrow(
      /not loaded/i,
    );
  });

  it("analyzeThreats() returns a valid ThreatAnalysis for empty patterns", async () => {
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(makeMockBackend());

    const result = await engine.analyzeThreats([]);

    expect(result.patternCount).toBe(0);
    expect(result.threatScore).toBeGreaterThanOrEqual(0);
    expect(result.threatScore).toBeLessThanOrEqual(1);
    expect(["none", "low", "medium", "high", "critical"]).toContain(
      result.threatLevel,
    );
    expect(result.analysisTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.memoryUsedMB).toBeGreaterThan(0);

    engine.dispose();
  });

  it("analyzeThreats() scores benign human-like patterns as low threat", async () => {
    const patterns: BehaviorPattern[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makePattern("keystroke", i * 350, { dwellTimeMs: 80 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makePattern("mouse", 2000 + i * 500, { speedPxPerMs: 1.2 }),
      ),
    ];

    const engine = new GemmaEngine({}, makeMockCacheManager());
    // Backend returns high "none" probability → low ML score
    await engine.load(makeMockBackend(new Float32Array([0.95, 0.03, 0.01, 0.005, 0.005])));

    const result = await engine.analyzeThreats(patterns);

    expect(result.threatScore).toBeLessThan(0.35);
    expect(["none", "low"]).toContain(result.threatLevel);

    engine.dispose();
  });

  it("analyzeThreats() scores bot-like patterns as medium-or-higher threat", async () => {
    // 25 perfectly-timed keystroke events at 5 ms intervals (superhuman speed)
    const patterns = makeKeystrokes(25, 5);

    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(
      makeMockBackend(new Float32Array([0.3, 0.2, 0.2, 0.2, 0.1])),
    );

    const result = await engine.analyzeThreats(patterns);

    expect(result.threatScore).toBeGreaterThanOrEqual(0.35);
    expect(["medium", "high", "critical"]).toContain(result.threatLevel);
    expect(result.signals.length).toBeGreaterThan(0);

    engine.dispose();
  });

  it("analyzeThreats() includes patternCount in the result", async () => {
    const patterns = makeKeystrokes(7, 200);
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(makeMockBackend());
    const result = await engine.analyzeThreats(patterns);
    expect(result.patternCount).toBe(7);
    engine.dispose();
  });

  it("signals are sorted by confidence descending", async () => {
    const patterns = makeKeystrokes(25, 5);
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(makeMockBackend());
    const result = await engine.analyzeThreats(patterns);
    for (let i = 1; i < result.signals.length; i++) {
      expect(result.signals[i - 1].confidence).toBeGreaterThanOrEqual(
        result.signals[i].confidence,
      );
    }
    engine.dispose();
  });

  it("dispose() sets isReady() to false and nulls the backend reference", () => {
    const backend = makeMockBackend();
    const engine = new GemmaEngine({}, makeMockCacheManager());

    engine.dispose();

    expect(engine.isReady()).toBe(false);
    expect(backend.dispose).not.toHaveBeenCalled(); // backend was never set
  });

  it("dispose() calls backend.dispose() after load()", async () => {
    const backend = makeMockBackend();
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(backend);

    engine.dispose();

    expect(backend.dispose).toHaveBeenCalledOnce();
    expect(engine.isReady()).toBe(false);
  });

  it("getMemoryUsageMB() returns > 0 after load()", async () => {
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(makeMockBackend());
    expect(engine.getMemoryUsageMB()).toBeGreaterThan(0);
    engine.dispose();
  });

  it("getMemoryUsageMB() returns ~2 MB (runtime overhead only) after dispose()", async () => {
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(makeMockBackend());
    engine.dispose();
    // Buffer is released; only the fixed 2 MB runtime overhead remains
    expect(engine.getMemoryUsageMB()).toBeCloseTo(2, 0);
  });

  it("load() throws and rolls back when model exceeds maxMemoryMB", async () => {
    // 512 KB mock buffer, but maxMemoryMB = 0 → triggers the budget check
    const largeBuf = new ArrayBuffer(512 * 1024);
    const cacheMgr = new ModelCacheManager();
    cacheMgr.getFromCache = vi.fn().mockResolvedValue(largeBuf);

    const engine = new GemmaEngine({ maxMemoryMB: 0 }, cacheMgr);

    await expect(engine.load(makeMockBackend())).rejects.toThrow(
      /exceeds maxMemoryMB/i,
    );

    // Engine must not be left in a partially-loaded state
    expect(engine.isReady()).toBe(false);
    expect(engine.getMemoryUsageMB()).toBeCloseTo(2, 0);
  });

  it("analyzeThreats() is resilient to backend inference errors", async () => {
    const faultyBackend: InferenceBackend = {
      isAvailable: vi.fn().mockResolvedValue(true),
      infer: vi.fn().mockRejectedValue(new Error("GPU crash")),
      dispose: vi.fn(),
    };

    const patterns = makeKeystrokes(25, 5);
    const engine = new GemmaEngine({}, makeMockCacheManager());
    await engine.load(faultyBackend);

    // Should not throw — heuristic signals still apply
    const result = await engine.analyzeThreats(patterns);
    expect(result).toBeDefined();
    expect(result.signals.length).toBeGreaterThan(0);

    engine.dispose();
  });
});
