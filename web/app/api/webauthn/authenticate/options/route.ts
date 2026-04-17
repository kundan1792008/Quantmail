import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  challengeExpiresAt,
  isValidEmail,
  parseTransports,
  webAuthnConfig,
} from "@/lib/webauthn";

export const runtime = "nodejs";

interface AuthenticationOptionsRequest {
  email?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as AuthenticationOptionsRequest;
  const email = body.email?.trim().toLowerCase();

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
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

  if (!user || user.webAuthnCredentials.length === 0) {
    return NextResponse.json(
      { error: "No registered passkeys found for this user" },
      { status: 404 }
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: webAuthnConfig.rpID,
    userVerification: "preferred",
    allowCredentials: user.webAuthnCredentials.map((credential) => ({
      id: credential.credentialId,
      type: "public-key",
      transports: parseTransports(credential.transports),
    })),
  });

  const challenge = await prisma.webAuthnChallenge.create({
    data: {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      biometricHash: user.biometricHash,
      webAuthnUserId: user.webAuthnUserId,
      challenge: options.challenge,
      type: "AUTHENTICATION",
      expiresAt: challengeExpiresAt(),
    },
  });

  return NextResponse.json({
    challengeId: challenge.id,
    options,
  });
}
