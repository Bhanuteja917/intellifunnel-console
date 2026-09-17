import { createHmac } from "node:crypto";
import type { PrismaClient, SuppressionEntryType, SuppressionListType } from "@prisma/client";
import Papa from "papaparse";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { requireEnv } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { applyMapping, parseDelimited, type RowError } from "@/lib/lists/csv";
import { normalizeDomain } from "@/lib/normalise/domain";
import { emailDomain, normalizeEmail } from "@/lib/normalise/email";
import type { ImportResult } from "@/lib/lists/target-accounts";
import { assertChannelDraftAndAccessible } from "@/lib/campaigns/crud";
import { resolveAccount } from "@/lib/identity/account-resolution";

const ENTRY_TYPES: readonly string[] = ["account", "domain", "email", "contact"];

/**
 * FR-CP-6: suppression entries are exempt from retention expiry, so the value
 * is also kept as a salted hash that survives anonymisation of the contact.
 *
 * The salt is required, with no fallback. Every import writes these hashes
 * today, and a hash written under a substituted salt can never be matched
 * against one written under the real salt — the damage is silent, permanent
 * and only discovered by the phase that starts reading valueHash.
 */
export function hashSuppressionValue(value: string): string {
  const salt = requireEnv("SUPPRESSION_HASH_SALT");
  return createHmac("sha256", salt).update(value).digest("hex");
}

type SuppressionValueResolution =
  | { ok: true; value: string; accountId?: string }
  | { ok: false; message: string };

async function resolveSuppressionValue(
  db: PrismaClient,
  type: SuppressionEntryType,
  rawValue: string,
): Promise<SuppressionValueResolution> {
  if (type === "account") {
    const match = await resolveAccount(db, { domain: rawValue });
    if (match.status !== "matched") {
      return { ok: false, message: `Could not resolve account for suppression: ${rawValue}` };
    }
    return { ok: true, value: normalizeDomain(rawValue) ?? rawValue, accountId: match.accountId };
  }

  let value: string | null = null;
  try {
    value = type === "email" || type === "contact" ? normalizeEmail(rawValue) : normalizeDomain(rawValue);
  } catch {
    value = null;
  }
  if (value === null) {
    return { ok: false, message: `Could not normalise value: ${rawValue}` };
  }
  return { ok: true, value };
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

    const type = rawType as SuppressionEntryType;
    const resolution = await resolveSuppressionValue(db, type, rawValue);
    if (!resolution.ok) {
      errors.push({ rowNumber, field: "value", rawValue, message: resolution.message });
      continue;
    }

    await db.suppressionEntry.upsert({
      where: { listId_type_value: { listId: list.id, type, value: resolution.value } },
      update: {},
      create: {
        listId: list.id,
        type,
        value: resolution.value,
        valueHash: hashSuppressionValue(resolution.value),
        accountId: resolution.accountId,
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
  campaignChannelId: string,
  listId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "attachSuppressionList", after: { listId } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      await tx.channelSuppressionList.deleteMany({ where: { campaignChannelId } });
      await tx.channelSuppressionList.create({
        data: {
          campaignChannelId,
          listId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
    },
  );
}

export async function detachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "detachSuppressionList" },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      await tx.channelSuppressionList.deleteMany({ where: { campaignChannelId } });
    },
  );
}

export type AddSuppressionEntryInput = { type: SuppressionEntryType; value: string };

/**
 * Manual counterpart to `importSuppressionList`'s per-row loop, one entry at
 * a time. Requires both `list:write` (it may create a list) and
 * `campaign:write` (it mutates channel-scoped state).
 */
export async function addSuppressionEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: AddSuppressionEntryInput,
): Promise<{ entryId: string }> {
  assertPermission(actor, "list:write");
  assertPermission(actor, "campaign:write");
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  const rawValue = input.value.trim();
  const resolution = await resolveSuppressionValue(db, input.type, rawValue);
  if (!resolution.ok) throw new ValidationError(resolution.message);
  const value = resolution.value;
  const accountId = resolution.accountId;

  return withAudit(
    db,
    actor,
    (result: { entryId: string }) => ({
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "addSuppressionEntry",
      after: { entryId: result.entryId },
    }),
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      let link = await tx.channelSuppressionList.findFirst({ where: { campaignChannelId } });
      if (link === null) {
        const list = await tx.suppressionList.create({
          data: {
            ownerOrganizationId: channel.campaign.clientOrganizationId,
            name: "Manual entries",
            type: "custom",
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        link = await tx.channelSuppressionList.create({
          data: { campaignChannelId, listId: list.id, createdById: actor.userId, updatedById: actor.userId },
        });
      }

      const entry = await tx.suppressionEntry.upsert({
        where: { listId_type_value: { listId: link.listId, type: input.type, value } },
        update: {},
        create: {
          listId: link.listId,
          type: input.type,
          value,
          valueHash: hashSuppressionValue(value),
          accountId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      return { entryId: entry.id };
    },
  );
}

export async function removeSuppressionEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  entryId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "removeSuppressionEntry", after: { entryId } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      const link = await tx.channelSuppressionList.findFirst({ where: { campaignChannelId } });
      if (link === null) throw new NotFoundError("No suppression list attached to this channel");
      const entry = await tx.suppressionEntry.findUnique({ where: { id: entryId } });
      if (entry === null || entry.listId !== link.listId) {
        throw new NotFoundError("Suppression entry not found on this channel");
      }
      await tx.suppressionEntry.delete({ where: { id: entryId } });
    },
  );
}

export async function exportSuppressionListCsv(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<string | null> {
  assertPermission(actor, "campaign:read");
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    select: { campaign: { select: { clientOrganizationId: true } } },
  });
  if (channel === null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  const link = await db.channelSuppressionList.findFirst({ where: { campaignChannelId } });
  if (link === null) return null;

  const entries = await db.suppressionEntry.findMany({
    where: { listId: link.listId },
    orderBy: { createdAt: "asc" },
  });
  // Never export valueHash — it exists for post-anonymisation matching
  // (FR-CP-6), not for a client-facing download.
  return Papa.unparse(entries.map((e) => ({ type: e.type, value: e.value })));
}

export type ImportAndAttachSuppressionInput = {
  name: string;
  type: SuppressionListType;
  content: string;
  mapping: Record<string, string>;
};

export async function importAndAttachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: ImportAndAttachSuppressionInput,
): Promise<ImportResult> {
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);
  const result = await importSuppressionList(db, actor, {
    ownerOrganizationId: channel.campaign.clientOrganizationId,
    name: input.name,
    type: input.type,
    content: input.content,
    mapping: input.mapping,
  });
  await attachSuppressionList(db, actor, campaignChannelId, result.listId);
  return result;
}

export async function isSuppressed(
  db: PrismaClient,
  campaignChannelId: string,
  candidate: { email?: string; domain?: string; accountId?: string },
): Promise<boolean> {
  const links = await db.channelSuppressionList.findMany({
    where: { campaignChannelId },
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
