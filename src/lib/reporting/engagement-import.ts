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

  // Both placement references are resolved up front, in two batched queries,
  // for two reasons. (1) Correctness: an `assetPlacementId` taken on trust
  // reaches `engagementEvent.upsert` inside the `$transaction` below and
  // throws a raw Prisma FK violation, which rolls back every *good* row in
  // the same upload and leaves the `ImportBatch` stuck at "processing" —
  // breaking this module's partial-success contract (one bad row never blocks
  // the rest of the file) and escaping `toActionResult` as an unhandled 500.
  // Every id must therefore be checked against the DB, exactly as `formSlug`
  // already was. (2) Doing that check per row would be an N+1, so both
  // lookups are one `findMany` each and the row loop only consults a Set/Map.
  const requestedIds = new Set<string>();
  const requestedSlugs = new Set<string>();
  for (const row of parsed.rows) {
    const rawPlacementId = row.assetPlacementId?.trim();
    const rawFormSlug = row.formSlug?.trim();
    if (rawPlacementId !== undefined && rawPlacementId !== "") requestedIds.add(rawPlacementId);
    else if (rawFormSlug !== undefined && rawFormSlug !== "") requestedSlugs.add(rawFormSlug);
  }

  const knownPlacements = requestedIds.size > 0 || requestedSlugs.size > 0
    ? await db.assetPlacement.findMany({
        where: {
          OR: [
            ...(requestedIds.size > 0 ? [{ id: { in: [...requestedIds] } }] : []),
            ...(requestedSlugs.size > 0 ? [{ formSlug: { in: [...requestedSlugs] } }] : []),
          ],
        },
        select: { id: true, formSlug: true },
      })
    : [];
  const validPlacementIds = new Set(knownPlacements.map((p) => p.id));
  const placementIdBySlug = new Map(knownPlacements.map((p) => [p.formSlug, p.id]));

  for (const [index, row] of parsed.rows.entries()) {
    const rowNumber = index + 1;
    const rawPlacementId = row.assetPlacementId?.trim();
    const rawFormSlug = row.formSlug?.trim();

    let assetPlacementId: string;
    if (rawPlacementId !== undefined && rawPlacementId !== "") {
      if (!validPlacementIds.has(rawPlacementId)) {
        errors.push({
          rowNumber, field: "assetPlacementId", rawValue: rawPlacementId,
          message: "Unknown assetPlacementId",
        });
        continue;
      }
      assetPlacementId = rawPlacementId;
    } else if (rawFormSlug !== undefined && rawFormSlug !== "") {
      const resolved = placementIdBySlug.get(rawFormSlug);
      if (resolved === undefined) {
        errors.push({ rowNumber, field: "formSlug", rawValue: rawFormSlug, message: "Unknown formSlug" });
        continue;
      }
      assetPlacementId = resolved;
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
