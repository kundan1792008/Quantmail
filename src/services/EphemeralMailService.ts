/**
 * EphemeralMailService
 *
 * Manages self-destructing, AES-256-GCM encrypted messages.
 *
 * Security model
 * ──────────────
 * • The AES-256-GCM key is generated client-side and embedded exclusively in
 *   the URL fragment (#key=<base64url>) so it is NEVER sent to this server.
 * • This service stores only the opaque ciphertext blob, the IV, and the GCM
 *   auth-tag.  Without the fragment key the server cannot decrypt anything.
 * • On destruction the blob is overwritten with cryptographically random bytes
 *   before the database row is removed, leaving no residual plaintext.
 *
 * Destruction modes
 * ─────────────────
 * READ_ONCE        — destroyed on first successful open.
 * TIMER_1H         — auto-expires 1 hour after creation.
 * TIMER_24H        — auto-expires 24 hours after creation.
 * TIMER_7D         — auto-expires 7 days after creation.
 * SCREENSHOT_PROOF — behaves like READ_ONCE; the client layer also applies
 *                    CSS user-select:none + JS event prevention overlays.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import type { DestructionMode } from "../generated/prisma/client";

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMER_DURATIONS_MS: Record<string, number> = {
  TIMER_1H: 60 * 60 * 1_000,
  TIMER_24H: 24 * 60 * 60 * 1_000,
  TIMER_7D: 7 * 24 * 60 * 60 * 1_000,
};

const MAX_BLOB_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CreateEphemeralMessageInput {
  senderId: string;
  recipientEmail: string;
  /** Base64url-encoded AES-256-GCM ciphertext. */
  encryptedBlob: string;
  /** Base64url-encoded 12-byte IV. */
  iv: string;
  /** Base64url-encoded 16-byte GCM auth tag. */
  authTag: string;
  subject?: string;
  destructionMode: DestructionMode;
  /** Sender's ephemeral ECDH public key (base64url, P-256 SubjectPublicKeyInfo). */
  senderPublicKey: string;
  /** Recipient's long-term ECDH public key if available (optional). */
  recipientPubKey?: string;
}

export interface EphemeralMessageMeta {
  id: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  destructionMode: DestructionMode;
  screenshotProof: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  /** Sender's public key so the recipient can derive the shared ECDH secret. */
  senderPublicKey: string | null;
}

export interface OpenEphemeralMessageResult {
  id: string;
  /** Base64url-encoded ciphertext. Null if already destroyed. */
  encryptedBlob: string | null;
  iv: string | null;
  authTag: string | null;
  subject: string;
  destructionMode: DestructionMode;
  screenshotProof: boolean;
  senderPublicKey: string | null;
  alreadyDestroyed: boolean;
  destroyedAt: Date | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the expiry timestamp for timer-based destruction modes.
 * Returns `null` for READ_ONCE and SCREENSHOT_PROOF (no time limit).
 */
export function computeExpiresAt(mode: DestructionMode): Date | null {
  const durationMs = TIMER_DURATIONS_MS[mode as string];
  if (durationMs === undefined) return null;
  return new Date(Date.now() + durationMs);
}

/**
 * Returns true when the message has passed its expiry deadline.
 */
export function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return Date.now() > expiresAt.getTime();
}

/**
 * Returns true when the message has already been destroyed
 * (either read or expired and cleaned up).
 */
export function isDestroyed(destroyedAt: Date | null): boolean {
  return destroyedAt !== null;
}

/**
 * Validates that the encrypted blob length is within the allowed limit.
 */
export function isBlobSizeValid(blobBase64url: string): boolean {
  // base64url-encoded length * 3/4 gives approximate byte count.
  const estimatedBytes = Math.floor((blobBase64url.length * 3) / 4);
  return estimatedBytes <= MAX_BLOB_SIZE_BYTES;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Persists a new ephemeral encrypted message.
 *
 * The caller is responsible for generating the AES-256-GCM key client-side
 * and embedding it in the shareable URL fragment.  Only the ciphertext,
 * IV, and auth-tag are stored here.
 */
export async function createEphemeralMessage(
  input: CreateEphemeralMessageInput
): Promise<EphemeralMessageMeta> {
  const {
    senderId,
    recipientEmail,
    encryptedBlob,
    iv,
    authTag,
    subject = "",
    destructionMode,
    senderPublicKey,
    recipientPubKey,
  } = input;

  if (!isBlobSizeValid(encryptedBlob)) {
    throw new Error("Encrypted blob exceeds maximum allowed size (10 MB).");
  }

  const screenshotProof = destructionMode === "SCREENSHOT_PROOF";
  const expiresAt = computeExpiresAt(destructionMode);
  const blobBuffer = new Uint8Array(Buffer.from(encryptedBlob, "base64url"));

  const message = await prisma.ephemeralMessage.create({
    data: {
      senderId,
      recipientEmail,
      encryptedBlob: blobBuffer,
      iv,
      authTag,
      subject,
      destructionMode,
      screenshotProof,
      expiresAt,
      keyPair: {
        create: {
          senderPublicKey,
          recipientPubKey: recipientPubKey ?? null,
        },
      },
    },
    include: { keyPair: true },
  });

  return {
    id: message.id,
    senderId: message.senderId,
    recipientEmail: message.recipientEmail,
    subject: message.subject,
    destructionMode: message.destructionMode,
    screenshotProof: message.screenshotProof,
    expiresAt: message.expiresAt,
    createdAt: message.createdAt,
    senderPublicKey: message.keyPair?.senderPublicKey ?? null,
  };
}

/**
 * Opens an ephemeral message and returns the encrypted blob for client-side
 * decryption.
 *
 * Side-effects:
 * • READ_ONCE / SCREENSHOT_PROOF — triggers immediate destruction after
 *   returning the blob to the caller.
 * • Timer modes — returns the blob if not yet expired; marks as destroyed
 *   if the deadline has passed.
 */
export async function openEphemeralMessage(
  messageId: string
): Promise<OpenEphemeralMessageResult> {
  const message = await prisma.ephemeralMessage.findUnique({
    where: { id: messageId },
    include: { keyPair: true },
  });

  if (!message) {
    return {
      id: messageId,
      encryptedBlob: null,
      iv: null,
      authTag: null,
      subject: "",
      destructionMode: "READ_ONCE",
      screenshotProof: false,
      senderPublicKey: null,
      alreadyDestroyed: true,
      destroyedAt: null,
    };
  }

  // Already destroyed.
  if (message.destroyedAt !== null) {
    return {
      id: message.id,
      encryptedBlob: null,
      iv: null,
      authTag: null,
      subject: message.subject,
      destructionMode: message.destructionMode,
      screenshotProof: message.screenshotProof,
      senderPublicKey: message.keyPair?.senderPublicKey ?? null,
      alreadyDestroyed: true,
      destroyedAt: message.destroyedAt,
    };
  }

  // Check timer expiry.
  if (isExpired(message.expiresAt)) {
    await destroyEphemeralMessage(messageId);
    return {
      id: message.id,
      encryptedBlob: null,
      iv: null,
      authTag: null,
      subject: message.subject,
      destructionMode: message.destructionMode,
      screenshotProof: message.screenshotProof,
      senderPublicKey: message.keyPair?.senderPublicKey ?? null,
      alreadyDestroyed: true,
      destroyedAt: new Date(),
    };
  }

  // Valid, unread message — return the blob.
  const blobBase64url = Buffer.from(message.encryptedBlob).toString("base64url");

  const result: OpenEphemeralMessageResult = {
    id: message.id,
    encryptedBlob: blobBase64url,
    iv: message.iv,
    authTag: message.authTag,
    subject: message.subject,
    destructionMode: message.destructionMode,
    screenshotProof: message.screenshotProof,
    senderPublicKey: message.keyPair?.senderPublicKey ?? null,
    alreadyDestroyed: false,
    destroyedAt: null,
  };

  // READ_ONCE and SCREENSHOT_PROOF: destroy immediately after delivering the blob.
  if (
    message.destructionMode === "READ_ONCE" ||
    message.destructionMode === "SCREENSHOT_PROOF"
  ) {
    await destroyEphemeralMessage(messageId);
  } else {
    // Record the first read timestamp for audit purposes.
    if (message.readAt === null) {
      await prisma.ephemeralMessage.update({
        where: { id: messageId },
        data: { readAt: new Date() },
      });
    }
  }

  return result;
}

/**
 * Securely destroys an ephemeral message.
 *
 * Steps:
 *  1. Overwrite the encrypted blob with random bytes (same length).
 *  2. Set `destroyedAt` timestamp.
 *  3. Delete the row from the database.
 *
 * The overwrite step ensures that even if the database has row-level logging
 * or WAL files, the original ciphertext is replaced before deletion.
 */
export async function destroyEphemeralMessage(messageId: string): Promise<void> {
  const message = await prisma.ephemeralMessage.findUnique({
    where: { id: messageId },
    select: { id: true, destroyedAt: true, encryptedBlob: true },
  });

  if (!message || message.destroyedAt !== null) {
    return; // Already gone or destroyed.
  }

  // Overwrite with random bytes of the same length.
  const blobLength = (message.encryptedBlob as Uint8Array).length;
  const randomOverwrite = new Uint8Array(randomBytes(blobLength > 0 ? blobLength : 32));

  await prisma.ephemeralMessage.update({
    where: { id: messageId },
    data: {
      encryptedBlob: randomOverwrite,
      destroyedAt: new Date(),
    },
  });

  // Delete the row (cascade deletes the associated EphemeralKeyPair).
  await prisma.ephemeralMessage.delete({ where: { id: messageId } });
}

/**
 * Sweeps all messages whose timer has expired and destroys them.
 * Intended to be called by a background job/cron.
 *
 * Returns the number of messages destroyed.
 */
export async function sweepExpiredMessages(): Promise<number> {
  const expired = await prisma.ephemeralMessage.findMany({
    where: {
      destroyedAt: null,
      expiresAt: { lte: new Date() },
    },
    select: { id: true },
  });

  for (const { id } of expired) {
    await destroyEphemeralMessage(id);
  }

  return expired.length;
}

/**
 * Lists metadata for messages sent to a recipient email.
 * Does NOT return the encrypted blob — only metadata.
 */
export async function listMessagesForRecipient(
  recipientEmail: string
): Promise<EphemeralMessageMeta[]> {
  const messages = await prisma.ephemeralMessage.findMany({
    where: { recipientEmail, destroyedAt: null },
    include: { keyPair: true },
    orderBy: { createdAt: "desc" },
  });

  // Filter out expired ones lazily.
  const results: EphemeralMessageMeta[] = [];
  for (const m of messages) {
    if (isExpired(m.expiresAt)) {
      await destroyEphemeralMessage(m.id);
      continue;
    }
    results.push({
      id: m.id,
      senderId: m.senderId,
      recipientEmail: m.recipientEmail,
      subject: m.subject,
      destructionMode: m.destructionMode,
      screenshotProof: m.screenshotProof,
      expiresAt: m.expiresAt,
      createdAt: m.createdAt,
      senderPublicKey: m.keyPair?.senderPublicKey ?? null,
    });
  }

  return results;
}

/**
 * Lists metadata for messages sent BY a user.
 */
export async function listMessagesBySender(
  senderId: string
): Promise<EphemeralMessageMeta[]> {
  const messages = await prisma.ephemeralMessage.findMany({
    where: { senderId, destroyedAt: null },
    include: { keyPair: true },
    orderBy: { createdAt: "desc" },
  });

  const results: EphemeralMessageMeta[] = [];
  for (const m of messages) {
    if (isExpired(m.expiresAt)) {
      await destroyEphemeralMessage(m.id);
      continue;
    }
    results.push({
      id: m.id,
      senderId: m.senderId,
      recipientEmail: m.recipientEmail,
      subject: m.subject,
      destructionMode: m.destructionMode,
      screenshotProof: m.screenshotProof,
      expiresAt: m.expiresAt,
      createdAt: m.createdAt,
      senderPublicKey: m.keyPair?.senderPublicKey ?? null,
    });
  }

  return results;
}
