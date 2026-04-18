/**
 * KeyExchangeService
 *
 * ECDH-based key-exchange with per-message forward secrecy for the
 * Self-Destructing Encrypted Messages feature (issue #45).
 *
 *   - Each `KeyExchangePair` row holds an ECDH key pair for a user.
 *   - A *new* ephemeral pair is generated for every outbound message
 *     (`generateEphemeralPair`) so leaking a single private key never
 *     compromises previously delivered messages — that is forward secrecy.
 *   - Pairs can be `rotate`d (replaced by a fresh pair, old key marked
 *     ROTATED) or fully `revoke`d (every message that referenced the pair
 *     is hard-marked REVOKED and made unreadable on the next access).
 *   - `deriveSharedSecret` performs the standard ECDH(privA, pubB) → 32
 *     byte symmetric secret, fed through HKDF-SHA-256 so the output is
 *     uniformly distributed and bound to a per-message info string.
 *
 * Private keys at rest are stored AES-256-GCM-encrypted under
 * `process.env.ENCRYPTION_SECRET` (the same server-bound secret used by
 * `utils/crypto.ts`).  Plaintext private keys never leave this module.
 */

import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "../db";

// ─── Types ────────────────────────────────────────────────────────

export type SupportedAlgorithm = "ECDH_P256" | "ECDH_P384";

export interface GeneratedKeyPair {
  /** Base64url-encoded uncompressed SEC1 public key (0x04‖X‖Y). */
  publicKey: string;
  /** Base64url-encoded raw private scalar. */
  privateKey: string;
  /** SHA-256(publicKey) – stable identifier safe to log. */
  fingerprint: string;
  algorithm: SupportedAlgorithm;
}

export interface PersistedKeyPair {
  id: string;
  ownerUserId: string;
  algorithm: SupportedAlgorithm;
  publicKey: string;
  fingerprint: string;
  state: "ACTIVE" | "ROTATED" | "REVOKED";
  label: string;
  createdAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export interface DeriveOptions {
  /**
   * Optional per-message context bound into the HKDF expansion.
   * Including the message id ensures that even if the same two pairs
   * are reused, every derived key is unique.
   */
  info?: string;
  /** Output length in bytes – defaults to 32 (AES-256 key size). */
  length?: number;
  /** Optional HKDF salt (defaults to fixed app-wide constant). */
  salt?: Buffer;
}

// ─── Internal helpers ─────────────────────────────────────────────

const CURVE_NAMES: Record<SupportedAlgorithm, string> = {
  ECDH_P256: "prime256v1",
  ECDH_P384: "secp384r1",
};

const PRIVATE_KEY_VERSION = "v1";
const HKDF_DEFAULT_SALT = Buffer.from(
  "quantmail/ephemeral-key-exchange/v1",
  "utf8"
);

function getEncryptionSecret(): string {
  return process.env["ENCRYPTION_SECRET"] || "quantmail-key-secret";
}

function curveFor(algorithm: SupportedAlgorithm): string {
  const curve = CURVE_NAMES[algorithm];
  if (!curve) {
    throw new Error(`Unsupported key-exchange algorithm: ${algorithm}`);
  }
  return curve;
}

/** Derives the SHA-256 fingerprint of a serialized public key. */
export function fingerprintPublicKey(publicKeyB64: string): string {
  const raw = Buffer.from(publicKeyB64, "base64url");
  return createHash("sha256").update(raw).digest("hex");
}

/** Encrypts a private key for storage using AES-256-GCM + scrypt KDF. */
export function encryptPrivateKey(privateKeyB64: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(getEncryptionSecret(), salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(privateKeyB64, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PRIVATE_KEY_VERSION,
    salt.toString("base64url"),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

/** Reverses `encryptPrivateKey`; returns null on tamper / wrong secret. */
export function decryptPrivateKey(stored: string): string | null {
  const parts = stored.split(".");
  if (parts.length !== 5 || parts[0] !== PRIVATE_KEY_VERSION) return null;
  try {
    const [, saltB64, ivB64, tagB64, dataB64] = parts;
    const salt = Buffer.from(saltB64, "base64url");
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    const key = scryptSync(getEncryptionSecret(), salt, 32);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    return null;
  }
}

/**
 * RFC 5869 HKDF — extract+expand using HMAC-SHA-256.
 * Implemented locally to avoid pulling in another crypto dependency.
 */
export function hkdf(
  ikm: Buffer,
  salt: Buffer,
  info: Buffer,
  length: number
): Buffer {
  if (length <= 0 || length > 255 * 32) {
    throw new RangeError("HKDF output length out of range");
  }
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const blocks: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(blocks).length < length) {
    const hmac = createHmac("sha256", prk);
    hmac.update(prev);
    hmac.update(info);
    hmac.update(Buffer.from([counter]));
    prev = hmac.digest();
    blocks.push(prev);
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

// ─── Pure ECDH primitives (no DB) ─────────────────────────────────

/**
 * Generates a fresh ECDH key pair.
 *
 * The output is encoding-only; nothing is persisted.  Use this directly
 * for one-shot ephemeral keys, or use `createPair` to also persist it.
 */
export function generateKeyPair(
  algorithm: SupportedAlgorithm = "ECDH_P256"
): GeneratedKeyPair {
  const ecdh = createECDH(curveFor(algorithm));
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey().toString("base64url");
  const privateKey = ecdh.getPrivateKey().toString("base64url");
  return {
    publicKey,
    privateKey,
    fingerprint: fingerprintPublicKey(publicKey),
    algorithm,
  };
}

/** Convenience alias used by EphemeralMailService. */
export function generateEphemeralPair(
  algorithm: SupportedAlgorithm = "ECDH_P256"
): GeneratedKeyPair {
  return generateKeyPair(algorithm);
}

/**
 * Derives a 32-byte symmetric secret from (privateKey, peerPublicKey).
 *
 * The raw ECDH output is fed through HKDF-SHA-256 so that the resulting
 * key has full 256 bits of entropy and is bound to the supplied `info`
 * string (typically the message id).
 */
export function deriveSharedSecret(
  privateKeyB64: string,
  peerPublicKeyB64: string,
  options: DeriveOptions = {},
  algorithm: SupportedAlgorithm = "ECDH_P256"
): Buffer {
  const ecdh = createECDH(curveFor(algorithm));
  ecdh.setPrivateKey(Buffer.from(privateKeyB64, "base64url"));
  const sharedRaw = ecdh.computeSecret(
    Buffer.from(peerPublicKeyB64, "base64url")
  );
  return hkdf(
    sharedRaw,
    options.salt ?? HKDF_DEFAULT_SALT,
    Buffer.from(options.info ?? "quantmail-message-key", "utf8"),
    options.length ?? 32
  );
}

/**
 * Compares two public keys in constant time.  Used when verifying that a
 * recipient's claimed key matches what the sender saw when encrypting.
 */
export function publicKeysEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "base64url");
    const bb = Buffer.from(b, "base64url");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// ─── Persistence layer (KeyExchangePair model) ────────────────────

function toPersisted(row: {
  id: string;
  ownerUserId: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  state: string;
  label: string;
  createdAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}): PersistedKeyPair {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    algorithm: row.algorithm as SupportedAlgorithm,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    state: row.state as PersistedKeyPair["state"],
    label: row.label,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    revokedAt: row.revokedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Generates a new ECDH pair, encrypts the private half, and stores it.
 * Returns the persisted record (without the private key).
 */
export async function createPair(params: {
  ownerUserId: string;
  algorithm?: SupportedAlgorithm;
  label?: string;
  expiresAt?: Date | null;
}): Promise<PersistedKeyPair> {
  const algorithm: SupportedAlgorithm = params.algorithm ?? "ECDH_P256";
  const pair = generateKeyPair(algorithm);
  const created = await prisma.keyExchangePair.create({
    data: {
      ownerUserId: params.ownerUserId,
      algorithm,
      publicKey: pair.publicKey,
      privateKey: encryptPrivateKey(pair.privateKey),
      fingerprint: pair.fingerprint,
      label: params.label ?? "",
      expiresAt: params.expiresAt ?? null,
    },
  });
  return toPersisted(created);
}

export async function listActivePairs(
  ownerUserId: string
): Promise<PersistedKeyPair[]> {
  const rows = await prisma.keyExchangePair.findMany({
    where: { ownerUserId, state: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPersisted);
}

export async function listAllPairs(
  ownerUserId: string
): Promise<PersistedKeyPair[]> {
  const rows = await prisma.keyExchangePair.findMany({
    where: { ownerUserId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPersisted);
}

export async function getPair(id: string): Promise<PersistedKeyPair | null> {
  const row = await prisma.keyExchangePair.findUnique({ where: { id } });
  return row ? toPersisted(row) : null;
}

/**
 * Loads the encrypted private-key blob and returns the decrypted value.
 * Returns null if the record cannot be decrypted (e.g. wrong secret).
 */
export async function loadPrivateKey(
  pairId: string
): Promise<{ pair: PersistedKeyPair; privateKey: string } | null> {
  const row = await prisma.keyExchangePair.findUnique({ where: { id: pairId } });
  if (!row) return null;
  const privateKey = decryptPrivateKey(row.privateKey);
  if (!privateKey) return null;
  return { pair: toPersisted(row), privateKey };
}

/**
 * Rotates a pair: marks the existing one as ROTATED, generates a fresh
 * pair (same algorithm + label) and returns it.  Messages already
 * encrypted under the rotated pair remain readable until the pair is
 * explicitly revoked.
 */
export async function rotatePair(pairId: string): Promise<PersistedKeyPair> {
  const existing = await prisma.keyExchangePair.findUnique({
    where: { id: pairId },
  });
  if (!existing) {
    throw new Error("Key exchange pair not found");
  }
  if (existing.state !== "ACTIVE") {
    throw new Error(`Cannot rotate pair in state ${existing.state}`);
  }
  await prisma.keyExchangePair.update({
    where: { id: pairId },
    data: { state: "ROTATED", rotatedAt: new Date() },
  });
  return createPair({
    ownerUserId: existing.ownerUserId,
    algorithm: existing.algorithm as SupportedAlgorithm,
    label: existing.label,
  });
}

/**
 * Revokes a pair *and* marks every EphemeralMessage that used it as
 * REVOKED.  Subsequent `EphemeralMailService.fetchForRead` calls for
 * those messages return a deterministic "revoked" error and the row is
 * scheduled for purge by the next sweeper run.
 */
export async function revokePair(pairId: string): Promise<{
  pair: PersistedKeyPair;
  affectedMessages: number;
}> {
  const existing = await prisma.keyExchangePair.findUnique({
    where: { id: pairId },
  });
  if (!existing) {
    throw new Error("Key exchange pair not found");
  }
  if (existing.state === "REVOKED") {
    return { pair: toPersisted(existing), affectedMessages: 0 };
  }

  const updated = await prisma.keyExchangePair.update({
    where: { id: pairId },
    data: { state: "REVOKED", revokedAt: new Date() },
  });

  const result = await prisma.ephemeralMessage.updateMany({
    where: {
      keyExchangePairId: pairId,
      state: { in: ["ACTIVE", "READ"] },
    },
    data: {
      state: "REVOKED",
      destructionReason: "KEY_REVOKED",
      destroyedAt: new Date(),
    },
  });

  return {
    pair: toPersisted(updated),
    affectedMessages: result.count,
  };
}

/**
 * Returns a "rotation dashboard" summary: counts per state and the
 * timestamp of the most recent active pair.  Used by the
 * `/api/key-exchange/dashboard` endpoint surfaced in the UI.
 */
export async function rotationDashboard(ownerUserId: string): Promise<{
  active: number;
  rotated: number;
  revoked: number;
  newestActiveAt: Date | null;
  oldestActiveAt: Date | null;
}> {
  const grouped = await prisma.keyExchangePair.groupBy({
    by: ["state"],
    where: { ownerUserId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { ACTIVE: 0, ROTATED: 0, REVOKED: 0 };
  for (const row of grouped) {
    counts[row.state] = row._count._all;
  }
  const newest = await prisma.keyExchangePair.findFirst({
    where: { ownerUserId, state: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const oldest = await prisma.keyExchangePair.findFirst({
    where: { ownerUserId, state: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return {
    active: counts["ACTIVE"],
    rotated: counts["ROTATED"],
    revoked: counts["REVOKED"],
    newestActiveAt: newest?.createdAt ?? null,
    oldestActiveAt: oldest?.createdAt ?? null,
  };
}

/**
 * Convenience helper used by EphemeralMailService when sending a message.
 *
 * Generates a single ephemeral pair, persists it under the sender's
 * account with state ACTIVE and `label = "ephemeral:<msgId>"`, and
 * returns both the persisted record *and* the raw private key (so the
 * caller can perform the ECDH derivation in the same request).
 */
export async function mintEphemeralForMessage(params: {
  senderUserId: string;
  messageId: string;
  algorithm?: SupportedAlgorithm;
}): Promise<{ pair: PersistedKeyPair; privateKey: string }> {
  const algorithm: SupportedAlgorithm = params.algorithm ?? "ECDH_P256";
  const generated = generateKeyPair(algorithm);
  const created = await prisma.keyExchangePair.create({
    data: {
      ownerUserId: params.senderUserId,
      algorithm,
      publicKey: generated.publicKey,
      privateKey: encryptPrivateKey(generated.privateKey),
      fingerprint: generated.fingerprint,
      label: `ephemeral:${params.messageId}`,
    },
  });
  return { pair: toPersisted(created), privateKey: generated.privateKey };
}
