import CryptoJS from "crypto-js";
import { v4 as uuidv4 } from "uuid";

/**
 * Derives a deterministic biometric hash from a facial matrix payload.
 * Uses SHA-256 to produce a unique identity fingerprint.
 */
export function deriveBiometricHash(facialMatrixData: string): string {
  return CryptoJS.SHA256(facialMatrixData).toString(CryptoJS.enc.Hex);
}

/**
 * Generates a Master SSO token for cross-app identity propagation.
 * The token encodes the user ID and a timestamp, signed with HMAC-SHA256.
 */
export function generateMasterSSOToken(
  userId: string,
  secret: string
): string {
  const payload = JSON.stringify({
    sub: userId,
    iat: Date.now(),
    jti: uuidv4(),
  });
  const signature = CryptoJS.HmacSHA256(payload, secret).toString(
    CryptoJS.enc.Hex
  );
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${signature}`;
}

/**
 * Verifies a Master SSO token and extracts the user ID.
 * Returns the userId if valid, or null if the signature doesn't match.
 */
export function verifyMasterSSOToken(
  token: string,
  secret: string
): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  try {
    const payload = Buffer.from(encoded, "base64url").toString("utf-8");
    const expectedSig = CryptoJS.HmacSHA256(payload, secret).toString(
      CryptoJS.enc.Hex
    );
    if (signature !== expectedSig) return null;
    const parsed = JSON.parse(payload) as { sub: string };
    return parsed.sub;
  } catch {
    return null;
  }
}
