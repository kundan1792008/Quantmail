/**
 * DeviceSensorAuth
 * ================
 *
 * Device-level behavioral biometric layer. Combines two very different
 * signal sources into a single confidence score that can be consumed by
 * {@link ContinuousAuthMiddleware}:
 *
 *   Mobile:
 *     - Gyroscope tilt patterns while the user holds the phone.
 *     - Accelerometer "noise floor" at rest — this is surprisingly stable
 *       per device because of manufacturing tolerances in the MEMS
 *       sensors.
 *     - Orientation / pitch / roll distributions.
 *
 *   Desktop:
 *     - GPU / WebGL renderer string + vendor.
 *     - AudioContext fingerprint (OfflineAudioContext oscillator hash).
 *     - Screen color profile (color depth, width, height, gamut, DPR).
 *     - Installed font / plugin hashes provided by the client.
 *
 * For each user the module stores a *device signature*. Every subsequent
 * ping compares the live sensor reading against the signature and emits
 * a 0..1 score. If the signature drifts too far, the middleware treats
 * it as an anomaly identical to a failing typing/mouse check.
 *
 * All server-side work is deterministic and synchronous: the heavy
 * lifting (WebGL probing, audio oscillator sampling) happens on the
 * client and is delivered here as a JSON bundle.
 */

import { createHash } from "node:crypto";

// ─── Public Types ────────────────────────────────────────────────────────────

export type DeviceKind = "mobile" | "desktop";

/** One raw sample from a motion sensor. All axes in m/s² or rad/s. */
export interface MotionSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A single "tick" of orientation data. */
export interface OrientationSample {
  readonly t: number;
  readonly alpha: number; // z-axis rotation (0..360°)
  readonly beta: number; // x-axis tilt (-180..180°)
  readonly gamma: number; // y-axis tilt (-90..90°)
}

/**
 * Payload submitted by a mobile device. Sample rates are expected to be
 * at least ~20 Hz; bursts shorter than 2 seconds are rejected.
 */
export interface MobileSensorBundle {
  readonly deviceKind: "mobile";
  readonly deviceId: string;
  readonly capturedAt: number;
  readonly gyroscope: readonly MotionSample[];
  readonly accelerometer: readonly MotionSample[];
  readonly orientation?: readonly OrientationSample[];
  readonly screen?: ScreenInfo;
  readonly userAgent?: string;
}

/**
 * Payload submitted by a desktop device. The client precomputes the
 * fingerprints locally and sends only the hashed / truncated results —
 * this keeps us from inhaling megabytes of WebGL probe output.
 */
export interface DesktopSensorBundle {
  readonly deviceKind: "desktop";
  readonly deviceId: string;
  readonly capturedAt: number;
  readonly webgl?: WebGlFingerprint;
  readonly audio?: AudioFingerprint;
  readonly screen?: ScreenInfo;
  readonly fontHash?: string;
  readonly pluginHash?: string;
  readonly userAgent?: string;
  readonly timezone?: string;
  readonly languages?: readonly string[];
}

export type DeviceSensorBundle = MobileSensorBundle | DesktopSensorBundle;

export interface WebGlFingerprint {
  readonly vendor?: string;
  readonly renderer?: string;
  readonly version?: string;
  readonly shadingLanguageVersion?: string;
  readonly maxTextureSize?: number;
  readonly extensionsHash?: string;
}

export interface AudioFingerprint {
  readonly sampleRate?: number;
  readonly oscillatorHash?: string;
  readonly outputHash?: string;
  readonly channelCount?: number;
}

export interface ScreenInfo {
  readonly width: number;
  readonly height: number;
  readonly colorDepth?: number;
  readonly pixelRatio?: number;
  readonly gamut?: string;
  readonly orientation?: string;
}

/**
 * Per-user, per-device stored signature. Everything is a number or hash
 * so the whole object is cheap to serialize to JSON / Postgres.
 */
export interface DeviceSignature {
  readonly userId: string;
  readonly deviceId: string;
  readonly deviceKind: DeviceKind;
  readonly sampleCount: number;
  readonly updatedAt: number;
  readonly version: number;

  // Mobile features
  readonly gyroMagnitudeMean: number;
  readonly gyroMagnitudeStd: number;
  readonly accelNoiseFloor: number;
  readonly accelNoiseStd: number;
  readonly tiltBetaMean: number;
  readonly tiltGammaMean: number;
  readonly tiltBetaStd: number;
  readonly tiltGammaStd: number;
  readonly gravityMagnitudeMean: number;

  // Desktop features
  readonly webglVendorHash: string;
  readonly webglRendererHash: string;
  readonly webglExtensionsHash: string;
  readonly audioOscillatorHash: string;
  readonly audioSampleRate: number;
  readonly fontHash: string;
  readonly pluginHash: string;
  readonly timezone: string;
  readonly languageHash: string;

  // Shared
  readonly screenHash: string;
  readonly userAgentHash: string;
}

export interface DeviceComparisonResult {
  readonly userId: string;
  readonly deviceId: string;
  readonly deviceKind: DeviceKind;
  readonly score: number; // 0..1, 1 = identical
  readonly distance: number;
  readonly anomalous: boolean;
  readonly mismatches: readonly string[];
  readonly computedAt: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DeviceSensorConstants = Object.freeze({
  MIN_MOTION_SAMPLES: 40,
  MAX_MOTION_SAMPLES: 5_000,
  MIN_SAMPLE_SPAN_MS: 2_000,
  SIGNATURE_VERSION: 1,
  ANOMALY_THRESHOLD: 0.55, // distance above this ⇒ anomaly
  // Weighting of individual mismatch contributions to the total distance.
  WEIGHTS: Object.freeze({
    webglVendor: 0.12,
    webglRenderer: 0.15,
    webglExtensions: 0.08,
    audioHash: 0.1,
    audioSampleRate: 0.05,
    fontHash: 0.05,
    pluginHash: 0.05,
    timezone: 0.05,
    screen: 0.05,
    userAgent: 0.05,
    languages: 0.03,
    gyro: 0.1,
    accel: 0.07,
    tilt: 0.05,
  }),
} as const);

// ─── Hashing & small utilities ───────────────────────────────────────────────

/** Short, stable SHA-256 hex digest. Empty inputs hash to empty string. */
export function stableHash(input: string | undefined | null, bytes = 16): string {
  if (input == null || input === "") return "";
  return createHash("sha256").update(input).digest("hex").slice(0, bytes * 2);
}

function hashMany(parts: readonly (string | number | undefined | null)[]): string {
  const joined = parts
    .map((p) => (p == null ? "" : String(p)))
    .join("|");
  return stableHash(joined);
}

function clampMagnitudeSeries(samples: readonly MotionSample[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!;
    const m = Math.hypot(s.x, s.y, s.z);
    if (Number.isFinite(m)) out.push(m);
  }
  return out;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i += 1) s += xs[i]!;
  return s / xs.length;
}

function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const d = xs[i]! - m;
    acc += d * d;
  }
  return Math.sqrt(acc / xs.length);
}

/**
 * Noise floor — the standard deviation of the high-frequency component
 * of the accelerometer magnitude after subtracting a 5-sample moving
 * average. Bot / emulator accelerometer streams are typically too clean
 * here, while real devices have a ~0.02..0.06 m/s² noise band that is
 * stable per device.
 */
export function accelerometerNoiseFloor(samples: readonly MotionSample[]): number {
  const mags = clampMagnitudeSeries(samples);
  if (mags.length < 6) return 0;
  const smooth = new Array<number>(mags.length);
  const win = 5;
  for (let i = 0; i < mags.length; i += 1) {
    const lo = Math.max(0, i - win);
    const hi = Math.min(mags.length, i + win + 1);
    let s = 0;
    for (let j = lo; j < hi; j += 1) s += mags[j]!;
    smooth[i] = s / (hi - lo);
  }
  const residual = new Array<number>(mags.length);
  for (let i = 0; i < mags.length; i += 1) residual[i] = mags[i]! - smooth[i]!;
  return stdDev(residual);
}

/**
 * Compute a single numeric gravity magnitude estimate from
 * accelerometer data. For a stationary-ish phone this is ~9.81 m/s²,
 * but devices differ in their calibration offset by up to ~0.2 m/s².
 */
export function gravityEstimate(samples: readonly MotionSample[]): number {
  const mags = clampMagnitudeSeries(samples);
  if (mags.length === 0) return 0;
  // Use the p50 — robust to jitter.
  const sorted = [...mags].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

// ─── Signature building ──────────────────────────────────────────────────────

function emptySignatureDefaults(): Omit<
  DeviceSignature,
  "userId" | "deviceId" | "deviceKind" | "updatedAt" | "sampleCount"
> {
  return {
    version: DeviceSensorConstants.SIGNATURE_VERSION,
    gyroMagnitudeMean: 0,
    gyroMagnitudeStd: 0,
    accelNoiseFloor: 0,
    accelNoiseStd: 0,
    tiltBetaMean: 0,
    tiltGammaMean: 0,
    tiltBetaStd: 0,
    tiltGammaStd: 0,
    gravityMagnitudeMean: 0,
    webglVendorHash: "",
    webglRendererHash: "",
    webglExtensionsHash: "",
    audioOscillatorHash: "",
    audioSampleRate: 0,
    fontHash: "",
    pluginHash: "",
    timezone: "",
    languageHash: "",
    screenHash: "",
    userAgentHash: "",
  };
}

function screenHashOf(screen: ScreenInfo | undefined): string {
  if (!screen) return "";
  return hashMany([
    screen.width,
    screen.height,
    screen.colorDepth,
    screen.pixelRatio,
    screen.gamut,
    screen.orientation,
  ]);
}

export function buildSignatureFromBundle(
  userId: string,
  bundle: DeviceSensorBundle
): DeviceSignature {
  const base = emptySignatureDefaults();
  const common = {
    userId,
    deviceId: bundle.deviceId,
    deviceKind: bundle.deviceKind,
    updatedAt: Date.now(),
    screenHash: screenHashOf(bundle.screen),
    userAgentHash: stableHash(bundle.userAgent ?? ""),
  };

  if (bundle.deviceKind === "mobile") {
    const gyroMags = clampMagnitudeSeries(bundle.gyroscope);
    const noiseFloor = accelerometerNoiseFloor(bundle.accelerometer);
    const gravity = gravityEstimate(bundle.accelerometer);
    const betas: number[] = [];
    const gammas: number[] = [];
    for (const o of bundle.orientation ?? []) {
      if (Number.isFinite(o.beta)) betas.push(o.beta);
      if (Number.isFinite(o.gamma)) gammas.push(o.gamma);
    }
    return {
      ...base,
      ...common,
      sampleCount: bundle.gyroscope.length + bundle.accelerometer.length,
      gyroMagnitudeMean: mean(gyroMags),
      gyroMagnitudeStd: stdDev(gyroMags),
      accelNoiseFloor: noiseFloor,
      accelNoiseStd: stdDev(clampMagnitudeSeries(bundle.accelerometer)),
      tiltBetaMean: mean(betas),
      tiltGammaMean: mean(gammas),
      tiltBetaStd: stdDev(betas),
      tiltGammaStd: stdDev(gammas),
      gravityMagnitudeMean: gravity,
    };
  }

  // Desktop
  return {
    ...base,
    ...common,
    sampleCount: 1,
    webglVendorHash: stableHash(bundle.webgl?.vendor ?? ""),
    webglRendererHash: stableHash(bundle.webgl?.renderer ?? ""),
    webglExtensionsHash: bundle.webgl?.extensionsHash ?? "",
    audioOscillatorHash: bundle.audio?.oscillatorHash ?? "",
    audioSampleRate: bundle.audio?.sampleRate ?? 0,
    fontHash: bundle.fontHash ?? "",
    pluginHash: bundle.pluginHash ?? "",
    timezone: bundle.timezone ?? "",
    languageHash: stableHash((bundle.languages ?? []).join(",")),
  };
}

// ─── Comparison helpers ──────────────────────────────────────────────────────

function zish(delta: number, base: number): number {
  // normalize a numeric delta to a 0..1 "distance" contribution
  const b = Math.max(Math.abs(base), 1e-3);
  return Math.min(1, Math.abs(delta) / b);
}

function strictHashDistance(a: string, b: string): number {
  if (!a && !b) return 0; // both unknown — no distance
  if (!a || !b) return 0.5; // one side unknown
  return a === b ? 0 : 1;
}

function scalarTolerance(a: number, b: number, tol: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const delta = Math.abs(a - b);
  if (delta <= tol) return 0;
  return Math.min(1, (delta - tol) / Math.max(tol, 1e-3));
}

/**
 * Compare a live sensor bundle against a stored signature, producing a
 * weighted distance plus a list of the biggest mismatch contributors.
 *
 * The distance is a weighted sum of per-feature distances, where each
 * contribution is in [0, 1]. Total weights sum to 1, so the output
 * distance is also bounded by 1.
 */
export function compareBundle(
  signature: DeviceSignature,
  bundle: DeviceSensorBundle
): DeviceComparisonResult {
  if (signature.deviceKind !== bundle.deviceKind) {
    return {
      userId: signature.userId,
      deviceId: signature.deviceId,
      deviceKind: signature.deviceKind,
      score: 0,
      distance: 1,
      anomalous: true,
      mismatches: ["deviceKind"],
      computedAt: Date.now(),
    };
  }
  const W = DeviceSensorConstants.WEIGHTS;
  const mismatches: string[] = [];
  let distance = 0;

  const liveBase = buildSignatureFromBundle(signature.userId, bundle);

  const addHash = (name: string, w: number, a: string, b: string): void => {
    const d = strictHashDistance(a, b);
    if (d > 0) mismatches.push(name);
    distance += w * d;
  };

  // Shared
  addHash("screen", W.screen, signature.screenHash, liveBase.screenHash);
  addHash("userAgent", W.userAgent, signature.userAgentHash, liveBase.userAgentHash);

  if (bundle.deviceKind === "mobile") {
    // gyro magnitude — tolerance 0.15 rad/s
    const dGyro = scalarTolerance(
      signature.gyroMagnitudeMean,
      liveBase.gyroMagnitudeMean,
      0.15
    );
    if (dGyro > 0.2) mismatches.push("gyroMagnitudeMean");
    distance += W.gyro * dGyro;

    // accel noise floor — tolerance 0.02 m/s²
    const dAccel = scalarTolerance(
      signature.accelNoiseFloor,
      liveBase.accelNoiseFloor,
      0.02
    );
    if (dAccel > 0.2) mismatches.push("accelNoiseFloor");
    distance += W.accel * dAccel;

    // tilt mean — tolerance 10°
    const dTilt =
      (scalarTolerance(signature.tiltBetaMean, liveBase.tiltBetaMean, 10) +
        scalarTolerance(signature.tiltGammaMean, liveBase.tiltGammaMean, 10)) /
      2;
    if (dTilt > 0.3) mismatches.push("tilt");
    distance += W.tilt * dTilt;
  } else {
    addHash("webglVendor", W.webglVendor, signature.webglVendorHash, liveBase.webglVendorHash);
    addHash("webglRenderer", W.webglRenderer, signature.webglRendererHash, liveBase.webglRendererHash);
    addHash("webglExtensions", W.webglExtensions, signature.webglExtensionsHash, liveBase.webglExtensionsHash);
    addHash("audioOscillator", W.audioHash, signature.audioOscillatorHash, liveBase.audioOscillatorHash);
    addHash("fontHash", W.fontHash, signature.fontHash, liveBase.fontHash);
    addHash("pluginHash", W.pluginHash, signature.pluginHash, liveBase.pluginHash);
    addHash("languages", W.languages, signature.languageHash, liveBase.languageHash);
    addHash("timezone", W.timezone, signature.timezone, liveBase.timezone);

    const dRate = scalarTolerance(signature.audioSampleRate, liveBase.audioSampleRate, 1);
    if (dRate > 0) mismatches.push("audioSampleRate");
    distance += W.audioSampleRate * dRate;
  }

  const clamped = Math.max(0, Math.min(1, distance));
  const score = 1 - clamped;
  return {
    userId: signature.userId,
    deviceId: signature.deviceId,
    deviceKind: signature.deviceKind,
    score,
    distance: clamped,
    anomalous: clamped >= DeviceSensorConstants.ANOMALY_THRESHOLD,
    mismatches,
    computedAt: Date.now(),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a sensor bundle before ingest. The rules are:
 *   - Mobile bundles must include enough motion samples over at least
 *     {@link DeviceSensorConstants.MIN_SAMPLE_SPAN_MS}.
 *   - Desktop bundles must include at least a screen + user-agent, or
 *     one of the fingerprints.
 *
 * On success the bundle is returned (narrowed & cloned with bounded
 * arrays). On failure a tagged error is returned.
 */
export type ValidationOk<T> = { readonly ok: true; readonly value: T };
export type ValidationErr = { readonly ok: false; readonly error: string };
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

export function validateBundle(raw: unknown): ValidationResult<DeviceSensorBundle> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "EMPTY_BUNDLE" };
  const r = raw as Partial<DeviceSensorBundle> & Record<string, unknown>;
  if (r.deviceKind !== "mobile" && r.deviceKind !== "desktop") {
    return { ok: false, error: "BAD_DEVICE_KIND" };
  }
  if (typeof r.deviceId !== "string" || r.deviceId.length === 0) {
    return { ok: false, error: "MISSING_DEVICE_ID" };
  }
  if (typeof r.capturedAt !== "number" || !Number.isFinite(r.capturedAt)) {
    return { ok: false, error: "BAD_CAPTURED_AT" };
  }

  if (r.deviceKind === "mobile") {
    const gyro = Array.isArray(r.gyroscope) ? (r.gyroscope as MotionSample[]) : [];
    const accel = Array.isArray(r.accelerometer) ? (r.accelerometer as MotionSample[]) : [];
    if (
      gyro.length < DeviceSensorConstants.MIN_MOTION_SAMPLES ||
      accel.length < DeviceSensorConstants.MIN_MOTION_SAMPLES
    ) {
      return { ok: false, error: "NOT_ENOUGH_SAMPLES" };
    }
    const span =
      Math.max(accel[accel.length - 1]?.t ?? 0, gyro[gyro.length - 1]?.t ?? 0) -
      Math.min(accel[0]?.t ?? 0, gyro[0]?.t ?? 0);
    if (span < DeviceSensorConstants.MIN_SAMPLE_SPAN_MS) {
      return { ok: false, error: "SAMPLE_SPAN_TOO_SHORT" };
    }
    const mobile: MobileSensorBundle = {
      deviceKind: "mobile",
      deviceId: r.deviceId,
      capturedAt: r.capturedAt,
      gyroscope: gyro.slice(0, DeviceSensorConstants.MAX_MOTION_SAMPLES),
      accelerometer: accel.slice(0, DeviceSensorConstants.MAX_MOTION_SAMPLES),
      ...(Array.isArray(r.orientation)
        ? { orientation: (r.orientation as OrientationSample[]).slice(0, DeviceSensorConstants.MAX_MOTION_SAMPLES) }
        : {}),
      ...(r.screen ? { screen: r.screen as ScreenInfo } : {}),
      ...(typeof r.userAgent === "string" ? { userAgent: r.userAgent } : {}),
    };
    return { ok: true, value: mobile };
  }

  const desktop: DesktopSensorBundle = {
    deviceKind: "desktop",
    deviceId: r.deviceId,
    capturedAt: r.capturedAt,
    ...(r.webgl ? { webgl: r.webgl as WebGlFingerprint } : {}),
    ...(r.audio ? { audio: r.audio as AudioFingerprint } : {}),
    ...(r.screen ? { screen: r.screen as ScreenInfo } : {}),
    ...(typeof r.fontHash === "string" ? { fontHash: r.fontHash } : {}),
    ...(typeof r.pluginHash === "string" ? { pluginHash: r.pluginHash } : {}),
    ...(typeof r.userAgent === "string" ? { userAgent: r.userAgent } : {}),
    ...(typeof r.timezone === "string" ? { timezone: r.timezone } : {}),
    ...(Array.isArray(r.languages)
      ? { languages: (r.languages as string[]).filter((x) => typeof x === "string") }
      : {}),
  };
  // Require at least one identifying field.
  const ok = Boolean(
    desktop.webgl || desktop.audio || desktop.screen || desktop.fontHash || desktop.userAgent
  );
  if (!ok) return { ok: false, error: "NO_FINGERPRINT" };
  return { ok: true, value: desktop };
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface UserDeviceState {
  readonly userId: string;
  readonly devices: Map<string, DeviceSignature>;
  lastResult: DeviceComparisonResult | null;
  pendingAttempts: number;
}

function newUserDeviceState(userId: string): UserDeviceState {
  return {
    userId,
    devices: new Map(),
    lastResult: null,
    pendingAttempts: 0,
  };
}

export interface DeviceSensorStore {
  load(userId: string): UserDeviceState | null;
  save(userId: string, s: UserDeviceState): void;
  delete(userId: string): void;
}

class InMemoryDeviceStore implements DeviceSensorStore {
  private readonly m = new Map<string, UserDeviceState>();
  load(userId: string): UserDeviceState | null {
    return this.m.get(userId) ?? null;
  }
  save(userId: string, s: UserDeviceState): void {
    this.m.set(userId, s);
  }
  delete(userId: string): void {
    this.m.delete(userId);
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class DeviceSensorAuth {
  private readonly store: DeviceSensorStore;
  constructor(store?: DeviceSensorStore) {
    this.store = store ?? new InMemoryDeviceStore();
  }

  /**
   * Enroll (or update) a device signature from a validated bundle.
   * Subsequent bundles for the same deviceId merge their features using
   * a moving average so the signature slowly adapts to small device
   * drift (e.g. sensor aging).
   */
  enroll(userId: string, bundle: DeviceSensorBundle): DeviceSignature {
    const state = this.store.load(userId) ?? newUserDeviceState(userId);
    const fresh = buildSignatureFromBundle(userId, bundle);
    const existing = state.devices.get(bundle.deviceId);
    const merged = existing ? mergeSignatures(existing, fresh) : fresh;
    state.devices.set(bundle.deviceId, merged);
    this.store.save(userId, state);
    return merged;
  }

  getSignature(userId: string, deviceId: string): DeviceSignature | null {
    return this.store.load(userId)?.devices.get(deviceId) ?? null;
  }

  listDevices(userId: string): DeviceSignature[] {
    const state = this.store.load(userId);
    if (!state) return [];
    return Array.from(state.devices.values());
  }

  removeDevice(userId: string, deviceId: string): boolean {
    const state = this.store.load(userId);
    if (!state) return false;
    const ok = state.devices.delete(deviceId);
    if (ok) this.store.save(userId, state);
    return ok;
  }

  compare(userId: string, bundle: DeviceSensorBundle): DeviceComparisonResult {
    const state = this.store.load(userId) ?? newUserDeviceState(userId);
    const sig = state.devices.get(bundle.deviceId);
    let result: DeviceComparisonResult;
    if (!sig) {
      result = {
        userId,
        deviceId: bundle.deviceId,
        deviceKind: bundle.deviceKind,
        score: 0.5,
        distance: 0.5,
        anomalous: false,
        mismatches: ["NEW_DEVICE"],
        computedAt: Date.now(),
      };
    } else {
      result = compareBundle(sig, bundle);
    }
    state.lastResult = result;
    this.store.save(userId, state);
    return result;
  }

  score(userId: string, deviceId?: string): number {
    const state = this.store.load(userId);
    if (!state || state.devices.size === 0) return 1; // no enrolled device yet
    if (deviceId) {
      const last = state.lastResult;
      if (last && last.deviceId === deviceId) return last.score;
      return 1;
    }
    return state.lastResult?.score ?? 1;
  }

  lastResult(userId: string): DeviceComparisonResult | null {
    return this.store.load(userId)?.lastResult ?? null;
  }

  snapshot(userId: string): Record<string, unknown> {
    const s = this.store.load(userId);
    if (!s) return { userId, present: false };
    return {
      userId,
      present: true,
      deviceCount: s.devices.size,
      devices: Array.from(s.devices.values()).map((d) => ({
        deviceId: d.deviceId,
        deviceKind: d.deviceKind,
        sampleCount: d.sampleCount,
        updatedAt: d.updatedAt,
      })),
      lastResult: s.lastResult,
    };
  }

  reset(userId: string): void {
    this.store.delete(userId);
  }
}

/** Moving-average merge so a signature adapts to small per-session drift. */
function mergeSignatures(
  prev: DeviceSignature,
  next: DeviceSignature
): DeviceSignature {
  // Prefer hash identity when both sides agree; otherwise keep the
  // newest. For scalar sensor values use an EMA with α=0.2.
  const alpha = 0.2;
  const ema = (a: number, b: number): number => a * (1 - alpha) + b * alpha;
  return {
    ...prev,
    updatedAt: Date.now(),
    sampleCount: prev.sampleCount + next.sampleCount,
    gyroMagnitudeMean: ema(prev.gyroMagnitudeMean, next.gyroMagnitudeMean),
    gyroMagnitudeStd: ema(prev.gyroMagnitudeStd, next.gyroMagnitudeStd),
    accelNoiseFloor: ema(prev.accelNoiseFloor, next.accelNoiseFloor),
    accelNoiseStd: ema(prev.accelNoiseStd, next.accelNoiseStd),
    tiltBetaMean: ema(prev.tiltBetaMean, next.tiltBetaMean),
    tiltGammaMean: ema(prev.tiltGammaMean, next.tiltGammaMean),
    tiltBetaStd: ema(prev.tiltBetaStd, next.tiltBetaStd),
    tiltGammaStd: ema(prev.tiltGammaStd, next.tiltGammaStd),
    gravityMagnitudeMean: ema(prev.gravityMagnitudeMean, next.gravityMagnitudeMean),
    webglVendorHash: next.webglVendorHash || prev.webglVendorHash,
    webglRendererHash: next.webglRendererHash || prev.webglRendererHash,
    webglExtensionsHash: next.webglExtensionsHash || prev.webglExtensionsHash,
    audioOscillatorHash: next.audioOscillatorHash || prev.audioOscillatorHash,
    audioSampleRate: next.audioSampleRate || prev.audioSampleRate,
    fontHash: next.fontHash || prev.fontHash,
    pluginHash: next.pluginHash || prev.pluginHash,
    timezone: next.timezone || prev.timezone,
    languageHash: next.languageHash || prev.languageHash,
    screenHash: next.screenHash || prev.screenHash,
    userAgentHash: next.userAgentHash || prev.userAgentHash,
  };
}

// ─── Singleton + Fastify route plugin ────────────────────────────────────────

let _singleton: DeviceSensorAuth | null = null;

export function getDeviceSensorAuth(): DeviceSensorAuth {
  if (!_singleton) _singleton = new DeviceSensorAuth();
  return _singleton;
}

export function setDeviceSensorAuth(svc: DeviceSensorAuth): void {
  _singleton = svc;
}

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";

function extractUserId(request: FastifyRequest): string | null {
  const r = request as FastifyRequest & {
    user?: { id?: string };
    zeroTrustUser?: { id?: string };
  };
  return r.user?.id ?? r.zeroTrustUser?.id ?? null;
}

export const deviceSensorRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post("/device/enroll", async (request, reply) => {
    const userId = extractUserId(request);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = validateBundle(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const sig = getDeviceSensorAuth().enroll(userId, parsed.value);
    return reply.send({
      enrolled: true,
      deviceId: sig.deviceId,
      deviceKind: sig.deviceKind,
      updatedAt: sig.updatedAt,
    });
  });

  app.post("/device/verify", async (request, reply) => {
    const userId = extractUserId(request);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = validateBundle(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const cmp = getDeviceSensorAuth().compare(userId, parsed.value);
    return reply.send(cmp);
  });

  app.get("/device/list", async (request, reply) => {
    const userId = extractUserId(request);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const devices = getDeviceSensorAuth()
      .listDevices(userId)
      .map((d) => ({
        deviceId: d.deviceId,
        deviceKind: d.deviceKind,
        sampleCount: d.sampleCount,
        updatedAt: d.updatedAt,
      }));
    return reply.send({ devices });
  });

  app.delete("/device/:deviceId", async (request, reply) => {
    const userId = extractUserId(request);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = request.params as { deviceId?: string };
    if (!params.deviceId) return reply.code(400).send({ error: "MISSING_DEVICE_ID" });
    const ok = getDeviceSensorAuth().removeDevice(userId, params.deviceId);
    return reply.send({ removed: ok });
  });
};
