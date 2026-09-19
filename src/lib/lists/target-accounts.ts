import type { PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/auth/permissions";
import {
  addListEntry,
  attachList,
  detachList,
  exportListCsv,
  importAndAttachList,
  importList,
  removeListEntry,
  type AddListEntryInput,
  type ImportAndAttachInput,
  type ImportResult,
} from "@/lib/lists/lists";

export type { ImportResult };

export type ImportTargetAccountsInput = {
  ownerOrganizationId: string;
  name: string;
  content: string;
  mapping: Record<string, string>;
  isReusable?: boolean;
};

export async function importTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  input: ImportTargetAccountsInput,
): Promise<ImportResult> {
  return importList(db, actor, { ...input, type: "targetAccounts" });
}

export async function attachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  listId: string,
): Promise<void> {
  return attachList(db, actor, campaignChannelId, listId);
}

export async function detachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<void> {
  return detachList(db, actor, campaignChannelId, "targetAccounts");
}

export type AddTargetAccountEntryInput = AddListEntryInput;

export async function addTargetAccountEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: AddTargetAccountEntryInput,
): Promise<{ entryId: string }> {
  return addListEntry(db, actor, campaignChannelId, "targetAccounts", input);
}

export async function removeTargetAccountEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  entryId: string,
): Promise<void> {
  return removeListEntry(db, actor, campaignChannelId, entryId);
}

export async function exportTargetAccountListCsv(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<string | null> {
  return exportListCsv(db, actor, campaignChannelId, "targetAccounts");
}

export type ImportAndAttachTargetAccountsInput = ImportAndAttachInput;

export async function importAndAttachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: ImportAndAttachTargetAccountsInput,
): Promise<ImportResult> {
  return importAndAttachList(db, actor, campaignChannelId, "targetAccounts", input);
}

/**
 * Cap resolution (SRS §4.3): the entry override wins if set, otherwise the
 * channel default applies, otherwise the account is uncapped. Matching is by
 * normalized domain — target-account entries no longer resolve to an
 * internal `Account`, so the whole domain is blocked/capped as a unit.
 */
export async function resolveAccountCap(
  db: PrismaClient,
  campaignChannelId: string,
  domain: string | null,
): Promise<number | null> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    select: { defaultMaxLeadsPerAccount: true },
  });
  if (channel === null) throw new NotFoundError("Campaign channel not found");

  if (domain !== null) {
    const link = await db.channelList.findFirst({ where: { campaignChannelId, list: { type: "targetAccounts" } } });
    if (link !== null) {
      const entry = await db.listEntry.findFirst({
        where: {
          listId: link.listId,
          accountNormalizedDomain: domain,
          maxLeadsPerAccountOverride: { not: null },
        },
        orderBy: { maxLeadsPerAccountOverride: "asc" },
      });
      if (entry?.maxLeadsPerAccountOverride != null) return entry.maxLeadsPerAccountOverride;
    }
  }

  return channel.defaultMaxLeadsPerAccount;
}
