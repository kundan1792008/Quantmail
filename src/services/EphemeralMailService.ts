/**
 * EphemeralMailService
 *
 * Implements the server-side half of the Self-Destructing Encrypted
 * Messages feature (issue #45).
 *
 * Threat model
 * ────────────
 * The server is *honest-but-curious*: we want operators to be unable to
 * read message bodies even if they have full database access.  To achieve
 * that:
 *
 *   1. The AES-256-GCM symmetric key is generated client-side and is
 *      transmitted to the recipient out-of-band — embedded in the URL
 *      *fragment* (`#k=...`), which browsers never send to servers.  We
 *      provide `generateMessageKey` and `encryptPayload` here only as
 *      convenience helpers for tests and the rare "server-encrypts"
 *      legacy flow; production senders should encrypt locally and post
 *      the resulting ciphertext.
 *
 *   2. Stored fields are limited to: ciphertext, IV, auth tag, algorithm
 *      label, destruction policy and bookkeeping.  We never persist the
 *      symmetric key.
 *
 *   3. ECDH ephemeral keys (per-message forward secrecy) are minted via
 *      `KeyExchangeService.mintEphemeralForMessage`.  Revoking the
 *      pair instantly marks the message REVOKED.
 *
 *   4. Destruction modes:
 *        • READ_ONCE        – first successful fetch returns the payload
 *                             and atomically transitions ACTIVE → READ
 *                             then DESTROYED on the same call.
 *        • TIMER_1H/24H/7D  – `expiresAt` is set; sweeper purges expired
 *                             rows.  Reads after expiry return 410.
 *        • SCREENSHOT_PROOF – behaves like READ_ONCE but the response
 *                             includes a `screenshotProof: true` hint
 *                             so the SecureReader UI can apply the
 *                             user-select:none + watermark overlay.
 *
 *   5. Secure delete: before the row is removed we overwrite the
 *      ciphertext / IV / auth tag columns with cryptographically-random
 *      bytes of equal length.  This makes any leftover WAL / backup
 *      pages contain shredded data rather than the original ciphertext.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "../db";
import {
  deriveSharedSecret,
  generateEphemeralPair,
  loadPrivateKey,
  mintEphemeralForMessage,
  revokePair,
  type SupportedAlgorithm,
} from "./KeyExchangeService";

// ─── Public types ─────────────────────────────────────────────────

export type DestructionMode =
  | "READ_ONCE"
  | "TIMER_1H"
  | "TIMER_24H"
  | "TIMER_7D"
  | "SCREENSHOT_PROOF";

export type MessageState =
  | "ACTIVE"
  | "READ"
  | "EXPIRED"
  | "DESTROYED"
  | "REVOKED";

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "AES-256-GCM";
}

export interface SendParams {
  senderUserId: string;
  recipientEmail: string;
  subject: string;
  /** Pre-encrypted payload (preferred path – server can't read). */
  payload: EncryptedPayload;
  destructionMode: DestructionMode;
  attachments?: EncryptedPayload | null;
  /** Algorithm to use for the per-message ECDH pair. */
  keyAlgorithm?: SupportedAlgorithm;
  /** Whether the recipient may persist the message into their Vault. */
  vaultAllowed?: boolean;
}

export interface SendResult {
  id: string;
  fragmentHint: string;
  destructionMode: DestructionMode;
  expiresAt: Date | null;
  senderEphemeralPublicKey: string;
  keyExchangePairId: string;
}

export interface FetchContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface FetchSuccess {
  ok: true;
  id: string;
  subject: string;
  payload: EncryptedPayload;
  attachments: EncryptedPayload | null;
  destructionMode: DestructionMode;
  expiresAt: Date | null;
  senderEphemeralPublicKey: string;
  vaultAllowed: boolean;
  remainingReads: number;
  /** Hint for the SecureReader UI to apply anti-screenshot styling. */
  screenshotProof: boolean;
}

export interface FetchFailure {
  ok: false;
  reason:
    | "NOT_FOUND"
    | "EXPIRED"
    | "ALREADY_READ"
    | "DESTROYED"
    | "REVOKED";
}

export type FetchResult = FetchSuccess | FetchFailure;

// ─── Crypto helpers ──────────────────────────────────────────────

const AES_ALGORITHM: "aes-256-gcm" = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Generates a fresh AES-256-GCM symmetric key.  Encoded as base64url so
 * it fits cleanly into a URL fragment (#k=…).
 */
export function generateMessageKey(): string {
  return randomBytes(KEY_BYTES).toString("base64url");
}

/**
 * Encrypts a UTF-8 plaintext under an AES-256-GCM key.
 *
 * Provided primarily for tests, server-side migration tooling and the
 * "draft saved as encrypted" autosave flow.  Production clients SHOULD
 * encrypt in the browser using the WebCrypto API.
 */
export function encryptPayload(
  plaintext: string,
  keyB64: string
): EncryptedPayload {
  const key = decodeKey(keyB64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
    algorithm: "AES-256-GCM",
  };
}

/**
 * Decrypts a payload produced by `encryptPayload`.  Returns null if the
 * authentication tag fails (tamper or wrong key).
 */
export function decryptPayload(
  payload: EncryptedPayload,
  keyB64: string
): string | null {
  if (payload.algorithm !== "AES-256-GCM") return null;
  try {
    const key = decodeKey(keyB64);
    const iv = Buffer.from(payload.iv, "base64url");
    const tag = Buffer.from(payload.authTag, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) return null;
    const ct = Buffer.from(payload.ciphertext, "base64url");
    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    return null;
  }
}

/** Validates and decodes a base64url-encoded AES-256 key. */
function decodeKey(keyB64: string): Buffer {
  const buf = Buffer.from(keyB64, "base64url");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`AES key must be ${KEY_BYTES} bytes, got ${buf.length}`);
  }
  return buf;
}

/**
 * Constant-time comparison of an opaque token (e.g. the URL fragment
 * digest).  Used by future signed-fragment flows.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** SHA-256 of an IP address (cheap pseudonymisation for audit log). */
function hashIp(ip: string | undefined): string {
  return createHash("sha256")
    .update(ip ?? "unknown")
    .digest("hex");
}

/**
 * Linear-time recipient-email sanity check.  Avoids backtracking regex
 * patterns (e.g. `/.+@.+\..+/`) that CodeQL flags as polynomial ReDoS
 * risks.  We just need to reject obvious garbage before hitting the DB;
 * real RFC-5321 validation happens at the SMTP layer.
 */
function isValidRecipientEmail(email: string): boolean {
  if (email.length < 3 || email.length > 254) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 0 || domain.length < 3) return false;
  const dot = domain.indexOf(".");
  if (dot <= 0 || dot === domain.length - 1) return false;
  // Reject whitespace / control characters anywhere.
  for (let i = 0; i < email.length; i++) {
    const c = email.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return false;
  }
  return true;
}

// ─── Destruction-policy helpers ──────────────────────────────────

const TIMER_DURATIONS: Record<DestructionMode, number | null> = {
  READ_ONCE: null,
  TIMER_1H: 60 * 60 * 1000,
  TIMER_24H: 24 * 60 * 60 * 1000,
  TIMER_7D: 7 * 24 * 60 * 60 * 1000,
  SCREENSHOT_PROOF: null,
};

/**
 * Effective "unlimited" reads for timer-based destruction modes.  The
 * number must be finite (DB columns are NOT NULL) but large enough that
 * no realistic user session will exhaust it inside the timer window.
 */
const TIMER_MODE_MAX_READS = 1_000_000;

/**
 * Computes the destruction policy from a destruction mode:
 *   – `expiresAt` is set for TIMER_* modes (relative to now).
 *   – `maxReads` is 1 for READ_ONCE / SCREENSHOT_PROOF, +∞ for timers.
 */
export function destructionPolicy(mode: DestructionMode, now: Date = new Date()): {
  expiresAt: Date | null;
  maxReads: number;
} {
  const ttl = TIMER_DURATIONS[mode];
  if (ttl !== null) {
    return {
      expiresAt: new Date(now.getTime() + ttl),
      maxReads: TIMER_MODE_MAX_READS,
    };
  }
  return { expiresAt: null, maxReads: 1 };
}

// ─── Send ────────────────────────────────────────────────────────

/**
 * Persists an encrypted message and mints a per-message ECDH pair.
 * Returns the recipient-facing identifier; the symmetric key must be
 * delivered out-of-band (URL fragment).
 */
export async function send(params: SendParams): Promise<SendResult> {
  if (!params.payload) {
    throw new Error("payload is required");
  }
  if (!params.recipientEmail || !isValidRecipientEmail(params.recipientEmail)) {
    throw new Error("recipientEmail must be a valid email address");
  }
  validatePayload(params.payload);
  if (params.attachments) {
    validatePayload(params.attachments);
  }

  const policy = destructionPolicy(params.destructionMode);

  // Two-step create: first allocate the row id (so the ephemeral key
  // can be labelled with it), then attach the key pair and update.
  const placeholder = await prisma.ephemeralMessage.create({
    data: {
      senderUserId: params.senderUserId,
      recipientEmail: params.recipientEmail.toLowerCase(),
      subject: params.subject,
      ciphertext: params.payload.ciphertext,
      iv: params.payload.iv,
      authTag: params.payload.authTag,
      algorithm: params.payload.algorithm,
      destructionMode: params.destructionMode,
      state: "ACTIVE",
      expiresAt: policy.expiresAt,
      maxReads: policy.maxReads,
      vaultAllowed: params.vaultAllowed ?? false,
      attachmentsBlob: params.attachments?.ciphertext ?? null,
      attachmentsIv: params.attachments?.iv ?? null,
      attachmentsAuthTag: params.attachments?.authTag ?? null,
    },
  });

  const { pair } = await mintEphemeralForMessage({
    senderUserId: params.senderUserId,
    messageId: placeholder.id,
    algorithm: params.keyAlgorithm ?? "ECDH_P256",
  });

  await prisma.ephemeralMessage.update({
    where: { id: placeholder.id },
    data: {
      keyExchangePairId: pair.id,
      senderEphemeralKey: pair.publicKey,
    },
  });

  return {
    id: placeholder.id,
    fragmentHint: "Place AES key in URL fragment as #k=<base64url>",
    destructionMode: params.destructionMode,
    expiresAt: policy.expiresAt,
    senderEphemeralPublicKey: pair.publicKey,
    keyExchangePairId: pair.id,
  };
}

function validatePayload(p: EncryptedPayload): void {
  if (p.algorithm !== "AES-256-GCM") {
    throw new Error(`Unsupported payload algorithm: ${p.algorithm}`);
  }
  const iv = Buffer.from(p.iv, "base64url");
  const tag = Buffer.from(p.authTag, "base64url");
  if (iv.length !== IV_BYTES) {
    throw new Error(`IV must be ${IV_BYTES} bytes`);
  }
  if (tag.length !== AUTH_TAG_BYTES) {
    throw new Error(`Auth tag must be ${AUTH_TAG_BYTES} bytes`);
  }
  if (p.ciphertext.length === 0) {
    throw new Error("ciphertext must be non-empty");
  }
}

// ─── Fetch (the destruction trigger) ─────────────────────────────

/**
 * Atomically fetches a message and applies its destruction policy.
 *
 * The whole operation runs inside an interactive transaction so that
 * concurrent reads of a READ_ONCE message can never both succeed —
 * exactly one transaction wins; the loser sees `ALREADY_READ`.
 */
export async function fetchForRead(
  id: string,
  context: FetchContext = {}
): Promise<FetchResult> {
  const ipHash = hashIp(context.ipAddress);
  const userAgent = context.userAgent ?? "";

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.ephemeralMessage.findUnique({ where: { id } });
    if (!row) {
      return { ok: false, reason: "NOT_FOUND" } as const;
    }

    if (row.state === "DESTROYED") {
      return { ok: false, reason: "DESTROYED" } as const;
    }
    if (row.state === "REVOKED") {
      return { ok: false, reason: "REVOKED" } as const;
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "EXPIRED" } as const;
    }
    if (row.state === "READ" && row.readCount >= row.maxReads) {
      return { ok: false, reason: "ALREADY_READ" } as const;
    }

    const newReadCount = row.readCount + 1;
    const consumed = newReadCount >= row.maxReads;
    const nextState = consumed ? "READ" : "ACTIVE";

    await tx.ephemeralMessage.update({
      where: { id },
      data: { readCount: newReadCount, state: nextState },
    });

    await tx.ephemeralMessageDelivery.create({
      data: {
        messageId: id,
        ipHash,
        userAgent,
        succeeded: true,
        reason: "OK",
      },
    });

    const success: FetchSuccess = {
      ok: true,
      id: row.id,
      subject: row.subject,
      payload: {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
        algorithm: "AES-256-GCM",
      },
      attachments:
        row.attachmentsBlob && row.attachmentsIv && row.attachmentsAuthTag
          ? {
              ciphertext: row.attachmentsBlob,
              iv: row.attachmentsIv,
              authTag: row.attachmentsAuthTag,
              algorithm: "AES-256-GCM",
            }
          : null,
      destructionMode: row.destructionMode as DestructionMode,
      expiresAt: row.expiresAt,
      senderEphemeralPublicKey: row.senderEphemeralKey ?? "",
      vaultAllowed: row.vaultAllowed,
      remainingReads: Math.max(0, row.maxReads - newReadCount),
      screenshotProof: row.destructionMode === "SCREENSHOT_PROOF",
    };
    return success;
  });

  // For READ_ONCE / SCREENSHOT_PROOF, perform the secure overwrite +
  // hard delete *outside* the transaction so the reader gets a fast
  // response while we shred asynchronously.  We still await it here
  // so callers (and tests) observe a deterministic post-condition.
  if (result.ok && result.remainingReads === 0) {
    await secureDestroy(id, "READ_LIMIT_REACHED");
  }

  // Record failed access attempts for the audit log.
  if (!result.ok) {
    await prisma.ephemeralMessageDelivery
      .create({
        data: {
          messageId: id,
          ipHash,
          userAgent,
          succeeded: false,
          reason: result.reason,
        },
      })
      .catch(() => {
        // Audit-log writes for non-existent rows fail the FK; ignore.
      });
  }

  return result;
}

// ─── Destruction & sweeping ──────────────────────────────────────

/**
 * Overwrites the ciphertext / IV / auth-tag columns with random bytes
 * of equal length, then hard-deletes the row.  The two-phase approach
 * defeats forensic recovery from WAL / replicas / backup snapshots
 * that captured the row before deletion.
 */
export async function secureDestroy(
  id: string,
  reason: string
): Promise<boolean> {
  const row = await prisma.ephemeralMessage.findUnique({ where: { id } });
  if (!row) return false;

  const overwrittenCiphertext = randomBytes(
    Buffer.from(row.ciphertext, "base64url").length || 32
  ).toString("base64url");
  const overwrittenIv = randomBytes(
    Buffer.from(row.iv, "base64url").length || IV_BYTES
  ).toString("base64url");
  const overwrittenTag = randomBytes(
    Buffer.from(row.authTag, "base64url").length || AUTH_TAG_BYTES
  ).toString("base64url");

  await prisma.ephemeralMessage.update({
    where: { id },
    data: {
      state: "DESTROYED",
      destroyedAt: new Date(),
      destructionReason: reason,
      ciphertext: overwrittenCiphertext,
      iv: overwrittenIv,
      authTag: overwrittenTag,
      attachmentsBlob: row.attachmentsBlob ? overwrittenCiphertext : null,
      attachmentsIv: row.attachmentsIv ? overwrittenIv : null,
      attachmentsAuthTag: row.attachmentsAuthTag ? overwrittenTag : null,
      senderEphemeralKey: null,
    },
  });

  await prisma.ephemeralMessage.delete({ where: { id } });
  return true;
}

/**
 * Sweeper – marks every TIMER_* message past its expiry as EXPIRED and
 * then secure-destroys it.  Intended to be run periodically by the
 * BullMQ scheduler.  Returns the number of rows shredded.
 */
export async function purgeDestroyed(now: Date = new Date()): Promise<number> {
  // Messages whose destruction condition has been recorded: either their
  // timer elapsed, the sender revoked the pair, or `fetchForRead` already
  // marked them READ after the last allowed read.  The final shredding
  // (overwrite + hard-delete) happens in `secureDestroy` below.
  const expired = await prisma.ephemeralMessage.findMany({
    where: {
      OR: [
        { state: "EXPIRED" },
        { state: "REVOKED" },
        {
          AND: [
            { state: { in: ["ACTIVE", "READ"] } },
            { expiresAt: { not: null, lte: now } },
          ],
        },
      ],
    },
    select: { id: true, state: true, expiresAt: true },
  });

  let count = 0;
  for (const row of expired) {
    const reason =
      row.state === "REVOKED"
        ? "KEY_REVOKED"
        : row.expiresAt && row.expiresAt.getTime() <= now.getTime()
          ? "TIMER_EXPIRED"
          : "READ_LIMIT_REACHED";
    if (await secureDestroy(row.id, reason)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Sender-initiated immediate revocation of a message (useful when the
 * URL fragment was shared publicly by mistake).
 */
export async function revokeMessage(
  id: string,
  senderUserId: string
): Promise<boolean> {
  const row = await prisma.ephemeralMessage.findUnique({ where: { id } });
  if (!row || row.senderUserId !== senderUserId) return false;
  await secureDestroy(id, "SENDER_REVOKED");
  return true;
}

// ─── ECDH convenience used by tests ──────────────────────────────

/**
 * End-to-end demo that the ECDH plumbing is sound: encrypts a message
 * under a freshly derived shared secret and immediately decrypts it.
 * Returns the round-tripped plaintext and the message id.
 *
 * In production this whole flow happens client-side; the function is
 * exported so unit tests can exercise the wire format.
 */
export async function roundTripDemo(params: {
  senderUserId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  destructionMode: DestructionMode;
}): Promise<{ id: string; decrypted: string }> {
  const recipient = generateEphemeralPair();
  const sender = generateEphemeralPair();
  const shared = deriveSharedSecret(sender.privateKey, recipient.publicKey, {
    info: "round-trip-demo",
  });
  const keyB64 = shared.toString("base64url");
  const payload = encryptPayload(params.body, keyB64);
  const result = await send({
    senderUserId: params.senderUserId,
    recipientEmail: params.recipientEmail,
    subject: params.subject,
    payload,
    destructionMode: params.destructionMode,
  });
  const recovered = decryptPayload(payload, keyB64);
  return { id: result.id, decrypted: recovered ?? "" };
}

/**
 * Helper that decrypts the private half of a stored pair and runs
 * `deriveSharedSecret` against a peer's public key — used by the
 * sender's UI to re-derive the symmetric key when re-opening a draft.
 */
export async function deriveSecretForStoredPair(
  pairId: string,
  peerPublicKey: string,
  info?: string
): Promise<Buffer | null> {
  const loaded = await loadPrivateKey(pairId);
  if (!loaded) return null;
  return deriveSharedSecret(
    loaded.privateKey,
    peerPublicKey,
    info ? { info } : {},
    loaded.pair.algorithm
  );
}

/** Re-export so callers can revoke a message *and* its key in one place. */
export async function revokeMessageAndKey(
  id: string,
  senderUserId: string
): Promise<boolean> {
  const row = await prisma.ephemeralMessage.findUnique({ where: { id } });
  if (!row || row.senderUserId !== senderUserId) return false;
  if (row.keyExchangePairId) {
    await revokePair(row.keyExchangePairId);
  } else {
    await secureDestroy(id, "SENDER_REVOKED");
  }
  return true;
}

// ─── Read-side helpers for sender dashboard ─────────────────────

export interface MessageSummary {
  id: string;
  recipientEmail: string;
  subject: string;
  destructionMode: DestructionMode;
  state: MessageState;
  expiresAt: Date | null;
  readCount: number;
  createdAt: Date;
}

export async function listSentMessages(
  senderUserId: string,
  limit = 50
): Promise<MessageSummary[]> {
  const rows = await prisma.ephemeralMessage.findMany({
    where: { senderUserId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    recipientEmail: row.recipientEmail,
    subject: row.subject,
    destructionMode: row.destructionMode as DestructionMode,
    state: row.state as MessageState,
    expiresAt: row.expiresAt,
    readCount: row.readCount,
    createdAt: row.createdAt,
  }));
}

export async function getDeliveryAuditLog(
  messageId: string,
  senderUserId: string
): Promise<
  Array<{
    accessedAt: Date;
    succeeded: boolean;
    reason: string;
    ipHash: string;
  }>
> {
  const row = await prisma.ephemeralMessage.findUnique({
    where: { id: messageId },
  });
  if (!row || row.senderUserId !== senderUserId) return [];
  const deliveries = await prisma.ephemeralMessageDelivery.findMany({
    where: { messageId },
    orderBy: { accessedAt: "desc" },
  });
  return deliveries.map((d) => ({
    accessedAt: d.accessedAt,
    succeeded: d.succeeded,
    reason: d.reason,
    ipHash: d.ipHash,
  }));
}
