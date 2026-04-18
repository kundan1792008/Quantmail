/**
 * REST routes for the Self-Destructing Encrypted Messages feature.
 *
 *   POST   /ephemeral                       – send an encrypted message
 *   GET    /ephemeral/:id                   – fetch + apply destruction
 *   DELETE /ephemeral/:id                   – sender revoke
 *   GET    /ephemeral/sent                  – list sender's outbox
 *   GET    /ephemeral/:id/audit             – per-message access audit log
 *   POST   /ephemeral/sweep                 – admin-only sweeper trigger
 *
 *   POST   /key-exchange/pairs              – mint a new ECDH pair
 *   GET    /key-exchange/pairs              – list user's pairs
 *   POST   /key-exchange/pairs/:id/rotate   – rotate
 *   POST   /key-exchange/pairs/:id/revoke   – revoke + cascade-revoke msgs
 *   GET    /key-exchange/dashboard          – rotation summary
 *
 *   POST   /vault/unlock-token              – mint biometric unlock token
 *                                              (caller must already have
 *                                               verified WebAuthn assertion)
 *   POST   /vault                           – save a message into the vault
 *   GET    /vault                           – list entries
 *   POST   /vault/:id/open                  – read with unlock token
 *   DELETE /vault/:id                       – remove entry
 *   GET    /vault/capacity                  – { used, total, remaining }
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  requireAuth,
  requireAdmin,
  type AuthenticatedUser,
} from "../middleware/authMiddleware";
import * as Ephemeral from "../services/EphemeralMailService";
import * as KeyExchange from "../services/KeyExchangeService";
import * as Vault from "../services/MessageVault";
import { verifyPasskeyAuthentication } from "../services/WebAuthnService";

type AuthedRequest = FastifyRequest & { user: AuthenticatedUser };

interface SendBody {
  recipientEmail: string;
  subject: string;
  payload: Ephemeral.EncryptedPayload;
  attachments?: Ephemeral.EncryptedPayload | null;
  destructionMode: Ephemeral.DestructionMode;
  vaultAllowed?: boolean;
  keyAlgorithm?: KeyExchange.SupportedAlgorithm;
}

interface IdParams {
  id: string;
}

interface PairCreateBody {
  algorithm?: KeyExchange.SupportedAlgorithm;
  label?: string;
}

interface VaultPutBody {
  originalId?: string | null;
  subject: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  messageKey: string;
}

interface VaultOpenBody {
  unlockToken: string;
}

interface VaultUnlockTokenBody {
  /**
   * Fresh WebAuthn assertion response obtained via
   * `generatePasskeyAuthenticationOptions` → browser `navigator.credentials.get()`.
   * The underlying challenge (consumed inside `verifyPasskeyAuthentication`)
   * has a 5-minute TTL, so this request cryptographically proves the user
   * performed a biometric gesture within the last few minutes.
   */
  assertion: Parameters<typeof verifyPasskeyAuthentication>[1];
}

const VALID_DESTRUCTION_MODES: Ephemeral.DestructionMode[] = [
  "READ_ONCE",
  "TIMER_1H",
  "TIMER_24H",
  "TIMER_7D",
  "SCREENSHOT_PROOF",
];

export async function ephemeralRoutes(app: FastifyInstance): Promise<void> {
  // ─── Ephemeral message endpoints ────────────────────────────────

  app.post<{ Body: SendBody }>(
    "/ephemeral",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body;
      if (
        !body ||
        typeof body.recipientEmail !== "string" ||
        typeof body.subject !== "string" ||
        !body.payload ||
        typeof body.payload.ciphertext !== "string" ||
        typeof body.payload.iv !== "string" ||
        typeof body.payload.authTag !== "string"
      ) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      if (!VALID_DESTRUCTION_MODES.includes(body.destructionMode)) {
        return reply
          .code(400)
          .send({ error: "Invalid destructionMode", allowed: VALID_DESTRUCTION_MODES });
      }
      const auth = (request as AuthedRequest).user;
      try {
        const result = await Ephemeral.send({
          senderUserId: auth.id,
          recipientEmail: body.recipientEmail,
          subject: body.subject,
          payload: body.payload,
          attachments: body.attachments ?? null,
          destructionMode: body.destructionMode,
          vaultAllowed: body.vaultAllowed ?? false,
          keyAlgorithm: body.keyAlgorithm,
        });
        return reply.code(201).send(result);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "send failed" });
      }
    }
  );

  app.get<{ Params: IdParams }>("/ephemeral/:id", async (request, reply) => {
    const { id } = request.params;
    const result = await Ephemeral.fetchForRead(id, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? "",
    });
    if (!result.ok) {
      const status =
        result.reason === "NOT_FOUND"
          ? 404
          : result.reason === "ALREADY_READ" || result.reason === "DESTROYED"
            ? 410
            : result.reason === "EXPIRED"
              ? 410
              : 403;
      return reply.code(status).send({ error: result.reason });
    }
    return reply.send(result);
  });

  app.delete<{ Params: IdParams }>(
    "/ephemeral/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const ok = await Ephemeral.revokeMessageAndKey(request.params.id, auth.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return reply.send({ status: "revoked" });
    }
  );

  app.get(
    "/ephemeral/sent",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const messages = await Ephemeral.listSentMessages(auth.id);
      return reply.send({ messages });
    }
  );

  app.get<{ Params: IdParams }>(
    "/ephemeral/:id/audit",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const log = await Ephemeral.getDeliveryAuditLog(request.params.id, auth.id);
      return reply.send({ log });
    }
  );

  app.post(
    "/ephemeral/sweep",
    { preHandler: requireAdmin },
    async (_request, reply) => {
      const purged = await Ephemeral.purgeDestroyed();
      return reply.send({ purged });
    }
  );

  // ─── Key-exchange endpoints ─────────────────────────────────────

  app.post<{ Body: PairCreateBody }>(
    "/key-exchange/pairs",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const body = request.body ?? {};
      const pair = await KeyExchange.createPair({
        ownerUserId: auth.id,
        algorithm: body.algorithm,
        label: body.label,
      });
      return reply.code(201).send(pair);
    }
  );

  app.get(
    "/key-exchange/pairs",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const pairs = await KeyExchange.listAllPairs(auth.id);
      return reply.send({ pairs });
    }
  );

  app.post<{ Params: IdParams }>(
    "/key-exchange/pairs/:id/rotate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const existing = await KeyExchange.getPair(request.params.id);
      if (!existing || existing.ownerUserId !== auth.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const next = await KeyExchange.rotatePair(request.params.id);
        return reply.send({ rotated: existing, next });
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "rotate failed" });
      }
    }
  );

  app.post<{ Params: IdParams }>(
    "/key-exchange/pairs/:id/revoke",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const existing = await KeyExchange.getPair(request.params.id);
      if (!existing || existing.ownerUserId !== auth.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      const result = await KeyExchange.revokePair(request.params.id);
      return reply.send(result);
    }
  );

  app.get(
    "/key-exchange/dashboard",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const summary = await KeyExchange.rotationDashboard(auth.id);
      return reply.send(summary);
    }
  );

  // ─── Vault endpoints ────────────────────────────────────────────

  /**
   * Mints a short-lived (5-minute) unlock token.
   *
   * Requires a *fresh* WebAuthn assertion in the request body — we run
   * `verifyPasskeyAuthentication` here, which consumes the pending
   * challenge.  Because challenges are one-shot and expire in 5
   * minutes, a stolen long-lived SSO token cannot mint vault unlock
   * tokens without also performing a new biometric gesture.
   */
  app.post<{ Body: VaultUnlockTokenBody }>(
    "/vault/unlock-token",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const body = request.body;
      if (!body || !body.assertion) {
        return reply
          .code(400)
          .send({ error: "WebAuthn assertion required" });
      }
      if (!auth.verified) {
        return reply
          .code(403)
          .send({ error: "Biometric verification required" });
      }
      try {
        const result = await verifyPasskeyAuthentication(auth.id, body.assertion);
        if (!result.verified) {
          return reply.code(403).send({ error: "Biometric gesture rejected" });
        }
      } catch (err) {
        return reply.code(403).send({
          error: "Biometric gesture rejected",
          reason: err instanceof Error ? err.message : "verification failed",
        });
      }
      const token = Vault.mintUnlockToken(auth.id);
      return reply.send({ token, expiresInSeconds: 300 });
    }
  );

  app.post<{ Body: VaultPutBody }>(
    "/vault",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const body = request.body;
      if (
        !body ||
        typeof body.subject !== "string" ||
        typeof body.ciphertext !== "string" ||
        typeof body.iv !== "string" ||
        typeof body.authTag !== "string" ||
        typeof body.messageKey !== "string"
      ) {
        return reply.code(400).send({ error: "Invalid vault payload" });
      }
      try {
        const entry = await Vault.put({
          ownerUserId: auth.id,
          originalId: body.originalId ?? null,
          subject: body.subject,
          ciphertext: body.ciphertext,
          iv: body.iv,
          authTag: body.authTag,
          messageKeyB64: body.messageKey,
        });
        return reply.code(201).send(entry);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "vault put failed" });
      }
    }
  );

  app.get(
    "/vault",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const entries = await Vault.list(auth.id);
      return reply.send({ entries });
    }
  );

  app.post<{ Params: IdParams; Body: VaultOpenBody }>(
    "/vault/:id/open",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body.unlockToken !== "string") {
        return reply.code(400).send({ error: "unlockToken required" });
      }
      const result = await Vault.unlock(request.params.id, body.unlockToken);
      if (!result) {
        return reply.code(403).send({ error: "Locked" });
      }
      return reply.send(result);
    }
  );

  app.delete<{ Params: IdParams }>(
    "/vault/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const ok = await Vault.remove(request.params.id, auth.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return reply.send({ status: "removed" });
    }
  );

  app.get(
    "/vault/capacity",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = (request as AuthedRequest).user;
      const cap = await Vault.capacity(auth.id);
      return reply.send(cap);
    }
  );
}
