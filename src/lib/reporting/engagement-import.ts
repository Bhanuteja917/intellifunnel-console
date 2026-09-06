import type { PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { parseDelimited, type RowError } from "@/lib/lists/csv";

export type ImportEngagementEventsInput = { fileContent: string };

export type ImportEngagementEventsResult = {
  batchId: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsFailed: number;
  errors: RowError[];
};

type ValidRow = { assetPlacementId: string; date: Date; impressions: number; conversions: number };

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const trimmed = raw.trim();
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value < 0 || String(value) !== trimmed) return null;
  return value;
}

export async function importEngagementEvents(
  db: PrismaClient,
  actor: Actor,
  input: ImportEngagementEventsInput,
): Promise<ImportEngagementEventsResult> {
  assertPermission(actor, "report:write");

  const parsed = parseDelimited(input.fileContent);
  const errors: RowError[] = [];
  const validRows: ValidRow[] = [];

  for (const [index, row] of parsed.rows.entries()) {
    const rowNumber = index + 1;
    const rawPlacementId = row.assetPlacementId?.trim();
    const rawFormSlug = row.formSlug?.trim();

    let assetPlacementId: string;
    if (rawPlacementId !== undefined && rawPlacementId !== "") {
      assetPlacementId = rawPlacementId;
    } else if (rawFormSlug !== undefined && rawFormSlug !== "") {
      const placement = await db.assetPlacement.findUnique({ where: { formSlug: rawFormSlug } });
      if (placement === null) {
        errors.push({ rowNumber, field: "formSlug", rawValue: rawFormSlug, message: "Unknown formSlug" });
        continue;
      }
      assetPlacementId = placement.id;
    } else {
      errors.push({ rowNumber, field: null, rawValue: null, message: "Row needs assetPlacementId or formSlug" });
      continue;
    }

    const rawDate = row.date?.trim();
    const dateMs = rawDate !== undefined ? Date.parse(rawDate) : Number.NaN;
    if (Number.isNaN(dateMs)) {
      errors.push({ rowNumber, field: "date", rawValue: rawDate ?? null, message: "Date is not parseable" });
      continue;
    }

    const impressions = parseNonNegativeInt(row.impressions);
    if (impressions === null) {
      errors.push({
        rowNumber, field: "impressions", rawValue: row.impressions ?? null,
        message: "Impressions must be a non-negative integer",
      });
      continue;
    }

    const conversions = parseNonNegativeInt(row.conversions);
    if (conversions === null) {
      errors.push({
        rowNumber, field: "conversions", rawValue: row.conversions ?? null,
        message: "Conversions must be a non-negative integer",
      });
      continue;
    }

    validRows.push({ assetPlacementId, date: new Date(dateMs), impressions, conversions });
  }

  const batch = await db.importBatch.create({
    data: {
      type: "metrics",
      uploadedById: actor.userId,
      organizationId: actor.organizationId,
      mappingJson: {},
      rowsTotal: parsed.rows.length,
      status: "processing",
    },
  });

  if (validRows.length > 0) {
    await db.$transaction(
      validRows.map((row) =>
        db.engagementEvent.upsert({
          where: { assetPlacementId_date: { assetPlacementId: row.assetPlacementId, date: row.date } },
          create: { ...row, importBatchId: batch.id },
          update: { impressions: row.impressions, conversions: row.conversions, importBatchId: batch.id },
        }),
      ),
    );
  }

  if (errors.length > 0) {
    await db.importError.createMany({ data: errors.map((error) => ({ batchId: batch.id, ...error })) });
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { rowsAccepted: validRows.length, rowsFailed: errors.length, status: "completed" },
  });

  return {
    batchId: batch.id,
    rowsTotal: parsed.rows.length,
    rowsAccepted: validRows.length,
    rowsFailed: errors.length,
    errors,
  };
}
