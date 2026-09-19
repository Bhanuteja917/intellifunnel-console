import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { requireEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth/permissions";
import { normalizeDomain } from "@/lib/normalise/domain";
import { emailDomain } from "@/lib/normalise/email";
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

/**
 * Used for `DoNotContact.valueHash` (a separate, unrelated table — see
 * `lib/leads/matching.ts`'s `checkDoNotContact`), which still needs a salted
 * hash that survives anonymisation of the contact it was computed from. No
 * fallback: a hash written under a substituted salt can never be matched
 * against one written under the real salt.
 */
export function hashSuppressionValue(value: string): string {
  const salt = requireEnv("SUPPRESSION_HASH_SALT");
  return createHmac("sha256", salt).update(value).digest("hex");
}

export type ImportSuppressionInput = {
  ownerOrganizationId: string;
  name: string;
  content: string;
  mapping: Record<string, string>;
  isReusable?: boolean;
};

export async function importSuppressionList(
  db: PrismaClient,
  actor: Actor,
  input: ImportSuppressionInput,
): Promise<ImportResult> {
  return importList(db, actor, { ...input, type: "suppression" });
}

export async function attachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  listId: string,
): Promise<void> {
  return attachList(db, actor, campaignChannelId, listId);
}

export async function detachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<void> {
  return detachList(db, actor, campaignChannelId, "suppression");
}

export type AddSuppressionEntryInput = AddListEntryInput;

export async function addSuppressionEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: AddSuppressionEntryInput,
): Promise<{ entryId: string }> {
  return addListEntry(db, actor, campaignChannelId, "suppression", input);
}

export async function removeSuppressionEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  entryId: string,
): Promise<void> {
  return removeListEntry(db, actor, campaignChannelId, entryId);
}

export async function exportSuppressionListCsv(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<string | null> {
  return exportListCsv(db, actor, campaignChannelId, "suppression");
}

export type ImportAndAttachSuppressionInput = ImportAndAttachInput;

export async function importAndAttachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: ImportAndAttachSuppressionInput,
): Promise<ImportResult> {
  return importAndAttachList(db, actor, campaignChannelId, "suppression", input);
}

/**
 * Suppression now blocks a whole domain, not individual emails/contacts: a
 * candidate is suppressed if its domain (explicit, or derived from its
 * email) matches any entry's `accountNormalizedDomain` in a suppression list
 * attached to this channel.
 */
export async function isSuppressed(
  db: PrismaClient,
  campaignChannelId: string,
  candidate: { email?: string; domain?: string },
): Promise<boolean> {
  const links = await db.channelList.findMany({
    where: { campaignChannelId, list: { type: "suppression" } },
    select: { listId: true },
  });
  if (links.length === 0) return false;
  const listIds = links.map((l) => l.listId);

  const domain = candidate.domain !== undefined
    ? normalizeDomain(candidate.domain)
    : candidate.email !== undefined
      ? emailDomain(candidate.email)
      : null;
  if (domain === null) return false;

  const hit = await db.listEntry.findFirst({
    where: { listId: { in: listIds }, accountNormalizedDomain: domain },
    select: { id: true },
  });

  return hit !== null;
}
