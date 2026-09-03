import type { MatchStatus, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";

export type UnresolvedEntry = {
  id: string;
  listId: string;
  listName: string;
  rawName: string | null;
  rawDomain: string | null;
  matchStatus: MatchStatus;
  candidateAccountIds: string[];
};

export async function listUnresolvedEntries(
  db: PrismaClient,
  actor: Actor,
  filter: { organizationId?: string; listId?: string; limit?: number; cursor?: string } = {},
): Promise<{ entries: UnresolvedEntry[]; nextCursor: string | null }> {
  // The queue is an internal tool: it exposes accounts across every client.
  assertPermission(actor, "account:write");

  const limit = filter.limit ?? 50;
  const where: Prisma.TargetAccountEntryWhereInput = {
    matchStatus: { in: ["unmatched", "ambiguous"] },
    ...(filter.listId === undefined ? {} : { listId: filter.listId }),
    ...(filter.organizationId === undefined
      ? {}
      : { list: { ownerOrganizationId: filter.organizationId } }),
  };

  // NFR-P-1: cursor-based paging, never offset.
  const rows = await db.targetAccountEntry.findMany({
    where,
    include: { list: { select: { name: true } } },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(filter.cursor === undefined ? {} : { cursor: { id: filter.cursor }, skip: 1 }),
  });

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;

  return {
    entries: page.map((row) => ({
      id: row.id,
      listId: row.listId,
      listName: row.list.name,
      rawName: row.rawName,
      rawDomain: row.rawDomain,
      matchStatus: row.matchStatus,
      candidateAccountIds: (row.candidateAccountIdsJson as string[] | null) ?? [],
    })),
    nextCursor,
  };
}

/**
 * The validity a match must still have at the moment it is written: the
 * account exists, is not soft-deleted, and has not been merged away since the
 * match was computed. Called with `tx` so the check and the write commit
 * together — a merge landing in between would otherwise point an entry at an
 * account that no longer resolves.
 */
async function assertAccountStillLinkable(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<void> {
  const account = await tx.account.findUnique({ where: { id: accountId } });
  if (account === null || account.deletedAt !== null) throw new NotFoundError("Account not found");
  if (account.mergedIntoId !== null) throw new ValidationError("Account has been merged away");
}

export async function resolveEntryToAccount(
  db: PrismaClient,
  actor: Actor,
  entryId: string,
  accountId: string,
): Promise<void> {
  assertPermission(actor, "account:write");

  const entry = await db.targetAccountEntry.findUnique({ where: { id: entryId } });
  if (entry === null) throw new NotFoundError("Target account entry not found");

  await withAudit(
    db,
    actor,
    {
      entityType: "TargetAccountEntry",
      entityId: entryId,
      action: "resolve",
      before: { matchStatus: entry.matchStatus, accountId: entry.accountId },
      after: { matchStatus: "matched", accountId },
    },
    async (tx) => {
      await assertAccountStillLinkable(tx, accountId);

      await tx.targetAccountEntry.update({
        where: { id: entryId },
        data: { accountId, matchStatus: "matched", candidateAccountIdsJson: Prisma.DbNull },
      });
    },
  );
}

export async function resolveEntryByCreatingAccount(
  db: PrismaClient,
  actor: Actor,
  entryId: string,
): Promise<{ accountId: string }> {
  assertPermission(actor, "account:write");

  const entry = await db.targetAccountEntry.findUnique({ where: { id: entryId } });
  if (entry === null) throw new NotFoundError("Target account entry not found");
  if (entry.rawName === null && entry.rawDomain === null) {
    throw new ValidationError("Entry has neither a name nor a domain to create an account from");
  }

  const account = await createAccount(db, actor, {
    name: entry.rawName ?? entry.rawDomain ?? "Unnamed account",
    domain: entry.rawDomain ?? undefined,
  });

  await resolveEntryToAccount(db, actor, entryId, account.id);
  return { accountId: account.id };
}

/** Re-runs matching, for use after new accounts have been created. */
export async function rematchEntry(
  db: PrismaClient,
  actor: Actor,
  entryId: string,
): Promise<MatchStatus> {
  assertPermission(actor, "account:write");

  const entry = await db.targetAccountEntry.findUnique({ where: { id: entryId } });
  if (entry === null) throw new NotFoundError("Target account entry not found");

  const match = await resolveAccount(db, {
    name: entry.rawName ?? undefined,
    domain: entry.rawDomain ?? undefined,
  });

  await withAudit(
    db,
    actor,
    {
      entityType: "TargetAccountEntry",
      entityId: entryId,
      action: "rematch",
      before: { matchStatus: entry.matchStatus, accountId: entry.accountId },
      after: { matchStatus: match.status, accountId: match.status === "matched" ? match.accountId : null },
    },
    async (tx) => {
      // `resolveAccount` above ran outside any transaction, so re-verify the
      // account it picked is still linkable before writing it — the same
      // check resolveEntryToAccount makes for a manually chosen account.
      if (match.status === "matched") {
        await assertAccountStillLinkable(tx, match.accountId);
      }

      await tx.targetAccountEntry.update({
        where: { id: entryId },
        data: {
          matchStatus: match.status,
          accountId: match.status === "matched" ? match.accountId : null,
          candidateAccountIdsJson:
            match.status === "ambiguous" ? (match.candidateIds as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
    },
  );

  return match.status;
}
