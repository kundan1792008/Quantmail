/**
 * ContinuousAuth Middleware
 *
 * Aggregates identity signals from:
 *   - TypingRhythmAnalyzer   (keystroke dynamics)
 *   - MouseDynamicsTracker   (pointer behaviour)
 *   - DeviceSensorAuth       (hardware fingerprint / sensors)
 *
 * into a single [0, 1] confidence score per authenticated session.
 *
 * Enforcement rules:
 *   - confidence < 0.7 sustained for > 60 seconds → soft re-auth (face scan)
 *   - confidence < 0.3 at any point → immediate session lock + full biometric
 *     re-auth required
 *
 * All anomaly events are written to the SecurityAuditLog table.
 *
 * Fastify route registration exposes:
 *   POST /behavioral/telemetry   – ingest a telemetry batch
 *   GET  /behavioral/confidence  – read current confidence for the caller
 *   POST /behavioral/clear       – clear anomaly state after re-auth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db";
import { zeroTrustGateway } from "./ZeroTrustGateway";
import {
  ingestKeystrokes,
  clearAnomalyState as clearTypingAnomaly,
  KeystrokeEvent,
} from "../services/TypingRhythmAnalyzer";
import {
  ingestMovementWindow,
  MovementSample,
  ClickEvent,
  ScrollEvent,
  HoverEvent,
} from "../services/MouseDynamicsTracker";
import {
  evaluateDeviceTelemetry,
  enrollDevice,
  getEnrolledDevices,
  DeviceTelemetry,
} from "../services/DeviceSensorAuth";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Confidence below which a soft re-auth is triggered (after grace period). */
const SOFT_REAUTH_THRESHOLD = 0.7;

/** Confidence below which the session is locked immediately. */
const HARD_LOCK_THRESHOLD = 0.3;

/** Milliseconds of sub-threshold confidence before triggering soft re-auth. */
const SOFT_REAUTH_GRACE_MS = 60_000;

/** Signal weights for the composite confidence score. */
const WEIGHTS = {
  typing: 0.35,
  mouse: 0.35,
  device: 0.30,
} as const;

/**
 * Maximum number of devices that will be auto-enrolled on first recognition.
 * Kept intentionally small to limit the attack surface of silent enrolment.
 */
const AUTO_ENROLL_DEVICE_LIMIT = 3;

// ─── In-memory session confidence state ──────────────────────────────────────

interface SessionState {
  userId: string;
  typingConfidence: number;
  mouseConfidence: number;
  deviceConfidence: number;
  compositeConfidence: number;
  locked: boolean;
  softReauthRequired: boolean;
  lowConfidenceSince: number | null;
  lastUpdatedAt: number;
}

const sessionStateStore = new Map<string, SessionState>();

// ─── Confidence Calculation ───────────────────────────────────────────────────

/**
 * Computes the weighted composite confidence score.
 */
export function computeCompositeConfidence(
  typingConfidence: number,
  mouseConfidence: number,
  deviceConfidence: number
): number {
  return (
    typingConfidence * WEIGHTS.typing +
    mouseConfidence * WEIGHTS.mouse +
    deviceConfidence * WEIGHTS.device
  );
}

// ─── Session State Management ─────────────────────────────────────────────────

/**
 * Returns (or creates) the in-memory session state for a user.
 */
export function getSessionState(userId: string): SessionState {
  if (!sessionStateStore.has(userId)) {
    sessionStateStore.set(userId, {
      userId,
      typingConfidence: 0.8,
      mouseConfidence: 0.8,
      deviceConfidence: 0.8,
      compositeConfidence: 0.8,
      locked: false,
      softReauthRequired: false,
      lowConfidenceSince: null,
      lastUpdatedAt: Date.now(),
    });
  }
  return sessionStateStore.get(userId)!;
}

/**
 * Updates the session state with new signal values and applies the enforcement
 * rules.  Returns the updated state.
 */
export function updateSessionState(
  userId: string,
  partial: Partial<Pick<SessionState, "typingConfidence" | "mouseConfidence" | "deviceConfidence">>
): SessionState {
  const state = getSessionState(userId);
  const now = Date.now();

  if (partial.typingConfidence !== undefined)
    state.typingConfidence = partial.typingConfidence;
  if (partial.mouseConfidence !== undefined)
    state.mouseConfidence = partial.mouseConfidence;
  if (partial.deviceConfidence !== undefined)
    state.deviceConfidence = partial.deviceConfidence;

  state.compositeConfidence = computeCompositeConfidence(
    state.typingConfidence,
    state.mouseConfidence,
    state.deviceConfidence
  );
  state.lastUpdatedAt = now;

  // ── Enforcement rules ────────────────────────────────────────────────────

  // Rule 1: immediate lock on critically low confidence
  if (state.compositeConfidence < HARD_LOCK_THRESHOLD) {
    state.locked = true;
    state.softReauthRequired = false;
  }

  // Rule 2: soft re-auth after sustained low confidence
  if (!state.locked && state.compositeConfidence < SOFT_REAUTH_THRESHOLD) {
    if (state.lowConfidenceSince === null) {
      state.lowConfidenceSince = now;
    } else if (now - state.lowConfidenceSince >= SOFT_REAUTH_GRACE_MS) {
      state.softReauthRequired = true;
    }
  } else if (state.compositeConfidence >= SOFT_REAUTH_THRESHOLD) {
    // Confidence recovered – reset the grace-period timer
    state.lowConfidenceSince = null;
  }

  return state;
}

/**
 * Clears anomaly/lock state for a user after successful re-authentication.
 */
export function clearSessionLock(userId: string): void {
  const state = getSessionState(userId);
  state.locked = false;
  state.softReauthRequired = false;
  state.lowConfidenceSince = null;
  clearTypingAnomaly(userId);
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

/**
 * Writes an anomaly event to the SecurityAuditLog.
 * Silently swallows database errors to avoid blocking the auth pipeline.
 */
async function logAnomalyEvent(
  userId: string,
  eventType: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    // The SecurityAuditLog model is new and the Prisma client types are
    // regenerated during `npm run build` (prisma generate).  Until then the
    // cast below is the minimal safe workaround; it will be removed once the
    // generated client reflects the updated schema.
    await (prisma as unknown as {
      securityAuditLog: {
        create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      };
    }).securityAuditLog.create({
      data: {
        userId,
        eventType,
        details: JSON.stringify(details),
        occurredAt: new Date(),
      },
    });
  } catch {
    // Non-fatal: log to stderr only
    console.error(`[ContinuousAuth] Failed to write audit log for ${userId}:`, eventType);
  }
}

// ─── Telemetry Ingestion ──────────────────────────────────────────────────────

/** Shape of the POST /behavioral/telemetry request body. */
interface TelemetryBody {
  keystrokes?: KeystrokeEvent[];
  movements?: MovementSample[];
  clicks?: ClickEvent[];
  scrolls?: ScrollEvent[];
  hovers?: HoverEvent[];
  device?: DeviceTelemetry;
}

/**
 * Processes a single telemetry batch for a user, updates the session state,
 * and enforces re-auth if needed.
 *
 * Returns the updated SessionState.
 */
export async function processTelemetry(
  userId: string,
  body: TelemetryBody
): Promise<SessionState> {
  const updates: Partial<Pick<SessionState, "typingConfidence" | "mouseConfidence" | "deviceConfidence">> = {};

  // ── Typing ────────────────────────────────────────────────────────────────
  if (body.keystrokes && body.keystrokes.length > 0) {
    const typingResult = ingestKeystrokes(userId, body.keystrokes);
    if (typingResult) {
      updates.typingConfidence = typingResult.confidence;
      if (typingResult.isAnomaly) {
        await logAnomalyEvent(userId, "TYPING_ANOMALY_DETECTED", {
          dtwDistance: typingResult.dtwDistance,
          windowSize: typingResult.windowSize,
        });
      }
    }
  }

  // ── Mouse ─────────────────────────────────────────────────────────────────
  if (body.movements && body.movements.length > 0) {
    const mouseResult = ingestMovementWindow(
      userId,
      body.movements,
      body.clicks ?? [],
      body.scrolls ?? [],
      body.hovers ?? []
    );
    if (mouseResult) {
      updates.mouseConfidence = mouseResult.confidence;
      if (mouseResult.isAnomaly) {
        await logAnomalyEvent(userId, "MOUSE_ANOMALY_DETECTED", {
          cosineSimilarity: mouseResult.cosineSimilarity,
          impossibleMovements: mouseResult.impossibleMovements,
        });
      }
    }
  }

  // ── Device ────────────────────────────────────────────────────────────────
  if (body.device) {
    const deviceResult = evaluateDeviceTelemetry(userId, body.device);
    updates.deviceConfidence = deviceResult.confidence;

    // Auto-enroll device on first recognition (below max limit)
    if (!deviceResult.isKnownDevice) {
      const enrolled = getEnrolledDevices(userId);
      if (enrolled.length < AUTO_ENROLL_DEVICE_LIMIT) {
        enrollDevice(
          userId,
          deviceResult.deviceId,
          body.device.platform,
          deviceResult.confidence
        );
      }
    }

    if (deviceResult.anomalies.length > 0) {
      await logAnomalyEvent(userId, "DEVICE_ANOMALY_DETECTED", {
        deviceId: deviceResult.deviceId,
        anomalies: deviceResult.anomalies,
      });
    }
  }

  const state = updateSessionState(userId, updates);

  // ── Lock logging ──────────────────────────────────────────────────────────
  if (state.locked) {
    await logAnomalyEvent(userId, "SESSION_LOCKED", {
      compositeConfidence: state.compositeConfidence,
      typingConfidence: state.typingConfidence,
      mouseConfidence: state.mouseConfidence,
      deviceConfidence: state.deviceConfidence,
    });
  } else if (state.softReauthRequired) {
    await logAnomalyEvent(userId, "SOFT_REAUTH_REQUIRED", {
      compositeConfidence: state.compositeConfidence,
      lowConfidenceDurationMs: state.lowConfidenceSince
        ? Date.now() - state.lowConfidenceSince
        : 0,
    });
  }

  return state;
}

// ─── Fastify Route Registration ───────────────────────────────────────────────

/**
 * Registers all behavioral-biometrics routes on the Fastify instance.
 *
 * Routes:
 *   POST /behavioral/telemetry   – ingest a telemetry batch
 *   GET  /behavioral/confidence  – return current confidence for the caller
 *   POST /behavioral/clear       – clear lock/anomaly state after re-auth
 *   GET  /behavioral/devices     – list enrolled devices for the caller
 */
export async function continuousAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /behavioral/telemetry ───────────────────────────────────────────
  app.post(
    "/behavioral/telemetry",
    { preHandler: zeroTrustGateway },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.zeroTrustUser!;
      const body = request.body as TelemetryBody;

      const state = await processTelemetry(user.id, body);

      const status = state.locked
        ? "LOCKED"
        : state.softReauthRequired
        ? "SOFT_REAUTH_REQUIRED"
        : "OK";

      return reply.code(state.locked ? 403 : 200).send({
        status,
        confidence: state.compositeConfidence,
        signals: {
          typing: state.typingConfidence,
          mouse: state.mouseConfidence,
          device: state.deviceConfidence,
        },
        locked: state.locked,
        softReauthRequired: state.softReauthRequired,
      });
    }
  );

  // ── GET /behavioral/confidence ───────────────────────────────────────────
  app.get(
    "/behavioral/confidence",
    { preHandler: zeroTrustGateway },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.zeroTrustUser!;
      const state = getSessionState(user.id);

      return reply.send({
        userId: user.id,
        confidence: state.compositeConfidence,
        signals: {
          typing: state.typingConfidence,
          mouse: state.mouseConfidence,
          device: state.deviceConfidence,
        },
        locked: state.locked,
        softReauthRequired: state.softReauthRequired,
        lastUpdatedAt: new Date(state.lastUpdatedAt).toISOString(),
      });
    }
  );

  // ── POST /behavioral/clear ───────────────────────────────────────────────
  app.post(
    "/behavioral/clear",
    { preHandler: zeroTrustGateway },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.zeroTrustUser!;
      clearSessionLock(user.id);

      await logAnomalyEvent(user.id, "SESSION_LOCK_CLEARED", {
        clearedBy: user.id,
      });

      return reply.send({ status: "OK", message: "Session lock cleared" });
    }
  );

  // ── GET /behavioral/devices ──────────────────────────────────────────────
  app.get(
    "/behavioral/devices",
    { preHandler: zeroTrustGateway },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.zeroTrustUser!;
      const devices = getEnrolledDevices(user.id);

      return reply.send({ devices });
    }
  );
}
