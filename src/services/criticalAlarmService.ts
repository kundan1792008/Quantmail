import { prisma } from "../db";
import { sanitizeBody, type IncomingMessage } from "../interceptors/InboxInterceptor";

const CRITICAL_KEYWORDS = [
  "critical payment",
  "payment alert",
  "payment failed",
  "ecosystem token",
  "token alert",
  "token compromise",
  "wallet drain",
  "unauthorized transfer",
];

function includesCriticalKeywords(text: string): boolean {
  const normalized = text.toLowerCase();
  return CRITICAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function buildSilenceChallenge(userId: string, alertId: string): string {
  return `DASHBOARD_ONLY_${userId}_${alertId}`;
}

export function isCriticalPaymentOrTokenAlert(
  message: IncomingMessage
): boolean {
  const combined = `${message.subject || ""}\n${message.body || ""}`;
  return includesCriticalKeywords(combined);
}

export async function triggerSynchronizedWebBluetoothAlarm(params: {
  userId: string;
  source: string;
  subject: string;
  body: string;
  triggeredFromMessageId?: string;
}): Promise<{
  alertId: string;
  synchronizedTriggerAt: string;
  dispatchCount: number;
  silenceChallenge: string;
}> {
  const devices = await prisma.connectedIoTDevice.findMany({
    where: {
      userId: params.userId,
      isActive: true,
      webBluetoothEnabled: true,
    },
    select: { id: true },
  });

  const synchronizedTriggerAt = new Date(Date.now() + 1500);

  const alert = await prisma.criticalAlert.create({
    data: {
      userId: params.userId,
      source: params.source,
      subject: params.subject,
      body: sanitizeBody(params.body),
      silenceChallenge: "__PENDING__",
      triggeredFromMessageId: params.triggeredFromMessageId,
      dispatches: {
        create: devices.map((device) => ({
          deviceId: device.id,
          synchronizedTriggerAt,
        })),
      },
    },
    select: { id: true },
  });

  const silenceChallenge = buildSilenceChallenge(params.userId, alert.id);

  await prisma.criticalAlert.update({
    where: { id: alert.id },
    data: { silenceChallenge },
  });

  return {
    alertId: alert.id,
    synchronizedTriggerAt: synchronizedTriggerAt.toISOString(),
    dispatchCount: devices.length,
    silenceChallenge,
  };
}

export async function silenceAlarmFromDashboardPhysicalLogin(params: {
  userId: string;
  alertId: string;
  dashboardSessionId: string;
}): Promise<{ silenced: boolean; reason?: string }> {
  const session = await prisma.dashboardPhysicalLogin.findFirst({
    where: {
      id: params.dashboardSessionId,
      userId: params.userId,
      loginMethod: "PHYSICAL",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!session) {
    return {
      silenced: false,
      reason: "PHYSICAL_DASHBOARD_LOGIN_REQUIRED",
    };
  }

  const alert = await prisma.criticalAlert.findUnique({
    where: { id: params.alertId },
    select: { id: true, userId: true, alarmStatus: true },
  });

  if (!alert || alert.userId !== params.userId) {
    return { silenced: false, reason: "ALERT_NOT_FOUND" };
  }

  if (alert.alarmStatus === "SILENCED") {
    return { silenced: true };
  }

  await prisma.$transaction([
    prisma.criticalAlert.update({
      where: { id: params.alertId },
      data: {
        alarmStatus: "SILENCED",
        silencedAt: new Date(),
      },
    }),
    prisma.alarmDispatch.updateMany({
      where: { alertId: params.alertId },
      data: { status: "SILENCED" },
    }),
  ]);

  return { silenced: true };
}
