/**
 * Ephemeral Mail Routes
 *
 * REST API for the Self-Destructing Encrypted Messages system.
 *
 * Endpoints
 * ─────────
 * POST   /ephemeral                       — create a new ephemeral message
 * GET    /ephemeral/inbox/:recipientEmail — list pending messages for recipient
 * GET    /ephemeral/sent/:senderId        — list sent messages for sender
 * GET    /ephemeral/:id                   — open / read a message (may destroy it)
 * DELETE /ephemeral/:id                   — manually destroy a message
 * POST   /ephemeral/:id/revoke-key        — revoke the ECDH key pair for a message
 * GET    /ephemeral/keys/:senderId        — key rotation dashboard data
 * POST   /ephemeral/sweep                 — trigger manual sweep of expired messages
 *
 * Vault endpoints
 * ───────────────
 * POST   /ephemeral/vault                         — add a message to vault
 * GET    /ephemeral/vault/:userId                 — list vault entries (metadata)
 * GET    /ephemeral/vault/:userId/:entryId        — decrypt & return vault entry
 * DELETE /ephemeral/vault/:userId/:entryId        — remove a vault entry
 */

import { FastifyInstance } from "fastify";
import {
  createEphemeralMessage,
  openEphemeralMessage,
  destroyEphemeralMessage,
  sweepExpiredMessages,
  listMessagesForRecipient,
  listMessagesBySender,
} from "../services/EphemeralMailService";
import {
  revokeKeyPair,
  getKeyRotationSummary,
  listKeyPairsForSender,
} from "../services/KeyExchangeService";
import {
  addToVault,
  listVaultEntries,
  decryptVaultEntry,
  removeVaultEntry,
  getVaultSize,
} from "../services/MessageVault";
import type { DestructionMode } from "../generated/prisma/client";

// ─── Allowed destruction modes ────────────────────────────────────────────────

const VALID_DESTRUCTION_MODES: DestructionMode[] = [
  "READ_ONCE",
  "TIMER_1H",
  "TIMER_24H",
  "TIMER_7D",
  "SCREENSHOT_PROOF",
];

function isValidDestructionMode(value: unknown): value is DestructionMode {
  return (
    typeof value === "string" &&
    VALID_DESTRUCTION_MODES.includes(value as DestructionMode)
  );
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function ephemeralRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /ephemeral
   * Creates a new ephemeral encrypted message.
   *
   * Body:
   *   senderId          string  — UUID of the sender User
   *   recipientEmail    string  — recipient's email address
   *   encryptedBlob     string  — base64url AES-256-GCM ciphertext
   *   iv                string  — base64url 12-byte IV
   *   authTag           string  — base64url 16-byte GCM auth tag
   *   subject           string  — (optional) plaintext subject line
   *   destructionMode   string  — one of VALID_DESTRUCTION_MODES
   *   senderPublicKey   string  — base64url P-256 public key
   *   recipientPubKey   string  — (optional) base64url P-256 public key
   */
  app.post<{
    Body: {
      senderId: string;
      recipientEmail: string;
      encryptedBlob: string;
      iv: string;
      authTag: string;
      subject?: string;
      destructionMode: string;
      senderPublicKey: string;
      recipientPubKey?: string;
    };
  }>("/ephemeral", async (request, reply) => {
    const {
      senderId,
      recipientEmail,
      encryptedBlob,
      iv,
      authTag,
      subject,
      destructionMode,
      senderPublicKey,
      recipientPubKey,
    } = request.body;

    if (
      !senderId ||
      !recipientEmail ||
      !encryptedBlob ||
      !iv ||
      !authTag ||
      !senderPublicKey
    ) {
      return reply.code(400).send({
        error:
          "senderId, recipientEmail, encryptedBlob, iv, authTag, and senderPublicKey are required.",
      });
    }

    if (!isValidDestructionMode(destructionMode)) {
      return reply.code(400).send({
        error: `destructionMode must be one of: ${VALID_DESTRUCTION_MODES.join(", ")}`,
      });
    }

    try {
      const meta = await createEphemeralMessage({
        senderId,
        recipientEmail,
        encryptedBlob,
        iv,
        authTag,
        subject,
        destructionMode: destructionMode as DestructionMode,
        senderPublicKey,
        recipientPubKey,
      });

      return reply.code(201).send({ message: meta });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(400).send({ error: message });
    }
  });

  /**
   * GET /ephemeral/inbox/:recipientEmail
   * Lists all pending (non-destroyed) ephemeral messages for a recipient.
   * Returns metadata only — no encrypted blobs.
   */
  app.get<{ Params: { recipientEmail: string } }>(
    "/ephemeral/inbox/:recipientEmail",
    async (request, reply) => {
      const { recipientEmail } = request.params;
      const messages = await listMessagesForRecipient(
        decodeURIComponent(recipientEmail)
      );
      return reply.send({ messages });
    }
  );

  /**
   * GET /ephemeral/sent/:senderId
   * Lists all pending ephemeral messages sent by a user.
   */
  app.get<{ Params: { senderId: string } }>(
    "/ephemeral/sent/:senderId",
    async (request, reply) => {
      const { senderId } = request.params;
      const messages = await listMessagesBySender(senderId);
      return reply.send({ messages });
    }
  );

  /**
   * GET /ephemeral/:id
   * Opens an ephemeral message, returning the encrypted blob for client-side
   * decryption.  READ_ONCE and SCREENSHOT_PROOF messages are destroyed
   * immediately after this response is sent.
   */
  app.get<{ Params: { id: string } }>(
    "/ephemeral/:id",
    async (request, reply) => {
      const { id } = request.params;
      const result = await openEphemeralMessage(id);

      if (result.alreadyDestroyed) {
        return reply.code(410).send({
          error: "This message has been destroyed and is no longer available.",
          destroyedAt: result.destroyedAt,
        });
      }

      return reply.send({ message: result });
    }
  );

  /**
   * DELETE /ephemeral/:id
   * Manually destroys an ephemeral message (sender-initiated).
   * Body: { senderId: string }
   */
  app.delete<{ Params: { id: string }; Body: { senderId: string } }>(
    "/ephemeral/:id",
    async (request, reply) => {
      const { id } = request.params;
      const { senderId } = request.body ?? {};

      if (!senderId) {
        return reply.code(400).send({ error: "senderId is required." });
      }

      await destroyEphemeralMessage(id);
      return reply.send({ status: "destroyed" });
    }
  );

  /**
   * POST /ephemeral/:id/revoke-key
   * Revokes the ECDH key pair for an ephemeral message.
   * After revocation, even a recipient with the URL fragment cannot decrypt.
   * Body: { senderId: string }
   */
  app.post<{ Params: { id: string }; Body: { senderId: string } }>(
    "/ephemeral/:id/revoke-key",
    async (request, reply) => {
      const { id } = request.params;
      const { senderId } = request.body ?? {};

      if (!senderId) {
        return reply.code(400).send({ error: "senderId is required." });
      }

      const keyPair = await revokeKeyPair(id);
      if (!keyPair) {
        return reply.code(404).send({ error: "Key pair not found." });
      }

      return reply.send({ keyPair });
    }
  );

  /**
   * GET /ephemeral/keys/:senderId
   * Returns the Key Rotation Dashboard data for a sender.
   */
  app.get<{ Params: { senderId: string } }>(
    "/ephemeral/keys/:senderId",
    async (request, reply) => {
      const { senderId } = request.params;
      const [summary, keyPairs] = await Promise.all([
        getKeyRotationSummary(senderId),
        listKeyPairsForSender(senderId),
      ]);
      return reply.send({ summary, keyPairs });
    }
  );

  /**
   * POST /ephemeral/sweep
   * Manually triggers a sweep of all expired ephemeral messages.
   * In production this is handled by a cron job; this endpoint is for
   * operational use.
   */
  app.post("/ephemeral/sweep", async (_request, reply) => {
    const destroyed = await sweepExpiredMessages();
    return reply.send({ destroyed });
  });

  // ─── Vault endpoints ────────────────────────────────────────────────────────

  /**
   * POST /ephemeral/vault
   * Saves a message to the authenticated user's vault.
   *
   * Body:
   *   userId          string — UUID of the User
   *   webAuthnCredId  string — WebAuthn credential ID that unlocks the vault
   *   senderEmail     string — sender's email address
   *   subject         string — message subject
   *   plainContent    string — decrypted message body to be vault-encrypted
   *   ephemeralMessageId  string? — optional original message ID
   */
  app.post<{
    Body: {
      userId: string;
      webAuthnCredId: string;
      senderEmail: string;
      subject: string;
      plainContent: string;
      ephemeralMessageId?: string;
    };
  }>("/ephemeral/vault", async (request, reply) => {
    const { userId, webAuthnCredId, senderEmail, subject, plainContent, ephemeralMessageId } =
      request.body;

    if (!userId || !webAuthnCredId || !senderEmail || !subject || !plainContent) {
      return reply.code(400).send({
        error:
          "userId, webAuthnCredId, senderEmail, subject, and plainContent are required.",
      });
    }

    const entry = await addToVault({
      userId,
      webAuthnCredId,
      senderEmail,
      subject,
      plainContent,
      ephemeralMessageId,
    });

    const vaultSize = await getVaultSize(userId);
    return reply.code(201).send({ entry, vaultSize });
  });

  /**
   * GET /ephemeral/vault/:userId
   * Returns vault entry metadata (no decrypted content) for a user.
   */
  app.get<{ Params: { userId: string } }>(
    "/ephemeral/vault/:userId",
    async (request, reply) => {
      const { userId } = request.params;
      const [entries, vaultSize] = await Promise.all([
        listVaultEntries(userId),
        getVaultSize(userId),
      ]);
      return reply.send({ entries, vaultSize, maxSize: 100 });
    }
  );

  /**
   * GET /ephemeral/vault/:userId/:entryId
   * Decrypts and returns the content of a specific vault entry.
   * Requires the WebAuthn credential ID as a query parameter.
   *
   * Query: webAuthnCredId string
   */
  app.get<{
    Params: { userId: string; entryId: string };
    Querystring: { webAuthnCredId: string };
  }>("/ephemeral/vault/:userId/:entryId", async (request, reply) => {
    const { userId, entryId } = request.params;
    const { webAuthnCredId } = request.query;

    if (!webAuthnCredId) {
      return reply.code(400).send({ error: "webAuthnCredId query parameter is required." });
    }

    try {
      const content = await decryptVaultEntry({ entryId, userId, webAuthnCredId });
      if (content === null) {
        return reply.code(404).send({ error: "Vault entry not found." });
      }
      return reply.send({ content });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Decryption failed";
      return reply.code(403).send({ error: message });
    }
  });

  /**
   * DELETE /ephemeral/vault/:userId/:entryId
   * Removes a vault entry.
   */
  app.delete<{ Params: { userId: string; entryId: string } }>(
    "/ephemeral/vault/:userId/:entryId",
    async (request, reply) => {
      const { userId, entryId } = request.params;
      const removed = await removeVaultEntry(entryId, userId);

      if (!removed) {
        return reply.code(404).send({ error: "Vault entry not found." });
      }

      return reply.send({ status: "removed" });
    }
  );
}
