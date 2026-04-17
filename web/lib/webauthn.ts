import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

const DEFAULT_CHALLENGE_TTL_MS = 300000;

const rpID =
  process.env["WEBAUTHN_RP_ID"] ??
  process.env["NEXT_PUBLIC_WEBAUTHN_RP_ID"] ??
  "localhost";

const rpOrigin = process.env["WEBAUTHN_ORIGIN"] ?? "http://localhost:3000";

const rpName = process.env["WEBAUTHN_RP_NAME"] ?? "Quantmail";

const challengeTtlMs = Number(
  process.env["WEBAUTHN_CHALLENGE_TTL_MS"] ?? DEFAULT_CHALLENGE_TTL_MS
);

export const webAuthnConfig = {
  rpID,
  rpOrigin,
  rpName,
  challengeTtlMs: Number.isFinite(challengeTtlMs)
    ? challengeTtlMs
    : DEFAULT_CHALLENGE_TTL_MS,
};

export function challengeExpiresAt(): Date {
  return new Date(Date.now() + webAuthnConfig.challengeTtlMs);
}

export function isValidEmail(value: string): boolean {
  if (!value || value.length > 254 || value.includes(" ")) {
    return false;
  }

  const atIndex = value.indexOf("@");
  const lastAtIndex = value.lastIndexOf("@");

  if (atIndex <= 0 || atIndex !== lastAtIndex || atIndex === value.length - 1) {
    return false;
  }

  const localPart = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);

  return localPart.length > 0 && domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
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
