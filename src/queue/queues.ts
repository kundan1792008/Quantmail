/**
 * Message Queue Definitions (BullMQ)
 *
 * Defines BullMQ queues for asynchronous operations.
 * Redis connection parameters are read from environment variables.
 * When Redis is unavailable the queues log a warning and degrade gracefully.
 *
 * Environment variables:
 *   REDIS_HOST  – Redis hostname (default: 127.0.0.1)
 *   REDIS_PORT  – Redis port     (default: 6379)
 *   REDIS_PASSWORD – Redis password (optional)
 */

import { Queue, type ConnectionOptions } from "bullmq";

// ─── Redis Connection ─────────────────────────────────────────────

export const redisConnection: ConnectionOptions = {
  host: process.env["REDIS_HOST"] || "127.0.0.1",
  port: parseInt(process.env["REDIS_PORT"] || "6379", 10),
  password: process.env["REDIS_PASSWORD"] || undefined,
  // Prevent unhandled errors from crashing the process when Redis is absent.
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

// ─── Queue Names ──────────────────────────────────────────────────

export const QUEUE_NAMES = {
  EMAIL: "email",
  WEBHOOK: "webhook",
  PUSH_NOTIFICATION: "push-notification",
} as const;

// ─── Job Data Shapes ──────────────────────────────────────────────

export interface EmailJobData {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

export interface WebhookJobData {
  event: string;
  data: Record<string, unknown>;
}

export interface PushNotificationJobData {
  userId: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

// ─── Queue Instances ──────────────────────────────────────────────

let emailQueue: Queue<EmailJobData> | null = null;
let webhookQueue: Queue<WebhookJobData> | null = null;
let pushNotificationQueue: Queue<PushNotificationJobData> | null = null;

/**
 * Lazily creates a BullMQ Queue, catching Redis connection errors gracefully.
 */
function createQueue<T>(name: string): Queue<T> | null {
  try {
    return new Queue<T>(name, { connection: redisConnection });
  } catch (err) {
    console.warn(
      `[Queue] Failed to create queue "${name}". Redis may be unavailable.`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function getEmailQueue(): Queue<EmailJobData> | null {
  if (!emailQueue) {
    emailQueue = createQueue<EmailJobData>(QUEUE_NAMES.EMAIL);
  }
  return emailQueue;
}

export function getWebhookQueue(): Queue<WebhookJobData> | null {
  if (!webhookQueue) {
    webhookQueue = createQueue<WebhookJobData>(QUEUE_NAMES.WEBHOOK);
  }
  return webhookQueue;
}

export function getPushNotificationQueue(): Queue<PushNotificationJobData> | null {
  if (!pushNotificationQueue) {
    pushNotificationQueue = createQueue<PushNotificationJobData>(
      QUEUE_NAMES.PUSH_NOTIFICATION
    );
  }
  return pushNotificationQueue;
}

// ─── Enqueue Helpers ──────────────────────────────────────────────

/**
 * Adds an email job to the email queue.
 * Falls back to direct sending if Redis is unavailable.
 */
export async function enqueueEmail(data: EmailJobData): Promise<void> {
  const queue = getEmailQueue();
  if (!queue) {
    // Fallback: send directly without queuing.
    const { sendEmail } = await import("../services/emailService");
    await sendEmail(data);
    return;
  }
  await queue.add("send-email", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Adds a webhook dispatch job to the webhook queue.
 */
export async function enqueueWebhookDispatch(
  data: WebhookJobData
): Promise<void> {
  const queue = getWebhookQueue();
  if (!queue) {
    // Fallback: dispatch directly.
    const { dispatchWebhookEvent } = await import(
      "../webhooks/webhookService"
    );
    await dispatchWebhookEvent(
      data.event as Parameters<typeof dispatchWebhookEvent>[0],
      data.data
    );
    return;
  }
  await queue.add("dispatch-webhook", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });
}

/**
 * Adds a push notification job to the push notification queue.
 */
export async function enqueuePushNotification(
  data: PushNotificationJobData
): Promise<void> {
  const queue = getPushNotificationQueue();
  if (!queue) {
    console.warn("[Queue] Push notification queue unavailable; dropping job.", data);
    return;
  }
  await queue.add("send-push", data, {
    attempts: 2,
    backoff: { type: "fixed", delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  });
}
