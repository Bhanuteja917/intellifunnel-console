import type { ListType, PrismaClient } from "@prisma/client";
import Papa from "papaparse";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { applyMapping, parseDelimited, type RowError } from "@/lib/lists/csv";
import { normalizeDomain } from "@/lib/normalise/domain";
import { assertChannelDraftAndAccessible } from "@/lib/campaigns/crud";

function hasNameOrDomain(accountName: string | undefined, accountRawDomain: string | undefined): boolean {
  return !(
    (accountName === undefined || accountName === "") &&
    (accountRawDomain === undefined || accountRawDomain === "")
  );
}

export type ImportResult = {
  batchId: string;
  listId: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsFailed: number;
  errors: RowError[];
};

export type ImportListInput = {
  ownerOrganizationId: string;
  name: string;
  type: ListType;
  content: string;
  mapping: Record<string, string>;
  isReusable?: boolean;
};

export async function importList(
  db: PrismaClient,
  actor: Actor,
  input: ImportListInput,
): Promise<ImportResult> {
  assertPermission(actor, "list:write");
  assertOrganizationAccess(actor, input.ownerOrganizationId);

  const parsed = parseDelimited(input.content);
  const errors: RowError[] = [];

  const list = await db.list.create({
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
      type: input.type,
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
    const accountName = row.accountName?.trim();
    const accountRawDomain = row.accountRawDomain?.trim();

    if (!hasNameOrDomain(accountName, accountRawDomain)) {
      errors.push({ rowNumber, field: null, rawValue: null, message: "Row needs a name or domain" });
      continue;
    }

    const accountNormalizedDomain =
      accountRawDomain === undefined || accountRawDomain === "" ? null : normalizeDomain(accountRawDomain);

    const capRaw = row.maxLeadsPerAccountOverride?.trim();
    let cap: number | null = null;
    if (capRaw !== undefined && capRaw !== "") {
      const parsedCap = Number.parseInt(capRaw, 10);
      if (Number.isNaN(parsedCap) || parsedCap <= 0) {
        errors.push({
          rowNumber, field: "maxLeadsPerAccountOverride", rawValue: capRaw,
          message: "Cap override must be a positive integer",
        });
        continue;
      }
      cap = parsedCap;
    }

    await db.listEntry.create({
      data: {
        listId: list.id,
        accountName: accountName ?? null,
        accountRawDomain: accountRawDomain ?? null,
        accountNormalizedDomain,
        maxLeadsPerAccountOverride: cap,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    accepted += 1;
  }

  if (errors.length > 0) {
    await db.importError.createMany({
      data: errors.map((error) => ({ batchId: batch.id, ...error })),
    });
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

export async function attachList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  listId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  const list = await db.list.findUnique({ where: { id: listId }, select: { type: true } });
  if (list === null) throw new NotFoundError("List not found");

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "attachList", after: { listId, type: list.type } },
    async (tx) => {
      // Re-verify draft status inside the transaction: the outer check can go
      // stale if a client approval commits in the gap (FR-CS-2).
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      // One active list per type per channel: replace, don't accumulate. A
      // channel can hold a targetAccounts list and a suppression list at the
      // same time — only lists of the same type as the one being attached
      // are replaced.
      await tx.channelList.deleteMany({ where: { campaignChannelId, list: { type: list.type } } });
      await tx.channelList.create({
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

export async function detachList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  type: ListType,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "detachList", after: { type } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      await tx.channelList.deleteMany({ where: { campaignChannelId, list: { type } } });
    },
  );
}

export type AddListEntryInput = {
  accountName?: string;
  accountRawDomain?: string;
  maxLeadsPerAccountOverride?: number;
};

/**
 * Manual counterpart to `importList`'s per-row loop. Requires both
 * `list:write` (it may create a list) and `campaign:write` (it mutates
 * channel-scoped state), same split of concerns as import + attach.
 */
export async function addListEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  type: ListType,
  input: AddListEntryInput,
): Promise<{ entryId: string }> {
  assertPermission(actor, "list:write");
  assertPermission(actor, "campaign:write");
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  const accountName = input.accountName?.trim();
  const accountRawDomain = input.accountRawDomain?.trim();
  if (!hasNameOrDomain(accountName, accountRawDomain)) {
    throw new ValidationError("Row needs a name or domain");
  }
  if (
    input.maxLeadsPerAccountOverride !== undefined &&
    (!Number.isInteger(input.maxLeadsPerAccountOverride) || input.maxLeadsPerAccountOverride <= 0)
  ) {
    throw new ValidationError("Cap override must be a positive integer");
  }

  const accountNormalizedDomain =
    accountRawDomain === undefined || accountRawDomain === "" ? null : normalizeDomain(accountRawDomain);

  return withAudit(
    db,
    actor,
    (result: { entryId: string }) => ({
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "addListEntry",
      after: { entryId: result.entryId, type },
    }),
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      let link = await tx.channelList.findFirst({ where: { campaignChannelId, list: { type } } });
      if (link === null) {
        const list = await tx.list.create({
          data: {
            ownerOrganizationId: channel.campaign.clientOrganizationId,
            name: "Manual entries",
            type,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        link = await tx.channelList.create({
          data: { campaignChannelId, listId: list.id, createdById: actor.userId, updatedById: actor.userId },
        });
      }

      const entry = await tx.listEntry.create({
        data: {
          listId: link.listId,
          accountName: accountName ?? null,
          accountRawDomain: accountRawDomain ?? null,
          accountNormalizedDomain,
          maxLeadsPerAccountOverride: input.maxLeadsPerAccountOverride ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      return { entryId: entry.id };
    },
  );
}

export async function removeListEntry(
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
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "removeListEntry", after: { entryId } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      const links = await tx.channelList.findMany({ where: { campaignChannelId }, select: { listId: true } });
      const entry = await tx.listEntry.findUnique({ where: { id: entryId } });
      if (entry === null || !links.some((l) => l.listId === entry.listId)) {
        throw new NotFoundError("List entry not found on this channel");
      }
      await tx.listEntry.delete({ where: { id: entryId } });
    },
  );
}

export async function exportListCsv(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  type: ListType,
): Promise<string | null> {
  assertPermission(actor, "campaign:read");
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    select: { campaign: { select: { clientOrganizationId: true } } },
  });
  if (channel === null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  const link = await db.channelList.findFirst({ where: { campaignChannelId, list: { type } } });
  if (link === null) return null;

  const entries = await db.listEntry.findMany({
    where: { listId: link.listId },
    orderBy: { createdAt: "asc" },
  });
  return Papa.unparse(
    entries.map((e) => ({
      name: e.accountName ?? "",
      domain: e.accountRawDomain ?? "",
      ...(type === "targetAccounts" ? { maxLeadsPerAccountOverride: e.maxLeadsPerAccountOverride ?? "" } : {}),
    })),
  );
}

export type ImportAndAttachInput = {
  name: string;
  content: string;
  mapping: Record<string, string>;
};

/**
 * Combines `importList` (creates the list; needs `list:write`) and
 * `attachList` (links it to the channel; needs `campaign:write`) so the
 * upload server action stays a single call, the same way the CSV upload
 * dialog is a single user action.
 */
export async function importAndAttachList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  type: ListType,
  input: ImportAndAttachInput,
): Promise<ImportResult> {
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);
  const result = await importList(db, actor, {
    ownerOrganizationId: channel.campaign.clientOrganizationId,
    name: input.name,
    type,
    content: input.content,
    mapping: input.mapping,
  });
  await attachList(db, actor, campaignChannelId, result.listId);
  return result;
}
