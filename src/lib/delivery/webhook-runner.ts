import type { DeliveryRun, Prisma, PrismaClient } from "@prisma/client";
import { applyFieldMapping, type FieldMappingEntry } from "@/lib/delivery/field-mapping";
import { signPayload, toDeliverableRecord } from "@/lib/delivery/webhook";
import { logger } from "@/lib/logging/logger";

export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000] as const;

async function recordFailure(
  db: PrismaClient,
  run: DeliveryRun,
  now: Date,
  errorMessage: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const attemptCount = run.attemptCount + 1;
  const exhausted = attemptCount >= run.maxAttempts;
  await db.deliveryRun.update({
    where: { id: run.id },
    data: {
      attemptCount,
      lastError: errorMessage.slice(0, 500),
      requestPayloadJson: payload as Prisma.InputJsonValue,
      status: exhausted ? "exhausted" : "failed",
      nextRetryAt: exhausted ? null : new Date(now.getTime() + BACKOFF_MS[attemptCount - 1]!),
    },
  });
}

/**
 * Fires every webhook DeliveryRun that is due: pending (never attempted) or
 * failed with nextRetryAt in the past. One HTTP call per run, each wrapped in
 * its own try/catch so one unreachable endpoint can't block the rest of the
 * batch. Returns the count of runs attempted (not the count that succeeded).
 */
export async function fireDueWebhookRuns(
  db: PrismaClient,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const dueRuns = await db.deliveryRun.findMany({
    where: {
      method: "webhook",
      status: { in: ["pending", "failed"] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    include: { leads: { include: { lead: { include: { contact: true, account: true } } } } },
  });

  let attempted = 0;
  for (const run of dueRuns) {
    const config = await db.deliveryConfig.findUnique({ where: { campaignChannelId: run.campaignChannelId } });
    const runLead = run.leads[0];

    if (config === null || config.method !== "webhook" || runLead === undefined) {
      // Config deleted or reconfigured away from webhook after this run was created — nothing sane left
      // to retry against, ever. Terminal.
      await db.deliveryRun.update({ where: { id: run.id }, data: { status: "exhausted", lastError: "Delivery config missing or no longer webhook" } });
      continue;
    }

    if (config.status !== "active") {
      // Paused: this is usually temporary (e.g. the client's endpoint is down for maintenance) — leave
      // the run exactly as-is so it's retried on a later tick once the config is resumed, rather than
      // being killed off like a genuinely unrecoverable config.
      continue;
    }

    if (config.webhookUrl === null || config.webhookSecret === null) {
      // Active webhook config missing its own required fields — shouldn't happen given config.ts's
      // validate(), but if it does there's nothing sane left to retry against. Terminal.
      await db.deliveryRun.update({ where: { id: run.id }, data: { status: "exhausted", lastError: "Delivery config missing webhookUrl or webhookSecret" } });
      continue;
    }

    const mapping = config.fieldMappingJson as unknown as FieldMappingEntry[];
    const record = toDeliverableRecord(runLead.lead);
    const payload = applyFieldMapping(mapping, record);
    const body = JSON.stringify(payload);
    const signature = signPayload(config.webhookSecret, body);

    attempted++;
    try {
      const response = await fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Delivery-Signature": signature,
          "X-Delivery-Run-Id": run.id,
        },
        body,
      });
      if (response.ok) {
        await db.deliveryRun.update({
          where: { id: run.id },
          data: { status: "success", completedAt: now, requestPayloadJson: payload as Prisma.InputJsonValue },
        });
      } else {
        await recordFailure(db, run, now, `HTTP ${response.status}`, payload);
      }
    } catch (error) {
      logger.warn("delivery.webhook.failed", { runId: run.id, error: error instanceof Error ? error.message : String(error) });
      await recordFailure(db, run, now, error instanceof Error ? error.message : String(error), payload);
    }
  }
  return attempted;
}
