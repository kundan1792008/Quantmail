import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { getPrisma } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { inboxRoutes } from "./routes/inbox.js";

export async function buildApp(dbPath?: string) {
  const app = Fastify({ logger: true });
  const prisma = getPrisma(dbPath);

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Register route modules
  await authRoutes(app, prisma);
  await inboxRoutes(app, prisma);

  // Health check
  app.get("/health", async () => ({ status: "ok", service: "quantmail" }));

  return app;
}

async function main() {
  const app = await buildApp();
  const port = Number(process.env["PORT"] ?? 3000);
  const host = process.env["HOST"] ?? "0.0.0.0";

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
