/**
 * WebAuthn / Passkey Authentication Service
 *
 * Provides registration and authentication flows using the WebAuthn standard.
 * Supports multiple credentials per user (phone, laptop, security key).
 *
 * Uses @simplewebauthn/server for attestation and assertion verification.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { prisma } from "../db";

// ─── Configuration ────────────────────────────────────────────────

const RP_NAME = process.env["WEBAUTHN_RP_NAME"] || "Quantmail";
const RP_ID = process.env["WEBAUTHN_RP_ID"] || "localhost";
const ORIGIN = process.env["WEBAUTHN_ORIGIN"] || "http://localhost:3000";

/** In-memory challenge store keyed by userId.
 *  In production, replace with a Redis-backed store with TTL. */
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Types ────────────────────────────────────────────────────────

export interface StoredCredential {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: bigint;
  transports: AuthenticatorTransportFuture[];
  deviceType: string;
  backedUp: boolean;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

// ─── Challenge helpers ────────────────────────────────────────────

function storeChallenge(userId: string, challenge: string): void {
  challengeStore.set(userId, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

function consumeChallenge(userId: string): string | null {
  const entry = challengeStore.get(userId);
  if (!entry) return null;
  challengeStore.delete(userId);
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

// ─── Registration ─────────────────────────────────────────────────

/**
 * Generates WebAuthn registration options for a user.
 * Excludes already-registered credentials to prevent duplicates.
 */
export async function generatePasskeyRegistrationOptions(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { webAuthnCredentials: true },
  });
  if (!user) throw new Error("User not found");

  const existingCredentials = user.webAuthnCredentials.map((cred: { credentialId: string; transports: string }) => ({
    id: cred.credentialId,
    transports: JSON.parse(cred.transports) as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    userDisplayName: user.displayName,
    attestationType: "none",
    excludeCredentials: existingCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    supportedAlgorithmIDs: [-7, -257], // ES256, RS256
  });

  storeChallenge(userId, options.challenge);

  return options as unknown as Record<string, unknown>;
}

/**
 * Verifies a WebAuthn registration response and stores the new credential.
 */
export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  credentialName?: string
): Promise<{ verified: boolean; credentialId?: string }> {
  const challenge = consumeChallenge(userId);
  if (!challenge) {
    throw new Error("No active registration challenge found or challenge expired");
  }

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    throw new Error(
      `Registration verification failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  // Encode public key as base64url for storage
  const publicKeyB64 = Buffer.from(credential.publicKey).toString("base64url");
  const transports = response.response.transports ?? [];

  await prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: publicKeyB64,
      counter: BigInt(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: JSON.stringify(transports),
      name: credentialName ?? "Passkey",
    },
  });

  return { verified: true, credentialId: credential.id };
}

// ─── Authentication ───────────────────────────────────────────────

/**
 * Generates WebAuthn authentication options for a user.
 * Includes all registered credentials as allowed credentials.
 */
export async function generatePasskeyAuthenticationOptions(
  userId: string
): Promise<Record<string, unknown>> {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
  });

  if (credentials.length === 0) {
    throw new Error("No passkeys registered for this user");
  }

  const allowCredentials = credentials.map((cred: { credentialId: string; transports: string }) => ({
    id: cred.credentialId,
    transports: JSON.parse(cred.transports) as AuthenticatorTransportFuture[],
  }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: "preferred",
  });

  storeChallenge(userId, options.challenge);

  return options as unknown as Record<string, unknown>;
}

/**
 * Verifies a WebAuthn authentication response.
 * Updates the credential's sign counter to prevent cloning attacks.
 */
export async function verifyPasskeyAuthentication(
  userId: string,
  response: AuthenticationResponseJSON
): Promise<{ verified: boolean; credentialId?: string }> {
  const challenge = consumeChallenge(userId);
  if (!challenge) {
    throw new Error("No active authentication challenge found or challenge expired");
  }

  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: response.id },
  });

  if (!credential || credential.userId !== userId) {
    throw new Error("Credential not found or does not belong to this user");
  }

  const publicKey = Buffer.from(credential.publicKey, "base64url");
  const transports = JSON.parse(credential.transports) as AuthenticatorTransportFuture[];

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credentialId,
        publicKey,
        counter: Number(credential.counter),
        transports,
      },
    });
  } catch (err) {
    throw new Error(
      `Authentication verification failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!verification.verified) {
    return { verified: false };
  }

  // Update counter to prevent replay/cloning attacks
  await prisma.webAuthnCredential.update({
    where: { credentialId: credential.credentialId },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });

  return { verified: true, credentialId: credential.credentialId };
}

// ─── Credential management ────────────────────────────────────────

/**
 * Returns all passkeys registered for a user.
 */
export async function listUserCredentials(userId: string): Promise<StoredCredential[]> {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return credentials.map((c: {
    id: string;
    credentialId: string;
    publicKey: string;
    counter: bigint;
    transports: string;
    deviceType: string;
    backedUp: boolean;
    name: string;
    createdAt: Date;
    lastUsedAt: Date | null;
  }) => ({
    id: c.id,
    credentialId: c.credentialId,
    publicKey: c.publicKey,
    counter: c.counter,
    transports: JSON.parse(c.transports) as AuthenticatorTransportFuture[],
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    name: c.name,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  }));
}

/**
 * Removes a specific passkey credential by its DB record ID.
 * Only removes the credential if it belongs to the given userId.
 */
export async function removeCredential(
  userId: string,
  credentialRecordId: string
): Promise<boolean> {
  const credential = await prisma.webAuthnCredential.findUnique({
    where: { id: credentialRecordId },
  });

  if (!credential || credential.userId !== userId) {
    return false;
  }

  await prisma.webAuthnCredential.delete({ where: { id: credentialRecordId } });
  return true;
}
