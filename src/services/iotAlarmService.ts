import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { deriveBiometricHash } from "../utils/crypto";

const PHYSICAL_LOGIN_TTL_MS = 5 * 60 * 1000;

function buildDeviceCommandPayload(
  syncGroup: string,
  sessionId: string,
  protocol: "APPLE_WATCH" | "WEB_BLUETOOTH" | "IOT_BRIDGE"
): string {
  return JSON.stringify({
    action: "SYNCHRONIZED_ALARM_ON",
    syncGroup,
    sessionId,
    protocol,
    requiresDashboardPhysicalLogin: true,
    capacitor: {
      iosWatchBridge: protocol === "APPLE_WATCH",
      webBluetooth: protocol === "WEB_BLUETOOTH" || protocol === "IOT_BRIDGE",
    },
  });
}

export async function triggerSynchronizedAlarmForCriticalAlert(args: {
  userId: string;
  inboxMessageId: string;
  alertType: "PAYMENT" | "ECOSYSTEM_TOKEN";
  summary: string;
}): Promise<{ alarmSessionId: string; syncGroup: string; dispatchedCount: number }> {
  const alert = await prisma.criticalAlert.create({
    data: {
      userId: args.userId,
      inboxMessageId: args.inboxMessageId,
      alertType: args.alertType,
      summary: args.summary,
      severity: "CRITICAL",
    },
  });

  const syncGroup = `sync-${Date.now()}-${randomUUID()}`;
  const alarmSession = await prisma.alarmSession.create({
    data: {
      userId: args.userId,
      criticalAlertId: alert.id,
      syncGroup,
    },
  });

  const devices = await prisma.iotDevice.findMany({
    where: { userId: args.userId, active: true },
  });

  if (devices.length > 0) {
    await prisma.alarmDispatch.createMany({
      data: devices.map((device) => ({
        alarmSessionId: alarmSession.id,
        deviceId: device.id,
        status: "DISPATCHED",
        commandPayload: buildDeviceCommandPayload(
          syncGroup,
          alarmSession.id,
          device.protocol
        ),
      })),
    });
  }

  return {
    alarmSessionId: alarmSession.id,
    syncGroup,
    dispatchedCount: devices.length,
  };
}

export async function createDashboardPhysicalLoginToken(
  userId: string
): Promise<{ token: string; expiresAt: Date }> {
  const now = Date.now();
  const expiresAt = new Date(now + PHYSICAL_LOGIN_TTL_MS);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { biometricHash: true },
  });
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }
  const tokenSeed = `${userId}:${now}:${randomUUID()}`;
  const token = deriveBiometricHash(`${tokenSeed}:${deriveBiometricHash(user.biometricHash)}`);

  await prisma.dashboardPhysicalLogin.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function silenceAlarmWithPhysicalLogin(args: {
  userId: string;
  alarmSessionId: string;
  physicalLoginToken: string;
}): Promise<"SILENCED"> {
  const now = new Date();

  const login = await prisma.dashboardPhysicalLogin.findFirst({
    where: {
      userId: args.userId,
      token: args.physicalLoginToken,
      consumedAt: null,
    },
    orderBy: { verifiedAt: "desc" },
  });

  if (!login) {
    throw new Error("PHYSICAL_LOGIN_NOT_FOUND");
  }
  if (login.expiresAt < now) {
    throw new Error("PHYSICAL_LOGIN_EXPIRED");
  }

  await prisma.dashboardPhysicalLogin.update({
    where: { id: login.id },
    data: { consumedAt: now },
  });

  const alarmSession = await prisma.alarmSession.findUnique({
    where: { id: args.alarmSessionId },
    select: { id: true, userId: true, state: true },
  });

  if (!alarmSession || alarmSession.userId !== args.userId) {
    throw new Error("ALARM_SESSION_NOT_FOUND");
  }

  await prisma.alarmSession.update({
    where: { id: args.alarmSessionId },
    data: { state: "SILENCED", silencedAt: now },
  });

  return "SILENCED";
}
