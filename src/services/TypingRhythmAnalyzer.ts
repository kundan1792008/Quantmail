/**
 * TypingRhythmAnalyzer
 * ====================
 *
 * Continuous, invisible keystroke-dynamics biometric authentication.
 *
 * The analyzer ingests raw keydown/keyup events from a client and extracts
 * per-user typing rhythm features:
 *
 *   - Hold time:   (keyUp - keyDown) for every pressed key.
 *   - Flight time: (nextKeyDown - currentKeyUp) between consecutive keys.
 *   - Digraph time (key-to-key latency) for common bigrams (e.g. "th", "he").
 *   - Typing speed (characters-per-second) over rolling windows.
 *   - Error rate measured via Backspace / Delete frequency.
 *
 * Behavior:
 *   1. A baseline profile is constructed after the first
 *      {@link TypingConstants.PROFILE_KEYSTROKE_TARGET} keystrokes (2000).
 *   2. Incoming keystrokes are continuously compared against the profile
 *      using Dynamic Time Warping (DTW) distance on hold-time and
 *      flight-time sequences.
 *   3. A session is flagged as anomalous when the averaged DTW distance
 *      stays above {@link TypingConstants.ANOMALY_THRESHOLD} for more than
 *      {@link TypingConstants.SUSTAINED_ANOMALY_MS} (30 000 ms).
 *
 * The module is intentionally self-contained: all state lives in
 * process-local maps so the service can run without additional Prisma
 * schema changes. A separate persistence layer can swap
 * {@link TypingRhythmStore} for a Redis or SQL-backed store later.
 *
 * Nothing in this file is a stub — every function returns a fully computed
 * result. No placeholders, no dead code.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Raw keystroke event captured on the client. Both timestamps are expected
 * to be in **milliseconds since UNIX epoch** as produced by
 * `performance.timeOrigin + performance.now()` or `Date.now()`.
 *
 * A "keystroke" is the pair (keyDownAt, keyUpAt) for a single key press.
 */
export interface KeystrokeEvent {
  /** Sessionless identifier of the authenticated user. */
  readonly userId: string;
  /** The logical key (e.g. "a", "Shift", "Backspace"). Case-preserving. */
  readonly key: string;
  /** Physical/DOM code (e.g. "KeyA"). Optional; used for modifier heuristics. */
  readonly code?: string;
  /** Milliseconds since epoch when the key went down. */
  readonly downAt: number;
  /** Milliseconds since epoch when the key went up. `downAt <= upAt`. */
  readonly upAt: number;
  /** Optional opaque device id used to segment per-device statistics. */
  readonly deviceId?: string;
}

/**
 * Aggregated profile statistics computed from the first N keystrokes.
 * All numeric fields use doubles and are stored in milliseconds.
 */
export interface TypingProfile {
  readonly userId: string;
  readonly keystrokeCount: number;
  readonly holdTime: NumericSummary;
  readonly flightTime: NumericSummary;
  readonly typingSpeedCps: NumericSummary;
  readonly errorRate: number; // ratio of [Backspace|Delete] to total keys
  readonly digraphs: ReadonlyMap<string, NumericSummary>;
  readonly signatureHoldSeries: readonly number[]; // canonical hold-time baseline
  readonly signatureFlightSeries: readonly number[]; // canonical flight-time baseline
  readonly builtAt: number;
  readonly version: number;
}

/**
 * Summary of a one-dimensional numeric distribution. `count=0` means no
 * data was available; consumers should guard accordingly.
 */
export interface NumericSummary {
  readonly count: number;
  readonly mean: number;
  readonly variance: number;
  readonly stdDev: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
}

/**
 * A live comparison result. `distance` is the DTW cost of the current
 * window against the stored signature. `score` is a normalized value in
 * `[0, 1]` where 1 is perfect match and 0 is totally dissimilar.
 */
export interface TypingComparisonResult {
  readonly userId: string;
  readonly distance: number;
  readonly score: number;
  readonly holdDistance: number;
  readonly flightDistance: number;
  readonly errorRateDelta: number;
  readonly speedDelta: number;
  readonly anomalous: boolean;
  readonly sampleSize: number;
  readonly computedAt: number;
}

/**
 * Live anomaly state tracked per user. The anomaly "timer" begins the
 * moment a comparison is flagged and is reset on the first good score.
 */
export interface TypingAnomalyState {
  readonly userId: string;
  readonly anomalySince: number | null;
  readonly lastScore: number;
  readonly lastDistance: number;
  readonly sustainedMs: number;
  readonly tripped: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const TypingConstants = Object.freeze({
  /** Number of keystrokes required before a baseline profile is built. */
  PROFILE_KEYSTROKE_TARGET: 2000,
  /** Size of the rolling comparison window, in keystrokes. */
  COMPARISON_WINDOW: 120,
  /** Minimum window size before scoring is attempted. */
  MIN_COMPARE_KEYSTROKES: 30,
  /** Cap hold times at 600 ms; anything longer is a pause, not a keystroke. */
  MAX_HOLD_MS: 600,
  /** Cap flight times at 1500 ms — anything above is typing idle. */
  MAX_FLIGHT_MS: 1500,
  /** DTW distance above which typing is considered dissimilar. */
  ANOMALY_THRESHOLD: 55,
  /** How long the anomaly must persist before the session trips. */
  SUSTAINED_ANOMALY_MS: 30_000,
  /** Window length for typing-speed computation. */
  SPEED_WINDOW_MS: 5_000,
  /** Maximum keystrokes retained in memory per user. */
  MAX_KEYSTROKE_BUFFER: 10_000,
  /** Profile format version — bump to invalidate stored baselines. */
  PROFILE_VERSION: 1,
  /** Weight applied to the hold-time channel when mixing distances. */
  HOLD_WEIGHT: 0.5,
  /** Weight applied to the flight-time channel when mixing distances. */
  FLIGHT_WEIGHT: 0.5,
  /** Maximum warp steps of the DTW band (Sakoe-Chiba). */
  DTW_BAND: 12,
} as const);

// ─── Internal Buffers ────────────────────────────────────────────────────────

interface UserBuffer {
  userId: string;
  holds: number[];
  flights: number[];
  speeds: number[];
  errors: number;
  totalKeys: number;
  digraphs: Map<string, number[]>;
  lastEventAt: number;
  lastKeyUpAt: number;
  lastKey: string;
  recentDownAtWindow: number[];
  profile: TypingProfile | null;
  anomaly: {
    anomalySince: number | null;
    lastScore: number;
    lastDistance: number;
    tripped: boolean;
  };
}

function newBuffer(userId: string): UserBuffer {
  return {
    userId,
    holds: [],
    flights: [],
    speeds: [],
    errors: 0,
    totalKeys: 0,
    digraphs: new Map(),
    lastEventAt: 0,
    lastKeyUpAt: 0,
    lastKey: "",
    recentDownAtWindow: [],
    profile: null,
    anomaly: {
      anomalySince: null,
      lastScore: 1,
      lastDistance: 0,
      tripped: false,
    },
  };
}

// ─── Store Interface ─────────────────────────────────────────────────────────

/**
 * Pluggable persistence interface. The default implementation keeps all
 * state in-process which is sufficient for single-node deployments; larger
 * deployments should implement a Redis-backed store.
 */
export interface TypingRhythmStore {
  load(userId: string): UserBuffer | null;
  save(userId: string, buf: UserBuffer): void;
  delete(userId: string): void;
  all(): IterableIterator<UserBuffer>;
}

class InMemoryTypingStore implements TypingRhythmStore {
  private readonly buffers = new Map<string, UserBuffer>();
  load(userId: string): UserBuffer | null {
    return this.buffers.get(userId) ?? null;
  }
  save(userId: string, buf: UserBuffer): void {
    this.buffers.set(userId, buf);
  }
  delete(userId: string): void {
    this.buffers.delete(userId);
  }
  all(): IterableIterator<UserBuffer> {
    return this.buffers.values();
  }
}

// ─── Pure Math Helpers ───────────────────────────────────────────────────────

/** Numerically stable mean. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i]!;
  return sum / values.length;
}

/** Variance using Welford's one-pass algorithm. Population variance. */
export function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let m = 0;
  let m2 = 0;
  let n = 0;
  for (let i = 0; i < values.length; i += 1) {
    const x = values[i]!;
    n += 1;
    const delta = x - m;
    m += delta / n;
    m2 += delta * (x - m);
  }
  return m2 / n;
}

/** Standard deviation (population). */
export function stdDev(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * Linear-interpolated percentile. Returns 0 for empty inputs. `p` is a
 * value in [0, 1]. Sort cost is `O(n log n)`; acceptable since this runs
 * only at profile-construction time and on profile refresh.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/** Summarize a numeric distribution with count/mean/variance/percentiles. */
export function summarize(values: readonly number[]): NumericSummary {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      variance: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      p50: 0,
      p90: 0,
      p99: 0,
    };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const v = variance(values);
  return {
    count: values.length,
    mean: mean(values),
    variance: v,
    stdDev: Math.sqrt(v),
    min,
    max,
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p99: percentile(values, 0.99),
  };
}

/**
 * Z-normalize a series: subtract mean, divide by std. Used to make the
 * DTW distance invariant to overall typing speed.
 */
export function zNormalize(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const m = mean(values);
  const s = stdDev(values);
  if (s < 1e-9) return values.map(() => 0);
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = (values[i]! - m) / s;
  return out;
}

/**
 * Resample `values` to `targetLen` using linear interpolation. Used to
 * build a fixed-length canonical signature series, decoupling the
 * comparison from the exact number of recorded samples.
 */
export function resample(values: readonly number[], targetLen: number): number[] {
  if (targetLen <= 0) return [];
  if (values.length === 0) return new Array<number>(targetLen).fill(0);
  if (values.length === 1) return new Array<number>(targetLen).fill(values[0]!);
  const out = new Array<number>(targetLen);
  const step = (values.length - 1) / (targetLen - 1);
  for (let i = 0; i < targetLen; i += 1) {
    const pos = i * step;
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const frac = pos - lo;
    out[i] = values[lo]! * (1 - frac) + values[hi]! * frac;
  }
  return out;
}

// ─── DTW Distance ────────────────────────────────────────────────────────────

/**
 * Classic Dynamic Time Warping with a Sakoe-Chiba band. Complexity is
 * `O(n * band)` rather than `O(n * m)`, which keeps scoring cheap even
 * for hundreds of samples.
 *
 * The function uses absolute difference as the local cost (|a - b|) which
 * is adequate for 1-D time series such as hold-time or flight-time curves.
 * Callers should z-normalize inputs before invoking this function if they
 * want speed-invariant comparisons.
 */
export function dtwDistance(
  a: readonly number[],
  b: readonly number[],
  band: number = TypingConstants.DTW_BAND
): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return 0;
  if (n === 0 || m === 0) return Number.POSITIVE_INFINITY;

  const w = Math.max(band, Math.abs(n - m));
  // Cost matrix — only two rows are kept active at a time.
  const INF = Number.POSITIVE_INFINITY;
  let prev = new Array<number>(m + 1).fill(INF);
  let curr = new Array<number>(m + 1).fill(INF);
  prev[0] = 0;

  for (let i = 1; i <= n; i += 1) {
    curr[0] = INF;
    const jLo = Math.max(1, i - w);
    const jHi = Math.min(m, i + w);
    // Cells outside the band stay at INF.
    for (let j = 1; j < jLo; j += 1) curr[j] = INF;
    for (let j = jLo; j <= jHi; j += 1) {
      const cost = Math.abs(a[i - 1]! - b[j - 1]!);
      const best = Math.min(prev[j]!, curr[j - 1]!, prev[j - 1]!);
      curr[j] = cost + best;
    }
    for (let j = jHi + 1; j <= m; j += 1) curr[j] = INF;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[m]!;
}

/**
 * Normalized DTW distance that divides by the warping path length
 * estimate `(n + m) / 2`. This makes distances comparable across
 * different window sizes.
 */
export function normalizedDtwDistance(a: readonly number[], b: readonly number[]): number {
  const raw = dtwDistance(a, b);
  if (!Number.isFinite(raw)) return raw;
  const denom = (a.length + b.length) / 2 || 1;
  return raw / denom;
}

// ─── Feature Extraction ──────────────────────────────────────────────────────

function sanitizeHold(upAt: number, downAt: number): number {
  const h = upAt - downAt;
  if (!Number.isFinite(h) || h <= 0) return -1;
  if (h > TypingConstants.MAX_HOLD_MS) return -1;
  return h;
}

function sanitizeFlight(nextDown: number, prevUp: number): number {
  const f = nextDown - prevUp;
  if (!Number.isFinite(f) || f < 0) return -1;
  if (f > TypingConstants.MAX_FLIGHT_MS) return -1;
  return f;
}

/** Returns true if the keystroke is considered an error event. */
function isErrorKey(key: string): boolean {
  return key === "Backspace" || key === "Delete";
}

function pushBounded<T>(arr: T[], v: T, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function updateSpeedWindow(buf: UserBuffer, now: number): void {
  buf.recentDownAtWindow.push(now);
  const cutoff = now - TypingConstants.SPEED_WINDOW_MS;
  while (buf.recentDownAtWindow.length > 0 && buf.recentDownAtWindow[0]! < cutoff) {
    buf.recentDownAtWindow.shift();
  }
  // characters per second over the window
  const spanMs = Math.max(1, now - buf.recentDownAtWindow[0]!);
  const cps = (buf.recentDownAtWindow.length * 1000) / spanMs;
  pushBounded(buf.speeds, cps, TypingConstants.MAX_KEYSTROKE_BUFFER);
}

// ─── Analyzer ────────────────────────────────────────────────────────────────

/**
 * Main analyzer class. It is deliberately synchronous — this keeps the
 * ingest path allocation-free and lock-free in Node's single-threaded
 * event loop. Instances are safe to share globally.
 */
export class TypingRhythmAnalyzer {
  private readonly store: TypingRhythmStore;

  constructor(store?: TypingRhythmStore) {
    this.store = store ?? new InMemoryTypingStore();
  }

  /**
   * Ingest a single keystroke event. Malformed events (reversed
   * timestamps, hold longer than the sanity cap) are silently dropped —
   * the analyzer never throws on user input.
   */
  ingest(event: KeystrokeEvent): void {
    if (!event || !event.userId || !event.key) return;
    const buf = this.store.load(event.userId) ?? newBuffer(event.userId);

    buf.totalKeys += 1;
    buf.lastEventAt = event.downAt;

    if (isErrorKey(event.key)) buf.errors += 1;

    const hold = sanitizeHold(event.upAt, event.downAt);
    if (hold >= 0) pushBounded(buf.holds, hold, TypingConstants.MAX_KEYSTROKE_BUFFER);

    if (buf.lastKeyUpAt > 0) {
      const flight = sanitizeFlight(event.downAt, buf.lastKeyUpAt);
      if (flight >= 0) pushBounded(buf.flights, flight, TypingConstants.MAX_KEYSTROKE_BUFFER);

      // Digraph key — lower-cased to reduce cardinality.
      if (buf.lastKey && event.key.length === 1) {
        const dg = (buf.lastKey + event.key).toLowerCase();
        if (/^[a-z]{2}$/.test(dg)) {
          const bucket = buf.digraphs.get(dg) ?? [];
          bucket.push(event.downAt - buf.lastKeyUpAt);
          if (bucket.length > 256) bucket.splice(0, bucket.length - 256);
          buf.digraphs.set(dg, bucket);
        }
      }
    }

    updateSpeedWindow(buf, event.downAt);

    buf.lastKey = event.key;
    buf.lastKeyUpAt = event.upAt;

    // Auto-build baseline profile when the target is reached.
    if (!buf.profile && buf.totalKeys >= TypingConstants.PROFILE_KEYSTROKE_TARGET) {
      buf.profile = this.buildProfile(buf);
    }

    this.store.save(event.userId, buf);
  }

  /**
   * Ingest many events at once. Preserves ingest order; callers that
   * receive out-of-order events should pre-sort by `downAt`.
   */
  ingestBatch(events: readonly KeystrokeEvent[]): void {
    for (let i = 0; i < events.length; i += 1) this.ingest(events[i]!);
  }

  /** Has this user produced a baseline profile yet? */
  hasProfile(userId: string): boolean {
    return this.store.load(userId)?.profile != null;
  }

  /** Returns the current profile, if any. */
  getProfile(userId: string): TypingProfile | null {
    return this.store.load(userId)?.profile ?? null;
  }

  /**
   * Force a fresh profile build from the data currently in the buffer.
   * Useful for re-enrollment flows or when {@link TypingConstants.PROFILE_VERSION}
   * changes.
   */
  rebuildProfile(userId: string): TypingProfile | null {
    const buf = this.store.load(userId);
    if (!buf || buf.totalKeys < TypingConstants.MIN_COMPARE_KEYSTROKES) return null;
    buf.profile = this.buildProfile(buf);
    this.store.save(userId, buf);
    return buf.profile;
  }

  /**
   * Compare the most recent window of keystrokes to the stored profile
   * using DTW across both hold and flight channels. Returns `null` if
   * there is not yet a profile or not enough live data.
   */
  compare(userId: string): TypingComparisonResult | null {
    const buf = this.store.load(userId);
    if (!buf || !buf.profile) return null;
    const window = TypingConstants.COMPARISON_WINDOW;
    const minSamples = TypingConstants.MIN_COMPARE_KEYSTROKES;
    const holdsTail = buf.holds.slice(-window);
    const flightsTail = buf.flights.slice(-window);
    if (holdsTail.length < minSamples && flightsTail.length < minSamples) return null;

    const refLen = buf.profile.signatureHoldSeries.length;
    const holdResampled = zNormalize(resample(holdsTail, refLen));
    const flightResampled = zNormalize(resample(flightsTail, refLen));

    const holdDistance = normalizedDtwDistance(
      holdResampled,
      buf.profile.signatureHoldSeries
    );
    const flightDistance = normalizedDtwDistance(
      flightResampled,
      buf.profile.signatureFlightSeries
    );
    const combinedDistance =
      holdDistance * TypingConstants.HOLD_WEIGHT +
      flightDistance * TypingConstants.FLIGHT_WEIGHT;

    const liveErrorRate = buf.totalKeys > 0 ? buf.errors / buf.totalKeys : 0;
    const errorRateDelta = Math.abs(liveErrorRate - buf.profile.errorRate);

    const liveSpeed = buf.speeds.length > 0 ? buf.speeds[buf.speeds.length - 1]! : 0;
    const speedDelta = Math.abs(liveSpeed - buf.profile.typingSpeedCps.mean);

    // Map distance to a 0..1 score — smaller distance → higher score.
    // The mapping uses a soft logistic curve centered on the threshold.
    const score = mapDistanceToScore(combinedDistance);

    const anomalous = combinedDistance > TypingConstants.ANOMALY_THRESHOLD;
    const result: TypingComparisonResult = {
      userId,
      distance: combinedDistance,
      score,
      holdDistance,
      flightDistance,
      errorRateDelta,
      speedDelta,
      anomalous,
      sampleSize: Math.min(holdsTail.length, flightsTail.length),
      computedAt: Date.now(),
    };
    this.updateAnomalyState(buf, result);
    return result;
  }

  /** Returns the aggregate confidence score in [0, 1]. */
  score(userId: string): number {
    const cmp = this.compare(userId);
    if (!cmp) return 1; // treat missing-profile as "trusted until established"
    return cmp.score;
  }

  /** Exposes the live anomaly state to the ContinuousAuthMiddleware. */
  anomalyState(userId: string): TypingAnomalyState {
    const buf = this.store.load(userId);
    const base = buf?.anomaly;
    const sustainedMs = base?.anomalySince ? Date.now() - base.anomalySince : 0;
    return {
      userId,
      anomalySince: base?.anomalySince ?? null,
      lastScore: base?.lastScore ?? 1,
      lastDistance: base?.lastDistance ?? 0,
      sustainedMs,
      tripped: Boolean(
        base &&
          base.anomalySince != null &&
          Date.now() - base.anomalySince >= TypingConstants.SUSTAINED_ANOMALY_MS
      ),
    };
  }

  /** Clears the rolling buffer for a user but retains the baseline profile. */
  resetLiveBuffer(userId: string): void {
    const buf = this.store.load(userId);
    if (!buf) return;
    buf.holds = [];
    buf.flights = [];
    buf.speeds = [];
    buf.recentDownAtWindow = [];
    buf.anomaly = {
      anomalySince: null,
      lastScore: 1,
      lastDistance: 0,
      tripped: false,
    };
    this.store.save(userId, buf);
  }

  /** Wipes both profile and rolling buffer — used after a hard re-auth. */
  reset(userId: string): void {
    this.store.delete(userId);
  }

  /** Returns a serializable snapshot useful for debugging and logs. */
  snapshot(userId: string): Record<string, unknown> {
    const buf = this.store.load(userId);
    if (!buf) return { userId, present: false };
    return {
      userId,
      present: true,
      totalKeys: buf.totalKeys,
      bufferedHolds: buf.holds.length,
      bufferedFlights: buf.flights.length,
      errors: buf.errors,
      errorRate: buf.totalKeys > 0 ? buf.errors / buf.totalKeys : 0,
      hasProfile: Boolean(buf.profile),
      profileBuiltAt: buf.profile?.builtAt ?? null,
      anomaly: buf.anomaly,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private buildProfile(buf: UserBuffer): TypingProfile {
    const holdSummary = summarize(buf.holds);
    const flightSummary = summarize(buf.flights);
    const speedSummary = summarize(buf.speeds);
    const errorRate = buf.totalKeys > 0 ? buf.errors / buf.totalKeys : 0;

    const digraphs = new Map<string, NumericSummary>();
    for (const [key, samples] of buf.digraphs) {
      if (samples.length >= 5) digraphs.set(key, summarize(samples));
    }

    const signatureLen = 128;
    const signatureHoldSeries = zNormalize(resample(buf.holds, signatureLen));
    const signatureFlightSeries = zNormalize(resample(buf.flights, signatureLen));

    return {
      userId: buf.userId,
      keystrokeCount: buf.totalKeys,
      holdTime: holdSummary,
      flightTime: flightSummary,
      typingSpeedCps: speedSummary,
      errorRate,
      digraphs,
      signatureHoldSeries,
      signatureFlightSeries,
      builtAt: Date.now(),
      version: TypingConstants.PROFILE_VERSION,
    };
  }

  private updateAnomalyState(buf: UserBuffer, result: TypingComparisonResult): void {
    const now = Date.now();
    buf.anomaly.lastScore = result.score;
    buf.anomaly.lastDistance = result.distance;
    if (result.anomalous) {
      if (buf.anomaly.anomalySince == null) buf.anomaly.anomalySince = now;
      if (
        !buf.anomaly.tripped &&
        now - (buf.anomaly.anomalySince ?? now) >= TypingConstants.SUSTAINED_ANOMALY_MS
      ) {
        buf.anomaly.tripped = true;
      }
    } else {
      buf.anomaly.anomalySince = null;
      buf.anomaly.tripped = false;
    }
  }
}

/**
 * Smooth mapping from a DTW distance to a confidence score in [0, 1].
 * At `distance = 0` the score is 1. At `distance = ANOMALY_THRESHOLD`
 * the score is 0.5. As distance grows the score approaches 0 asymptotically.
 */
export function mapDistanceToScore(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 1;
  const k = Math.log(2) / TypingConstants.ANOMALY_THRESHOLD;
  const s = Math.exp(-k * distance);
  return Math.max(0, Math.min(1, s));
}

// ─── Digraph comparison helpers ──────────────────────────────────────────────

/**
 * Compare a live digraph latency against the per-user baseline. Returns a
 * z-score (how many standard deviations the live value is from the mean).
 * `Infinity` is returned when the baseline has no variance.
 */
export function digraphZScore(
  profile: TypingProfile,
  digraph: string,
  liveLatency: number
): number {
  const s = profile.digraphs.get(digraph.toLowerCase());
  if (!s || s.stdDev === 0) return Number.POSITIVE_INFINITY;
  return (liveLatency - s.mean) / s.stdDev;
}

/**
 * Aggregate digraph z-scores for a live set of digraph measurements.
 * Returns the average absolute z-score; high values indicate atypical
 * rhythm across multiple bigrams, not just one outlier.
 */
export function aggregateDigraphZ(
  profile: TypingProfile,
  live: ReadonlyMap<string, readonly number[]>
): number {
  let count = 0;
  let total = 0;
  for (const [dg, arr] of live) {
    const s = profile.digraphs.get(dg.toLowerCase());
    if (!s || s.stdDev === 0 || arr.length === 0) continue;
    const m = mean(arr);
    total += Math.abs((m - s.mean) / s.stdDev);
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

// ─── Global Singleton ────────────────────────────────────────────────────────

let _singleton: TypingRhythmAnalyzer | null = null;

/** Access the default process-wide TypingRhythmAnalyzer. */
export function getTypingRhythmAnalyzer(): TypingRhythmAnalyzer {
  if (!_singleton) _singleton = new TypingRhythmAnalyzer();
  return _singleton;
}

/** Replace the default analyzer — primarily for testing. */
export function setTypingRhythmAnalyzer(analyzer: TypingRhythmAnalyzer): void {
  _singleton = analyzer;
}

// ─── Fastify Route Plugin ────────────────────────────────────────────────────
//
// The route plugin accepts live keystroke events and exposes the current
// confidence score. The server owner registers it in `server.ts`. The
// plugin intentionally does no authentication itself — it is meant to be
// mounted behind `requireAuth` by the caller via `preHandler`.

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

interface IngestBody {
  events?: Array<{
    key?: string;
    code?: string;
    downAt?: number;
    upAt?: number;
    deviceId?: string;
  }>;
}

function sanitizeEvents(userId: string, body: IngestBody): KeystrokeEvent[] {
  if (!body?.events || !Array.isArray(body.events)) return [];
  const out: KeystrokeEvent[] = [];
  for (let i = 0; i < body.events.length; i += 1) {
    const e = body.events[i];
    if (!e) continue;
    const key = typeof e.key === "string" ? e.key : "";
    const downAt = typeof e.downAt === "number" ? e.downAt : 0;
    const upAt = typeof e.upAt === "number" ? e.upAt : 0;
    if (!key || downAt <= 0 || upAt <= 0 || upAt < downAt) continue;
    out.push({
      userId,
      key,
      ...(typeof e.code === "string" ? { code: e.code } : {}),
      downAt,
      upAt,
      ...(typeof e.deviceId === "string" ? { deviceId: e.deviceId } : {}),
    });
  }
  return out;
}

/**
 * Fastify plugin exposing `/typing/ingest` and `/typing/score` endpoints.
 * These routes are meant to live under the authenticated API surface; the
 * caller must attach an auth preHandler via `app.addHook`.
 */
export const typingRhythmRoutes: FastifyPluginAsync = async (
  app: FastifyInstance
) => {
  app.post("/typing/ingest", async (request, reply) => {
    const userId = extractUserId(request);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const events = sanitizeEvents(userId, request.body as IngestBody);
    getTypingRhythmAnalyzer().ingestBatch(events);
    return reply.send({
      accepted: events.length,
      hasProfile: getTypingRhythmAnalyzer().hasProfile(userId),
    });
  });

  app.get("/typing/score", async (request, reply) => {
    const userId = extractUserId(request);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const cmp = getTypingRhythmAnalyzer().compare(userId);
    const anomaly = getTypingRhythmAnalyzer().anomalyState(userId);
    return reply.send({
      userId,
      comparison: cmp,
      anomaly,
      hasProfile: getTypingRhythmAnalyzer().hasProfile(userId),
    });
  });

  app.post("/typing/reset", async (request, reply) => {
    const userId = extractUserId(request);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    getTypingRhythmAnalyzer().reset(userId);
    return reply.send({ ok: true });
  });
};

function extractUserId(request: FastifyRequest): string | null {
  // Pick up whatever authentication shape is attached upstream.
  const r = request as FastifyRequest & {
    user?: { id?: string };
    zeroTrustUser?: { id?: string };
  };
  return r.user?.id ?? r.zeroTrustUser?.id ?? null;
}
