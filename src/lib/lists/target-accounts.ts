import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";
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
