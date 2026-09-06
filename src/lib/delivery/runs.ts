import type { DeliveryRun, Prisma, PrismaClient } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";

type Tx = Prisma.TransactionClient;

/**
 * Called from inside verification.ts's accept transaction. Looks up the
 * channel's DeliveryConfig and, only for an active webhook config, creates a
 * pending DeliveryRun covering exactly this one lead — no HTTP call happens
 * here; src/lib/delivery/webhook-runner.ts's fireDueWebhookRuns job picks it
 * up on the next worker tick. A csv config, a paused config, or no config at
 * all is a silent no-op: CSV delivery is generated in batches by its own job
 * (Task 8), not per-lead.
 */
export async function createWebhookRunOnAccept(tx: Tx, campaignChannelId: string, leadId: string): Promise<void> {
  const config = await tx.deliveryConfig.findUnique({ where: { campaignChannelId } });
  if (config === null || config.method !== "webhook" || config.status !== "active") return;

  await tx.deliveryRun.create({
    data: {
      campaignChannelId,
      method: "webhook",
      leads: { create: { leadId } },
    },
  });
}

export async function listDeliveryRunsForChannel(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<DeliveryRun[]> {
  assertPermission(actor, "delivery:read");
  return db.deliveryRun.findMany({
    where: { campaignChannelId },
    orderBy: { createdAt: "desc" },
  });
}

const RETRYABLE_STATUSES = new Set(["failed", "exhausted"]);

/** Resets a failed/exhausted run so the next worker tick picks it up as if fresh. */
export async function retryDeliveryRun(db: PrismaClient, actor: Actor, runId: string): Promise<DeliveryRun> {
  assertPermission(actor, "delivery:write");
  const run = await db.deliveryRun.findUniqueOrThrow({ where: { id: runId } });
  if (!RETRYABLE_STATUSES.has(run.status)) {
    throw new ValidationError(`Cannot retry a run with status "${run.status}" — only failed or exhausted runs can be retried`);
  }
  return db.deliveryRun.update({
    where: { id: runId },
    data: { status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null },
  });
}
