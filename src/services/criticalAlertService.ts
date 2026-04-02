import { prisma } from "../db";

const CRITICAL_ALERT_PATTERNS: readonly RegExp[] = [
  /\bcritical\b/i,
  /\bpayment\b/i,
  /\becosystem\s*token\b/i,
  /\btoken\s*breach\b/i,
  /\bunauthorized\s*transfer\b/i,
  /\burgent\s*payment\b/i,
];

export interface CriticalAlertPayload {
  userId: string;
  inboxMessageId: string;
  subject: string;
  body: string;
}

export function isCriticalPaymentOrEcosystemTokenAlert(
  subject: string,
  body: string
): boolean {
  const source = `${subject}\n${body}`;
  const matches = CRITICAL_ALERT_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(source) ? 1 : 0),
    0
  );
  return matches >= 2;
}

export async function triggerSynchronizedWebBluetoothAlarm(
  payload: CriticalAlertPayload
): Promise<{
  alarmSessionId: string;
  synchronizedDevices: number;
  requiresPhysicalDashboardLogin: boolean;
}> {
  const activeDevices = await prisma.ioTDevice.findMany({
    where: {
      userId: payload.userId,
      active: true,
      connectionType: "webbluetooth",
    },
  });

  const alarmSession = await prisma.criticalAlarmSession.create({
    data: {
      userId: payload.userId,
      inboxMessageId: payload.inboxMessageId,
      alertType: "CRITICAL_PAYMENT_ECOSYSTEM_TOKEN_ALERT",
      status: "ACTIVE",
      requiresPhysicalLogin: true,
      dispatches: {
        create: activeDevices.map((device) => ({
          deviceId: device.id,
          channel: "webbluetooth",
          status: "TRIGGERED",
          payload: JSON.stringify({
            alarmSignal: "QUANTMAIL_CRITICAL_ALERT",
            synchronized: true,
            source: "inbox",
            startedAt: new Date().toISOString(),
          }),
        })),
      },
    },
  });

  return {
    alarmSessionId: alarmSession.id,
    synchronizedDevices: activeDevices.length,
    requiresPhysicalDashboardLogin: true,
  };
}

export async function silenceCriticalAlarmFromDashboard(
  userId: string,
  alarmSessionId: string,
  physicalDashboardLoginToken: string
): Promise<{ silenced: boolean; status: string }> {
  if (!physicalDashboardLoginToken || physicalDashboardLoginToken.length < 16) {
    return { silenced: false, status: "PHYSICAL_LOGIN_REQUIRED" };
  }

  const alarm = await prisma.criticalAlarmSession.findFirst({
    where: {
      id: alarmSessionId,
      userId,
      status: "ACTIVE",
      requiresPhysicalLogin: true,
    },
  });

  if (!alarm) {
    return { silenced: false, status: "ALARM_NOT_ACTIVE" };
  }

  await prisma.criticalAlarmSession.update({
    where: { id: alarm.id },
    data: {
      status: "SILENCED",
      silencedAt: new Date(),
      silencedBy: userId,
      silenceOrigin: "quantchat_dashboard_physical_login",
      dispatches: {
        updateMany: {
          where: {
            alarmSessionId: alarm.id,
            status: "TRIGGERED",
          },
          data: {
            status: "SILENCED",
            acknowledgedAt: new Date(),
          },
        },
      },
    },
  });

  return { silenced: true, status: "SILENCED" };
}
