import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";
import authRoutes from "./routes/auth";
import inboxRoutes from "./routes/inbox";
import digitalTwinRoutes from "./routes/digitalTwin";

export function createPrismaClient(): PrismaClient {
  const dbPath = process.env.DATABASE_PATH || "./dev.db";
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

export function buildApp(prisma?: PrismaClient) {
  const app = Fastify({ logger: true });
  const db = prisma ?? createPrismaClient();

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", service: "quantmail" }));

  app.register(authRoutes, { prisma: db });
  app.register(inboxRoutes, { prisma: db });
  app.register(digitalTwinRoutes, { prisma: db });

  return { app, prisma: db };
}

async function start() {
  const { app } = buildApp();
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";

  try {
    await app.listen({ port, host });
    console.log(`Quantmail server running on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

export default buildApp;
