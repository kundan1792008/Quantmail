/**
 * MouseDynamicsTracker
 *
 * Continuously verifies user identity through mouse / pointer dynamics:
 *   - Velocity curves (speed over time)
 *   - Acceleration patterns (change in velocity)
 *   - Click precision (distance from target centre at click)
 *   - Scroll speed and distance distributions
 *   - Hover duration on interactive elements
 *   - Impossible-movement detection (teleporting cursor → bot / remote access)
 *
 * Each 10-second window of movement is compressed into a 64-feature vector.
 * The live vector is compared against the stored per-user signature using
 * cosine similarity, and an anomaly is flagged when similarity drops below
 * the configured threshold.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of samples required before the signature is considered mature. */
const SIGNATURE_BOOTSTRAP_SAMPLES = 20;

/** Length of the normalised feature vector. */
export const FEATURE_VECTOR_SIZE = 64;

/** Cosine-similarity below which a window is considered anomalous. */
const SIMILARITY_ANOMALY_THRESHOLD = 0.55;

/**
 * Maximum plausible cursor speed in pixels per millisecond.
 * Movements faster than this are classified as "impossible" (teleport).
 */
const MAX_PLAUSIBLE_SPEED_PX_MS = 5.0;

/** Window length used for movement analysis (milliseconds). */
const ANALYSIS_WINDOW_MS = 10_000;

/** Maximum number of raw movement samples stored per user. */
const MAX_MOVEMENT_SAMPLES = 10_000;

/** Maximum milliseconds between two clicks to be counted as a double-click. */
const DOUBLE_CLICK_THRESHOLD_MS = 300;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** A single pointer-movement sample captured from the browser. */
export interface MovementSample {
  /** X coordinate in viewport pixels. */
  x: number;
  /** Y coordinate in viewport pixels. */
  y: number;
  /** Unix timestamp (ms). */
  timestamp: number;
  /** Optional: element tag the cursor is hovering over. */
  targetTag?: string;
}

/** A single click event. */
export interface ClickEvent {
  /** X coordinate at click. */
  x: number;
  /** Y coordinate at click. */
  y: number;
  /** X coordinate of the centre of the clicked element. */
  targetCentreX: number;
  /** Y coordinate of the centre of the clicked element. */
  targetCentreY: number;
  /** Unix timestamp (ms). */
  timestamp: number;
}

/** A single scroll event. */
export interface ScrollEvent {
  /** Delta Y in pixels. */
  deltaY: number;
  /** Unix timestamp (ms). */
  timestamp: number;
}

/** A hover event (element entered / left). */
export interface HoverEvent {
  /** Unix timestamp when cursor entered the element (ms). */
  enteredAt: number;
  /** Unix timestamp when cursor left the element (ms). */
  leftAt: number;
  /** DOM tag of the hovered element. */
  tag: string;
}

/** A 64-element normalised feature vector. */
export type FeatureVector = number[];

/** Per-user stored signature (mean feature vector). */
export interface MouseSignature {
  userId: string;
  /** Running mean vector – updated on each window. */
  meanVector: FeatureVector;
  /** Number of windows averaged into meanVector. */
  sampleCount: number;
  /** Whether the signature is mature enough for comparisons. */
  mature: boolean;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** Result of comparing one live window against the stored signature. */
export interface MouseComparisonResult {
  userId: string;
  cosineSimilarity: number;
  isAnomaly: boolean;
  confidence: number;
  impossibleMovements: number;
  sampledAt: string;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

const signatureStore = new Map<string, MouseSignature>();
const rawMovementStore = new Map<string, MovementSample[]>();

// ─── Vector Math ──────────────────────────────────────────────────────────────

/**
 * Computes cosine similarity between two vectors of equal length.
 * Returns 1.0 for identical direction, 0.0 for orthogonal, -1.0 for opposite.
 */
export function cosineSimilarity(a: FeatureVector, b: FeatureVector): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Returns a zero vector of FEATURE_VECTOR_SIZE.
 */
function zeroVector(): FeatureVector {
  return new Array<number>(FEATURE_VECTOR_SIZE).fill(0);
}

/**
 * Updates a running mean vector with a new sample.
 * Uses Welford's online algorithm (simplified additive form for fixed count).
 */
function updateMeanVector(
  mean: FeatureVector,
  newSample: FeatureVector,
  n: number
): FeatureVector {
  return mean.map((v, i) => v + (newSample[i]! - v) / n);
}

// ─── Feature Extraction ───────────────────────────────────────────────────────

/**
 * Computes velocity (px/ms) between consecutive movement samples.
 */
function computeVelocities(samples: MovementSample[]): number[] {
  const velocities: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i]!.timestamp - samples[i - 1]!.timestamp;
    if (dt <= 0) continue;
    const dx = samples[i]!.x - samples[i - 1]!.x;
    const dy = samples[i]!.y - samples[i - 1]!.y;
    velocities.push(Math.sqrt(dx * dx + dy * dy) / dt);
  }
  return velocities;
}

/**
 * Computes acceleration (change in velocity / dt) between consecutive samples.
 */
function computeAccelerations(velocities: number[], samples: MovementSample[]): number[] {
  const accelerations: number[] = [];
  for (let i = 1; i < velocities.length; i++) {
    const dt = samples[i + 1]!.timestamp - samples[i]!.timestamp;
    if (dt <= 0) continue;
    accelerations.push((velocities[i]! - velocities[i - 1]!) / dt);
  }
  return accelerations;
}

/** Returns a handful of descriptive statistics for a numeric array. */
function stats(arr: number[]): {
  mean: number;
  std: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
} {
  if (arr.length === 0) {
    return { mean: 0, std: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  }

  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  const pct = (p: number) => {
    const idx = Math.floor((p / 100) * (n - 1));
    return sorted[idx] ?? 0;
  };

  return {
    mean,
    std: Math.sqrt(variance),
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    p25: pct(25),
    p50: pct(50),
    p75: pct(75),
    p90: pct(90),
  };
}

/**
 * Builds a 64-feature vector from a window of movement, click, scroll, and
 * hover events.
 *
 * Feature layout (indices 0–63):
 *   0–7   velocity statistics (mean, std, min, max, p25, p50, p75, p90)
 *   8–15  acceleration statistics
 *   16–19 click precision stats (mean & std of distance from target centre,
 *          mean inter-click interval, click count normalised to 10 s)
 *   20–27 scroll statistics (deltaY mean, std, min, max; scroll event rate;
 *          scroll direction changes; reserved × 2)
 *   28–35 hover duration statistics (mean, std, min, max; hover count normalised;
 *          reserved × 3)
 *   36–39 path curvature (mean angular change per step; std; reserved × 2)
 *   40–43 jitter (mean small-movement magnitude; std; reserved × 2)
 *   44–47 directional entropy (fraction of moves in each quadrant)
 *   48–51 movement burstiness (coefficient of variation of inter-event times;
 *          fraction of time cursor is stationary; reserved × 2)
 *   52–55 speed quantiles per quadrant (mean speed top-right, top-left,
 *          bottom-left, bottom-right)
 *   56–59 click-to-movement-ratio; double-click rate; reserved × 2
 *   60–63 temporal regularity: autocorrelation lag-1 of velocities; reserved × 3
 */
export function extractFeatureVector(
  movements: MovementSample[],
  clicks: ClickEvent[],
  scrolls: ScrollEvent[],
  hovers: HoverEvent[]
): FeatureVector {
  const vec = zeroVector();

  // ── Velocity features (0–7) ──────────────────────────────────────────────
  const velocities = computeVelocities(movements);
  const velStats = stats(velocities);
  vec[0] = velStats.mean;
  vec[1] = velStats.std;
  vec[2] = velStats.min;
  vec[3] = velStats.max;
  vec[4] = velStats.p25;
  vec[5] = velStats.p50;
  vec[6] = velStats.p75;
  vec[7] = velStats.p90;

  // ── Acceleration features (8–15) ─────────────────────────────────────────
  const accelerations = computeAccelerations(velocities, movements);
  const accStats = stats(accelerations);
  vec[8] = accStats.mean;
  vec[9] = accStats.std;
  vec[10] = accStats.min;
  vec[11] = accStats.max;
  vec[12] = accStats.p25;
  vec[13] = accStats.p50;
  vec[14] = accStats.p75;
  vec[15] = accStats.p90;

  // ── Click precision features (16–19) ──────────────────────────────────────
  const clickDistances = clicks.map((c) => {
    const dx = c.x - c.targetCentreX;
    const dy = c.y - c.targetCentreY;
    return Math.sqrt(dx * dx + dy * dy);
  });
  const clickDistStats = stats(clickDistances);
  vec[16] = clickDistStats.mean;
  vec[17] = clickDistStats.std;
  const clickIntervals = clicks.slice(1).map((c, i) => c.timestamp - clicks[i]!.timestamp);
  vec[18] = stats(clickIntervals).mean;
  vec[19] = clicks.length / (ANALYSIS_WINDOW_MS / 1_000); // clicks/sec

  // ── Scroll features (20–27) ───────────────────────────────────────────────
  const scrollDeltas = scrolls.map((s) => Math.abs(s.deltaY));
  const scrollStats = stats(scrollDeltas);
  vec[20] = scrollStats.mean;
  vec[21] = scrollStats.std;
  vec[22] = scrollStats.min;
  vec[23] = scrollStats.max;
  vec[24] = scrolls.length / (ANALYSIS_WINDOW_MS / 1_000); // scrolls/sec
  let dirChanges = 0;
  for (let i = 1; i < scrolls.length; i++) {
    if (
      Math.sign(scrolls[i]!.deltaY) !== Math.sign(scrolls[i - 1]!.deltaY) &&
      scrolls[i - 1]!.deltaY !== 0
    ) {
      dirChanges++;
    }
  }
  vec[25] = dirChanges;
  // 26-27 reserved

  // ── Hover duration features (28–35) ──────────────────────────────────────
  const hoverDurations = hovers.map((h) => h.leftAt - h.enteredAt);
  const hoverStats = stats(hoverDurations);
  vec[28] = hoverStats.mean;
  vec[29] = hoverStats.std;
  vec[30] = hoverStats.min;
  vec[31] = hoverStats.max;
  vec[32] = hovers.length / (ANALYSIS_WINDOW_MS / 1_000);
  // 33-35 reserved

  // ── Path curvature (36–39) ───────────────────────────────────────────────
  const angles: number[] = [];
  for (let i = 2; i < movements.length; i++) {
    const ax = movements[i - 1]!.x - movements[i - 2]!.x;
    const ay = movements[i - 1]!.y - movements[i - 2]!.y;
    const bx = movements[i]!.x - movements[i - 1]!.x;
    const by = movements[i]!.y - movements[i - 1]!.y;
    const dot = ax * bx + ay * by;
    const cross = ax * by - ay * bx;
    angles.push(Math.atan2(Math.abs(cross), dot));
  }
  const angleStats = stats(angles);
  vec[36] = angleStats.mean;
  vec[37] = angleStats.std;
  // 38-39 reserved

  // ── Jitter (40–43) ───────────────────────────────────────────────────────
  const smallMoves = movements.slice(1).map((m, i) => {
    const dx = m.x - movements[i]!.x;
    const dy = m.y - movements[i]!.y;
    return Math.sqrt(dx * dx + dy * dy);
  });
  const jitterStats = stats(smallMoves.filter((v) => v < 5));
  vec[40] = jitterStats.mean;
  vec[41] = jitterStats.std;
  // 42-43 reserved

  // ── Directional entropy (44–47) ──────────────────────────────────────────
  let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
  for (let i = 1; i < movements.length; i++) {
    const dx = movements[i]!.x - movements[i - 1]!.x;
    const dy = movements[i]!.y - movements[i - 1]!.y;
    if (dx >= 0 && dy >= 0) q1++;
    else if (dx < 0 && dy >= 0) q2++;
    else if (dx < 0 && dy < 0) q3++;
    else q4++;
  }
  const total = Math.max(1, movements.length - 1);
  vec[44] = q1 / total;
  vec[45] = q2 / total;
  vec[46] = q3 / total;
  vec[47] = q4 / total;

  // ── Movement burstiness (48–51) ──────────────────────────────────────────
  const intervals = movements
    .slice(1)
    .map((m, i) => m.timestamp - movements[i]!.timestamp)
    .filter((t) => t > 0);
  const intStats = stats(intervals);
  vec[48] = intStats.mean > 0 ? intStats.std / intStats.mean : 0; // CoV
  const stationary = smallMoves.filter((v) => v < 1).length;
  vec[49] = stationary / Math.max(1, smallMoves.length);
  // 50-51 reserved

  // ── Speed per quadrant (52–55) ────────────────────────────────────────────
  const speedByQuadrant: [number[], number[], number[], number[]] = [[], [], [], []];
  for (let i = 1; i < movements.length; i++) {
    const dt = movements[i]!.timestamp - movements[i - 1]!.timestamp;
    if (dt <= 0) continue;
    const dx = movements[i]!.x - movements[i - 1]!.x;
    const dy = movements[i]!.y - movements[i - 1]!.y;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;
    const idx = dx >= 0 && dy >= 0 ? 0 : dx < 0 && dy >= 0 ? 1 : dx < 0 && dy < 0 ? 2 : 3;
    speedByQuadrant[idx]!.push(speed);
  }
  vec[52] = stats(speedByQuadrant[0]!).mean;
  vec[53] = stats(speedByQuadrant[1]!).mean;
  vec[54] = stats(speedByQuadrant[2]!).mean;
  vec[55] = stats(speedByQuadrant[3]!).mean;

  // ── Click-to-movement ratio (56–59) ──────────────────────────────────────
  vec[56] = clicks.length / Math.max(1, movements.length);
  const doubleClicks = clicks.filter((_, i) =>
    i > 0 && clicks[i]!.timestamp - clicks[i - 1]!.timestamp < DOUBLE_CLICK_THRESHOLD_MS
  ).length;
  vec[57] = doubleClicks / Math.max(1, clicks.length);
  // 58-59 reserved

  // ── Velocity autocorrelation lag-1 (60–63) ────────────────────────────────
  if (velocities.length >= 2) {
    const vMean = velStats.mean;
    let cov = 0;
    let varSum = 0;
    for (let i = 1; i < velocities.length; i++) {
      cov += (velocities[i - 1]! - vMean) * (velocities[i]! - vMean);
      varSum += (velocities[i - 1]! - vMean) ** 2;
    }
    vec[60] = varSum > 0 ? cov / varSum : 0;
  }
  // 61-63 reserved

  return vec;
}

// ─── Impossible Movement Detection ───────────────────────────────────────────

/**
 * Counts the number of "impossible" movements in a sample sequence.
 *
 * An impossible movement is one where the cursor travels faster than
 * MAX_PLAUSIBLE_SPEED_PX_MS pixels per millisecond – indicative of a
 * remote-desktop tool or a bot injecting synthetic mouse events.
 */
export function countImpossibleMovements(samples: MovementSample[]): number {
  let count = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i]!.timestamp - samples[i - 1]!.timestamp;
    if (dt <= 0) continue;
    const dx = samples[i]!.x - samples[i - 1]!.x;
    const dy = samples[i]!.y - samples[i - 1]!.y;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;
    if (speed > MAX_PLAUSIBLE_SPEED_PX_MS) count++;
  }
  return count;
}

// ─── Signature Management ─────────────────────────────────────────────────────

/**
 * Retrieves (or lazily creates) the mouse signature for a user.
 */
export function getSignature(userId: string): MouseSignature {
  if (!signatureStore.has(userId)) {
    signatureStore.set(userId, {
      userId,
      meanVector: zeroVector(),
      sampleCount: 0,
      mature: false,
      updatedAt: new Date().toISOString(),
    });
  }
  return signatureStore.get(userId)!;
}

/**
 * Resets a user's stored signature.
 */
export function resetSignature(userId: string): void {
  signatureStore.delete(userId);
  rawMovementStore.delete(userId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ingests a 10-second window of pointer events for a user.
 *
 * During bootstrapping (< SIGNATURE_BOOTSTRAP_SAMPLES windows), the feature
 * vector is accumulated into the mean signature without anomaly detection.
 * Once mature, the live vector is compared against the mean signature.
 *
 * Returns a comparison result once the signature is mature, or null during
 * bootstrapping.
 */
export function ingestMovementWindow(
  userId: string,
  movements: MovementSample[],
  clicks: ClickEvent[],
  scrolls: ScrollEvent[],
  hovers: HoverEvent[]
): MouseComparisonResult | null {
  const signature = getSignature(userId);
  const liveVector = extractFeatureVector(movements, clicks, scrolls, hovers);
  const impossible = countImpossibleMovements(movements);

  // Always update the running mean
  signature.sampleCount++;
  signature.meanVector = updateMeanVector(signature.meanVector, liveVector, signature.sampleCount);
  signature.updatedAt = new Date().toISOString();

  if (signature.sampleCount < SIGNATURE_BOOTSTRAP_SAMPLES) {
    return null;
  }

  signature.mature = true;

  const similarity = cosineSimilarity(liveVector, signature.meanVector);
  const isAnomaly = similarity < SIMILARITY_ANOMALY_THRESHOLD || impossible > 3;

  return {
    userId,
    cosineSimilarity: similarity,
    isAnomaly,
    confidence: Math.max(0, Math.min(1, (similarity + 1) / 2)),
    impossibleMovements: impossible,
    sampledAt: new Date().toISOString(),
  };
}

/**
 * Returns a read-only snapshot of the stored signature.
 * Returns null if no signature exists for the user.
 */
export function getSignatureSnapshot(userId: string): Readonly<MouseSignature> | null {
  return signatureStore.get(userId) ?? null;
}
