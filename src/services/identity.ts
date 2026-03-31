import { createHash, randomBytes } from "node:crypto";

/**
 * Verified sender domains that are allowed into the primary inbox.
 * All other domains are routed to the Shadow table.
 */
const VERIFIED_DOMAINS: ReadonlySet<string> = new Set([
  "quantmail.io",
  "infinitytrinity.io",
]);

/**
 * Known high-risk domains that are unconditionally dropped.
 */
const BLOCKED_DOMAINS: ReadonlySet<string> = new Set([
  "spam-factory.test",
  "phish.example",
]);

/** Extract the domain portion from an email address. */
export function extractDomain(email: string): string {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) {
    return "";
  }
  return email.slice(atIndex + 1).toLowerCase();
}

/** Determine whether a sender domain is verified. */
export function isDomainVerified(domain: string): boolean {
  return VERIFIED_DOMAINS.has(domain.toLowerCase());
}

/** Determine whether a sender domain is explicitly blocked. */
export function isDomainBlocked(domain: string): boolean {
  return BLOCKED_DOMAINS.has(domain.toLowerCase());
}

/**
 * Classify a sender email and return the interception reason (if any).
 * Returns `null` when the sender is verified and should reach the primary inbox.
 */
export function classifySender(
  senderEmail: string,
): { reason: string; severity: string } | null {
  const domain = extractDomain(senderEmail);

  if (domain === "") {
    return { reason: "invalid_sender_address", severity: "high" };
  }

  if (isDomainBlocked(domain)) {
    return { reason: "blocked_domain", severity: "critical" };
  }

  if (!isDomainVerified(domain)) {
    return { reason: "unverified_domain", severity: "medium" };
  }

  return null;
}

/**
 * Compute a SHA-256 hash used as a biometric facial-matrix identifier.
 * In production this would be derived from the liveness-check SDK payload;
 * here we create a deterministic hash from the supplied data buffer.
 */
export function computeFacialHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Generate a Master-ID token.
 * The token is a cryptographically random string that uniquely identifies a
 * user across all applications in the Infinity Trinity ecosystem.
 */
export function generateMasterIdToken(): string {
  return `qm_mid_${randomBytes(32).toString("hex")}`;
}

/**
 * Validate that a Master-ID token has the expected format.
 */
export function isValidMasterIdToken(token: string): boolean {
  return /^qm_mid_[0-9a-f]{64}$/.test(token);
}

/**
 * List of partner application identifiers that the Master ID propagates to.
 */
export const PARTNER_APPS = [
  "quantbrowse-ai",
  "quantvault",
  "quantpay",
  "quantdocs",
  "quantmeet",
  "quantcloud",
  "quantguard",
  "quantanalytics",
] as const;

export type PartnerApp = (typeof PARTNER_APPS)[number];

/**
 * Build the propagation payload sent to each partner app when a user
 * authenticates through the Biometric SSO.  Each app receives the same
 * master-ID token so they can correlate the identity without a second
 * authentication step.
 */
export function buildPropagationPayload(
  masterIdToken: string,
  userId: string,
) {
  return PARTNER_APPS.map((app) => ({
    app,
    masterIdToken,
    userId,
    propagatedAt: new Date().toISOString(),
  }));
}
