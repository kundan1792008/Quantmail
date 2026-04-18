/**
 * Webhook Service
 *
 * Manages webhook endpoint subscriptions and dispatches signed event payloads
 * to registered URLs for cross-service event delivery.
 */

import CryptoJS from "crypto-js";
import { prisma } from "../db";

/** Known webhook event types. */
export type WebhookEventType =
  | "inbox.message.received"
  | "inbox.message.intercepted"
  | "user.registered"
  | "user.verified"
  | "alarm.triggered"
  | "alarm.silenced"
  | "push.dispatched"
  | "streak.welcome_back"
  | "streak.shield.granted"
  | "streak.trinity.unlocked";

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
  endpointId: string;
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Computes the HMAC-SHA256 signature for a webhook payload.
 * Receivers should verify this signature to ensure authenticity.
 */
export function signWebhookPayload(payload: string, secret: string): string {
  return CryptoJS.HmacSHA256(payload, secret).toString(CryptoJS.enc.Hex);
}

/**
 * Verifies a webhook signature received from an external source.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = signWebhookPayload(payload, secret);
  return expected === signature;
}

/**
 * Registers a new webhook endpoint subscription.
 */
export async function registerWebhookEndpoint(
  url: string,
  secret: string,
  events: WebhookEventType[]
): Promise<{ id: string; url: string; events: WebhookEventType[] }> {
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      url,
      secret,
      events: JSON.stringify(events),
      active: true,
    },
  });

  return {
    id: endpoint.id,
    url: endpoint.url,
    events: JSON.parse(endpoint.events) as WebhookEventType[],
  };
}

/**
 * Dispatches a webhook event to all active, subscribed endpoints.
 * Each delivery attempt is made in parallel (fire-and-forget style).
 */
export async function dispatchWebhookEvent(
  event: WebhookEventType,
  data: Record<string, unknown>
): Promise<WebhookDeliveryResult[]> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { active: true },
  });

  const subscribed = endpoints.filter((ep) => {
    const epEvents = JSON.parse(ep.events) as string[];
    return epEvents.length === 0 || epEvents.includes(event);
  });

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
  const payloadString = JSON.stringify(payload);

  const deliveries = await Promise.allSettled(
    subscribed.map(async (ep): Promise<WebhookDeliveryResult> => {
      const signature = signWebhookPayload(payloadString, ep.secret);
      try {
        const response = await fetch(ep.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Quantmail-Signature": signature,
            "X-Quantmail-Event": event,
          },
          body: payloadString,
          signal: AbortSignal.timeout(10_000),
        });
        return {
          endpointId: ep.id,
          url: ep.url,
          success: response.ok,
          statusCode: response.status,
        };
      } catch (err) {
        return {
          endpointId: ep.id,
          url: ep.url,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    })
  );

  return deliveries.map((result) =>
    result.status === "fulfilled"
      ? result.value
      : {
          endpointId: "unknown",
          url: "unknown",
          success: false,
          error: "Dispatch promise rejected",
        }
  );
}
