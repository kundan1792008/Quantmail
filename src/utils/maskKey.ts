import { decryptApiKey } from "./crypto";

const ENCRYPTION_SECRET =
  process.env["ENCRYPTION_SECRET"] || "quantmail-key-secret";

/**
 * Returns a masked version of a stored (encrypted) API key.
 * Decrypts the value internally and shows only the last 4 plaintext characters.
 * Returns null when the stored value is absent.
 */
export function maskStoredKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const plain = decryptApiKey(encrypted, ENCRYPTION_SECRET);
  if (!plain || plain.length < 8) return "****";
  return `****${plain.slice(-4)}`;
}
