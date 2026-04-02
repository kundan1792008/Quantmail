import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../db";
import {
  AGGRESSOR_THRESHOLD_MS,
  buildAggressorPayload,
  createLivenessChallenge,
  registerDeviceToken,
  shouldEscalateChallenge,
  triggerAggressivePush,
} from "../services/pushAggressor";
import { deriveBiometricHash } from "../utils/crypto";

describe("Push Aggressor", () => {
  it("flags pending challenges older than the threshold", () => {
    const now = new Date();
    const stale = new Date(now.getTime() - AGGRESSOR_THRESHOLD_MS - 1_000);
    const fresh = new Date(now.getTime() - AGGRESSOR_THRESHOLD_MS + 10_000);

    expect(
      shouldEscalateChallenge(
        { status: "PENDING", createdAt: stale, escalatedAt: null },
        now
      )
    ).toBe(true);

    expect(
      shouldEscalateChallenge(
        { status: "PENDING", createdAt: fresh, escalatedAt: null },
        now
      )
    ).toBe(false);

    expect(
      shouldEscalateChallenge(
        { status: "ESCALATED", createdAt: stale, escalatedAt: now },
        now
      )
    ).toBe(false);
  });

  it("builds Quantchat warning payload with Quantads target", () => {
    const payload = buildAggressorPayload({
      userId: "user-123",
      challengeId: "challenge-abc",
      quantadsTarget: "quantads://campaign/test",
      tokens: ["token-1", "token-2"],
    });

    expect(payload.title).toBe("Quantchat SDK Warning");
    expect(payload.priority).toBe("HIGH");
    expect(payload.channel).toBe("quantchat-warning");
    expect(payload.data.target).toBe("quantads://campaign/test");
    expect(payload.tokens).toContain("token-1");
  });

  it("queues a notification when an old challenge is ignored", async () => {
    const unique = `user-${Date.now()}`;
    const email = `${unique}@quantmail.dev`;
    const hash = deriveBiometricHash(`${email}:seed`);

    const user = await prisma.user.create({
      data: {
        displayName: unique,
        email,
        biometricHash: hash,
        verified: true,
        digitalTwin: { create: {} },
      },
    });

    await registerDeviceToken({
      userId: user.id,
      token: `token-${unique}`,
      platform: "ios",
    });

    const { id: challengeId } = await createLivenessChallenge({
      userId: user.id,
      quantadsTarget: "quantads://campaign/test",
      now: new Date(Date.now() - AGGRESSOR_THRESHOLD_MS - 5_000),
    });

    const result = await triggerAggressivePush(challengeId, new Date());
    expect(result.skipped).toBe(false);

    const notification = await prisma.pushNotification.findFirst({
      where: { challengeId },
    });

    expect(notification).toBeTruthy();
    expect(notification?.priority).toBe("HIGH");
    expect(notification?.status).toBe("QUEUED");

    // clean up
    await prisma.pushNotification.deleteMany({ where: { challengeId } });
    await prisma.deviceToken.deleteMany({ where: { userId: user.id } });
    await prisma.livenessChallenge.deleteMany({ where: { userId: user.id } });
    await prisma.digitalTwin.delete({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
