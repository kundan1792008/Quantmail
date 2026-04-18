-- CreateEnum
CREATE TYPE "EphemeralDestructionMode" AS ENUM (
    'READ_ONCE',
    'TIMER_1H',
    'TIMER_24H',
    'TIMER_7D',
    'SCREENSHOT_PROOF'
);

-- CreateEnum
CREATE TYPE "EphemeralMessageState" AS ENUM (
    'ACTIVE',
    'READ',
    'EXPIRED',
    'DESTROYED',
    'REVOKED'
);

-- CreateEnum
CREATE TYPE "KeyExchangeAlgorithm" AS ENUM ('ECDH_P256', 'ECDH_P384');

-- CreateEnum
CREATE TYPE "KeyExchangePairState" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');

-- CreateTable
CREATE TABLE "EphemeralMessage" (
    "id" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "destructionMode" "EphemeralDestructionMode" NOT NULL,
    "state" "EphemeralMessageState" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "maxReads" INTEGER NOT NULL DEFAULT 1,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "senderEphemeralKey" TEXT,
    "keyExchangePairId" TEXT,
    "vaultAllowed" BOOLEAN NOT NULL DEFAULT false,
    "attachmentsBlob" TEXT,
    "attachmentsIv" TEXT,
    "attachmentsAuthTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "destroyedAt" TIMESTAMP(3),
    "destructionReason" TEXT,

    CONSTRAINT "EphemeralMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EphemeralMessageDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "succeeded" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EphemeralMessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyExchangePair" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "algorithm" "KeyExchangeAlgorithm" NOT NULL DEFAULT 'ECDH_P256',
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "state" "KeyExchangePairState" NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "KeyExchangePair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultedMessage" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "originalId" TEXT,
    "subject" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "wrappedKey" TEXT NOT NULL,
    "wrappedKeyIv" TEXT NOT NULL,
    "wrappedKeyTag" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VaultedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EphemeralMessage_senderUserId_createdAt_idx"
    ON "EphemeralMessage"("senderUserId", "createdAt");

-- CreateIndex
CREATE INDEX "EphemeralMessage_recipientEmail_state_idx"
    ON "EphemeralMessage"("recipientEmail", "state");

-- CreateIndex
CREATE INDEX "EphemeralMessage_state_expiresAt_idx"
    ON "EphemeralMessage"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "EphemeralMessageDelivery_messageId_accessedAt_idx"
    ON "EphemeralMessageDelivery"("messageId", "accessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KeyExchangePair_fingerprint_key"
    ON "KeyExchangePair"("fingerprint");

-- CreateIndex
CREATE INDEX "KeyExchangePair_ownerUserId_state_idx"
    ON "KeyExchangePair"("ownerUserId", "state");

-- CreateIndex
CREATE INDEX "KeyExchangePair_state_createdAt_idx"
    ON "KeyExchangePair"("state", "createdAt");

-- CreateIndex
CREATE INDEX "VaultedMessage_ownerUserId_savedAt_idx"
    ON "VaultedMessage"("ownerUserId", "savedAt");

-- AddForeignKey
ALTER TABLE "EphemeralMessage"
    ADD CONSTRAINT "EphemeralMessage_senderUserId_fkey"
    FOREIGN KEY ("senderUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EphemeralMessage"
    ADD CONSTRAINT "EphemeralMessage_keyExchangePairId_fkey"
    FOREIGN KEY ("keyExchangePairId") REFERENCES "KeyExchangePair"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EphemeralMessageDelivery"
    ADD CONSTRAINT "EphemeralMessageDelivery_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "EphemeralMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyExchangePair"
    ADD CONSTRAINT "KeyExchangePair_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultedMessage"
    ADD CONSTRAINT "VaultedMessage_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
