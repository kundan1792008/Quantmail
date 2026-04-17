/**
 * MessageVault
 *
 * Optional long-term storage for ephemeral messages that the original
 * sender explicitly marks as vault-able.
 *
 * Security model
 * ──────────────
 * • Each vault entry is re-encrypted with a vault key derived from the
 *   user's WebAuthn credential ID via HKDF.  The server-side
 *   VAULT_ENCRYPTION_SECRET is required in addition to the credential ID,
 *   so neither the database dump alone nor the credential ID alone suffices.
 * • Vault unlock is gated on a WebAuthn assertion in the route layer.
 *   This service assumes the caller has already verified the assertion.
 * • Hard cap: 100 entries per user.  When the cap is reached, the oldest
 *   entry is removed automatically (LRU eviction) before the new one is
 *   written.
 *
 * Vault key derivation
 * ────────────────────
 * vaultKey = HKDF-SHA256(
 *   ikm   = VAULT_ENCRYPTION_SECRET,
 *   salt  = credentialId,
 *   info  = "quantmail-vault-v1:<userId>",
 *   len   = 32 bytes
 * )
 * The derived key is then used for AES-256-GCM encryption of the content.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { prisma } from "../db";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_VAULT_ENTRIES = 100;
const VAULT_HKDF_INFO_PREFIX = "quantmail-vault-v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultEntry {
  id: string;
  userId: string;
  ephemeralMessageId: string | null;
  senderEmail: string;
  subject: string;
  /** Base64url-encoded AES-256-GCM ciphertext of the original message body. */
  encryptedContent: string;
  vaultedAt: Date;
  webAuthnCredId: string;
}

export interface VaultEntryMeta {
  id: string;
  userId: string;
  ephemeralMessageId: string | null;
  senderEmail: string;
  subject: string;
  vaultedAt: Date;
}

export interface AddToVaultInput {
  userId: string;
  webAuthnCredId: string;
  senderEmail: string;
  subject: string;
  /** Plain-text message body to be vault-encrypted. */
  plainContent: string;
  ephemeralMessageId?: string;
}

export interface DecryptVaultEntryInput {
  entryId: string;
  userId: string;
  webAuthnCredId: string;
}

// ─── Vault key derivation ─────────────────────────────────────────────────────

/**
 * Derives a 256-bit AES vault key using HKDF-SHA256.
 *
 * ikm   = VAULT_ENCRYPTION_SECRET (server secret)
 * salt  = credentialId (ties the key to a specific WebAuthn device)
 * info  = "quantmail-vault-v1:<userId>"
 */
export function deriveVaultKey(userId: string, credentialId: string): Buffer {
  const secret =
    process.env["VAULT_ENCRYPTION_SECRET"] ||
    process.env["ENCRYPTION_SECRET"] ||
    "quantmail-vault-fallback-secret";

  const info = `${VAULT_HKDF_INFO_PREFIX}:${userId}`;

  // HKDF extract
  const prk = createHmac("sha256", credentialId).update(secret).digest();

  // HKDF expand (one block = 32 bytes)
  const infoBuffer = Buffer.from(info, "utf-8");
  const counter = Buffer.from([0x01]);
  return createHmac("sha256", prk)
    .update(infoBuffer)
    .update(counter)
    .digest()
    .slice(0, 32);
}

// ─── Encrypt / decrypt helpers ────────────────────────────────────────────────

/**
 * Encrypts plaintext content using AES-256-GCM with the derived vault key.
 * Returns a combined buffer: iv (12 bytes) || authTag (16 bytes) || ciphertext.
 */
export function encryptVaultContent(
  plainContent: string,
  vaultKey: Buffer
): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainContent, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts vault content encrypted by encryptVaultContent.
 * Throws if authentication fails.
 */
export function decryptVaultContent(
  encryptedBuffer: Buffer,
  vaultKey: Buffer
): string {
  if (encryptedBuffer.length < 28) {
    throw new Error("Vault entry is too short to be valid.");
  }

  const iv = encryptedBuffer.slice(0, 12);
  const authTag = encryptedBuffer.slice(12, 28);
  const ciphertext = encryptedBuffer.slice(28);

  const decipher = createDecipheriv("aes-256-gcm", vaultKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf-8");
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Adds a message to the user's vault.
 *
 * If the vault already contains MAX_VAULT_ENTRIES (100) items, the oldest
 * entry is removed before the new one is written (LRU eviction).
 *
 * Precondition: the caller MUST have already verified the WebAuthn assertion.
 */
export async function addToVault(input: AddToVaultInput): Promise<VaultEntryMeta> {
  const { userId, webAuthnCredId, senderEmail, subject, plainContent, ephemeralMessageId } =
    input;

  // Count current vault entries.
  const count = await prisma.messageVaultEntry.count({ where: { userId } });

  if (count >= MAX_VAULT_ENTRIES) {
    // Evict the oldest entry.
    const oldest = await prisma.messageVaultEntry.findFirst({
      where: { userId },
      orderBy: { vaultedAt: "asc" },
      select: { id: true },
    });
    if (oldest) {
      await prisma.messageVaultEntry.delete({ where: { id: oldest.id } });
    }
  }

  const vaultKey = deriveVaultKey(userId, webAuthnCredId);
  const encryptedBuffer = encryptVaultContent(plainContent, vaultKey);

  const entry = await prisma.messageVaultEntry.create({
    data: {
      userId,
      webAuthnCredId,
      senderEmail,
      subject,
      encryptedContent: new Uint8Array(encryptedBuffer),
      ephemeralMessageId: ephemeralMessageId ?? null,
    },
  });

  return {
    id: entry.id,
    userId: entry.userId,
    ephemeralMessageId: entry.ephemeralMessageId,
    senderEmail: entry.senderEmail,
    subject: entry.subject,
    vaultedAt: entry.vaultedAt,
  };
}

/**
 * Returns vault entry metadata for a user (without decrypting content).
 * Requires WebAuthn assertion to be verified by the route layer.
 */
export async function listVaultEntries(userId: string): Promise<VaultEntryMeta[]> {
  const entries = await prisma.messageVaultEntry.findMany({
    where: { userId },
    orderBy: { vaultedAt: "desc" },
    select: {
      id: true,
      userId: true,
      ephemeralMessageId: true,
      senderEmail: true,
      subject: true,
      vaultedAt: true,
    },
  });

  return entries.map((e) => ({
    id: e.id,
    userId: e.userId,
    ephemeralMessageId: e.ephemeralMessageId,
    senderEmail: e.senderEmail,
    subject: e.subject,
    vaultedAt: e.vaultedAt,
  }));
}

/**
 * Decrypts and returns the plaintext content of a vault entry.
 *
 * Precondition: the caller MUST have already verified the WebAuthn assertion
 * for `webAuthnCredId`.
 *
 * Returns null if the entry is not found or does not belong to the user.
 * Throws if decryption fails (wrong key / tampered data).
 */
export async function decryptVaultEntry(
  input: DecryptVaultEntryInput
): Promise<string | null> {
  const { entryId, userId, webAuthnCredId } = input;

  const entry = await prisma.messageVaultEntry.findFirst({
    where: { id: entryId, userId },
  });

  if (!entry) return null;

  const vaultKey = deriveVaultKey(userId, webAuthnCredId);
  return decryptVaultContent(Buffer.from(entry.encryptedContent), vaultKey);
}

/**
 * Removes a specific vault entry.
 * Returns true if deleted, false if not found / not owned by the user.
 */
export async function removeVaultEntry(
  entryId: string,
  userId: string
): Promise<boolean> {
  const existing = await prisma.messageVaultEntry.findFirst({
    where: { id: entryId, userId },
    select: { id: true },
  });

  if (!existing) return false;

  await prisma.messageVaultEntry.delete({ where: { id: entryId } });
  return true;
}

/**
 * Returns the number of vault entries for a user.
 */
export async function getVaultSize(userId: string): Promise<number> {
  return prisma.messageVaultEntry.count({ where: { userId } });
}
