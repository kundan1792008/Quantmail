import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

const rpID =
  process.env["WEBAUTHN_RP_ID"] ??
  process.env["NEXT_PUBLIC_WEBAUTHN_RP_ID"] ??
  "localhost";

const rpOrigin = process.env["WEBAUTHN_ORIGIN"] ?? "http://localhost:3000";

const rpName = process.env["WEBAUTHN_RP_NAME"] ?? "Quantmail";

const challengeTtlMs = Number(process.env["WEBAUTHN_CHALLENGE_TTL_MS"] ?? 300000);

export const webAuthnConfig = {
  rpID,
  rpOrigin,
  rpName,
  challengeTtlMs: Number.isFinite(challengeTtlMs) ? challengeTtlMs : 300000,
};

export function challengeExpiresAt(): Date {
  return new Date(Date.now() + webAuthnConfig.challengeTtlMs);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidBiometricHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function parseTransports(
  value: string
): AuthenticatorTransportFuture[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    return parsed.filter(
      (transport): transport is AuthenticatorTransportFuture =>
        typeof transport === "string"
    );
  } catch {
    return undefined;
  }
}

export function serializeTransports(
  transports?: AuthenticatorTransportFuture[]
): string {
  return JSON.stringify(transports ?? []);
}

export function getCredentialId(
  response: Pick<RegistrationResponseJSON | AuthenticationResponseJSON, "id" | "rawId">
): string {
  return response.id || response.rawId;
}
