/**
 * Unit tests for the behavioral biometrics continuous authentication system.
 *
 * Covers:
 *   - TypingRhythmAnalyzer: DTW algorithm, digraph extraction, profile management
 *   - MouseDynamicsTracker: feature vector extraction, cosine similarity,
 *     impossible-movement detection, signature management
 *   - DeviceSensorAuth: device ID computation, signal scoring, device enrolment
 *   - ContinuousAuth middleware: composite confidence, enforcement rules
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma so the test suite can run without a live database
vi.mock("../db", () => ({
  prisma: {
    securityAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

// ─── TypingRhythmAnalyzer ─────────────────────────────────────────────────────

import {
  computeDTW,
  extractDigraphs,
  ingestKeystrokes,
  compareLiveWindow,
  clearAnomalyState,
  resetProfile,
  getProfileSnapshot,
  getAnomalyState,
  type KeystrokeEvent,
  type Digraph,
} from "../services/TypingRhythmAnalyzer";

// ─── MouseDynamicsTracker ─────────────────────────────────────────────────────

import {
  cosineSimilarity,
  extractFeatureVector,
  countImpossibleMovements,
  ingestMovementWindow,
  resetSignature,
  getSignatureSnapshot,
  FEATURE_VECTOR_SIZE,
  type MovementSample,
  type ClickEvent,
  type ScrollEvent,
  type HoverEvent,
} from "../services/MouseDynamicsTracker";

// ─── DeviceSensorAuth ─────────────────────────────────────────────────────────

import {
  computeDeviceId,
  analyseGyroscope,
  analyseAccelerometer,
  analyseWebGL,
  analyseAudio,
  analyseScreen,
  evaluateDeviceTelemetry,
  enrollDevice,
  revokeDevice,
  getEnrolledDevices,
  type DeviceTelemetry,
  type GyroscopeSample,
  type AccelerometerSample,
} from "../services/DeviceSensorAuth";

// ─── ContinuousAuth ───────────────────────────────────────────────────────────

import {
  computeCompositeConfidence,
  getSessionState,
  updateSessionState,
  clearSessionLock,
} from "../middleware/ContinuousAuth";

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

/** Creates a KeystrokeEvent for a given key, hold time, and start timestamp. */
function makeKeystroke(
  key: string,
  pressedAt: number,
  holdMs: number
): KeystrokeEvent {
  return { key, pressedAt, releasedAt: pressedAt + holdMs };
}

/**
 * Generates a realistic-looking sequence of keystroke events.
 * holdMs and flightMs are applied uniformly for simplicity.
 */
function generateKeystrokes(
  count: number,
  startAt = 0,
  holdMs = 80,
  flightMs = 120
): KeystrokeEvent[] {
  const keys: KeystrokeEvent[] = [];
  let cursor = startAt;
  for (let i = 0; i < count; i++) {
    keys.push({ key: "a", pressedAt: cursor, releasedAt: cursor + holdMs });
    cursor += holdMs + flightMs;
  }
  return keys;
}

/** Creates a MovementSample. */
function makeMovement(x: number, y: number, timestamp: number): MovementSample {
  return { x, y, timestamp };
}

/** Generates a smooth movement sequence. */
function generateMovements(
  count: number,
  startX = 0,
  startY = 0,
  dx = 2,
  dy = 1,
  dtMs = 50
): MovementSample[] {
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * dx,
    y: startY + i * dy,
    timestamp: i * dtMs,
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// TypingRhythmAnalyzer tests
// ══════════════════════════════════════════════════════════════════════════════

describe("computeDTW", () => {
  it("returns 0 for identical sequences", () => {
    const seq: Digraph[] = [
      { holdTime: 80, flightTime: 120 },
      { holdTime: 75, flightTime: 110 },
      { holdTime: 85, flightTime: 130 },
    ];
    expect(computeDTW(seq, seq)).toBe(0);
  });

  it("returns 1 for empty sequences", () => {
    expect(computeDTW([], [])).toBe(1);
  });

  it("returns a positive distance for different sequences", () => {
    const fast: Digraph[] = Array.from({ length: 5 }, () => ({
      holdTime: 50,
      flightTime: 60,
    }));
    const slow: Digraph[] = Array.from({ length: 5 }, () => ({
      holdTime: 300,
      flightTime: 400,
    }));
    const dist = computeDTW(fast, slow);
    expect(dist).toBeGreaterThan(0);
  });

  it("distance is symmetric", () => {
    const a: Digraph[] = [{ holdTime: 100, flightTime: 150 }];
    const b: Digraph[] = [{ holdTime: 200, flightTime: 250 }];
    expect(computeDTW(a, b)).toBeCloseTo(computeDTW(b, a), 10);
  });

  it("normalises by path length so short and long sequences are comparable", () => {
    const short: Digraph[] = Array.from({ length: 3 }, () => ({
      holdTime: 80,
      flightTime: 120,
    }));
    const long: Digraph[] = Array.from({ length: 10 }, () => ({
      holdTime: 80,
      flightTime: 120,
    }));
    // Identical content – both should yield distance 0
    expect(computeDTW(short, long)).toBeCloseTo(0, 5);
  });
});

describe("extractDigraphs", () => {
  it("returns empty array for fewer than 2 events", () => {
    expect(extractDigraphs([])).toHaveLength(0);
    expect(extractDigraphs([makeKeystroke("a", 0, 80)])).toHaveLength(0);
  });

  it("extracts correct hold and flight times", () => {
    const events: KeystrokeEvent[] = [
      { key: "a", pressedAt: 0, releasedAt: 100 },
      { key: "b", pressedAt: 200, releasedAt: 280 },
    ];
    const digraphs = extractDigraphs(events);
    expect(digraphs).toHaveLength(1);
    expect(digraphs[0]!.holdTime).toBe(100);
    expect(digraphs[0]!.flightTime).toBe(100);
  });

  it("filters out gaps longer than 5 seconds", () => {
    const events: KeystrokeEvent[] = [
      { key: "a", pressedAt: 0, releasedAt: 80 },
      { key: "b", pressedAt: 6_000, releasedAt: 6_080 }, // 5920 ms flight
    ];
    const digraphs = extractDigraphs(events);
    expect(digraphs).toHaveLength(0);
  });

  it("clamps negative hold times to 0", () => {
    const events: KeystrokeEvent[] = [
      // releasedAt before pressedAt – shouldn't happen but must be handled
      { key: "a", pressedAt: 100, releasedAt: 90 },
      { key: "b", pressedAt: 200, releasedAt: 280 },
    ];
    const digraphs = extractDigraphs(events);
    expect(digraphs[0]!.holdTime).toBe(0);
  });
});

describe("ingestKeystrokes and profile management", () => {
  const userId = "test-typing-user-1";

  beforeEach(() => {
    resetProfile(userId);
  });

  it("returns null while profile is still bootstrapping", () => {
    const events = generateKeystrokes(10);
    const result = ingestKeystrokes(userId, events);
    expect(result).toBeNull();
  });

  it("profile snapshot exists after ingestion", () => {
    ingestKeystrokes(userId, generateKeystrokes(50));
    const snapshot = getProfileSnapshot(userId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.keystrokeHistory.length).toBeGreaterThan(0);
  });

  it("marks profile as mature after 2000 keystrokes", () => {
    ingestKeystrokes(userId, generateKeystrokes(2000));
    const snapshot = getProfileSnapshot(userId);
    expect(snapshot!.mature).toBe(true);
  });

  it("returns a comparison result once mature", () => {
    ingestKeystrokes(userId, generateKeystrokes(2000));
    const result = ingestKeystrokes(userId, generateKeystrokes(60));
    expect(result).not.toBeNull();
    expect(typeof result!.dtwDistance).toBe("number");
    expect(result!.confidence).toBeGreaterThanOrEqual(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });

  it("clearAnomalyState clears anomaly tracking", () => {
    ingestKeystrokes(userId, generateKeystrokes(2000));
    clearAnomalyState(userId);
    expect(getAnomalyState(userId)).toBeNull();
  });

  it("compareLiveWindow returns high confidence for matching rhythm", () => {
    const pattern = generateKeystrokes(2000, 0, 80, 120);
    ingestKeystrokes(userId, pattern);
    // Compare against nearly identical pattern
    const live = generateKeystrokes(60, 50_000, 82, 118);
    const result = compareLiveWindow(userId, live);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("compareLiveWindow returns lower confidence for very different rhythm", () => {
    // Profile: fast typist
    const fast = generateKeystrokes(2000, 0, 50, 60);
    ingestKeystrokes(userId, fast);
    // Compare: extremely slow typist
    const slow = generateKeystrokes(60, 50_000, 500, 800);
    const result = compareLiveWindow(userId, slow);
    expect(result.confidence).toBeLessThan(0.8);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MouseDynamicsTracker tests
// ══════════════════════════════════════════════════════════════════════════════

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
  });

  it("returns 0 for zero-length vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 when one vector is all zeros", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("extractFeatureVector", () => {
  it(`produces a vector of exactly ${FEATURE_VECTOR_SIZE} elements`, () => {
    const movements = generateMovements(200);
    const clicks: ClickEvent[] = [
      { x: 100, y: 100, targetCentreX: 105, targetCentreY: 102, timestamp: 500 },
    ];
    const scrolls: ScrollEvent[] = [{ deltaY: -120, timestamp: 1000 }];
    const hovers: HoverEvent[] = [
      { enteredAt: 200, leftAt: 800, tag: "button" },
    ];
    const vec = extractFeatureVector(movements, clicks, scrolls, hovers);
    expect(vec).toHaveLength(FEATURE_VECTOR_SIZE);
  });

  it("all values are finite numbers", () => {
    const movements = generateMovements(100);
    const vec = extractFeatureVector(movements, [], [], []);
    for (const v of vec) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("handles empty inputs gracefully", () => {
    const vec = extractFeatureVector([], [], [], []);
    expect(vec).toHaveLength(FEATURE_VECTOR_SIZE);
    // Most features should be zero for empty input
    const nonZero = vec.filter((v) => v !== 0).length;
    expect(nonZero).toBeLessThan(FEATURE_VECTOR_SIZE);
  });

  it("velocity mean is higher for faster movements", () => {
    const fastMovements = generateMovements(100, 0, 0, 20, 10, 10); // 20+10 per 10ms
    const slowMovements = generateMovements(100, 0, 0, 1, 1, 10);   // ~1.4 per 10ms

    const fastVec = extractFeatureVector(fastMovements, [], [], []);
    const slowVec = extractFeatureVector(slowMovements, [], [], []);

    expect(fastVec[0]!).toBeGreaterThan(slowVec[0]!); // mean velocity
  });
});

describe("countImpossibleMovements", () => {
  it("returns 0 for normally-paced movements", () => {
    const samples = generateMovements(50, 0, 0, 3, 2, 50); // ~3.6 px per 50 ms = 0.072 px/ms
    expect(countImpossibleMovements(samples)).toBe(0);
  });

  it("detects teleporting cursor", () => {
    const samples: MovementSample[] = [
      { x: 0, y: 0, timestamp: 0 },
      { x: 5_000, y: 5_000, timestamp: 1 }, // 7071 px in 1 ms = 7071 px/ms >> 5 px/ms
    ];
    expect(countImpossibleMovements(samples)).toBe(1);
  });

  it("returns 0 for a single sample", () => {
    const samples: MovementSample[] = [{ x: 0, y: 0, timestamp: 0 }];
    expect(countImpossibleMovements(samples)).toBe(0);
  });
});

describe("ingestMovementWindow and signature management", () => {
  const userId = "test-mouse-user-1";

  beforeEach(() => {
    resetSignature(userId);
  });

  it("returns null during bootstrap phase (< 20 windows)", () => {
    const movements = generateMovements(50);
    const result = ingestMovementWindow(userId, movements, [], [], []);
    expect(result).toBeNull();
  });

  it("returns a result once signature is mature", () => {
    for (let i = 0; i < 20; i++) {
      ingestMovementWindow(userId, generateMovements(50, i * 10), [], [], []);
    }
    const result = ingestMovementWindow(userId, generateMovements(50), [], [], []);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });

  it("signature snapshot exists after ingestion", () => {
    ingestMovementWindow(userId, generateMovements(50), [], [], []);
    const snap = getSignatureSnapshot(userId);
    expect(snap).not.toBeNull();
    expect(snap!.sampleCount).toBe(1);
  });

  it("flags impossible movements as anomaly", () => {
    // Bootstrap
    for (let i = 0; i < 20; i++) {
      ingestMovementWindow(userId, generateMovements(50, i * 10), [], [], []);
    }
    // Inject teleporting movement
    const teleport: MovementSample[] = [
      { x: 0, y: 0, timestamp: 0 },
      { x: 50_000, y: 50_000, timestamp: 1 },
      { x: 0, y: 0, timestamp: 2 },
      { x: 50_000, y: 50_000, timestamp: 3 },
      { x: 0, y: 0, timestamp: 4 },
    ];
    const result = ingestMovementWindow(userId, teleport, [], [], []);
    expect(result!.impossibleMovements).toBeGreaterThan(0);
    expect(result!.isAnomaly).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DeviceSensorAuth tests
// ══════════════════════════════════════════════════════════════════════════════

describe("computeDeviceId", () => {
  it("returns a 64-character hex string", () => {
    const telemetry: DeviceTelemetry = {
      platform: "desktop",
      webgl: {
        renderer: "NVIDIA GeForce RTX 3080",
        vendor: "NVIDIA Corporation",
        maxTextureSize: 32768,
        extensionCount: 42,
        canvasHash: "abc123",
      },
      collectedAt: new Date().toISOString(),
    };
    const id = computeDeviceId(telemetry);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same ID for identical telemetry", () => {
    const telemetry: DeviceTelemetry = {
      platform: "mobile",
      collectedAt: "2024-01-01T00:00:00Z",
    };
    expect(computeDeviceId(telemetry)).toBe(computeDeviceId(telemetry));
  });

  it("produces different IDs for different renderers", () => {
    const base = { platform: "desktop" as const, collectedAt: "2024-01-01T00:00:00Z" };
    const t1: DeviceTelemetry = {
      ...base,
      webgl: { renderer: "GPU-A", vendor: "V1", maxTextureSize: 8192, extensionCount: 20, canvasHash: "aaa" },
    };
    const t2: DeviceTelemetry = {
      ...base,
      webgl: { renderer: "GPU-B", vendor: "V1", maxTextureSize: 8192, extensionCount: 20, canvasHash: "aaa" },
    };
    expect(computeDeviceId(t1)).not.toBe(computeDeviceId(t2));
  });
});

describe("analyseGyroscope", () => {
  it("returns 0.5 for insufficient samples", () => {
    const samples: GyroscopeSample[] = [
      { alpha: 0, beta: 0, gamma: 0, timestamp: 0 },
    ];
    expect(analyseGyroscope(samples)).toBe(0.5);
  });

  it("returns low score for suspiciously still device", () => {
    const samples: GyroscopeSample[] = Array.from({ length: 150 }, (_, i) => ({
      alpha: 0.001 * (i % 2),
      beta: 0.001 * (i % 2),
      gamma: 0.001 * (i % 2),
      timestamp: i * 10,
    }));
    expect(analyseGyroscope(samples)).toBeLessThan(0.3);
  });

  it("returns low score for excessive noise", () => {
    const samples: GyroscopeSample[] = Array.from({ length: 150 }, (_, i) => ({
      alpha: (Math.random() - 0.5) * 100,
      beta: (Math.random() - 0.5) * 100,
      gamma: (Math.random() - 0.5) * 100,
      timestamp: i * 10,
    }));
    expect(analyseGyroscope(samples)).toBeLessThan(0.5);
  });

  it("returns high score for natural hand-hold tremor", () => {
    // Simulate ~2 deg/s std – realistic human holding a phone
    const samples: GyroscopeSample[] = Array.from({ length: 150 }, (_, i) => ({
      alpha: Math.sin(i * 0.1) * 2 + (Math.random() - 0.5) * 0.5,
      beta: Math.cos(i * 0.1) * 2 + (Math.random() - 0.5) * 0.5,
      gamma: Math.sin(i * 0.05) * 1.5 + (Math.random() - 0.5) * 0.3,
      timestamp: i * 10,
    }));
    expect(analyseGyroscope(samples)).toBeGreaterThan(0.5);
  });
});

describe("analyseAccelerometer", () => {
  it("returns 0.5 for fewer than 10 samples", () => {
    const samples: AccelerometerSample[] = [
      { x: 0.1, y: 9.8, z: 0.05, timestamp: 0 },
    ];
    expect(analyseAccelerometer(samples)).toBe(0.5);
  });

  it("returns low score for zero-noise data", () => {
    const samples: AccelerometerSample[] = Array.from({ length: 20 }, (_, i) => ({
      x: 0.0001,
      y: 9.8,
      z: 0.0001,
      timestamp: i * 10,
    }));
    expect(analyseAccelerometer(samples)).toBeLessThan(0.5);
  });

  it("returns high score for realistic noise floor", () => {
    const samples: AccelerometerSample[] = Array.from({ length: 20 }, (_, i) => ({
      x: 0.05 + (Math.random() - 0.5) * 0.1,
      y: 9.8 + (Math.random() - 0.5) * 0.2,
      z: 0.02 + (Math.random() - 0.5) * 0.05,
      timestamp: i * 10,
    }));
    expect(analyseAccelerometer(samples)).toBeGreaterThanOrEqual(0.8);
  });
});

describe("analyseWebGL", () => {
  it("returns low score for undefined fingerprint", () => {
    expect(analyseWebGL(undefined)).toBeLessThan(0.5);
  });

  it("returns low score for unknown renderer", () => {
    expect(
      analyseWebGL({
        renderer: "unknown",
        vendor: "unknown",
        maxTextureSize: 4096,
        extensionCount: 10,
        canvasHash: "abc123",
      })
    ).toBeLessThan(0.4);
  });

  it("returns high score for real GPU info", () => {
    expect(
      analyseWebGL({
        renderer: "Intel Iris Xe Graphics",
        vendor: "Intel Inc.",
        maxTextureSize: 16384,
        extensionCount: 38,
        canvasHash: "3a4b5c6d7e8f",
      })
    ).toBeGreaterThan(0.8);
  });
});

describe("analyseAudio", () => {
  it("returns low score for undefined fingerprint", () => {
    expect(analyseAudio(undefined)).toBeLessThan(0.5);
  });

  it("returns low score for zero sample sum (blocked)", () => {
    expect(
      analyseAudio({ sampleSum: 0, sampleRate: 44100, channelCount: 2 })
    ).toBeLessThan(0.5);
  });

  it("returns high score for valid audio fingerprint", () => {
    expect(
      analyseAudio({ sampleSum: -0.06543321, sampleRate: 44100, channelCount: 2 })
    ).toBeGreaterThan(0.8);
  });

  it("returns low score for implausible sample rate", () => {
    expect(
      analyseAudio({ sampleSum: 0.5, sampleRate: 100, channelCount: 2 })
    ).toBeLessThan(0.5);
  });
});

describe("analyseScreen", () => {
  it("returns low score for undefined profile", () => {
    expect(analyseScreen(undefined)).toBeLessThan(0.5);
  });

  it("returns moderate score for non-standard colour depth", () => {
    expect(
      analyseScreen({
        colorDepth: 16,
        pixelRatio: 1,
        screenWidth: 1920,
        screenHeight: 1080,
        hasP3Gamut: false,
        hasHDR: false,
      })
    ).toBeLessThanOrEqual(0.6);
  });

  it("returns high score for standard display parameters", () => {
    expect(
      analyseScreen({
        colorDepth: 24,
        pixelRatio: 2,
        screenWidth: 2560,
        screenHeight: 1600,
        hasP3Gamut: true,
        hasHDR: false,
      })
    ).toBeGreaterThan(0.8);
  });
});

describe("enrollDevice and device management", () => {
  const userId = "test-device-user-1";

  beforeEach(() => {
    // Clear enrolled devices by revoking all
    const devices = getEnrolledDevices(userId);
    for (const d of devices) revokeDevice(userId, d.deviceId);
  });

  it("enrolls a device and retrieves it", () => {
    enrollDevice(userId, "device-abc", "desktop", 0.9);
    const devices = getEnrolledDevices(userId);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.deviceId).toBe("device-abc");
  });

  it("updates lastSeenAt on re-enrolment of same device", () => {
    enrollDevice(userId, "device-abc", "desktop", 0.9);
    const firstSeen = getEnrolledDevices(userId)[0]!.lastSeenAt;
    enrollDevice(userId, "device-abc", "desktop", 0.9);
    const secondSeen = getEnrolledDevices(userId)[0]!.lastSeenAt;
    // lastSeenAt should be >= firstSeen
    expect(new Date(secondSeen).getTime()).toBeGreaterThanOrEqual(
      new Date(firstSeen).getTime()
    );
  });

  it("revokes an enrolled device", () => {
    enrollDevice(userId, "device-xyz", "mobile", 0.8);
    const revoked = revokeDevice(userId, "device-xyz");
    expect(revoked).toBe(true);
    expect(getEnrolledDevices(userId)).toHaveLength(0);
  });

  it("returns false when revoking a non-existent device", () => {
    expect(revokeDevice(userId, "ghost-device")).toBe(false);
  });
});

describe("evaluateDeviceTelemetry", () => {
  const userId = "test-device-eval-1";

  beforeEach(() => {
    const devices = getEnrolledDevices(userId);
    for (const d of devices) revokeDevice(userId, d.deviceId);
  });

  it("returns a valid confidence score between 0 and 1", () => {
    const telemetry: DeviceTelemetry = {
      platform: "desktop",
      webgl: {
        renderer: "AMD Radeon RX 6800",
        vendor: "ATI Technologies Inc.",
        maxTextureSize: 32768,
        extensionCount: 45,
        canvasHash: "deadbeef1234",
      },
      audio: { sampleSum: -0.071341, sampleRate: 48000, channelCount: 2 },
      screen: {
        colorDepth: 24,
        pixelRatio: 1,
        screenWidth: 3840,
        screenHeight: 2160,
        hasP3Gamut: true,
        hasHDR: true,
      },
      collectedAt: new Date().toISOString(),
    };

    const result = evaluateDeviceTelemetry(userId, telemetry);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.deviceId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("marks unknown device when no devices are enrolled", () => {
    const telemetry: DeviceTelemetry = {
      platform: "desktop",
      collectedAt: new Date().toISOString(),
    };
    const result = evaluateDeviceTelemetry(userId, telemetry);
    expect(result.isKnownDevice).toBe(false);
  });

  it("marks device as known after manual enrolment", () => {
    const telemetry: DeviceTelemetry = {
      platform: "desktop",
      webgl: {
        renderer: "GPU-Test",
        vendor: "Vendor-Test",
        maxTextureSize: 4096,
        extensionCount: 10,
        canvasHash: "testcanvas",
      },
      collectedAt: new Date().toISOString(),
    };
    const deviceId = computeDeviceId(telemetry);
    enrollDevice(userId, deviceId, "desktop", 0.9);

    const result = evaluateDeviceTelemetry(userId, telemetry);
    expect(result.isKnownDevice).toBe(true);
    expect(result.anomalies).not.toContain("UNKNOWN_DEVICE");
  });

  it("adds UNKNOWN_DEVICE anomaly when device not recognised and one is enrolled", () => {
    enrollDevice(userId, "other-device", "desktop", 0.9);
    const telemetry: DeviceTelemetry = {
      platform: "desktop",
      collectedAt: new Date().toISOString(),
    };
    const result = evaluateDeviceTelemetry(userId, telemetry);
    expect(result.anomalies).toContain("UNKNOWN_DEVICE");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ContinuousAuth middleware tests
// ══════════════════════════════════════════════════════════════════════════════

describe("computeCompositeConfidence", () => {
  it("weights signals correctly", () => {
    // 0.35 * 1 + 0.35 * 1 + 0.30 * 1 = 1.0
    expect(computeCompositeConfidence(1, 1, 1)).toBeCloseTo(1.0, 10);
  });

  it("returns 0 when all signals are 0", () => {
    expect(computeCompositeConfidence(0, 0, 0)).toBeCloseTo(0, 10);
  });

  it("weights typing and mouse equally at 0.35 each", () => {
    const typingOnly = computeCompositeConfidence(1, 0, 0);
    const mouseOnly = computeCompositeConfidence(0, 1, 0);
    expect(typingOnly).toBeCloseTo(mouseOnly, 10);
  });

  it("device signal has less weight than typing or mouse", () => {
    const deviceOnly = computeCompositeConfidence(0, 0, 1);
    const typingOnly = computeCompositeConfidence(1, 0, 0);
    expect(deviceOnly).toBeLessThan(typingOnly);
  });
});

describe("updateSessionState", () => {
  const userId = "test-session-user-1";

  beforeEach(() => {
    clearSessionLock(userId);
  });

  it("creates default state when none exists", () => {
    const state = getSessionState(userId);
    expect(state.compositeConfidence).toBeGreaterThan(0);
    expect(state.locked).toBe(false);
  });

  it("updates confidence values", () => {
    updateSessionState(userId, {
      typingConfidence: 0.9,
      mouseConfidence: 0.85,
      deviceConfidence: 0.95,
    });
    const state = getSessionState(userId);
    expect(state.typingConfidence).toBe(0.9);
    expect(state.mouseConfidence).toBe(0.85);
    expect(state.deviceConfidence).toBe(0.95);
  });

  it("locks session when confidence drops below 0.3", () => {
    updateSessionState(userId, {
      typingConfidence: 0.1,
      mouseConfidence: 0.1,
      deviceConfidence: 0.1,
    });
    const state = getSessionState(userId);
    expect(state.locked).toBe(true);
  });

  it("does not lock session when confidence is above 0.3", () => {
    updateSessionState(userId, {
      typingConfidence: 0.9,
      mouseConfidence: 0.9,
      deviceConfidence: 0.9,
    });
    const state = getSessionState(userId);
    expect(state.locked).toBe(false);
  });

  it("sets lowConfidenceSince when confidence is between 0.3 and 0.7", () => {
    updateSessionState(userId, {
      typingConfidence: 0.5,
      mouseConfidence: 0.5,
      deviceConfidence: 0.5,
    });
    const state = getSessionState(userId);
    expect(state.lowConfidenceSince).not.toBeNull();
  });

  it("resets lowConfidenceSince when confidence recovers above 0.7", () => {
    // Drive down
    updateSessionState(userId, {
      typingConfidence: 0.5,
      mouseConfidence: 0.5,
      deviceConfidence: 0.5,
    });
    // Recover
    updateSessionState(userId, {
      typingConfidence: 0.9,
      mouseConfidence: 0.9,
      deviceConfidence: 0.9,
    });
    const state = getSessionState(userId);
    expect(state.lowConfidenceSince).toBeNull();
  });
});

describe("clearSessionLock", () => {
  const userId = "test-clear-lock-1";

  it("clears a locked session", () => {
    updateSessionState(userId, {
      typingConfidence: 0.05,
      mouseConfidence: 0.05,
      deviceConfidence: 0.05,
    });
    expect(getSessionState(userId).locked).toBe(true);

    clearSessionLock(userId);
    expect(getSessionState(userId).locked).toBe(false);
    expect(getSessionState(userId).softReauthRequired).toBe(false);
    expect(getSessionState(userId).lowConfidenceSince).toBeNull();
  });
});
