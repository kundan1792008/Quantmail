import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { inboxRoutes } from "./routes/inbox";
import { digitalTwinRoutes } from "./routes/digitalTwin";
import { iotRoutes } from "./routes/iot";
import { quanteditsRoutes } from "./routes/quantedits";
import { pushRoutes } from "./routes/push";
import { quanttubeRoutes } from "./routes/quanttube";
import { orchestratorRoutes } from "./routes/orchestrator";
import { tasksRoutes } from "./routes/tasks";
import { chatRoutes } from "./routes/chat";
import { notesRoutes } from "./routes/notes";
import { mailRoutes } from "./routes/mail";
import { calendarRoutes } from "./routes/calendar";
import { docsRoutes } from "./routes/docs";
import { sheetsRoutes } from "./routes/sheets";
import { driveRoutes } from "./routes/drive";
import { meetRoutes } from "./routes/meet";
import { settingsRoutes } from "./routes/settings";
import { adminRoutes } from "./routes/admin";
import { webhookRoutes } from "./routes/webhook";
import { superAppRoutes } from "./routes/superapp";
import { smartReplyRoutes } from "./routes/smartReply";
import { smartComposeRoutes } from "./routes/smartCompose";
import { ephemeralRoutes } from "./routes/ephemeral";
import { tokenValidatorRoutes } from "./services/TokenValidator";
import { prisma } from "./db";
import { landingPage } from "./landing";

function buildHttpsOptions(): { key: string; cert: string; ca?: string } | undefined {
  const keyPath = process.env["TLS_KEY_PATH"];
  const certPath = process.env["TLS_CERT_PATH"];
  if (!keyPath || !certPath) return undefined;

  return {
    key: fs.readFileSync(keyPath, "utf8"),
    cert: fs.readFileSync(certPath, "utf8"),
    ...(process.env["TLS_CA_PATH"]
      ? { ca: fs.readFileSync(process.env["TLS_CA_PATH"], "utf8") }
      : {}),
  };
}

const isProduction = process.env["NODE_ENV"] === "production";
const httpsOptions = buildHttpsOptions();

const app = Fastify({
  logger: {
    level: process.env["LOG_LEVEL"] || (isProduction ? "info" : "debug"),
    ...(isProduction
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: { colorize: true },
          },
        }),
  },
  bodyLimit: 1_048_576,
  ...(httpsOptions ? { https: httpsOptions } : {}),
});

const allowedOrigins = process.env["CORS_ORIGINS"]
  ? process.env["CORS_ORIGINS"].split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173"];

async function main(): Promise<void> {
  await app.register(helmet);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  await app.register(cors, {
    origin: isProduction ? allowedOrigins : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Quantmail API",
        description: "Quantmail – Biometric Identity Gateway REST API",
        version: "1.0.0",
      },
      servers: [{ url: "http://localhost:3000", description: "Local development" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  await app.register(authRoutes);
  await app.register(inboxRoutes);
  await app.register(digitalTwinRoutes);
  await app.register(iotRoutes);
  await app.register(quanteditsRoutes);
  await app.register(pushRoutes);
  await app.register(quanttubeRoutes);
  await app.register(orchestratorRoutes);
  await app.register(tasksRoutes);
  await app.register(chatRoutes);
  await app.register(notesRoutes);
  await app.register(mailRoutes);
  await app.register(calendarRoutes);
  await app.register(docsRoutes);
  await app.register(sheetsRoutes);
  await app.register(driveRoutes);
  await app.register(meetRoutes);
  await app.register(settingsRoutes);
  await app.register(adminRoutes);
  await app.register(webhookRoutes);
  await app.register(superAppRoutes);
  await app.register(smartReplyRoutes);
  await app.register(smartComposeRoutes);
  await app.register(ephemeralRoutes);
  await app.register(tokenValidatorRoutes);
  await app.register(profileRoutes);

  app.get(
    "/health",
    {
      schema: {
        description: "Health check endpoint – verifies service and DB status",
        tags: ["system"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              db: { type: "string" },
              uptime: { type: "number" },
              timestamp: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              db: { type: "string" },
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      let dbStatus = "ok";
      let dbError: string | undefined;
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch (err) {
        dbStatus = "error";
        dbError = err instanceof Error ? err.message : String(err);
        app.log.error({ err }, "Health check – DB connectivity failed");
      }

      const payload = {
        status: dbStatus === "ok" ? "ok" : "degraded",
        service: "quantmail",
        db: dbStatus,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        ...(dbError ? { error: dbError } : {}),
      };

      return reply.code(dbStatus === "ok" ? 200 : 503).send(payload);
    }
  );

  app.get("/", async (_request, reply) => reply.type("text/html").send(landingPage));

  const port = parseInt(process.env["PORT"] || "3000", 10);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
