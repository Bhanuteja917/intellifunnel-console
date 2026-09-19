import Papa from "papaparse";
import type { PrismaClient } from "@prisma/client";
import { getSetting } from "@/lib/settings/settings";
import { isCsvRunDue } from "@/lib/delivery/cron";
import { applyFieldMapping, type FieldMappingEntry } from "@/lib/delivery/field-mapping";
import { toDeliverableRecord } from "@/lib/delivery/webhook";
import type { StorageAdapter } from "@/lib/storage/types";
import { logger } from "@/lib/logging/logger";

/**
 * Generates one CSV DeliveryRun per active csv DeliveryConfig whose cron
 * schedule is due, covering every clientVisible lead accepted since the
 * config's lastCsvCursorAt watermark. The file write happens before the
 * transaction that records the run and advances the cursor — a crash between
 * the two leaves an orphaned storage object (acceptable) but never a lost or
 * duplicated lead, since the cursor only moves on commit.
 */
export async function generateDueCsvRuns(
  db: PrismaClient,
  now: Date,
  storage: StorageAdapter,
): Promise<number> {
  const timeZone = getSetting("operatingTimezone");
  const configs = await db.deliveryConfig.findMany({ where: { method: "csv", status: "active" } });

  let generated = 0;
  for (const config of configs) {
    try {
      if (config.csvScheduleCron === null) continue;

      const lastRun = await db.deliveryRun.findFirst({
        where: { campaignChannelId: config.campaignChannelId, method: "csv", status: "success" },
        orderBy: { completedAt: "desc" },
      });
      if (!isCsvRunDue(config.csvScheduleCron, lastRun?.completedAt ?? null, now, timeZone)) continue;

      const cursor = config.lastCsvCursorAt;
      const leads = await db.lead.findMany({
        where: {
          campaignChannelId: config.campaignChannelId,
          clientVisible: true,
          acceptedAt: cursor === null ? { not: null } : { gt: cursor },
        },
        include: { contact: true, account: true },
        orderBy: { acceptedAt: "asc" },
      });
      if (leads.length === 0) continue;

      const mapping = config.fieldMappingJson as unknown as FieldMappingEntry[];
      const rows = leads.map((lead) => applyFieldMapping(mapping, toDeliverableRecord(lead)));
      const csvBody = Papa.unparse(rows);
      const key = `delivery/${config.campaignChannelId}/${now.toISOString()}.csv`;
      await storage.put(key, Buffer.from(csvBody, "utf-8"), "text/csv");

      const latestAcceptedAt = leads[leads.length - 1]!.acceptedAt!;
      await db.$transaction(async (tx) => {
        const run = await tx.deliveryRun.create({
          data: {
            campaignChannelId: config.campaignChannelId,
            method: "csv",
            status: "success",
            fileUrl: key,
            startedAt: now,
            completedAt: now,
          },
        });
        await tx.deliveryRunLead.createMany({
          data: leads.map((lead) => ({ deliveryRunId: run.id, leadId: lead.id })),
        });
        await tx.deliveryConfig.update({ where: { id: config.id }, data: { lastCsvCursorAt: latestAcceptedAt } });
      });
      generated++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("delivery.csv.failed", {
        campaignChannelId: config.campaignChannelId,
        error: errorMessage,
      });
      // Make the failure admin-visible in the run log (E11 design spec scope decision 6), same as a
      // webhook failure would be — without this, a permanently-failing CSV config shows nothing at
      // all in the run log no matter how many times generation fails. A fresh, unrelated create, so it
      // shouldn't itself throw, but it's wrapped defensively anyway so it can never abort the batch.
      try {
        await db.deliveryRun.create({
          data: {
            campaignChannelId: config.campaignChannelId,
            method: "csv",
            status: "failed",
            lastError: errorMessage.slice(0, 500),
            startedAt: now,
          },
        });
      } catch (createError) {
        logger.warn("delivery.csv.failed_run_record_failed", {
          campaignChannelId: config.campaignChannelId,
          error: createError instanceof Error ? createError.message : String(createError),
        });
      }
    }
  }
  return generated;
}
