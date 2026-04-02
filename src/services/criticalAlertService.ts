import { prisma } from "../db";
import { deriveBiometricHash, verifyMasterSSOToken } from "../utils/crypto";

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

const SSO_SECRET = process.env["SSO_SECRET"] || "quantmail-dev-secret";
const SILENCE_TOKEN_MAX_AGE_MILLISECONDS = 5 * 60 * 1000;

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

async function hasValidBiometricIntegrity(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { livenessGrid: true },
  });
  if (!user || !user.verified || !user.livenessGrid || !user.livenessGrid.passed) {
    return false;
  }
  const expectedBiometricHash = deriveBiometricHash(
    `${user.email}:${user.livenessGrid.facialMatrixHash}`
  );
  return user.biometricHash === expectedBiometricHash;
}

export async function triggerSynchronizedWebBluetoothAlarm(
  payload: CriticalAlertPayload
): Promise<{
  alarmSessionId: string;
  synchronizedDevices: number;
  requiresPhysicalDashboardLogin: boolean;
}> {
  const biometricIntegrity = await hasValidBiometricIntegrity(payload.userId);
  if (!biometricIntegrity) {
    throw new Error("STRICT_BOT_DROP");
  }

  const activeDevices = await prisma.ioTDevice.findMany({
    where: {
      userId: payload.userId,
      active: true,
      connectionType: "WebBluetooth",
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
          channel: "WebBluetooth",
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
  const tokenUserId = verifyMasterSSOToken(
    physicalDashboardLoginToken,
    SSO_SECRET,
    SILENCE_TOKEN_MAX_AGE_MILLISECONDS
  );
  if (!tokenUserId || tokenUserId !== userId) {
    return { silenced: false, status: "PHYSICAL_LOGIN_REQUIRED" };
  }

  const biometricIntegrity = await hasValidBiometricIntegrity(userId);
  if (!biometricIntegrity) {
    return { silenced: false, status: "STRICT_BOT_DROP" };
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
