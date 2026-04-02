import Fastify from "fastify";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth";
import { inboxRoutes } from "./routes/inbox";
import { digitalTwinRoutes } from "./routes/digitalTwin";
import { pushRoutes } from "./routes/push";
import { startPushAggressor } from "./services/pushAggressor";

const app = Fastify({ logger: true });

async function main(): Promise<void> {
  await app.register(cors, { origin: true });
  await app.register(authRoutes);
  await app.register(inboxRoutes);
  await app.register(digitalTwinRoutes);
  await app.register(pushRoutes);
  startPushAggressor();

  app.get("/health", async () => ({ status: "ok", service: "quantmail" }));

  const port = parseInt(process.env["PORT"] || "3000", 10);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
