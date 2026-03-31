/**
 * InboxInterceptor – Shadow Inbox Spam Filter
 *
 * Webhook handler that inspects incoming email traffic.
 * Messages from unverified sender domains are dropped into the ShadowInbox
 * table instead of reaching the user's primary inbox.
 */

/** Domains considered unverified for shadow-inbox filtering. */
const UNVERIFIED_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "mail.ru",
  "yandex.com",
  "protonmail.com",
  "zoho.com",
  "icloud.com",
  "gmx.com",
  "live.com",
]);

export interface IncomingMessage {
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface InterceptResult {
  intercepted: boolean;
  reason: string;
  domain: string;
}

/**
 * Extracts the domain from an email address.
 * Returns empty string if the format is invalid.
 */
export function extractDomain(email: string): string {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 1) return "";
  return email.slice(atIndex + 1).toLowerCase().trim();
}

/**
 * Validates an email address format (basic check).
 * Uses an efficient regex that avoids polynomial backtracking.
 */
export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 1) return false;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!local || !domain || domain.indexOf(".") < 1) return false;
  if (/\s/.test(email)) return false;
  return true;
}

/**
 * Sanitizes a message body to prevent injection attacks.
 * Strips all HTML tags iteratively to handle nested tags, and limits length.
 */
export function sanitizeBody(body: string): string {
  let result = body;
  // Iteratively strip tags to handle nested/incomplete tags
  let previous: string;
  do {
    previous = result;
    result = result.replace(/<[^<>]*>/g, "");
  } while (result !== previous);
  return result.slice(0, 50000);
}

/**
 * Determines whether an incoming message should be intercepted
 * and dropped to the Shadow Inbox.
 */
export function shouldIntercept(message: IncomingMessage): InterceptResult {
  if (!isValidEmail(message.senderEmail)) {
    return {
      intercepted: true,
      reason: "INVALID_SENDER_FORMAT",
      domain: "",
    };
  }

  const domain = extractDomain(message.senderEmail);

  if (!domain) {
    return {
      intercepted: true,
      reason: "MISSING_DOMAIN",
      domain: "",
    };
  }

  if (UNVERIFIED_DOMAINS.has(domain)) {
    return {
      intercepted: true,
      reason: "UNVERIFIED_DOMAIN",
      domain,
    };
  }

  return {
    intercepted: false,
    reason: "ALLOWED",
    domain,
  };
}

/**
 * Returns the current set of unverified domains (for auditing).
 */
export function getUnverifiedDomains(): readonly string[] {
  return Array.from(UNVERIFIED_DOMAINS);
}
