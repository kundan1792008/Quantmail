/**
 * KeyExchangeService
 *
 * ECDH key exchange infrastructure for Quantmail's ephemeral E2E inbox.
 *
 * Design
 * ──────
 * • Every message gets a fresh P-256 ECDH key pair (forward secrecy).
 *   Compromise of one message's key reveals nothing about other messages.
 * • The server stores each message's ephemeral public key so the recipient
 *   can derive the shared secret client-side.  The private key is generated
 *   client-side and never touches the server.
 * • Key rotation is tracked here; revoking a key pair marks all messages
 *   encrypted with it as unreadable (the ECDH derivation is blocked).
 *
 * Key derivation flow
 * ───────────────────
 * Sender:
 *   1. generateEphemeralKeyPair()  → { publicKey, privateKey }
 *   2. deriveSharedSecret(senderPrivKey, recipientLongTermPubKey) → sharedSecret
 *   3. deriveAesKey(sharedSecret, salt) → aesKey (256-bit)
 *   4. Encrypt message with aesKey (AES-256-GCM)
 *   5. Store { messageId, senderPublicKey } via EphemeralMailService
 *   6. Share URL fragment: #key=<senderPublicKey>&s=<salt>
 *
 * Recipient:
 *   1. recipientLongTermPrivKey (stored in browser secure storage)
 *   2. deriveSharedSecret(recipientPrivKey, senderPublicKey from URL) → sharedSecret
 *   3. deriveAesKey(sharedSecret, salt from URL) → aesKey
 *   4. Decrypt blob
 */

import {
  generateKeyPairSync,
  createECDH,
  createHmac,
  randomBytes,
  createHash,
} from "node:crypto";
import { prisma } from "../db";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Elliptic curve used for all ECDH operations. */
const EC_CURVE = "prime256v1"; // P-256 / secp256r1

/** Length of the HKDF salt in bytes. */
const SALT_BYTES = 32;

/** HKDF context label. */
const HKDF_INFO = "quantmail-ephemeral-v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EphemeralKeyPairResult {
  /** Uncompressed P-256 public key, base64url-encoded (65 bytes). */
  publicKey: string;
  /** Raw P-256 private key, base64url-encoded.  Keep this secret. */
  privateKey: string;
}

export interface KeyPairRecord {
  id: string;
  messageId: string;
  senderPublicKey: string;
  recipientPubKey: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface KeyRotationSummary {
  totalKeyPairs: number;
  revokedKeyPairs: number;
  activeKeyPairs: number;
  oldestActiveCreatedAt: Date | null;
  newestActiveCreatedAt: Date | null;
}

// ─── Key generation ───────────────────────────────────────────────────────────

/**
 * Generates a fresh ephemeral ECDH key pair on the P-256 curve.
 *
 * One pair MUST be generated per message to provide forward secrecy.
 * The private key should be kept only in the sender's browser memory
 * and never transmitted to the server.
 */
export function generateEphemeralKeyPair(): EphemeralKeyPairResult {
  const ecdh = createECDH(EC_CURVE);
  ecdh.generateKeys();

  return {
    publicKey: ecdh.getPublicKey("base64url", "uncompressed"),
    privateKey: ecdh.getPrivateKey("base64url"),
  };
}

/**
 * Derives the ECDH shared secret from one party's private key and the
 * other party's public key.
 *
 * @param privateKeyBase64url  Local party's ECDH private key.
 * @param remotePublicKeyBase64url  Remote party's ECDH public key (uncompressed).
 * @returns Raw shared secret as a Buffer.
 */
export function deriveSharedSecret(
  privateKeyBase64url: string,
  remotePublicKeyBase64url: string
): Buffer {
  const ecdh = createECDH(EC_CURVE);
  ecdh.setPrivateKey(Buffer.from(privateKeyBase64url, "base64url"));
  const remote = Buffer.from(remotePublicKeyBase64url, "base64url");
  return ecdh.computeSecret(remote);
}

/**
 * Derives a 256-bit AES key from the ECDH shared secret using HKDF-SHA256.
 *
 * @param sharedSecret  Raw ECDH shared secret.
 * @param salt          32-byte random salt (base64url-encoded).
 * @returns 32-byte AES key as a Buffer.
 */
export function deriveAesKey(sharedSecret: Buffer, salt: string): Buffer {
  const saltBuffer = Buffer.from(salt, "base64url");

  // HKDF extract: PRK = HMAC-SHA256(salt, sharedSecret)
  const prk = createHmac("sha256", saltBuffer).update(sharedSecret).digest();

  // HKDF expand (T(1) = HMAC-SHA256(PRK, info || 0x01))
  const infoBuffer = Buffer.from(HKDF_INFO, "utf-8");
  const counter = Buffer.from([0x01]);
  const t1 = createHmac("sha256", prk)
    .update(infoBuffer)
    .update(counter)
    .digest();

  return t1.slice(0, 32); // 256 bits
}

/**
 * Generates a fresh random HKDF salt.
 */
export function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString("base64url");
}

/**
 * Derives the AES key directly from a private key and a remote public key.
 * Convenience wrapper combining deriveSharedSecret + deriveAesKey.
 */
export function deriveMessageKey(
  privateKeyBase64url: string,
  remotePublicKeyBase64url: string,
  salt: string
): Buffer {
  const sharedSecret = deriveSharedSecret(privateKeyBase64url, remotePublicKeyBase64url);
  return deriveAesKey(sharedSecret, salt);
}

// ─── Fingerprinting ───────────────────────────────────────────────────────────

/**
 * Produces a short human-readable fingerprint for a public key.
 * Useful in the Key Rotation Dashboard UI.
 */
export function fingerprintPublicKey(publicKeyBase64url: string): string {
  const raw = Buffer.from(publicKeyBase64url, "base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  // Return first 40 hex chars formatted in groups of 4.
  return hash
    .slice(0, 40)
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join(":");
}

// ─── Database operations ──────────────────────────────────────────────────────

/**
 * Fetches the key-pair record associated with an ephemeral message.
 */
export async function getKeyPairForMessage(
  messageId: string
): Promise<KeyPairRecord | null> {
  const kp = await prisma.ephemeralKeyPair.findUnique({
    where: { messageId },
  });
  if (!kp) return null;

  return {
    id: kp.id,
    messageId: kp.messageId,
    senderPublicKey: kp.senderPublicKey,
    recipientPubKey: kp.recipientPubKey,
    revokedAt: kp.revokedAt,
    createdAt: kp.createdAt,
  };
}

/**
 * Revokes the key pair for a message.
 *
 * After revocation the ECDH shared secret can no longer be derived, making
 * the encrypted blob permanently unreadable — even if the recipient still
 * has the URL fragment.
 *
 * Only the message sender may revoke (enforce this check at the route layer).
 */
export async function revokeKeyPair(messageId: string): Promise<KeyPairRecord | null> {
  const existing = await prisma.ephemeralKeyPair.findUnique({
    where: { messageId },
  });

  if (!existing) return null;
  if (existing.revokedAt !== null) {
    // Already revoked — return current state.
    return {
      id: existing.id,
      messageId: existing.messageId,
      senderPublicKey: existing.senderPublicKey,
      recipientPubKey: existing.recipientPubKey,
      revokedAt: existing.revokedAt,
      createdAt: existing.createdAt,
    };
  }

  const updated = await prisma.ephemeralKeyPair.update({
    where: { messageId },
    data: { revokedAt: new Date() },
  });

  return {
    id: updated.id,
    messageId: updated.messageId,
    senderPublicKey: updated.senderPublicKey,
    recipientPubKey: updated.recipientPubKey,
    revokedAt: updated.revokedAt,
    createdAt: updated.createdAt,
  };
}

/**
 * Checks whether a message's key pair has been revoked.
 * Returns true if the key pair does not exist (treat as revoked for safety).
 */
export async function isKeyRevoked(messageId: string): Promise<boolean> {
  const kp = await prisma.ephemeralKeyPair.findUnique({
    where: { messageId },
    select: { revokedAt: true },
  });
  if (!kp) return true;
  return kp.revokedAt !== null;
}

/**
 * Returns the Key Rotation Dashboard summary for a sender.
 */
export async function getKeyRotationSummary(
  senderId: string
): Promise<KeyRotationSummary> {
  const keyPairs = await prisma.ephemeralKeyPair.findMany({
    where: {
      message: { senderId },
    },
    orderBy: { createdAt: "asc" },
  });

  const active = keyPairs.filter((kp) => kp.revokedAt === null);
  const revoked = keyPairs.filter((kp) => kp.revokedAt !== null);

  return {
    totalKeyPairs: keyPairs.length,
    revokedKeyPairs: revoked.length,
    activeKeyPairs: active.length,
    oldestActiveCreatedAt: active.length > 0 ? active[0]!.createdAt : null,
    newestActiveCreatedAt:
      active.length > 0 ? active[active.length - 1]!.createdAt : null,
  };
}

/**
 * Lists all key pairs for a sender, ordered newest-first.
 * Intended for the Key Rotation Dashboard.
 */
export async function listKeyPairsForSender(
  senderId: string
): Promise<KeyPairRecord[]> {
  const keyPairs = await prisma.ephemeralKeyPair.findMany({
    where: { message: { senderId } },
    orderBy: { createdAt: "desc" },
  });

  return keyPairs.map((kp) => ({
    id: kp.id,
    messageId: kp.messageId,
    senderPublicKey: kp.senderPublicKey,
    recipientPubKey: kp.recipientPubKey,
    revokedAt: kp.revokedAt,
    createdAt: kp.createdAt,
  }));
}
