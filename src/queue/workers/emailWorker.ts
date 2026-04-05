/**
 * Email Queue Worker
 *
 * BullMQ worker that processes jobs from the "email" queue.
 * Each job calls the email service to deliver the message.
 *
 * Run this worker as a separate process:
 *   npx tsx src/queue/workers/emailWorker.ts
 *
 * Environment variables inherited from the main app apply here too.
 */

import { Worker, type Job } from "bullmq";
import { sendEmail } from "../../services/emailService";
import { redisConnection, QUEUE_NAMES, type EmailJobData } from "../queues";

const CONCURRENCY = parseInt(process.env["EMAIL_WORKER_CONCURRENCY"] || "5", 10);

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { to, subject, text, html, from } = job.data;

  console.log(`[EmailWorker] Processing job ${job.id} → ${to}: "${subject}"`);

  const result = await sendEmail({ to, subject, text, html, from });

  if (!result.success) {
    throw new Error(
      `Email delivery failed via ${result.provider}: ${result.error}`
    );
  }

  console.log(
    `[EmailWorker] Job ${job.id} delivered via ${result.provider} (messageId: ${result.messageId})`
  );
}

let worker: Worker<EmailJobData> | null = null;

export function startEmailWorker(): Worker<EmailJobData> | null {
  try {
    worker = new Worker<EmailJobData>(
      QUEUE_NAMES.EMAIL,
      processEmailJob,
      {
        connection: redisConnection,
        concurrency: CONCURRENCY,
      }
    );

    worker.on("completed", (job) => {
      console.log(`[EmailWorker] Job ${job.id} completed.`);
    });

    worker.on("failed", (job, err) => {
      console.error(
        `[EmailWorker] Job ${job?.id} failed: ${err.message}`
      );
    });

    worker.on("error", (err) => {
      console.error("[EmailWorker] Worker error:", err.message);
    });

    console.log(
      `[EmailWorker] Started. Queue: "${QUEUE_NAMES.EMAIL}", concurrency: ${CONCURRENCY}.`
    );
    return worker;
  } catch (err) {
    console.warn(
      "[EmailWorker] Failed to start worker. Redis may be unavailable.",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function stopEmailWorker(): Promise<void> {
  return worker ? worker.close() : Promise.resolve();
}

// ─── Standalone entry point ───────────────────────────────────────
// When run directly (e.g., `npx tsx src/queue/workers/emailWorker.ts`),
// start the worker process and keep it alive.

if (require.main === module) {
  const w = startEmailWorker();
  if (!w) {
    console.error("[EmailWorker] Could not start. Exiting.");
    process.exit(1);
  }

  const shutdown = async () => {
    console.log("[EmailWorker] Shutting down…");
    await stopEmailWorker();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
