/**
 * Admin Dashboard API
 *
 * Endpoints for system stats, user management, and global AI configuration.
 * All routes require a valid SSO token with the ADMIN role.
 */

import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { requireAdmin } from "../middleware/authMiddleware";
import type { AuthenticatedUser } from "../middleware/authMiddleware";
import { encryptApiKey } from "../utils/crypto";
import { maskStoredKey } from "../utils/maskKey";

const ENCRYPTION_SECRET = process.env["ENCRYPTION_SECRET"] || "quantmail-key-secret";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/stats", {
    preHandler: requireAdmin,
    handler: async (_request, reply) => {
      const [
        totalUsers,
        verifiedUsers,
        totalInboxMessages,
        totalShadowMessages,
        totalActiveAlarms,
        totalDeviceTokens,
        totalWebhookEndpoints,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { verified: true } }),
        prisma.inboxMessage.count(),
        prisma.shadowInbox.count(),
        prisma.criticalAlert.count({ where: { alarmStatus: "ACTIVE" } }),
        prisma.deviceToken.count(),
        prisma.webhookEndpoint.count({ where: { active: true } }),
      ]);

      return reply.send({
        stats: {
          users: { total: totalUsers, verified: verifiedUsers },
          inbox: {
            messages: totalInboxMessages,
            shadowFiltered: totalShadowMessages,
          },
          alarms: { active: totalActiveAlarms },
          devices: { tokens: totalDeviceTokens },
          webhooks: { activeEndpoints: totalWebhookEndpoints },
          generatedAt: new Date().toISOString(),
        },
      });
    },
  });

  app.get<{
    Querystring: { page?: string; limit?: string; role?: string };
  }>("/admin/users", {
    preHandler: requireAdmin,
    handler: async (request, reply) => {
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || "20", 10)));
      const roleFilter = request.query.role as "USER" | "ADMIN" | undefined;
      const where = roleFilter ? { role: roleFilter } : {};

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            displayName: true,
            email: true,
            verified: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.user.count({ where }),
      ]);

      return reply.send({
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  });

  app.get<{ Params: { id: string } }>("/admin/users/:id", {
    preHandler: requireAdmin,
    handler: async (request, reply) => {
      const { id } = request.params;

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          displayName: true,
          email: true,
          verified: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          livenessGrid: {
            select: {
              facialMatrixHash: true,
              livenessScore: true,
              passed: true,
              capturedAt: true,
            },
          },
          digitalTwin: {
            select: { agentConfig: true, lastSyncAt: true },
          },
          _count: {
            select: {
              inboxMessages: true,
              deviceTokens: true,
              criticalAlerts: true,
            },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      return reply.send({ user });
    },
  });

  app.patch<{
    Params: { id: string };
    Body: { role: "USER" | "ADMIN" };
  }>("/admin/users/:id/role", {
    preHandler: requireAdmin,
    handler: async (request, reply) => {
      const { id } = request.params;
      const { role } = request.body;

      if (!role || !["USER", "ADMIN"].includes(role)) {
        return reply.code(400).send({ error: "role must be USER or ADMIN" });
      }

      const requester = (request as typeof request & { user: AuthenticatedUser }).user;
      if (requester.id === id && role !== "ADMIN") {
        return reply.code(400).send({ error: "Cannot remove your own admin role" });
      }

      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: "User not found" });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { role },
        select: { id: true, displayName: true, email: true, role: true },
      });

      return reply.send({ user: updated });
    },
  });

  app.delete<{ Params: { id: string } }>("/admin/users/:id", {
    preHandler: requireAdmin,
    handler: async (request, reply) => {
      const { id } = request.params;
      const requester = (request as typeof request & { user: AuthenticatedUser }).user;

      if (requester.id === id) {
        return reply.code(400).send({ error: "Cannot delete your own account" });
      }

      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: "User not found" });
      }

      await prisma.user.delete({ where: { id } });
      return reply.send({ status: "deleted", id });
    },
  });

  app.get<{
    Querystring: { page?: string; limit?: string };
  }>("/admin/shadow-inbox", {
    preHandler: requireAdmin,
    handler: async (request, reply) => {
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || "20", 10)));

      const [entries, total] = await Promise.all([
        prisma.shadowInbox.findMany({
          orderBy: { droppedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.shadowInbox.count(),
      ]);

      return reply.send({
        entries,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },
  });

  app.post<{
    Body: {
      globalOpenaiKey?: string;
      globalAnthropicKey?: string;
      globalGeminiKey?: string;
      customModelUrl?: string;
      customModelKey?: string;
    };
  }>("/admin/config", {
    preHandler: requireAdmin,
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const requester = (request as typeof request & { user: AuthenticatedUser }).user;
      const {
        globalOpenaiKey,
        globalAnthropicKey,
        globalGeminiKey,
        customModelUrl,
        customModelKey,
      } = request.body;

      const updateData: Record<string, string | null> = {};
      if (globalOpenaiKey !== undefined) {
        updateData.globalOpenaiKey = globalOpenaiKey ? encryptApiKey(globalOpenaiKey, ENCRYPTION_SECRET) : null;
      }
      if (globalAnthropicKey !== undefined) {
        updateData.globalAnthropicKey = globalAnthropicKey ? encryptApiKey(globalAnthropicKey, ENCRYPTION_SECRET) : null;
      }
      if (globalGeminiKey !== undefined) {
        updateData.globalGeminiKey = globalGeminiKey ? encryptApiKey(globalGeminiKey, ENCRYPTION_SECRET) : null;
      }
      if (customModelUrl !== undefined) {
        updateData.customModelUrl = customModelUrl || null;
      }
      if (customModelKey !== undefined) {
        updateData.customModelKey = customModelKey ? encryptApiKey(customModelKey, ENCRYPTION_SECRET) : null;
      }

      if (Object.keys(updateData).length === 0) {
        return reply.code(400).send({ error: "At least one configuration field is required" });
      }

      const existing = await prisma.adminConfig.findFirst({ orderBy: { updatedAt: "desc" } });
      const config = existing
        ? await prisma.adminConfig.update({
            where: { id: existing.id },
            data: { ...updateData, updatedBy: requester.id },
          })
        : await prisma.adminConfig.create({
            data: { ...updateData, updatedBy: requester.id },
          });

      return reply.send({
        message: "Global AI configuration updated successfully.",
        configId: config.id,
        updatedAt: config.updatedAt,
      });
    },
  });

  app.get("/admin/config", {
    preHandler: requireAdmin,
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const config = await prisma.adminConfig.findFirst({ orderBy: { updatedAt: "desc" } });
      if (!config) {
        return reply.send({
          config: null,
          message: "No global configuration set. Use POST /admin/config to configure.",
        });
      }

      return reply.send({
        config: {
          id: config.id,
          globalOpenaiKey: maskStoredKey(config.globalOpenaiKey),
          globalAnthropicKey: maskStoredKey(config.globalAnthropicKey),
          globalGeminiKey: maskStoredKey(config.globalGeminiKey),
          customModelUrl: config.customModelUrl || null,
          customModelKey: maskStoredKey(config.customModelKey),
          updatedBy: config.updatedBy,
          updatedAt: config.updatedAt,
        },
      });
    },
  });
}
