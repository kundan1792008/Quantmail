/**
 * InboxInterceptor – Zero-Spam Shadow Inbox Filter
 *
 * Webhook handler that inspects incoming email traffic and routes
 * unverified sender domains to the Shadow database table, keeping
 * the primary inbox clean.
 */

import type { PrismaClient } from "../generated/prisma/client/index.js";

/** Domains that are considered unverified by default */
const DEFAULT_UNVERIFIED_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "mail.com",
  "yandex.com",
  "protonmail.com",
];

export interface IncomingEmailPayload {
  userId: string;
  senderEmail: string;
  subject: string;
  body: string;
}

export interface InterceptionResult {
  intercepted: boolean;
  destination: "inbox" | "shadow";
  reason?: string;
}

/**
 * Extracts the domain portion from an email address.
 */
export function extractDomain(email: string): string {
  const parts = email.split("@");
  return (parts[1] ?? "").toLowerCase();
}

/**
 * Checks if a sender domain is in the verified domains table.
 */
async function isDomainVerified(
  prisma: PrismaClient,
  domain: string
): Promise<boolean> {
  const found = await prisma.verifiedDomain.findUnique({
    where: { domain: domain.toLowerCase() },
  });
  return found !== null;
}

/**
 * Core interception logic. Evaluates an incoming email and routes it
 * to either the primary inbox or the shadow table.
 */
export async function interceptIncomingEmail(
  prisma: PrismaClient,
  payload: IncomingEmailPayload
): Promise<InterceptionResult> {
  const domain = extractDomain(payload.senderEmail);

  if (!domain) {
    // Invalid sender email – drop to shadow
    await prisma.shadowMessage.create({
      data: {
        userId: payload.userId,
        senderEmail: payload.senderEmail,
        senderDomain: "",
        subject: payload.subject,
        body: payload.body,
        reason: "INVALID_SENDER_EMAIL",
      },
    });
    return {
      intercepted: true,
      destination: "shadow",
      reason: "INVALID_SENDER_EMAIL",
    };
  }

  // Check if domain is in the default unverified list
  const isDefaultUnverified = DEFAULT_UNVERIFIED_DOMAINS.includes(domain);

  // Check if domain is explicitly verified in the database
  const isVerified = await isDomainVerified(prisma, domain);

  if (isDefaultUnverified && !isVerified) {
    // Route to shadow inbox
    await prisma.shadowMessage.create({
      data: {
        userId: payload.userId,
        senderEmail: payload.senderEmail,
        senderDomain: domain,
        subject: payload.subject,
        body: payload.body,
        reason: `UNVERIFIED_DOMAIN:${domain}`,
      },
    });
    return {
      intercepted: true,
      destination: "shadow",
      reason: `UNVERIFIED_DOMAIN:${domain}`,
    };
  }

  // Verified domain – deliver to primary inbox
  await prisma.inboxMessage.create({
    data: {
      userId: payload.userId,
      senderEmail: payload.senderEmail,
      senderDomain: domain,
      subject: payload.subject,
      body: payload.body,
    },
  });
  return {
    intercepted: false,
    destination: "inbox",
  };
}

/**
 * Red-team audit: returns statistics about the shadow inbox to detect
 * patterns that may indicate filter bypass attempts.
 */
export async function auditShadowInbox(
  prisma: PrismaClient,
  userId?: string
): Promise<{
  totalShadowed: number;
  byReason: Record<string, number>;
  recentDomains: string[];
}> {
  const where = userId ? { userId } : {};
  const messages = await prisma.shadowMessage.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 100,
  });

  const byReason: Record<string, number> = {};
  const domainSet = new Set<string>();

  for (const msg of messages) {
    byReason[msg.reason] = (byReason[msg.reason] ?? 0) + 1;
    if (msg.senderDomain) {
      domainSet.add(msg.senderDomain);
    }
  }

  const totalShadowed = await prisma.shadowMessage.count({ where });

  return {
    totalShadowed,
    byReason,
    recentDomains: Array.from(domainSet),
  };
}

export { DEFAULT_UNVERIFIED_DOMAINS };
