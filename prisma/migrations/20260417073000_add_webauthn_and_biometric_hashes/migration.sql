-- AlterTable
ALTER TABLE "User" ADD COLUMN "webAuthnUserId" TEXT;

-- CreateEnum
CREATE TYPE "WebAuthnChallengeType" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

-- CreateTable
CREATE TABLE "BiometricHash" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "livenessGridId" TEXT,
    "hash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'FACIAL_MATRIX',
    "algorithm" TEXT NOT NULL DEFAULT 'sha256',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BiometricHash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "biometricHash" TEXT,
    "webAuthnUserId" TEXT,
    "challenge" TEXT NOT NULL,
    "type" "WebAuthnChallengeType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT NOT NULL DEFAULT '[]',
    "deviceType" TEXT NOT NULL DEFAULT 'singleDevice',
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "credentialType" TEXT NOT NULL DEFAULT 'public-key',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_webAuthnUserId_key" ON "User"("webAuthnUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricHash_livenessGridId_key" ON "BiometricHash"("livenessGridId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricHash_hash_key" ON "BiometricHash"("hash");

-- CreateIndex
CREATE INDEX "BiometricHash_userId_createdAt_idx" ON "BiometricHash"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_email_type_createdAt_idx" ON "WebAuthnChallenge"("email", "type", "createdAt");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_createdAt_idx" ON "WebAuthnCredential"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BiometricHash" ADD CONSTRAINT "BiometricHash_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiometricHash" ADD CONSTRAINT "BiometricHash_livenessGridId_fkey" FOREIGN KEY ("livenessGridId") REFERENCES "LivenessGrid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
