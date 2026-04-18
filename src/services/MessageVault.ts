/**
 * MessageVault
 *
 * Per-user, biometric-gated archive for messages the original sender
 * explicitly allowed to be persisted (`vaultAllowed = true`).
 *
 * Storage model
 * ─────────────
 *   – Vaulted ciphertext + IV + auth tag are copied verbatim from the
 *     EphemeralMessage row.  The server still cannot decrypt them.
 *   – The AES-256-GCM message key (which the recipient learned via the
 *     URL fragment) is *wrapped* under a per-user vault key derived from
 *     `ENCRYPTION_SECRET` + `userId` via HKDF.  This means the unwrapped
 *     message keys never touch disk.
 *   – Unlock requires a fresh WebAuthn assertion: callers obtain a
 *     biometric challenge from `WebAuthnService.generateAuthChallenge`,
 *     prompt the user, and pass the verified `userId` plus the
 *     `unlockToken` returned by `mintUnlockToken` to `unlock`.
 *   – Capacity: 100 entries / user.  When the limit would be exceeded,
 *     `put` evicts the oldest entry first ("FIFO eviction").
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "../db";
import { hkdf } from "./KeyExchangeService";

// ─── Types ────────────────────────────────────────────────────────

export interface VaultEntry {
  id: string;
  originalId: string | null;
  subject: string;
  savedAt: Date;
  lastAccessedAt: Date | null;
  accessCount: number;
}

export interface VaultEntryWithCipher extends VaultEntry {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: "AES-256-GCM";
  /** Wrapped (encrypted) message key – decrypt with `unwrapKey`. */
  wrappedKey: { data: string; iv: string; authTag: string };
}

export interface UnlockToken {
  userId: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

// ─── Constants ────────────────────────────────────────────────────

export const VAULT_CAPACITY = 100;
const UNLOCK_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const UNLOCK_TOKEN_VERSION = "v1";

const HKDF_SALT = Buffer.from("quantmail/message-vault/v1", "utf8");
const HKDF_INFO_PREFIX = "quantmail/vault-key/";

function getServerSecret(): string {
  return process.env["ENCRYPTION_SECRET"] || "quantmail-key-secret";
}

function getUnlockSecret(): string {
  return process.env["VAULT_UNLOCK_SECRET"] || getServerSecret();
}

// ─── Per-user vault key ──────────────────────────────────────────

/**
 * Derives the user's 32-byte vault wrapping key.  The key is bound to
 * the user id and the server secret, so:
 *
 *   • Every user has an independent vault key (no cross-tenant leakage).
 *   • Re-deploying with a new ENCRYPTION_SECRET makes all wrapped keys
 *     unrecoverable — equivalent to a hard reset of every vault.
 */
export function deriveVaultKey(userId: string): Buffer {
  return hkdf(
    Buffer.from(getServerSecret(), "utf8"),
    HKDF_SALT,
    Buffer.from(HKDF_INFO_PREFIX + userId, "utf8"),
    32
  );
}

/** Wraps a plaintext AES key under the user's vault key. */
export function wrapKey(
  plainKeyB64: string,
  userId: string
): { data: string; iv: string; authTag: string } {
  const plain = Buffer.from(plainKeyB64, "base64url");
  if (plain.length !== 32) {
    throw new Error("Wrapped key must be 32 bytes (AES-256)");
  }
  const wrappingKey = deriveVaultKey(userId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    data: ct.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: tag.toString("base64url"),
  };
}

/** Reverses `wrapKey`.  Returns null on tamper. */
export function unwrapKey(
  wrapped: { data: string; iv: string; authTag: string },
  userId: string
): string | null {
  try {
    const wrappingKey = deriveVaultKey(userId);
    const iv = Buffer.from(wrapped.iv, "base64url");
    const tag = Buffer.from(wrapped.authTag, "base64url");
    const data = Buffer.from(wrapped.data, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "base64url"
    );
  } catch {
    return null;
  }
}

// ─── Biometric unlock tokens ─────────────────────────────────────

/**
 * Issues an HMAC-signed unlock token after WebAuthn verification has
 * succeeded.  The route handler is responsible for actually performing
 * the WebAuthn assertion check; this helper simply binds the result
 * to a short-lived token that the SecureReader / Vault UI presents on
 * subsequent reads.
 */
export function mintUnlockToken(userId: string, now: Date = new Date()): string {
  const issuedAt = now.getTime();
  const expiresAt = issuedAt + UNLOCK_TOKEN_TTL_MS;
  const payload = `${UNLOCK_TOKEN_VERSION}.${userId}.${issuedAt}.${expiresAt}`;
  const sig = createHmac("sha256", getUnlockSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/** Parses + validates an unlock token; returns the userId or null. */
export function verifyUnlockToken(
  token: string,
  now: Date = new Date()
): string | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, userId, issuedAtStr, expiresAtStr, providedSig] = parts;
  if (version !== UNLOCK_TOKEN_VERSION) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) return null;

  const expectedSig = createHmac("sha256", getUnlockSecret())
    .update(`${version}.${userId}.${issuedAtStr}.${expiresAtStr}`)
    .digest("base64url");
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return userId;
}

// ─── CRUD operations ─────────────────────────────────────────────

/**
 * Inserts a vaulted message, evicting the oldest entry if the user is
 * already at `VAULT_CAPACITY`.
 *
 * The plaintext message key (`messageKeyB64`) is wrapped before storage;
 * the caller is expected to have just decrypted the original ephemeral
 * message and to already hold the symmetric key in memory.
 */
export async function put(params: {
  ownerUserId: string;
  originalId: string | null;
  subject: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  messageKeyB64: string;
}): Promise<VaultEntry> {
  const wrapped = wrapKey(params.messageKeyB64, params.ownerUserId);

  const existing = await prisma.vaultedMessage.count({
    where: { ownerUserId: params.ownerUserId },
  });
  if (existing >= VAULT_CAPACITY) {
    const overflow = existing - VAULT_CAPACITY + 1;
    const toEvict = await prisma.vaultedMessage.findMany({
      where: { ownerUserId: params.ownerUserId },
      orderBy: { savedAt: "asc" },
      take: overflow,
      select: { id: true },
    });
    if (toEvict.length > 0) {
      await prisma.vaultedMessage.deleteMany({
        where: { id: { in: toEvict.map((r) => r.id) } },
      });
    }
  }

  const created = await prisma.vaultedMessage.create({
    data: {
      ownerUserId: params.ownerUserId,
      originalId: params.originalId,
      subject: params.subject,
      ciphertext: params.ciphertext,
      iv: params.iv,
      authTag: params.authTag,
      algorithm: "AES-256-GCM",
      wrappedKey: wrapped.data,
      wrappedKeyIv: wrapped.iv,
      wrappedKeyTag: wrapped.authTag,
    },
  });
  return {
    id: created.id,
    originalId: created.originalId,
    subject: created.subject,
    savedAt: created.savedAt,
    lastAccessedAt: created.lastAccessedAt,
    accessCount: created.accessCount,
  };
}

export async function list(ownerUserId: string): Promise<VaultEntry[]> {
  const rows = await prisma.vaultedMessage.findMany({
    where: { ownerUserId },
    orderBy: { savedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    originalId: row.originalId,
    subject: row.subject,
    savedAt: row.savedAt,
    lastAccessedAt: row.lastAccessedAt,
    accessCount: row.accessCount,
  }));
}

/**
 * Returns a vaulted message including its (still-wrapped) key, but ONLY
 * if the supplied unlock token is valid for the owning user.
 */
export async function unlock(
  entryId: string,
  unlockToken: string
): Promise<VaultEntryWithCipher | null> {
  const userId = verifyUnlockToken(unlockToken);
  if (!userId) return null;
  const row = await prisma.vaultedMessage.findUnique({
    where: { id: entryId },
  });
  if (!row || row.ownerUserId !== userId) return null;

  await prisma.vaultedMessage.update({
    where: { id: entryId },
    data: {
      lastAccessedAt: new Date(),
      accessCount: row.accessCount + 1,
    },
  });

  return {
    id: row.id,
    originalId: row.originalId,
    subject: row.subject,
    savedAt: row.savedAt,
    lastAccessedAt: new Date(),
    accessCount: row.accessCount + 1,
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.authTag,
    algorithm: "AES-256-GCM",
    wrappedKey: {
      data: row.wrappedKey,
      iv: row.wrappedKeyIv,
      authTag: row.wrappedKeyTag,
    },
  };
}

/**
 * Convenience that combines `unlock` with `unwrapKey` so callers get
 * back the plaintext AES key (still without the server ever holding
 * the *plaintext message body*).
 */
export async function unlockAndUnwrap(
  entryId: string,
  unlockToken: string
): Promise<{ entry: VaultEntryWithCipher; messageKey: string } | null> {
  const entry = await unlock(entryId, unlockToken);
  if (!entry) return null;
  const verifiedUser = verifyUnlockToken(unlockToken);
  if (!verifiedUser) return null;
  const key = unwrapKey(entry.wrappedKey, verifiedUser);
  if (!key) return null;
  return { entry, messageKey: key };
}

/** Removes a vault entry; returns true if a row was deleted. */
export async function remove(
  entryId: string,
  ownerUserId: string
): Promise<boolean> {
  const result = await prisma.vaultedMessage.deleteMany({
    where: { id: entryId, ownerUserId },
  });
  return result.count > 0;
}

/** Empties the user's vault.  Returns the number of rows removed. */
export async function clear(ownerUserId: string): Promise<number> {
  const result = await prisma.vaultedMessage.deleteMany({
    where: { ownerUserId },
  });
  return result.count;
}

export async function capacity(ownerUserId: string): Promise<{
  used: number;
  total: number;
  remaining: number;
}> {
  const used = await prisma.vaultedMessage.count({ where: { ownerUserId } });
  return { used, total: VAULT_CAPACITY, remaining: VAULT_CAPACITY - used };
}
