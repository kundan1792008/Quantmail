/**
 * ContinuousAuthMiddleware
 * ========================
 *
 * The glue layer that aggregates signals from the three behavioral
 * biometric sensors into a single confidence score in [0, 1]:
 *
 *   - {@link TypingRhythmAnalyzer}     (keystroke DTW)
 *   - {@link MouseDynamicsTracker}     (64-feature vector distance)
 *   - {@link DeviceSensorAuth}         (device fingerprint / motion)
 *
 * Decision rules (per issue #42):
 *   1. confidence < 0.7 for more than 60 s  →  soft re-auth (face scan)
 *   2. confidence < 0.3                      →  immediate hard lock +
 *                                              full biometric re-auth
 *   3. All state transitions are written to a per-process
 *      {@link SecurityAuditLog}.
 *
 * The middleware is a regular Fastify `preHandler`. It does NOT replace
 * upstream JWT / session middleware — it runs *after* authentication
 * has already happened and uses `request.user.id` as the subject.
 *
 * Everything here is deterministic and has no external side effects
 * beyond the in-process audit log. Production deployments can swap
 * {@link InMemorySecurityAuditLog} for a Prisma-backed implementation.
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  getTypingRhythmAnalyzer,
  TypingRhythmAnalyzer,
  TypingComparisonResult,
  TypingAnomalyState,
} from "../services/TypingRhythmAnalyzer";
import {
  getMouseDynamicsTracker,
  MouseDynamicsTracker,
  MouseComparisonResult,
} from "../services/MouseDynamicsTracker";
import {
  getDeviceSensorAuth,
  DeviceSensorAuth,
  DeviceComparisonResult,
} from "../services/DeviceSensorAuth";

// ─── Public Types ────────────────────────────────────────────────────────────

/** Aggregated confidence snapshot for a user. */
export interface ContinuousAuthSnapshot {
  readonly userId: string;
  readonly confidence: number; // 0..1
  readonly state: ContinuousAuthState;
  readonly typing: {
    readonly score: number;
    readonly comparison: TypingComparisonResult | null;
    readonly anomaly: TypingAnomalyState;
  };
  readonly mouse: {
    readonly score: number;
    readonly comparison: MouseComparisonResult | null;
  };
  readonly device: {
    readonly score: number;
    readonly comparison: DeviceComparisonResult | null;
  };
  readonly lastUpdatedAt: number;
  readonly belowSoftSince: number | null;
  readonly belowHardSince: number | null;
  readonly reauthRequired: ReauthLevel;
}

export type ContinuousAuthState =
  | "OK"
  | "WATCHING" // below soft threshold, but not yet for the full dwell
  | "SOFT_REAUTH" // soft dwell tripped — needs face scan
  | "HARD_LOCK"; // hard threshold tripped — full biometric lockdown

export type ReauthLevel = "NONE" | "SOFT" | "HARD";

/** A single row in the security audit log. */
export interface SecurityAuditEntry {
  readonly id: string;
  readonly userId: string;
  readonly at: number;
  readonly event: string;
  readonly confidence: number;
  readonly state: ContinuousAuthState;
  readonly details: Record<string, unknown>;
}

export interface SecurityAuditLog {
  record(entry: Omit<SecurityAuditEntry, "id" | "at"> & { at?: number }): SecurityAuditEntry;
  list(userId: string, limit?: number): readonly SecurityAuditEntry[];
  all(limit?: number): readonly SecurityAuditEntry[];
  clear(userId?: string): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const ContinuousAuthConstants = Object.freeze({
  SOFT_THRESHOLD: 0.7,
  HARD_THRESHOLD: 0.3,
  SOFT_DWELL_MS: 60_000,
  AUDIT_MAX_ENTRIES: 2_000,

  /** Weights applied when combining per-channel scores. */
  WEIGHTS: Object.freeze({
    typing: 0.4,
    mouse: 0.35,
    device: 0.25,
  }),

  /** Routes that must bypass the middleware (public endpoints). */
  DEFAULT_BYPASS_PREFIXES: Object.freeze([
    "/auth",
    "/health",
    "/docs",
    "/liveness",
    "/landing",
    "/",
  ]),
} as const);

// ─── Security Audit Log ──────────────────────────────────────────────────────

export class InMemorySecurityAuditLog implements SecurityAuditLog {
  private readonly entries: SecurityAuditEntry[] = [];
  private counter = 0;

  record(
    entry: Omit<SecurityAuditEntry, "id" | "at"> & { at?: number }
  ): SecurityAuditEntry {
    this.counter += 1;
    const full: SecurityAuditEntry = {
      id: `audit-${Date.now()}-${this.counter}`,
      at: entry.at ?? Date.now(),
      userId: entry.userId,
      event: entry.event,
      confidence: entry.confidence,
      state: entry.state,
      details: entry.details,
    };
    this.entries.push(full);
    if (this.entries.length > ContinuousAuthConstants.AUDIT_MAX_ENTRIES) {
      this.entries.splice(
        0,
        this.entries.length - ContinuousAuthConstants.AUDIT_MAX_ENTRIES
      );
    }
    return full;
  }

  list(userId: string, limit = 100): readonly SecurityAuditEntry[] {
    const filtered = this.entries.filter((e) => e.userId === userId);
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  all(limit = 200): readonly SecurityAuditEntry[] {
    return this.entries.slice(Math.max(0, this.entries.length - limit));
  }

  clear(userId?: string): void {
    if (!userId) {
      this.entries.length = 0;
      return;
    }
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i]!.userId === userId) this.entries.splice(i, 1);
    }
  }
}

// ─── State Machine ───────────────────────────────────────────────────────────

interface UserRuntimeState {
  userId: string;
  confidence: number;
  state: ContinuousAuthState;
  belowSoftSince: number | null;
  belowHardSince: number | null;
  lastUpdatedAt: number;
  reauthRequired: ReauthLevel;
  typingScore: number;
  mouseScore: number;
  deviceScore: number;
}

function freshRuntime(userId: string): UserRuntimeState {
  return {
    userId,
    confidence: 1,
    state: "OK",
    belowSoftSince: null,
    belowHardSince: null,
    lastUpdatedAt: 0,
    reauthRequired: "NONE",
    typingScore: 1,
    mouseScore: 1,
    deviceScore: 1,
  };
}

// ─── Aggregator ──────────────────────────────────────────────────────────────

export interface ContinuousAuthDeps {
  readonly typing: TypingRhythmAnalyzer;
  readonly mouse: MouseDynamicsTracker;
  readonly device: DeviceSensorAuth;
  readonly audit: SecurityAuditLog;
  readonly now?: () => number;
}

export class ContinuousAuthService {
  private readonly typing: TypingRhythmAnalyzer;
  private readonly mouse: MouseDynamicsTracker;
  private readonly device: DeviceSensorAuth;
  private readonly audit: SecurityAuditLog;
  private readonly runtime = new Map<string, UserRuntimeState>();
  private readonly now: () => number;

  constructor(deps?: Partial<ContinuousAuthDeps>) {
    this.typing = deps?.typing ?? getTypingRhythmAnalyzer();
    this.mouse = deps?.mouse ?? getMouseDynamicsTracker();
    this.device = deps?.device ?? getDeviceSensorAuth();
    this.audit = deps?.audit ?? new InMemorySecurityAuditLog();
    this.now = deps?.now ?? Date.now;
  }

  /**
   * Recompute the aggregate confidence for `userId` and return a fresh
   * snapshot. This method is idempotent and has no side effects other
   * than potentially appending one audit entry when the state changes.
   */
  evaluate(userId: string): ContinuousAuthSnapshot {
    const runtime = this.runtime.get(userId) ?? freshRuntime(userId);

    const typingCmp = this.safeTypingCompare(userId);
    const mouseCmp = this.safeMouseCompare(userId);
    const deviceLast = this.device.lastResult(userId);

    const typingScore = clamp01(typingCmp?.score ?? this.typing.score(userId));
    const mouseScore = clamp01(mouseCmp?.score ?? this.mouse.score(userId));
    const deviceScore = clamp01(this.device.score(userId));

    const W = ContinuousAuthConstants.WEIGHTS;
    const confidence = clamp01(
      typingScore * W.typing + mouseScore * W.mouse + deviceScore * W.device
    );

    const prevState = runtime.state;
    const nowMs = this.now();

    // Update dwell timers.
    if (confidence < ContinuousAuthConstants.SOFT_THRESHOLD) {
      if (runtime.belowSoftSince == null) runtime.belowSoftSince = nowMs;
    } else {
      runtime.belowSoftSince = null;
    }
    if (confidence < ContinuousAuthConstants.HARD_THRESHOLD) {
      if (runtime.belowHardSince == null) runtime.belowHardSince = nowMs;
    } else {
      runtime.belowHardSince = null;
    }

    // Decide state.
    let nextState: ContinuousAuthState = "OK";
    let reauth: ReauthLevel = "NONE";
    if (confidence < ContinuousAuthConstants.HARD_THRESHOLD) {
      nextState = "HARD_LOCK";
      reauth = "HARD";
    } else if (
      runtime.belowSoftSince != null &&
      nowMs - runtime.belowSoftSince >= ContinuousAuthConstants.SOFT_DWELL_MS
    ) {
      nextState = "SOFT_REAUTH";
      reauth = "SOFT";
    } else if (confidence < ContinuousAuthConstants.SOFT_THRESHOLD) {
      nextState = "WATCHING";
      reauth = "NONE";
    }

    runtime.confidence = confidence;
    runtime.state = nextState;
    runtime.reauthRequired = reauth;
    runtime.lastUpdatedAt = nowMs;
    runtime.typingScore = typingScore;
    runtime.mouseScore = mouseScore;
    runtime.deviceScore = deviceScore;
    this.runtime.set(userId, runtime);

    // Audit state transitions.
    if (prevState !== nextState) {
      this.audit.record({
        userId,
        event: `STATE_${prevState}_TO_${nextState}`,
        confidence,
        state: nextState,
        details: {
          typing: typingScore,
          mouse: mouseScore,
          device: deviceScore,
          soft: runtime.belowSoftSince,
          hard: runtime.belowHardSince,
        },
      });
    }

    return {
      userId,
      confidence,
      state: nextState,
      typing: {
        score: typingScore,
        comparison: typingCmp,
        anomaly: this.typing.anomalyState(userId),
      },
      mouse: { score: mouseScore, comparison: mouseCmp },
      device: { score: deviceScore, comparison: deviceLast },
      lastUpdatedAt: nowMs,
      belowSoftSince: runtime.belowSoftSince,
      belowHardSince: runtime.belowHardSince,
      reauthRequired: reauth,
    };
  }

  /** Explicit reset — called after a successful full re-auth. */
  clear(userId: string): void {
    this.runtime.delete(userId);
    this.typing.resetLiveBuffer(userId);
    this.mouse.resetLiveBuffer(userId);
    this.audit.record({
      userId,
      event: "CLEARED_BY_REAUTH",
      confidence: 1,
      state: "OK",
      details: {},
    });
  }

  /** Explicit soft-clear — used after a successful face scan. */
  acknowledgeSoftReauth(userId: string): void {
    const runtime = this.runtime.get(userId);
    if (!runtime) return;
    runtime.belowSoftSince = null;
    runtime.state = "OK";
    runtime.reauthRequired = "NONE";
    runtime.confidence = Math.max(runtime.confidence, 0.8);
    this.runtime.set(userId, runtime);
    this.audit.record({
      userId,
      event: "SOFT_REAUTH_ACK",
      confidence: runtime.confidence,
      state: "OK",
      details: {},
    });
  }

  auditLog(): SecurityAuditLog {
    return this.audit;
  }

  /**
   * Returns the most recent snapshot without re-evaluating. Useful from
   * hot paths that already called `evaluate` earlier in the same
   * request lifecycle.
   */
  snapshot(userId: string): ContinuousAuthSnapshot {
    const rt = this.runtime.get(userId);
    if (!rt) return this.evaluate(userId);
    return {
      userId,
      confidence: rt.confidence,
      state: rt.state,
      typing: {
        score: rt.typingScore,
        comparison: null,
        anomaly: this.typing.anomalyState(userId),
      },
      mouse: { score: rt.mouseScore, comparison: null },
      device: { score: rt.deviceScore, comparison: this.device.lastResult(userId) },
      lastUpdatedAt: rt.lastUpdatedAt,
      belowSoftSince: rt.belowSoftSince,
      belowHardSince: rt.belowHardSince,
      reauthRequired: rt.reauthRequired,
    };
  }

  private safeTypingCompare(userId: string): TypingComparisonResult | null {
    try {
      return this.typing.compare(userId);
    } catch {
      return null;
    }
  }

  private safeMouseCompare(userId: string): MouseComparisonResult | null {
    try {
      return this.mouse.compare(userId);
    } catch {
      return null;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _singleton: ContinuousAuthService | null = null;

export function getContinuousAuthService(): ContinuousAuthService {
  if (!_singleton) _singleton = new ContinuousAuthService();
  return _singleton;
}

export function setContinuousAuthService(svc: ContinuousAuthService): void {
  _singleton = svc;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

export interface ContinuousAuthMiddlewareOptions {
  readonly bypassPrefixes?: readonly string[];
  readonly service?: ContinuousAuthService;
  readonly onSoftReauth?: (snap: ContinuousAuthSnapshot, request: FastifyRequest) => void;
  readonly onHardLock?: (snap: ContinuousAuthSnapshot, request: FastifyRequest) => void;
}

declare module "fastify" {
  interface FastifyRequest {
    continuousAuth?: ContinuousAuthSnapshot;
  }
}

function extractUserId(request: FastifyRequest): string | null {
  const r = request as FastifyRequest & {
    user?: { id?: string };
    zeroTrustUser?: { id?: string };
  };
  return r.user?.id ?? r.zeroTrustUser?.id ?? null;
}

function shouldBypass(
  url: string | undefined,
  bypass: readonly string[]
): boolean {
  if (!url) return true;
  for (let i = 0; i < bypass.length; i += 1) {
    const p = bypass[i]!;
    // Exact "/" bypass only applies to the literal root path.
    if (p === "/") {
      if (url === "/") return true;
      continue;
    }
    if (url === p || url.startsWith(p + "/") || url.startsWith(p + "?")) return true;
  }
  return false;
}

/**
 * Build a Fastify `preHandler` that attaches the latest
 * {@link ContinuousAuthSnapshot} to `request.continuousAuth` and, when
 * the state has escalated, short-circuits the response with either
 * `401 SOFT_REAUTH` (face scan required) or `401 HARD_LOCK`
 * (full biometric re-auth required).
 */
export function buildContinuousAuthMiddleware(
  options: ContinuousAuthMiddlewareOptions = {}
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const bypass = options.bypassPrefixes ?? ContinuousAuthConstants.DEFAULT_BYPASS_PREFIXES;
  const svc = options.service ?? getContinuousAuthService();

  return async function continuousAuthPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (shouldBypass(request.url, bypass)) return;
    const userId = extractUserId(request);
    if (!userId) return; // unauthenticated routes are handled by upstream auth

    const snap = svc.evaluate(userId);
    request.continuousAuth = snap;
    reply.header("X-Continuous-Auth-Confidence", snap.confidence.toFixed(3));
    reply.header("X-Continuous-Auth-State", snap.state);

    if (snap.state === "HARD_LOCK") {
      if (options.onHardLock) {
        try {
          options.onHardLock(snap, request);
        } catch {
          // ignore callback failures
        }
      }
      return reply.code(401).send({
        error: "HARD_LOCK",
        message: "Session locked — full biometric re-authentication required.",
        confidence: snap.confidence,
      });
    }

    if (snap.state === "SOFT_REAUTH") {
      if (options.onSoftReauth) {
        try {
          options.onSoftReauth(snap, request);
        } catch {
          // ignore callback failures
        }
      }
      return reply.code(401).send({
        error: "SOFT_REAUTH",
        message: "Face re-scan required to continue.",
        confidence: snap.confidence,
      });
    }
  };
}

// ─── Fastify plugin ──────────────────────────────────────────────────────────

/**
 * Fastify plugin that registers the middleware globally and exposes
 * introspection endpoints:
 *
 *   GET  /continuous-auth/snapshot   → current confidence snapshot
 *   GET  /continuous-auth/audit      → security audit log for user
 *   POST /continuous-auth/reauth/ack → acknowledge completed face scan
 *   POST /continuous-auth/reset      → acknowledge completed full re-auth
 */
export const continuousAuthRoutes: FastifyPluginAsync<ContinuousAuthMiddlewareOptions> =
  async (app: FastifyInstance, opts: ContinuousAuthMiddlewareOptions = {}) => {
    const svc = opts.service ?? getContinuousAuthService();
    const preHandler = buildContinuousAuthMiddleware(opts);
    app.addHook("preHandler", preHandler);

    app.get("/continuous-auth/snapshot", async (request, reply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
      return reply.send(svc.evaluate(userId));
    });

    app.get("/continuous-auth/audit", async (request, reply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
      const limit = Number((request.query as { limit?: string })?.limit) || 100;
      return reply.send({ entries: svc.auditLog().list(userId, limit) });
    });

    app.post("/continuous-auth/reauth/ack", async (request, reply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
      svc.acknowledgeSoftReauth(userId);
      return reply.send({ ok: true });
    });

    app.post("/continuous-auth/reset", async (request, reply) => {
      const userId = extractUserId(request);
      if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });
      svc.clear(userId);
      return reply.send({ ok: true });
    });
  };

// ─── Helper: combine with ingest routes ──────────────────────────────────────
//
// Convenience re-exports so callers can wire everything up with a single
// import.

export { typingRhythmRoutes } from "../services/TypingRhythmAnalyzer";
export { mouseDynamicsRoutes } from "../services/MouseDynamicsTracker";
export { deviceSensorRoutes } from "../services/DeviceSensorAuth";
