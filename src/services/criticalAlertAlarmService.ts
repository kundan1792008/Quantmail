import { prisma } from "../db";
import { AlarmCategory, DispatchStatus, IoTDeviceType } from "../generated/prisma/client";

function buildDispatchPayload(alarmSessionId: string, deviceType: IoTDeviceType): string {
  return JSON.stringify({
    protocol: "quantmail-webbluetooth-sync-v1",
    command: "TRIGGER_SYNCHRONIZED_ALARM",
    alarmSessionId,
    synchronize: true,
    deviceType,
    timestamp: new Date().toISOString(),
  });
}

export async function triggerSynchronizedAlarm(params: {
  userId: string;
  messageId: string;
  category: AlarmCategory;
  reason: string;
}): Promise<{
  alarmSessionId: string;
  dispatchedDevices: number;
  silencingPolicy: string;
}> {
  const connectedDevices = await prisma.ioTDevice.findMany({
    where: {
      userId: params.userId,
      isConnected: true,
      alarmCapable: true,
    },
  });

  const alarmSession = await prisma.alarmSession.create({
    data: {
      userId: params.userId,
      messageId: params.messageId,
      category: params.category,
      reason: params.reason,
      alarmPayload: JSON.stringify({
        mode: "SYNCHRONIZED_WEBBLUETOOTH",
        origin: "INBOX_CRITICAL_ALERT",
      }),
    },
  });

  await prisma.alarmDeviceDispatch.createMany({
    data: connectedDevices.map(
      (device: { id: string; deviceType: IoTDeviceType }) => ({
        alarmSessionId: alarmSession.id,
        iotDeviceId: device.id,
        commandPayload: buildDispatchPayload(alarmSession.id, device.deviceType),
        dispatchStatus: DispatchStatus.PENDING,
      })
    ),
  });

  return {
    alarmSessionId: alarmSession.id,
    dispatchedDevices: connectedDevices.length,
    silencingPolicy: "ONLY_QUANTCHAT_PHYSICAL_DASHBOARD_LOGIN",
  };
}

export async function createPhysicalLoginSession(userId: string): Promise<{ sessionId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const session = await prisma.physicalLoginSession.create({
    data: {
      userId,
      expiresAt,
      source: "QUANTCHAT_DASHBOARD_PHYSICAL",
    },
  });

  return { sessionId: session.id, expiresAt: session.expiresAt };
}

export async function silenceAlarmWithPhysicalLogin(params: {
  alarmSessionId: string;
  physicalSessionId: string;
  userId: string;
}): Promise<{ silenced: boolean; reason: string }> {
  const session = await prisma.physicalLoginSession.findUnique({
    where: { id: params.physicalSessionId },
  });

  if (!session || session.userId !== params.userId) {
    return { silenced: false, reason: "INVALID_PHYSICAL_SESSION" };
  }

  if (session.usedForAlarm || session.expiresAt.getTime() < Date.now()) {
    return { silenced: false, reason: "EXPIRED_OR_USED_PHYSICAL_SESSION" };
  }

  const alarm = await prisma.alarmSession.findUnique({
    where: { id: params.alarmSessionId },
    include: { dispatches: true },
  });

  if (!alarm || alarm.userId !== params.userId) {
    return { silenced: false, reason: "ALARM_NOT_FOUND" };
  }

  await prisma.$transaction([
    prisma.physicalLoginSession.update({
      where: { id: session.id },
      data: { usedForAlarm: true },
    }),
    prisma.alarmSession.update({
      where: { id: alarm.id },
      data: {
        status: "SILENCED",
        silencedAt: new Date(),
        silencedBySession: session.id,
      },
    }),
    ...alarm.dispatches.map((dispatch: { id: string }) =>
      prisma.alarmDeviceDispatch.update({
        where: { id: dispatch.id },
        data: {
          dispatchStatus: DispatchStatus.ACKNOWLEDGED,
          acknowledgedAt: new Date(),
        },
      })
    ),
  ]);

  return { silenced: true, reason: "SILENCED_WITH_PHYSICAL_DASHBOARD_LOGIN" };
}
