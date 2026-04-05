import Fastify from "fastify";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth";
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
import { calendarRoutes } from "./routes/calendar";
import { docsRoutes } from "./routes/docs";
import { sheetsRoutes } from "./routes/sheets";
import { driveRoutes } from "./routes/drive";
import { meetRoutes } from "./routes/meet";

const app = Fastify({ logger: true });

async function main(): Promise<void> {
  await app.register(cors, { origin: true });
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
  await app.register(calendarRoutes);
  await app.register(docsRoutes);
  await app.register(sheetsRoutes);
  await app.register(driveRoutes);
  await app.register(meetRoutes);

  app.get("/health", async () => ({ status: "ok", service: "quantmail" }));

  const port = parseInt(process.env["PORT"] || "3000", 10);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
