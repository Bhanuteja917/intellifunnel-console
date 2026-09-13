import { db } from "@/lib/db";
import { logger } from "@/lib/logging/logger";
import { activateDueChannels, completeFinishedChannels } from "@/lib/campaigns/state-machine";
import { fireDueWebhookRuns } from "@/lib/delivery/webhook-runner";
import { generateDueCsvRuns } from "@/lib/delivery/csv-runner";
import { anonymizeExpiredContacts } from "@/lib/compliance/retention";
import { getStorageAdapter } from "@/lib/storage";

const INTERVAL_MS = Number.parseInt(process.env.WORKER_INTERVAL_MS ?? "60000", 10);

/**
 * Guards against overlapping runs. A tick that outlives the interval would
 * otherwise have a second copy of itself competing for the same campaigns,
 * where the loser of each transition raises "status changed concurrently" and
 * the log fills with failures that are really just self-contention.
 */
let running = false;
let inFlight: Promise<void> = Promise.resolve();

async function tick(): Promise<void> {
  if (running) {
    logger.warn("worker.tick.skipped", { reason: "previous tick still running" });
    return;
  }
  running = true;

  const now = new Date();
  const correlationId = crypto.randomUUID();
  try {
    const activated = await activateDueChannels(db, now);
    const completed = await completeFinishedChannels(db, now);
    const webhooksFired = await fireDueWebhookRuns(db, now);
    const storage = await getStorageAdapter();
    const csvRunsGenerated = await generateDueCsvRuns(db, now, storage);
    const contactsAnonymized = await anonymizeExpiredContacts(db, now);
    logger.info("worker.tick", { correlationId, activated, completed, webhooksFired, csvRunsGenerated, contactsAnonymized });
  } catch (error) {
    logger.error("worker.tick.failed", {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

function runTick(): void {
  inFlight = tick();
}

async function main(): Promise<void> {
  logger.info("worker.start", { intervalMs: INTERVAL_MS });
  runTick();
  const timer = setInterval(runTick, INTERVAL_MS);

  // Let an in-flight tick finish before exiting: a transition killed midway
  // still commits or rolls back atomically, but stopping between the two
  // batches leaves work the next boot has to pick up, and an abrupt exit
  // gives the orchestrator a non-zero status for a healthy shutdown.
  const shutdown = (signal: string): void => {
    logger.info("worker.shutdown", { signal });
    clearInterval(timer);
    void inFlight.finally(() => {
      logger.info("worker.stopped", { signal });
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main();
