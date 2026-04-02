import { prisma } from "../db";
import {
  ChallengeStatus,
  NotificationPriority,
  NotificationStatus,
} from "../generated/prisma/client";

export const AGGRESSOR_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
export const QUANTADS_DEFAULT_TARGET = "quantads://campaign/identity-check";
const QUANTCHAT_CHANNEL = "quantchat-warning";

export interface AggressorPushPayload {
  title: string;
  body: string;
  tokens: string[];
  data: Record<string, unknown>;
  priority: NotificationPriority;
  channel: string;
}

export function shouldEscalateChallenge(
  challenge: {
    status: ChallengeStatus;
    createdAt: Date;
    escalatedAt: Date | null;
  },
  now: Date = new Date(),
  thresholdMs: number = AGGRESSOR_THRESHOLD_MS
): boolean {
  if (challenge.status !== ChallengeStatus.PENDING) return false;
  if (challenge.escalatedAt) return false;
  return now.getTime() - challenge.createdAt.getTime() >= thresholdMs;
}

export function buildAggressorPayload(options: {
  userId: string;
  challengeId: string;
  quantadsTarget?: string;
  title?: string;
  body?: string;
  tokens: string[];
}): AggressorPushPayload {
  const quantadsTarget = options.quantadsTarget || QUANTADS_DEFAULT_TARGET;
  const title = options.title || "Quantchat SDK Warning";
  const body =
    options.body ||
    "Biometric liveness token ignored. Open Quantads UI to regain access.";
  return {
    title,
    body,
    tokens: options.tokens,
    priority: NotificationPriority.HIGH,
    channel: QUANTCHAT_CHANNEL,
    data: {
      kind: "quantchat_warning",
      target: quantadsTarget,
      challengeId: options.challengeId,
      userId: options.userId,
      intent: "force_open_quantads",
    },
  };
}

export async function registerDeviceToken(params: {
  userId: string;
  token: string;
  platform: string;
}): Promise<void> {
  const { userId, token, platform } = params;
  await prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform, lastSeenAt: new Date() },
  });
}

export async function createLivenessChallenge(params: {
  userId: string;
  quantadsTarget?: string;
  quantchatTitle?: string;
  quantchatBody?: string;
  ssoToken?: string;
  now?: Date;
}): Promise<{ id: string; expiresAt: Date }> {
  const now = params.now || new Date();
  const expiresAt = new Date(now.getTime() + AGGRESSOR_THRESHOLD_MS);
  const challenge = await prisma.livenessChallenge.create({
    data: {
      userId: params.userId,
      status: ChallengeStatus.PENDING,
      createdAt: now,
      expiresAt,
      quantadsTarget: params.quantadsTarget || QUANTADS_DEFAULT_TARGET,
      quantchatTitle: params.quantchatTitle || "Quantchat SDK Warning",
      quantchatBody:
        params.quantchatBody ||
        "Biometric liveness token pending. Complete to avoid enforcement.",
      ssoToken: params.ssoToken,
    },
  });
  return { id: challenge.id, expiresAt };
}

export async function markChallengeSatisfied(challengeId: string): Promise<void> {
  await prisma.livenessChallenge.update({
    where: { id: challengeId },
    data: {
      status: ChallengeStatus.SATISFIED,
      satisfiedAt: new Date(),
      lastPushAt: new Date(),
    },
  });
}

async function dispatchNotification(
  notificationId: string,
  tokens: string[],
  payload: AggressorPushPayload
): Promise<boolean> {
  const webhook = process.env["PUSH_DISPATCH_WEBHOOK"];
  if (!webhook) {
    return false;
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationId,
        tokens,
        payload,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function triggerAggressivePush(
  challengeId: string,
  now: Date = new Date()
): Promise<{ notificationId?: string; dispatched: boolean; skipped: boolean }> {
  const challenge = await prisma.livenessChallenge.findUnique({
    where: { id: challengeId },
    include: { user: true },
  });

  if (!challenge) {
    throw new Error("Liveness challenge not found");
  }

  if (
    !shouldEscalateChallenge(
      {
        status: challenge.status,
        createdAt: challenge.createdAt,
        escalatedAt: challenge.escalatedAt || null,
      },
      now
    )
  ) {
    return { skipped: true, dispatched: false };
  }

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: challenge.userId },
  });

  const tokenValues = tokens.map((t) => t.token);
  const payload = buildAggressorPayload({
    userId: challenge.userId,
    challengeId: challenge.id,
    quantadsTarget: challenge.quantadsTarget,
    title: challenge.quantchatTitle,
    body: challenge.quantchatBody,
    tokens: tokenValues,
  });

  const notification = await prisma.pushNotification.create({
    data: {
      userId: challenge.userId,
      challengeId: challenge.id,
      title: payload.title,
      body: payload.body,
      payload: JSON.stringify(payload.data),
      priority: NotificationPriority.HIGH,
      status: NotificationStatus.QUEUED,
      channel: QUANTCHAT_CHANNEL,
    },
  });

  await prisma.livenessChallenge.update({
    where: { id: challenge.id },
    data: {
      status: ChallengeStatus.ESCALATED,
      escalatedAt: now,
      lastPushAt: now,
    },
  });

  const dispatched = await dispatchNotification(
    notification.id,
    tokenValues,
    payload
  );

  if (dispatched) {
    await prisma.pushNotification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.DISPATCHED, dispatchedAt: new Date() },
    });
  }

  return {
    notificationId: notification.id,
    dispatched,
    skipped: false,
  };
}

export async function sweepAndAggress(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - AGGRESSOR_THRESHOLD_MS);
  const candidates = await prisma.livenessChallenge.findMany({
    where: {
      status: ChallengeStatus.PENDING,
      escalatedAt: null,
      createdAt: { lte: threshold },
    },
    select: { id: true },
  });

  for (const candidate of candidates) {
    await triggerAggressivePush(candidate.id, now);
  }

  return candidates.length;
}

export function startPushAggressor(intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    sweepAndAggress().catch((err) => {
      console.error("[PushAggressor] sweep failed", err);
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
