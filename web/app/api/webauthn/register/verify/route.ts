import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCredentialId, serializeTransports, webAuthnConfig } from "@/lib/webauthn";

export const runtime = "nodejs";

interface RegistrationVerifyRequest {
  challengeId?: string;
  response?: RegistrationResponseJSON;
}

export async function POST(request: Request) {
  const body = (await request.json()) as RegistrationVerifyRequest;

  if (!body.challengeId || !body.response) {
    return NextResponse.json(
      { error: "challengeId and response are required" },
      { status: 400 }
    );
  }

  const challenge = await prisma.webAuthnChallenge.findUnique({
    where: { id: body.challengeId },
  });

  if (!challenge || challenge.type !== "REGISTRATION") {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  if (challenge.usedAt || challenge.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;

  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: webAuthnConfig.rpOrigin,
      expectedRPID: webAuthnConfig.rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Passkey verification failed",
        message: error instanceof Error ? error.message : "Unknown verification error",
      },
      { status: 400 }
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Passkey verification failed" }, { status: 400 });
  }

  const credentialId = getCredentialId(body.response);
  const existingCredential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId },
  });

  if (existingCredential && existingCredential.userId !== challenge.userId) {
    return NextResponse.json(
      { error: "Credential is already registered to another user" },
      { status: 409 }
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: challenge.email },
    select: {
      id: true,
      displayName: true,
      email: true,
      biometricHash: true,
      verified: true,
      webAuthnUserId: true,
    },
  });

  const biometricOwner = challenge.biometricHash
    ? await prisma.user.findUnique({
        where: { biometricHash: challenge.biometricHash },
        select: { id: true, email: true },
      })
    : null;

  if (biometricOwner && biometricOwner.email !== challenge.email) {
    return NextResponse.json(
      { error: "Biometric hash is already registered to another user" },
      { status: 409 }
    );
  }

  if (existingUser && existingUser.biometricHash !== challenge.biometricHash) {
    return NextResponse.json(
      { error: "Biometric hash mismatch for existing user" },
      { status: 409 }
    );
  }

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          displayName: challenge.displayName ?? existingUser.displayName,
          webAuthnUserId:
            existingUser.webAuthnUserId ?? challenge.webAuthnUserId ?? crypto.randomUUID(),
          verified: existingUser.verified || Boolean(challenge.biometricHash),
        },
        select: {
          id: true,
          displayName: true,
          email: true,
          biometricHash: true,
          verified: true,
          webAuthnUserId: true,
        },
      })
    : await prisma.user.create({
        data: {
          displayName: challenge.displayName ?? challenge.email,
          email: challenge.email,
          biometricHash: challenge.biometricHash ?? credentialId,
          webAuthnUserId: challenge.webAuthnUserId ?? crypto.randomUUID(),
          verified: Boolean(challenge.biometricHash),
          digitalTwin: {
            create: {},
          },
        },
        select: {
          id: true,
          displayName: true,
          email: true,
          biometricHash: true,
          verified: true,
          webAuthnUserId: true,
        },
      });

  await prisma.digitalTwin.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  if (challenge.biometricHash) {
    const biometricHashRecord = await prisma.biometricHash.findUnique({
      where: { hash: challenge.biometricHash },
    });

    if (biometricHashRecord && biometricHashRecord.userId !== user.id) {
      return NextResponse.json(
        { error: "Biometric hash is already linked to another user" },
        { status: 409 }
      );
    }

    if (!biometricHashRecord) {
      await prisma.biometricHash.create({
        data: {
          userId: user.id,
          hash: challenge.biometricHash,
          verifiedAt: new Date(),
          metadata: JSON.stringify({
            source: "webauthn_registration",
            challengeId: challenge.id,
          }),
        },
      });
    }
  }

  const registrationInfo = verification.registrationInfo;

  await prisma.webAuthnCredential.upsert({
    where: { credentialId },
    update: {
      publicKey: Buffer.from(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      transports: serializeTransports(body.response.response.transports),
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      credentialType: body.response.type,
    },
    create: {
      userId: user.id,
      credentialId,
      publicKey: Buffer.from(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      transports: serializeTransports(body.response.response.transports),
      deviceType: registrationInfo.credentialDeviceType,
      backedUp: registrationInfo.credentialBackedUp,
      credentialType: body.response.type,
    },
  });

  await prisma.webAuthnChallenge.update({
    where: { id: challenge.id },
    data: {
      usedAt: new Date(),
      userId: user.id,
    },
  });

  return NextResponse.json({
    verified: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      verified: user.verified,
    },
  });
}
