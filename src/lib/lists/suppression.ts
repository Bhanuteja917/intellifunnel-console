import { createHmac } from "node:crypto";
import type { PrismaClient, SuppressionEntryType, SuppressionListType } from "@prisma/client";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { applyMapping, parseDelimited, type RowError } from "@/lib/lists/csv";
import { normalizeDomain } from "@/lib/normalise/domain";
import { emailDomain, normalizeEmail } from "@/lib/normalise/email";
import type { ImportResult } from "@/lib/lists/target-accounts";
import { assertDraftAndAccessible } from "@/lib/campaigns/crud";
import { resolveAccount } from "@/lib/identity/account-resolution";

const ENTRY_TYPES: readonly string[] = ["account", "domain", "email", "contact"];

/**
 * FR-CP-6: suppression entries are exempt from retention expiry, so the value
 * is also kept as a salted hash that survives anonymisation of the contact.
 */
export function hashSuppressionValue(value: string): string {
  const salt = process.env.SUPPRESSION_HASH_SALT ?? "development-salt";
  return createHmac("sha256", salt).update(value).digest("hex");
}

export type ImportSuppressionInput = {
  ownerOrganizationId: string;
  name: string;
  type: SuppressionListType;
  content: string;
  mapping: Record<string, string>;
  isReusable?: boolean;
};

export async function importSuppressionList(
  db: PrismaClient,
  actor: Actor,
  input: ImportSuppressionInput,
): Promise<ImportResult> {
  assertPermission(actor, "list:write");
  assertOrganizationAccess(actor, input.ownerOrganizationId);

  const parsed = parseDelimited(input.content);
  const errors: RowError[] = [];

  const list = await db.suppressionList.create({
    data: {
      ownerOrganizationId: input.ownerOrganizationId,
      name: input.name,
      type: input.type,
      isReusable: input.isReusable ?? true,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });

  const batch = await db.importBatch.create({
    data: {
      type: "suppression",
      uploadedById: actor.userId,
      organizationId: input.ownerOrganizationId,
      mappingJson: input.mapping,
      rowsTotal: parsed.rows.length,
      status: "processing",
    },
  });

  let accepted = 0;

  for (const [index, sourceRow] of parsed.rows.entries()) {
    const rowNumber = index + 1;
    const row = applyMapping(sourceRow, input.mapping);
    const rawType = row.type?.trim().toLowerCase() ?? "";
    const rawValue = row.value?.trim() ?? "";

    if (!ENTRY_TYPES.includes(rawType)) {
      errors.push({ rowNumber, field: "type", rawValue: rawType, message: `Unknown suppression type: ${rawType}` });
      continue;
    }

    if (rawType === "account") {
      // For account type, resolve via domain and require a match
      const match = await resolveAccount(db, { domain: rawValue });
      if (match.status !== "matched") {
        errors.push({
          rowNumber, field: "value", rawValue,
          message: `Could not resolve account for suppression: ${rawValue}`,
        });
        continue;
      }

      const normalizedValue = normalizeDomain(rawValue) ?? rawValue;
      await db.suppressionEntry.upsert({
        where: { listId_type_value: { listId: list.id, type: "account", value: normalizedValue } },
        update: {},
        create: {
          listId: list.id,
          type: "account" as const,
          value: normalizedValue,
          valueHash: hashSuppressionValue(normalizedValue),
          accountId: match.accountId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      accepted += 1;
      continue;
    }

    let value: string | null = null;
    try {
      value = rawType === "email" || rawType === "contact" ? normalizeEmail(rawValue) : normalizeDomain(rawValue);
    } catch {
      value = null;
    }

    if (value === null) {
      errors.push({ rowNumber, field: "value", rawValue, message: `Could not normalise value: ${rawValue}` });
      continue;
    }

    await db.suppressionEntry.upsert({
      where: { listId_type_value: { listId: list.id, type: rawType as SuppressionEntryType, value } },
      update: {},
      create: {
        listId: list.id,
        type: rawType as SuppressionEntryType,
        value,
        valueHash: hashSuppressionValue(value),
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    accepted += 1;
  }

  if (errors.length > 0) {
    await db.importError.createMany({ data: errors.map((error) => ({ batchId: batch.id, ...error })) });
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { rowsAccepted: accepted, rowsFailed: errors.length, status: "completed" },
  });

  return {
    batchId: batch.id,
    listId: list.id,
    rowsTotal: parsed.rows.length,
    rowsAccepted: accepted,
    rowsFailed: errors.length,
    errors,
  };
}

export async function attachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  listId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertDraftAndAccessible(db, actor, campaignId);

  await withAudit(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "attachSuppressionList", after: { listId } },
    async (tx) => {
      // Re-verify draft status inside the transaction: the outer check can go
      // stale if a client approval commits in the gap (FR-CS-2).
      await assertDraftAndAccessible(tx, actor, campaignId);

      await tx.campaignSuppressionList.create({
        data: {
          campaignId,
          listId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
    },
  );
}

export async function isSuppressed(
  db: PrismaClient,
  campaignId: string,
  candidate: { email?: string; domain?: string; accountId?: string },
): Promise<boolean> {
  const links = await db.campaignSuppressionList.findMany({
    where: { campaignId },
    select: { listId: true },
  });
  if (links.length === 0) return false;
  const listIds = links.map((l) => l.listId);

  const conditions: { type: SuppressionEntryType; value: string }[] = [];

  if (candidate.email !== undefined) {
    const email = normalizeEmail(candidate.email);
    conditions.push({ type: "email", value: email }, { type: "contact", value: email });
    const domain = emailDomain(candidate.email);
    if (domain !== null) conditions.push({ type: "domain", value: domain });
  }
  if (candidate.domain !== undefined) {
    const domain = normalizeDomain(candidate.domain);
    if (domain !== null) conditions.push({ type: "domain", value: domain });
  }
  if (conditions.length === 0 && candidate.accountId === undefined) return false;

  const hit = await db.suppressionEntry.findFirst({
    where: {
      listId: { in: listIds },
      OR: [
        ...conditions.map((c) => ({ type: c.type, value: c.value })),
        ...(candidate.accountId === undefined
          ? []
          : [{ type: "account" as const, accountId: candidate.accountId }]),
      ],
    },
    select: { id: true },
  });

  return hit !== null;
}
