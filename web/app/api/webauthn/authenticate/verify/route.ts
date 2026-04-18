import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCredentialId, parseTransports, webAuthnConfig } from "@/lib/webauthn";

export const runtime = "nodejs";

interface AuthenticationVerifyRequest {
  challengeId?: string;
  response?: AuthenticationResponseJSON;
}

export async function POST(request: Request) {
  const body = (await request.json()) as AuthenticationVerifyRequest;

  if (!body.challengeId || !body.response) {
    return NextResponse.json(
      { error: "challengeId and response are required" },
      { status: 400 }
    );
  }

  const challenge = await prisma.webAuthnChallenge.findUnique({
    where: { id: body.challengeId },
  });

  if (!challenge || challenge.type !== "AUTHENTICATION") {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  if (challenge.usedAt || challenge.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 410 });
  }

  const credentialId = getCredentialId(body.response);
  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          verified: true,
        },
      },
    },
  });

  if (!credential) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  if (challenge.userId && challenge.userId !== credential.userId) {
    return NextResponse.json({ error: "Credential mismatch" }, { status: 403 });
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;

  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: webAuthnConfig.rpOrigin,
      expectedRPID: webAuthnConfig.rpID,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        counter: Number(credential.counter),
        transports: parseTransports(credential.transports),
      },
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

  if (!verification.verified || !verification.authenticationInfo) {
    return NextResponse.json({ error: "Passkey verification failed" }, { status: 400 });
  }

  await prisma.webAuthnCredential.update({
    where: { credentialId },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  });

  await prisma.webAuthnChallenge.update({
    where: { id: challenge.id },
    data: { usedAt: new Date() },
  });

  return NextResponse.json({
    verified: true,
    user: credential.user,
  });
}
