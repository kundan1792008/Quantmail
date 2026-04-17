/**
 * TypingRhythmAnalyzer
 *
 * Continuously verifies user identity through keystroke dynamics:
 *   - Hold time per key (dwell time)
 *   - Flight time between keys (inter-key latency)
 *   - Typing speed (keys per minute)
 *   - Error rate and backspace frequency
 *
 * Per-user profiles are built from the first 2 000 keystrokes.
 * Live typing is compared against the stored profile using Dynamic Time
 * Warping (DTW) distance. If the distance exceeds the anomaly threshold
 * for 30 consecutive seconds, an anomaly is flagged.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of keystrokes required to consider the profile "mature". */
const PROFILE_BOOTSTRAP_KEYSTROKES = 2_000;

/**
 * DTW distance above which a single window is considered suspicious.
 * Calibrated empirically; legitimate users typically score below 0.35.
 */
const DTW_ANOMALY_THRESHOLD = 0.45;

/** Window size (number of digraphs) used for each live comparison. */
const COMPARISON_WINDOW_SIZE = 50;

/** Milliseconds of continuous anomaly required before flagging. */
const ANOMALY_DURATION_MS = 30_000;

/** Maximum number of keystroke events retained per user profile. */
const MAX_PROFILE_EVENTS = 5_000;

/** Maximum inter-key pause (ms) allowed within a digraph; longer gaps are dropped. */
const MAX_INTER_KEY_PAUSE_MS = 5_000;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** A single raw keystroke event captured from the browser. */
export interface KeystrokeEvent {
  /** DOM key name, e.g. "a", "Backspace", " ". */
  key: string;
  /** Unix timestamp (ms) when the key was pressed down. */
  pressedAt: number;
  /** Unix timestamp (ms) when the key was released. */
  releasedAt: number;
}

/**
 * A digraph is a pair of consecutive keystrokes.  It encapsulates:
 *   - hold time of the first key (dwell)
 *   - flight time from first key release to second key press
 */
export interface Digraph {
  holdTime: number;
  flightTime: number;
}

/** Per-user typing profile stored in memory. */
export interface TypingProfile {
  userId: string;
  /** Raw keystroke history used to build/update the profile. */
  keystrokeHistory: KeystrokeEvent[];
  /** Mean digraph vector (hold, flight) pairs – the "template". */
  templateDigraphs: Digraph[];
  /** Running estimate of words per minute. */
  avgWPM: number;
  /** Fraction of keystrokes that are backspaces. */
  backspaceRate: number;
  /** Whether the profile has enough data to be used for comparison. */
  mature: boolean;
  /** ISO timestamp when the profile was last updated. */
  updatedAt: string;
}

/** Result of a single live-session comparison. */
export interface TypingComparisonResult {
  userId: string;
  dtwDistance: number;
  isAnomaly: boolean;
  confidence: number;
  windowSize: number;
  sampledAt: string;
}

/** Anomaly window tracking state per user (in-memory). */
interface AnomalyWindow {
  firstAnomalyAt: number | null;
  consecutiveAnomalyMs: number;
  lastEvaluatedAt: number;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

const profileStore = new Map<string, TypingProfile>();
const anomalyWindows = new Map<string, AnomalyWindow>();

// ─── DTW Implementation ───────────────────────────────────────────────────────

/**
 * Computes the Euclidean distance between two digraphs.
 * Both hold time and flight time are normalised to [0, 1] by dividing by a
 * reference value of 500 ms before computing the norm.
 */
function digraphDistance(a: Digraph, b: Digraph): number {
  const REF = 500;
  const dHold = (a.holdTime - b.holdTime) / REF;
  const dFlight = (a.flightTime - b.flightTime) / REF;
  return Math.sqrt(dHold * dHold + dFlight * dFlight);
}

/**
 * Classic O(n·m) DTW algorithm on sequences of Digraphs.
 *
 * Returns the normalised DTW distance (divided by path length).
 * A value of 0 means perfect match; higher values indicate greater deviation.
 */
export function computeDTW(seq1: Digraph[], seq2: Digraph[]): number {
  const n = seq1.length;
  const m = seq2.length;

  if (n === 0 || m === 0) return 1;

  // Allocate cost matrix filled with Infinity
  const cost: number[][] = Array.from({ length: n }, () =>
    new Array<number>(m).fill(Infinity)
  );

  cost[0]![0] = digraphDistance(seq1[0]!, seq2[0]!);

  for (let i = 1; i < n; i++) {
    cost[i]![0] = cost[i - 1]![0]! + digraphDistance(seq1[i]!, seq2[0]!);
  }
  for (let j = 1; j < m; j++) {
    cost[0]![j] = cost[0]![j - 1]! + digraphDistance(seq1[0]!, seq2[j]!);
  }

  for (let i = 1; i < n; i++) {
    for (let j = 1; j < m; j++) {
      const d = digraphDistance(seq1[i]!, seq2[j]!);
      cost[i]![j] =
        d +
        Math.min(cost[i - 1]![j]!, cost[i]![j - 1]!, cost[i - 1]![j - 1]!);
    }
  }

  // Normalise by the optimal path length (n + m - 1)
  const rawDTW = cost[n - 1]![m - 1]!;
  return rawDTW / (n + m - 1);
}

// ─── Digraph Extraction ───────────────────────────────────────────────────────

/**
 * Converts an ordered sequence of KeystrokeEvents into a digraph sequence.
 * Events must be sorted by `pressedAt` ascending.
 */
export function extractDigraphs(events: KeystrokeEvent[]): Digraph[] {
  const digraphs: Digraph[] = [];

  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i]!;
    const next = events[i + 1]!;

    const holdTime = Math.max(0, current.releasedAt - current.pressedAt);
    const flightTime = Math.max(0, next.pressedAt - current.releasedAt);

    // Discard digraphs with implausibly long gaps – likely pauses between words.
    if (flightTime > MAX_INTER_KEY_PAUSE_MS) continue;

    digraphs.push({ holdTime, flightTime });
  }

  return digraphs;
}

// ─── Profile Management ───────────────────────────────────────────────────────

/**
 * Retrieves (or lazily creates) the typing profile for the given user.
 */
export function getProfile(userId: string): TypingProfile {
  if (!profileStore.has(userId)) {
    profileStore.set(userId, {
      userId,
      keystrokeHistory: [],
      templateDigraphs: [],
      avgWPM: 0,
      backspaceRate: 0,
      mature: false,
      updatedAt: new Date().toISOString(),
    });
  }
  return profileStore.get(userId)!;
}

/**
 * Rebuilds the template digraph sequence from the stored keystroke history.
 * Uses the median of each position across overlapping windows to produce a
 * noise-resistant representative sequence.
 */
function rebuildTemplate(profile: TypingProfile): void {
  const digraphs = extractDigraphs(profile.keystrokeHistory);

  if (digraphs.length < COMPARISON_WINDOW_SIZE) {
    profile.templateDigraphs = digraphs;
    return;
  }

  // Aggregate all windows of COMPARISON_WINDOW_SIZE into buckets per position,
  // then take the median hold/flight times.
  const holdBuckets: number[][] = Array.from(
    { length: COMPARISON_WINDOW_SIZE },
    () => []
  );
  const flightBuckets: number[][] = Array.from(
    { length: COMPARISON_WINDOW_SIZE },
    () => []
  );

  const stride = Math.max(1, Math.floor(COMPARISON_WINDOW_SIZE / 2));
  for (let start = 0; start + COMPARISON_WINDOW_SIZE <= digraphs.length; start += stride) {
    for (let k = 0; k < COMPARISON_WINDOW_SIZE; k++) {
      holdBuckets[k]!.push(digraphs[start + k]!.holdTime);
      flightBuckets[k]!.push(digraphs[start + k]!.flightTime);
    }
  }

  profile.templateDigraphs = holdBuckets.map((holds, k) => ({
    holdTime: median(holds),
    flightTime: median(flightBuckets[k]!),
  }));
}

/** Returns the median value of a numeric array. */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Computes statistics from a keystroke event array.
 * Returns avgWPM and backspaceRate.
 */
function computeStats(
  events: KeystrokeEvent[]
): { avgWPM: number; backspaceRate: number } {
  if (events.length < 2) return { avgWPM: 0, backspaceRate: 0 };

  const backspaces = events.filter((e) => e.key === "Backspace").length;
  const backspaceRate = backspaces / events.length;

  // Approximate WPM: assume average word length of 5 chars.
  const durationMin =
    (events[events.length - 1]!.pressedAt - events[0]!.pressedAt) / 60_000;
  const avgWPM =
    durationMin > 0 ? events.length / 5 / durationMin : 0;

  return { avgWPM, backspaceRate };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ingests a batch of keystroke events for a user.
 *
 * - If the profile is still bootstrapping, appends events to history and
 *   marks the profile as mature once 2 000 keystrokes have been recorded.
 * - If the profile is mature, triggers a live comparison.
 *
 * Returns the comparison result once the profile is mature, or null during
 * the bootstrapping phase.
 */
export function ingestKeystrokes(
  userId: string,
  events: KeystrokeEvent[]
): TypingComparisonResult | null {
  if (events.length === 0) return null;

  const profile = getProfile(userId);

  // Append events, capping the history at MAX_PROFILE_EVENTS
  profile.keystrokeHistory.push(...events);
  if (profile.keystrokeHistory.length > MAX_PROFILE_EVENTS) {
    profile.keystrokeHistory = profile.keystrokeHistory.slice(
      profile.keystrokeHistory.length - MAX_PROFILE_EVENTS
    );
  }

  const stats = computeStats(profile.keystrokeHistory);
  profile.avgWPM = stats.avgWPM;
  profile.backspaceRate = stats.backspaceRate;
  profile.updatedAt = new Date().toISOString();

  // Not yet mature: just accumulate
  if (profile.keystrokeHistory.length < PROFILE_BOOTSTRAP_KEYSTROKES) {
    return null;
  }

  // Mark mature and rebuild template on first crossing of the threshold
  if (!profile.mature) {
    profile.mature = true;
    rebuildTemplate(profile);
  }

  // Compare the most-recent window against the template
  return compareLiveWindow(userId, events);
}

/**
 * Compares the latest keystroke events against the user's stored template.
 *
 * Returns a TypingComparisonResult with the DTW distance, anomaly flag,
 * and a [0, 1] confidence score.
 */
export function compareLiveWindow(
  userId: string,
  liveEvents: KeystrokeEvent[]
): TypingComparisonResult {
  const profile = getProfile(userId);
  const now = Date.now();

  const liveDigraphs = extractDigraphs(liveEvents);

  if (liveDigraphs.length === 0 || profile.templateDigraphs.length === 0) {
    return {
      userId,
      dtwDistance: 1,
      isAnomaly: false,
      confidence: 0.5,
      windowSize: 0,
      sampledAt: new Date().toISOString(),
    };
  }

  // Use the last COMPARISON_WINDOW_SIZE digraphs from the live window
  const window = liveDigraphs.slice(-COMPARISON_WINDOW_SIZE);
  const dtwDistance = computeDTW(window, profile.templateDigraphs);

  const isAnomaly = dtwDistance > DTW_ANOMALY_THRESHOLD;

  // Update anomaly tracking
  let anomaly = anomalyWindows.get(userId);
  if (!anomaly) {
    anomaly = { firstAnomalyAt: null, consecutiveAnomalyMs: 0, lastEvaluatedAt: now };
    anomalyWindows.set(userId, anomaly);
  }

  const elapsed = now - anomaly.lastEvaluatedAt;
  anomaly.lastEvaluatedAt = now;

  if (isAnomaly) {
    if (anomaly.firstAnomalyAt === null) {
      anomaly.firstAnomalyAt = now;
      anomaly.consecutiveAnomalyMs = 0;
    } else {
      anomaly.consecutiveAnomalyMs += elapsed;
    }
  } else {
    anomaly.firstAnomalyAt = null;
    anomaly.consecutiveAnomalyMs = 0;
  }

  const sustainedAnomaly = anomaly.consecutiveAnomalyMs >= ANOMALY_DURATION_MS;

  // Map DTW distance to a [0, 1] confidence score.
  // DTW of 0 → confidence 1.0; DTW of ≥ 1.0 → confidence 0.0.
  const confidence = Math.max(0, Math.min(1, 1 - dtwDistance));

  return {
    userId,
    dtwDistance,
    isAnomaly: isAnomaly || sustainedAnomaly,
    confidence,
    windowSize: window.length,
    sampledAt: new Date().toISOString(),
  };
}

/**
 * Clears an anomaly state for a user (e.g., after successful re-auth).
 */
export function clearAnomalyState(userId: string): void {
  anomalyWindows.delete(userId);
}

/**
 * Resets a user's profile entirely (e.g., on confirmed account takeover).
 */
export function resetProfile(userId: string): void {
  profileStore.delete(userId);
  anomalyWindows.delete(userId);
}

/**
 * Returns a read-only snapshot of a user's current profile.
 * Returns null if no profile exists.
 */
export function getProfileSnapshot(userId: string): Readonly<TypingProfile> | null {
  return profileStore.get(userId) ?? null;
}

/**
 * Returns the current anomaly window state for a user.
 */
export function getAnomalyState(userId: string): Readonly<AnomalyWindow> | null {
  return anomalyWindows.get(userId) ?? null;
}
