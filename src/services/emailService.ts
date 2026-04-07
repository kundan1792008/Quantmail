/**
 * Email Service
 *
 * Provides a unified interface for sending transactional emails.
 * Supports a mock provider (for development/testing) and a pluggable
 * adapter pattern for production providers like SendGrid or AWS SES.
 *
 * Set EMAIL_PROVIDER=sendgrid|ses|mock in your environment.
 * For SendGrid set SENDGRID_API_KEY; for SES set AWS_REGION + AWS credentials.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

/** Abstract email provider interface – implement to add new providers. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

const DEFAULT_FROM_EMAIL = "noreply@quantmail.app";

// ─── Mock Provider ────────────────────────────────────────────────

/** Captures sent emails in memory; useful for tests and local development. */
const MAX_MOCK_EMAILS = 1000;
const sentEmails: Array<{ message: EmailMessage; sentAt: string }> = [];

export const mockEmailProvider: EmailProvider = {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const entry = { message, sentAt: new Date().toISOString() };
    // Cap the in-memory log to prevent unbounded memory growth.
    if (sentEmails.length >= MAX_MOCK_EMAILS) {
      sentEmails.shift();
    }
    sentEmails.push(entry);

    // Emit to console so development logs show the email content.
    console.log("[MockEmailProvider] Email sent:", {
      to: message.to,
      subject: message.subject,
      sentAt: entry.sentAt,
    });

    return {
      success: true,
      messageId: `mock-${Date.now()}`,
      provider: "mock",
    };
  },
};

/** Returns all emails captured by the mock provider (for testing/inspection). */
export function getMockSentEmails(): ReadonlyArray<{
  message: EmailMessage;
  sentAt: string;
}> {
  return sentEmails;
}

/** Clears the mock sent-email log. */
export function clearMockSentEmails(): void {
  sentEmails.length = 0;
}

// ─── Provider Resolution ──────────────────────────────────────────

/**
 * Resolves the active email provider based on the EMAIL_PROVIDER env var.
 * Falls back to the mock provider when no provider is configured.
 */
export function resolveEmailProvider(): EmailProvider {
  const providerName = process.env["EMAIL_PROVIDER"] || "mock";

  switch (providerName.toLowerCase()) {
    case "sendgrid": {
      const apiKey = process.env["SENDGRID_API_KEY"];
      if (!apiKey) {
        console.warn(
          "[EmailService] SENDGRID_API_KEY not set; falling back to mock provider."
        );
        return mockEmailProvider;
      }
      return buildSendGridProvider(apiKey);
    }
    case "ses": {
      // SES adapter – uses the AWS SDK when available, otherwise mock.
      return buildSESProvider();
    }
    default:
      return mockEmailProvider;
  }
}

// ─── SendGrid Adapter ─────────────────────────────────────────────

function buildSendGridProvider(apiKey: string): EmailProvider {
  const FROM_EMAIL = process.env["FROM_EMAIL"] || DEFAULT_FROM_EMAIL;

  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const payload = {
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: message.from || FROM_EMAIL },
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          ...(message.html
            ? [{ type: "text/html", value: message.html }]
            : []),
        ],
      };

      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            success: false,
            provider: "sendgrid",
            error: `SendGrid error ${response.status}: ${body}`,
          };
        }

        const messageId = response.headers.get("X-Message-Id") || undefined;
        return { success: true, messageId, provider: "sendgrid" };
      } catch (err) {
        return {
          success: false,
          provider: "sendgrid",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
  };
}

// ─── AWS SES Adapter ─────────────────────────────────────────────

function buildSESProvider(): EmailProvider {
  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      // Attempt to import the AWS SDK at runtime via a non-static path so
      // TypeScript does not try to resolve the optional package at compile time.
      const awsSesModule = "@aws-sdk/client-ses";
      try {
        const sesModule = await (
          import(awsSesModule) as Promise<unknown>
        ).catch(() => null);

        if (!sesModule) {
          console.warn(
            "[EmailService] @aws-sdk/client-ses not installed; falling back to mock."
          );
          return mockEmailProvider.send(message);
        }

        const { SESClient, SendEmailCommand } = sesModule as {
          SESClient: new (cfg: Record<string, unknown>) => {
            send: (cmd: unknown) => Promise<{ MessageId?: string }>;
          };
          SendEmailCommand: new (input: Record<string, unknown>) => unknown;
        };

        const region = process.env["AWS_REGION"] || "us-east-1";
        const fromEmail = process.env["FROM_EMAIL"] || DEFAULT_FROM_EMAIL;

        const client = new SESClient({ region });
        const command = new SendEmailCommand({
          Source: message.from || fromEmail,
          Destination: { ToAddresses: [message.to] },
          Message: {
            Subject: { Data: message.subject },
            Body: {
              Text: { Data: message.text },
              ...(message.html
                ? { Html: { Data: message.html } }
                : {}),
            },
          },
        });

        const result = await client.send(command);
        return {
          success: true,
          messageId: result.MessageId,
          provider: "ses",
        };
      } catch (err) {
        return {
          success: false,
          provider: "ses",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
  };
}

// ─── Public API ────────────────────────────────────────────────────

const activeProvider = resolveEmailProvider();

/**
 * Sends an email using the configured provider.
 */
export async function sendEmail(
  message: EmailMessage
): Promise<EmailSendResult> {
  return activeProvider.send(message);
}

/**
 * Sends an inbox notification email to a user.
 */
export async function sendInboxNotification(
  recipientEmail: string,
  senderEmail: string,
  subject: string
): Promise<EmailSendResult> {
  return sendEmail({
    to: recipientEmail,
    subject: `New message: ${subject}`,
    text: `You have received a new message from ${senderEmail} with subject: "${subject}". Open Quantmail to read it.`,
    html: `<p>You have received a new message from <strong>${senderEmail}</strong>.</p><p>Subject: <em>${subject}</em></p><p>Open Quantmail to read it.</p>`,
  });
}
