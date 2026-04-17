import { generateRegistrationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  challengeExpiresAt,
  isValidBiometricHash,
  isValidEmail,
  parseTransports,
  webAuthnConfig,
} from "@/lib/webauthn";

export const runtime = "nodejs";

interface RegistrationOptionsRequest {
  email?: string;
  displayName?: string;
  biometricHash?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as RegistrationOptionsRequest;
  const email = body.email?.trim().toLowerCase();
  const displayName = body.displayName?.trim();
  const biometricHash = body.biometricHash?.trim().toLowerCase();

  if (!email || !displayName || !biometricHash) {
    return NextResponse.json(
      { error: "email, displayName, and biometricHash are required" },
      { status: 400 }
    );
  }

  if (!isValidEmail(email) || !isValidBiometricHash(biometricHash)) {
    return NextResponse.json(
      { error: "Invalid email or biometricHash" },
      { status: 400 }
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    include: {
      webAuthnCredentials: {
        select: {
          credentialId: true,
          transports: true,
        },
      },
    },
  });

  if (existingUser && existingUser.biometricHash !== biometricHash) {
    return NextResponse.json(
      { error: "Biometric hash mismatch for existing user" },
      { status: 409 }
    );
  }

  const webAuthnUserId = existingUser?.webAuthnUserId ?? crypto.randomUUID();
  const options = await generateRegistrationOptions({
    rpID: webAuthnConfig.rpID,
    rpName: webAuthnConfig.rpName,
    userID: new TextEncoder().encode(webAuthnUserId),
    userName: email,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
    excludeCredentials: existingUser?.webAuthnCredentials.map((credential) => ({
      id: credential.credentialId,
      type: "public-key",
      transports: parseTransports(credential.transports),
    })),
  });

  const challenge = await prisma.webAuthnChallenge.create({
    data: {
      userId: existingUser?.id,
      email,
      displayName,
      biometricHash,
      webAuthnUserId,
      challenge: options.challenge,
      type: "REGISTRATION",
      expiresAt: challengeExpiresAt(),
    },
  });

  return NextResponse.json({
    challengeId: challenge.id,
    options,
  });
}
