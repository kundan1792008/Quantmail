/**
 * DeviceSensorAuth
 *
 * Builds a device confidence score from:
 *
 * Mobile sensors:
 *   - Gyroscope tilt patterns while holding the device
 *   - Accelerometer noise floor (unique per physical device)
 *
 * Desktop fingerprinting:
 *   - GPU fingerprint derived from WebGL renderer info
 *   - Audio context fingerprint (oscillator frequency response)
 *   - Screen colour profile (colour depth, pixel ratio, gamut)
 *
 * All fingerprint inputs are hashed into a stable device ID and
 * compared against the device IDs previously enrolled for the user.
 * The result is a [0, 1] device confidence score and a boolean
 * indicating whether the device is recognised.
 */

import { createHash } from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum number of stored device fingerprints needed before confidence
 * scoring is considered reliable.
 */
const MIN_ENROLLED_DEVICES = 1;

/**
 * Maximum number of devices that may be enrolled per user.
 * Exceeding this causes the oldest fingerprint to be evicted.
 */
const MAX_DEVICES_PER_USER = 10;

/**
 * How many gyroscope samples are required to form a tilt-pattern signature.
 */
const GYRO_SIGNATURE_SAMPLES = 100;

/**
 * Maximum standard deviation (deg/s) of gyroscope noise considered "normal"
 * for a stably-held device.  Significantly higher values suggest the device
 * is on a motorised mount or the readings are synthetic.
 */
const GYRO_NOISE_THRESHOLD = 15.0;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Gyroscope sample captured from the DeviceMotionEvent / sensor API. */
export interface GyroscopeSample {
  /** Rotation rate around X axis in degrees/second. */
  alpha: number;
  /** Rotation rate around Y axis in degrees/second. */
  beta: number;
  /** Rotation rate around Z axis in degrees/second. */
  gamma: number;
  /** Unix timestamp (ms). */
  timestamp: number;
}

/** Accelerometer sample. */
export interface AccelerometerSample {
  /** Acceleration along X axis in m/s². */
  x: number;
  /** Acceleration along Y axis in m/s². */
  y: number;
  /** Acceleration along Z axis in m/s². */
  z: number;
  /** Unix timestamp (ms). */
  timestamp: number;
}

/** WebGL GPU fingerprint payload (extracted in the browser). */
export interface WebGLFingerprint {
  /** WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL string. */
  renderer: string;
  /** WEBGL_debug_renderer_info UNMASKED_VENDOR_WEBGL string. */
  vendor: string;
  /** Max texture size. */
  maxTextureSize: number;
  /** Supported extension count. */
  extensionCount: number;
  /** Floating-point hash of a rendered gradient canvas (browser-side). */
  canvasHash: string;
}

/** Audio context fingerprint payload (extracted in the browser). */
export interface AudioFingerprint {
  /**
   * Sum of oscillator output samples after passing through a biquad filter.
   * This value is stable per browser/OS/hardware combination.
   */
  sampleSum: number;
  /** Sample rate of the AudioContext. */
  sampleRate: number;
  /** Channel count. */
  channelCount: number;
}

/** Screen / colour profile payload. */
export interface ScreenProfile {
  /** Screen colour depth (bits). */
  colorDepth: number;
  /** Device pixel ratio. */
  pixelRatio: number;
  /** Screen width in physical pixels. */
  screenWidth: number;
  /** Screen height in physical pixels. */
  screenHeight: number;
  /** Whether the CSS `color-gamut: p3` media query matched. */
  hasP3Gamut: boolean;
  /** Whether HDR is available (`dynamic-range: high`). */
  hasHDR: boolean;
}

/** Full device telemetry payload sent from the client. */
export interface DeviceTelemetry {
  /** Platform hint: "mobile" or "desktop". */
  platform: "mobile" | "desktop";
  gyroSamples?: GyroscopeSample[];
  accelSamples?: AccelerometerSample[];
  webgl?: WebGLFingerprint;
  audio?: AudioFingerprint;
  screen?: ScreenProfile;
  /** ISO timestamp of collection. */
  collectedAt: string;
}

/** Result of a device confidence evaluation. */
export interface DeviceAuthResult {
  userId: string;
  deviceId: string;
  isKnownDevice: boolean;
  confidence: number;
  signals: {
    gyroScore: number;
    accelScore: number;
    webglScore: number;
    audioScore: number;
    screenScore: number;
  };
  anomalies: string[];
  evaluatedAt: string;
}

/** An enrolled device record. */
export interface EnrolledDevice {
  deviceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  platform: "mobile" | "desktop";
  /** Confidence score at enrolment time. */
  enrolledConfidence: number;
}

// ─── In-memory device store ───────────────────────────────────────────────────

const enrolledDeviceStore = new Map<string, EnrolledDevice[]>();

// ─── Fingerprint Hashing ──────────────────────────────────────────────────────

/**
 * Produces a stable 64-hex-character device ID from raw fingerprint signals.
 */
export function computeDeviceId(telemetry: DeviceTelemetry): string {
  const components: string[] = [telemetry.platform];

  if (telemetry.webgl) {
    components.push(
      telemetry.webgl.renderer,
      telemetry.webgl.vendor,
      String(telemetry.webgl.maxTextureSize),
      String(telemetry.webgl.extensionCount),
      telemetry.webgl.canvasHash
    );
  }

  if (telemetry.audio) {
    // Round to 4 decimal places to tolerate minor floating-point jitter
    components.push(
      telemetry.audio.sampleSum.toFixed(4),
      String(telemetry.audio.sampleRate),
      String(telemetry.audio.channelCount)
    );
  }

  if (telemetry.screen) {
    components.push(
      String(telemetry.screen.colorDepth),
      telemetry.screen.pixelRatio.toFixed(2),
      String(telemetry.screen.screenWidth),
      String(telemetry.screen.screenHeight),
      String(telemetry.screen.hasP3Gamut),
      String(telemetry.screen.hasHDR)
    );
  }

  return createHash("sha256").update(components.join("|")).digest("hex");
}

// ─── Gyroscope Analysis ───────────────────────────────────────────────────────

/**
 * Analyses gyroscope samples to produce a [0, 1] score.
 *
 * A high score indicates natural, human-like holding patterns (low
 * micro-tremor noise consistent with a human hand).
 * A near-zero score indicates impossible stillness (clamped device or
 * synthetic data) or excessive noise (device on a moving surface).
 */
export function analyseGyroscope(samples: GyroscopeSample[]): number {
  if (samples.length < GYRO_SIGNATURE_SAMPLES) {
    // Insufficient data → neutral score
    return 0.5;
  }

  const alphas = samples.map((s) => s.alpha);
  const betas = samples.map((s) => s.beta);
  const gammas = samples.map((s) => s.gamma);

  const stdAlpha = stdDev(alphas);
  const stdBeta = stdDev(betas);
  const stdGamma = stdDev(gammas);
  const avgStd = (stdAlpha + stdBeta + stdGamma) / 3;

  // Perfect human tremor: ~0.5–5.0 deg/s std
  // Too still: < 0.05 deg/s (clamp or synthetic)
  // Too noisy: > GYRO_NOISE_THRESHOLD (motorised / synthetic)
  if (avgStd < 0.05) return 0.1; // Suspiciously still
  if (avgStd > GYRO_NOISE_THRESHOLD) return 0.1; // Suspiciously noisy

  // Score peaks in the 0.5–5.0 range
  const ideal = 2.5;
  const distance = Math.abs(avgStd - ideal) / ideal;
  return Math.max(0, 1 - distance);
}

// ─── Accelerometer Analysis ───────────────────────────────────────────────────

/**
 * Analyses accelerometer samples to produce a [0, 1] score.
 *
 * Each physical device has a characteristic noise floor (quantisation
 * noise, sensor bias).  The noise floor is derived from the standard
 * deviation of readings while the device is approximately stationary.
 */
export function analyseAccelerometer(samples: AccelerometerSample[]): number {
  if (samples.length < 10) return 0.5;

  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);
  const zs = samples.map((s) => s.z);

  const noiseFloor = (stdDev(xs) + stdDev(ys) + stdDev(zs)) / 3;

  // A legitimate mobile device at rest will have a noise floor of ~0.01–0.5 m/s².
  // Values outside this band suggest synthetic or uncalibrated data.
  if (noiseFloor < 0.005) return 0.15;
  if (noiseFloor > 5.0) return 0.15;

  return 0.9; // Plausible noise floor
}

// ─── WebGL Analysis ───────────────────────────────────────────────────────────

/**
 * Scores a WebGL fingerprint on [0, 1].
 * Missing or clearly-spoofed GPU info reduces the score.
 */
export function analyseWebGL(fp: WebGLFingerprint | undefined): number {
  if (!fp) return 0.3;

  // Normalise for case-insensitive, whitespace-tolerant comparison to prevent
  // trivial spoofing bypasses (e.g. 'Unknown', 'UNKNOWN', ' unknown ').
  const renderer = fp.renderer.trim().toLowerCase();
  const vendor = fp.vendor.trim().toLowerCase();

  // Empty renderer or vendor strings indicate driver-level spoofing
  if (!renderer || renderer === "unknown" || vendor === "unknown") {
    return 0.2;
  }

  // Suspiciously small canvas hash (e.g., all-zero) is a signal of canvas
  // fingerprint blocking/spoofing
  if (!fp.canvasHash || /^0+$/.test(fp.canvasHash)) {
    return 0.4;
  }

  // Reasonable GPU detected
  return 0.95;
}

// ─── Audio Analysis ───────────────────────────────────────────────────────────

/**
 * Scores an audio fingerprint on [0, 1].
 */
export function analyseAudio(fp: AudioFingerprint | undefined): number {
  if (!fp) return 0.3;

  // sampleSum = 0 means the browser blocked audio context fingerprinting
  if (fp.sampleSum === 0) return 0.3;

  // Implausibly low or high sample rates are spoofing indicators
  if (fp.sampleRate < 8_000 || fp.sampleRate > 192_000) return 0.2;

  return 0.9;
}

// ─── Screen Analysis ──────────────────────────────────────────────────────────

/**
 * Scores a screen profile on [0, 1].
 */
export function analyseScreen(profile: ScreenProfile | undefined): number {
  if (!profile) return 0.3;

  // Non-standard colour depth (not 24/30/32) is unusual on real hardware
  if (![24, 30, 32].includes(profile.colorDepth)) return 0.5;

  // Pixel ratio of exactly 1 on a "mobile" device is suspicious
  // (real phones almost always have ratio ≥ 2)
  // Note: we don't have the platform flag here, so we score conservatively.
  if (profile.pixelRatio <= 0) return 0.2;

  return 0.9;
}

// ─── Device Enrolment ─────────────────────────────────────────────────────────

/**
 * Returns the enrolled devices for a user.
 */
export function getEnrolledDevices(userId: string): EnrolledDevice[] {
  return enrolledDeviceStore.get(userId) ?? [];
}

/**
 * Enrolls a device fingerprint for a user.
 * If the device is already enrolled, updates its `lastSeenAt` timestamp.
 * If `MAX_DEVICES_PER_USER` is reached, evicts the oldest device.
 */
export function enrollDevice(
  userId: string,
  deviceId: string,
  platform: "mobile" | "desktop",
  confidence: number
): EnrolledDevice {
  const devices = enrolledDeviceStore.get(userId) ?? [];
  const existing = devices.find((d) => d.deviceId === deviceId);

  if (existing) {
    existing.lastSeenAt = new Date().toISOString();
    enrolledDeviceStore.set(userId, devices);
    return existing;
  }

  // Evict oldest if at capacity
  if (devices.length >= MAX_DEVICES_PER_USER) {
    devices.sort(
      (a, b) =>
        new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()
    );
    devices.shift();
  }

  const enrolled: EnrolledDevice = {
    deviceId,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    platform,
    enrolledConfidence: confidence,
  };
  devices.push(enrolled);
  enrolledDeviceStore.set(userId, devices);
  return enrolled;
}

/**
 * Removes a specific device from a user's enrolled device list.
 */
export function revokeDevice(userId: string, deviceId: string): boolean {
  const devices = enrolledDeviceStore.get(userId) ?? [];
  const before = devices.length;
  const filtered = devices.filter((d) => d.deviceId !== deviceId);
  enrolledDeviceStore.set(userId, filtered);
  return filtered.length < before;
}

// ─── Confidence Scoring ───────────────────────────────────────────────────────

/**
 * Evaluates device telemetry against the stored profile for a user.
 *
 * Returns a DeviceAuthResult with:
 *   - deviceId (stable hash of telemetry)
 *   - isKnownDevice (found in user's enrolled devices list)
 *   - confidence [0, 1]
 *   - per-signal scores
 *   - list of detected anomalies
 */
export function evaluateDeviceTelemetry(
  userId: string,
  telemetry: DeviceTelemetry
): DeviceAuthResult {
  const deviceId = computeDeviceId(telemetry);
  const enrolledDevices = getEnrolledDevices(userId);
  const isKnownDevice = enrolledDevices.some((d) => d.deviceId === deviceId);
  const anomalies: string[] = [];

  // ── Signal scores ─────────────────────────────────────────────────────────
  let gyroScore = 0.5;
  let accelScore = 0.5;

  if (telemetry.platform === "mobile") {
    if (telemetry.gyroSamples && telemetry.gyroSamples.length > 0) {
      gyroScore = analyseGyroscope(telemetry.gyroSamples);
      if (gyroScore < 0.3) anomalies.push("ABNORMAL_GYROSCOPE_PATTERN");
    }
    if (telemetry.accelSamples && telemetry.accelSamples.length > 0) {
      accelScore = analyseAccelerometer(telemetry.accelSamples);
      if (accelScore < 0.3) anomalies.push("ABNORMAL_ACCELEROMETER_NOISE");
    }
  }

  const webglScore = analyseWebGL(telemetry.webgl);
  if (webglScore < 0.4) anomalies.push("WEBGL_FINGERPRINT_SUSPICIOUS");

  const audioScore = analyseAudio(telemetry.audio);
  if (audioScore < 0.4) anomalies.push("AUDIO_FINGERPRINT_BLOCKED");

  const screenScore = analyseScreen(telemetry.screen);
  if (screenScore < 0.4) anomalies.push("SCREEN_PROFILE_ANOMALY");

  if (!isKnownDevice && enrolledDevices.length >= MIN_ENROLLED_DEVICES) {
    anomalies.push("UNKNOWN_DEVICE");
  }

  // ── Aggregate confidence ──────────────────────────────────────────────────
  // Weight: known-device check counts for 30 %; sensor/fingerprint signals 70 %
  const signalScore =
    telemetry.platform === "mobile"
      ? (gyroScore * 0.25 +
          accelScore * 0.25 +
          webglScore * 0.2 +
          audioScore * 0.15 +
          screenScore * 0.15)
      : (webglScore * 0.4 + audioScore * 0.35 + screenScore * 0.25);

  const deviceBonus = isKnownDevice ? 0.3 : 0;
  const confidence = Math.min(1, signalScore * 0.7 + deviceBonus);

  // Update last-seen for known device
  if (isKnownDevice) {
    const device = enrolledDevices.find((d) => d.deviceId === deviceId);
    if (device) device.lastSeenAt = new Date().toISOString();
  }

  return {
    userId,
    deviceId,
    isKnownDevice,
    confidence,
    signals: {
      gyroScore,
      accelScore,
      webglScore,
      audioScore,
      screenScore,
    },
    anomalies,
    evaluatedAt: new Date().toISOString(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
