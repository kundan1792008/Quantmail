import Fastify from "fastify";
import cors from "@fastify/cors";
import { biometricRoutes } from "./routes/biometric.js";
import { copilotRoutes } from "./routes/copilot.js";
import { auditRoutes } from "./routes/audit.js";
import { inboxInterceptorRoutes } from "./hooks/InboxInterceptor.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Health-check
  app.get("/health", async () => ({ status: "ok" }));

  // Feature routes
  await app.register(biometricRoutes);
  await app.register(copilotRoutes);
  await app.register(auditRoutes);
  await app.register(inboxInterceptorRoutes);

  return app;
}

async function start() {
  const app = await buildApp();
  const port = Number(process.env["PORT"]) || 3000;

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
