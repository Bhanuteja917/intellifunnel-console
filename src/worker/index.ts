import { db } from "@/lib/db";
import { logger } from "@/lib/logging/logger";
import { activateDueCampaigns, completeFinishedCampaigns } from "@/lib/campaigns/state-machine";

const INTERVAL_MS = Number.parseInt(process.env.WORKER_INTERVAL_MS ?? "60000", 10);

async function tick(): Promise<void> {
  const now = new Date();
  const correlationId = crypto.randomUUID();
  try {
    const activated = await activateDueCampaigns(db, now);
    const completed = await completeFinishedCampaigns(db, now);
    logger.info("worker.tick", { correlationId, activated, completed });
  } catch (error) {
    logger.error("worker.tick.failed", {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  logger.info("worker.start", { intervalMs: INTERVAL_MS });
  await tick();
  setInterval(() => void tick(), INTERVAL_MS);
}

void main();
