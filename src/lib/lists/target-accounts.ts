import type { Prisma, PrismaClient } from "@prisma/client";
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
import { resolveAccount } from "@/lib/identity/account-resolution";
import { assertChannelDraftAndAccessible } from "@/lib/campaigns/crud";

export type ImportTargetAccountsInput = {
  ownerOrganizationId: string;
  name: string;
  content: string;
  mapping: Record<string, string>;
  isReusable?: boolean;
};

export type ImportResult = {
  batchId: string;
  listId: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsFailed: number;
  errors: RowError[];
};

export async function importTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  input: ImportTargetAccountsInput,
): Promise<ImportResult> {
  assertPermission(actor, "list:write");
  assertOrganizationAccess(actor, input.ownerOrganizationId);

  const parsed = parseDelimited(input.content);
  const errors: RowError[] = [];

  const list = await db.targetAccountList.create({
    data: {
      ownerOrganizationId: input.ownerOrganizationId,
      name: input.name,
      isReusable: input.isReusable ?? true,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });

  const batch = await db.importBatch.create({
    data: {
      type: "targetAccounts",
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
    const rawName = row.rawName?.trim();
    const rawDomain = row.rawDomain?.trim();

    if ((rawName === undefined || rawName === "") && (rawDomain === undefined || rawDomain === "")) {
      errors.push({ rowNumber, field: null, rawValue: null, message: "Row needs a name or domain" });
      continue;
    }

    const normalizedDomain = rawDomain === undefined || rawDomain === "" ? null : normalizeDomain(rawDomain);

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

    // FR-ID-2: an ambiguous entry is recorded as ambiguous with its candidates
    // and lands in the admin resolution queue. It is never guessed.
    const match = await resolveAccount(db, {
      name: rawName,
      domain: rawDomain,
      country: row.country?.trim(),
    });

    await db.targetAccountEntry.create({
      data: {
        listId: list.id,
        rawName: rawName ?? null,
        rawDomain: rawDomain ?? null,
        normalizedDomain,
        accountId: match.status === "matched" ? match.accountId : null,
        matchStatus: match.status,
        candidateAccountIdsJson:
          match.status === "ambiguous" ? (match.candidateIds as Prisma.InputJsonValue) : undefined,
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

export async function attachTargetAccountList(
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
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "attachTargetAccountList", after: { listId } },
    async (tx) => {
      // Re-verify draft status inside the transaction: the outer check can go
      // stale if a client approval commits in the gap (FR-CS-2).
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      // One active list per channel: replace, don't accumulate.
      await tx.channelTargetAccountList.deleteMany({ where: { campaignChannelId } });
      await tx.channelTargetAccountList.create({
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

export async function detachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "detachTargetAccountList" },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      await tx.channelTargetAccountList.deleteMany({ where: { campaignChannelId } });
    },
  );
}

export type AddTargetAccountEntryInput = {
  rawName?: string;
  rawDomain?: string;
  country?: string;
  maxLeadsPerAccountOverride?: number;
};

/**
 * Manual counterpart to `importTargetAccountList`'s per-row loop. Requires
 * both `list:write` (it may create a list) and `campaign:write` (it mutates
 * channel-scoped state), same split of concerns as import + attach.
 */
export async function addTargetAccountEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: AddTargetAccountEntryInput,
): Promise<{ entryId: string }> {
  assertPermission(actor, "list:write");
  assertPermission(actor, "campaign:write");
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  const rawName = input.rawName?.trim();
  const rawDomain = input.rawDomain?.trim();
  if ((rawName === undefined || rawName === "") && (rawDomain === undefined || rawDomain === "")) {
    throw new ValidationError("Row needs a name or domain");
  }
  if (
    input.maxLeadsPerAccountOverride !== undefined &&
    (!Number.isInteger(input.maxLeadsPerAccountOverride) || input.maxLeadsPerAccountOverride <= 0)
  ) {
    throw new ValidationError("Cap override must be a positive integer");
  }

  const normalizedDomain = rawDomain === undefined || rawDomain === "" ? null : normalizeDomain(rawDomain);
  const match = await resolveAccount(db, { name: rawName, domain: rawDomain, country: input.country?.trim() });

  return withAudit(
    db,
    actor,
    (result: { entryId: string }) => ({
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "addTargetAccountEntry",
      after: { entryId: result.entryId },
    }),
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      let link = await tx.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
      if (link === null) {
        const list = await tx.targetAccountList.create({
          data: {
            ownerOrganizationId: channel.campaign.clientOrganizationId,
            name: "Manual entries",
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        link = await tx.channelTargetAccountList.create({
          data: { campaignChannelId, listId: list.id, createdById: actor.userId, updatedById: actor.userId },
        });
      }

      const entry = await tx.targetAccountEntry.create({
        data: {
          listId: link.listId,
          rawName: rawName ?? null,
          rawDomain: rawDomain ?? null,
          normalizedDomain,
          accountId: match.status === "matched" ? match.accountId : null,
          matchStatus: match.status,
          candidateAccountIdsJson:
            match.status === "ambiguous" ? (match.candidateIds as Prisma.InputJsonValue) : undefined,
          maxLeadsPerAccountOverride: input.maxLeadsPerAccountOverride ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      return { entryId: entry.id };
    },
  );
}

export async function removeTargetAccountEntry(
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
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "removeTargetAccountEntry", after: { entryId } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      const link = await tx.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
      if (link === null) throw new NotFoundError("No target account list attached to this channel");
      const entry = await tx.targetAccountEntry.findUnique({ where: { id: entryId } });
      if (entry === null || entry.listId !== link.listId) {
        throw new NotFoundError("Target account entry not found on this channel");
      }
      await tx.targetAccountEntry.delete({ where: { id: entryId } });
    },
  );
}

export async function exportTargetAccountListCsv(
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

  const link = await db.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
  if (link === null) return null;

  const entries = await db.targetAccountEntry.findMany({
    where: { listId: link.listId },
    orderBy: { createdAt: "asc" },
  });
  return Papa.unparse(
    entries.map((e) => ({
      name: e.rawName ?? "",
      domain: e.rawDomain ?? "",
      matchStatus: e.matchStatus,
      maxLeadsPerAccountOverride: e.maxLeadsPerAccountOverride ?? "",
    })),
  );
}

export type ImportAndAttachInput = {
  name: string;
  content: string;
  mapping: Record<string, string>;
};

/**
 * Combines `importTargetAccountList` (creates the list; needs `list:write`)
 * and `attachTargetAccountList` (links it to the channel; needs
 * `campaign:write`) so the upload server action stays a single call, the same
 * way the CSV upload dialog is a single user action.
 */
export async function importAndAttachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: ImportAndAttachInput,
): Promise<ImportResult> {
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);
  const result = await importTargetAccountList(db, actor, {
    ownerOrganizationId: channel.campaign.clientOrganizationId,
    name: input.name,
    content: input.content,
    mapping: input.mapping,
  });
  await attachTargetAccountList(db, actor, campaignChannelId, result.listId);
  return result;
}

/**
 * Cap resolution (SRS §4.3): the entry override wins if set, otherwise the
 * channel default applies, otherwise the account is uncapped.
 */
export async function resolveAccountCap(
  db: PrismaClient,
  campaignChannelId: string,
  accountId: string,
): Promise<number | null> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    select: { defaultMaxLeadsPerAccount: true },
  });
  if (channel === null) throw new NotFoundError("Campaign channel not found");

  const link = await db.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
  if (link !== null) {
    const entry = await db.targetAccountEntry.findFirst({
      where: {
        listId: link.listId,
        accountId,
        maxLeadsPerAccountOverride: { not: null },
      },
      orderBy: { maxLeadsPerAccountOverride: "asc" },
    });
    if (entry?.maxLeadsPerAccountOverride != null) return entry.maxLeadsPerAccountOverride;
  }

  return channel.defaultMaxLeadsPerAccount;
}
