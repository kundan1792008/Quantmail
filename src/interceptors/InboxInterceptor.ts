import { PrismaClient } from "../generated/prisma/client";

const UNVERIFIED_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "mail.com",
];

export interface IncomingMessage {
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface InterceptResult {
  intercepted: boolean;
  reason?: string;
  domain?: string;
}

function extractDomain(email: string): string {
  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : "";
}

/**
 * InboxInterceptor - Zero-Spam Shadow Inbox Filter
 *
 * Checks if an incoming message is from an unverified generic domain.
 * If so, it is dropped into the ShadowInbox table and never touches
 * the primary inbox.
 */
export async function interceptMessage(
  prisma: PrismaClient,
  message: IncomingMessage
): Promise<InterceptResult> {
  const domain = extractDomain(message.senderEmail);

  if (!domain) {
    return { intercepted: false };
  }

  if (UNVERIFIED_DOMAINS.includes(domain)) {
    await prisma.shadowInbox.create({
      data: {
        senderEmail: message.senderEmail,
        recipientEmail: message.recipientEmail,
        subject: message.subject,
        body: message.body,
        domain,
        reason: "UNVERIFIED_DOMAIN",
      },
    });

    return {
      intercepted: true,
      reason: "UNVERIFIED_DOMAIN",
      domain,
    };
  }

  return { intercepted: false };
}

export { UNVERIFIED_DOMAINS, extractDomain };
