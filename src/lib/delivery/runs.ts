import type { Prisma } from "@prisma/client";

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
