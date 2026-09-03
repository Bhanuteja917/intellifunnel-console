import type { PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export const ACCOUNT_MERGE_REVERSAL_HOURS = 72;

type MovedRecords = {
  contactIds: string[];
  aliasIds: string[];
  childAccountIds: string[];
  sourcePrimaryDomain: string | null;
  createdAliasId: string | null;
};

export async function mergeAccounts(
  db: PrismaClient,
  actor: Actor,
  input: { sourceAccountId: string; targetAccountId: string },
): Promise<{ mergeId: string }> {
  assertPermission(actor, "account:merge");
  if (input.sourceAccountId === input.targetAccountId) {
    throw new ValidationError("Cannot merge an account into itself");
  }

  // Fast-path check: verify accounts exist before entering transaction
  const [source, target] = await Promise.all([
    db.account.findUnique({ where: { id: input.sourceAccountId } }),
    db.account.findUnique({ where: { id: input.targetAccountId } }),
  ]);
  if (source === null || target === null) throw new NotFoundError("Account not found");

  const result = await withAudit<{ mergeId: string }>(
    db,
    actor,
    (merged) => ({
      entityType: "Account",
      entityId: input.sourceAccountId,
      action: "merge",
      before: { mergedIntoId: null, primaryDomain: source.primaryDomain },
      after: { mergedIntoId: input.targetAccountId, mergeId: merged.mergeId },
    }),
    async (tx) => {
      // Re-check inside transaction to close TOCTOU window
      const txSource = await tx.account.findUnique({ where: { id: input.sourceAccountId } });
      const txTarget = await tx.account.findUnique({ where: { id: input.targetAccountId } });
      if (txSource === null || txTarget === null) throw new NotFoundError("Account not found");
      if (txSource.mergedIntoId !== null) throw new ValidationError("Source is already merged");
      if (txTarget.mergedIntoId !== null) throw new ValidationError("Target is already merged");

      const contacts = await tx.contact.findMany({
        where: { accountId: txSource.id }, select: { id: true },
      });
      const aliases = await tx.accountAlias.findMany({
        where: { accountId: txSource.id }, select: { id: true },
      });
      const children = await tx.account.findMany({
        where: { parentAccountId: txSource.id }, select: { id: true },
      });

      await tx.contact.updateMany({ where: { accountId: txSource.id }, data: { accountId: txTarget.id } });
      await tx.accountAlias.updateMany({ where: { accountId: txSource.id }, data: { accountId: txTarget.id } });
      await tx.account.updateMany({
        where: { parentAccountId: txSource.id }, data: { parentAccountId: txTarget.id },
      });

      // The source's domain must keep resolving, now to the target. Freeing it
      // from the source first respects the unique constraint on primaryDomain.
      let createdAliasId: string | null = null;
      if (txSource.primaryDomain !== null) {
        await tx.account.update({ where: { id: txSource.id }, data: { primaryDomain: null } });
        const alias = await tx.accountAlias.create({
          data: { accountId: txTarget.id, value: txSource.primaryDomain, type: "domain" },
        });
        createdAliasId = alias.id;
      }

      await tx.account.update({
        where: { id: txSource.id },
        data: { mergedIntoId: txTarget.id, updatedById: actor.userId },
      });

      const moved: MovedRecords = {
        contactIds: contacts.map((c) => c.id),
        aliasIds: aliases.map((a) => a.id),
        childAccountIds: children.map((c) => c.id),
        sourcePrimaryDomain: txSource.primaryDomain,
        createdAliasId,
      };

      const merge = await tx.accountMerge.create({
        data: {
          sourceAccountId: txSource.id,
          targetAccountId: txTarget.id,
          movedJson: moved,
          mergedById: actor.userId,
        },
      });

      return { mergeId: merge.id };
    },
  );

  return result;
}

export async function unmergeAccounts(
  db: PrismaClient,
  actor: Actor,
  mergeId: string,
): Promise<void> {
  assertPermission(actor, "account:merge");

  // Fast-path check: fail early without opening a transaction. Every one of
  // these checks is repeated inside the transaction below, which is where they
  // actually hold — a check made here can go stale before the restore writes.
  const merge = await db.accountMerge.findUnique({ where: { id: mergeId } });
  if (merge === null) throw new NotFoundError("Merge record not found");
  if (merge.reversedAt !== null) throw new ValidationError("Merge is already reversed");

  const elapsedHours = (Date.now() - merge.mergedAt.getTime()) / 3_600_000;
  if (elapsedHours > ACCOUNT_MERGE_REVERSAL_HOURS) {
    throw new ValidationError(
      `Merges are reversible for ${ACCOUNT_MERGE_REVERSAL_HOURS} hours; this one is ${Math.floor(elapsedHours)} hours old`,
    );
  }

  await withAudit(
    db,
    actor,
    {
      entityType: "Account",
      entityId: merge.sourceAccountId,
      action: "unmerge",
      after: { mergeId },
    },
    async (tx) => {
      // Re-check inside the transaction, the same way mergeAccounts does:
      // a concurrent unmerge, or a second merge that moved the target away,
      // would otherwise let this restore yank records out of an account that
      // no longer holds them.
      const txMerge = await tx.accountMerge.findUnique({ where: { id: mergeId } });
      if (txMerge === null) throw new NotFoundError("Merge record not found");
      if (txMerge.reversedAt !== null) throw new ValidationError("Merge is already reversed");

      const txElapsedHours = (Date.now() - txMerge.mergedAt.getTime()) / 3_600_000;
      if (txElapsedHours > ACCOUNT_MERGE_REVERSAL_HOURS) {
        throw new ValidationError(
          `Merges are reversible for ${ACCOUNT_MERGE_REVERSAL_HOURS} hours; this one is ${Math.floor(txElapsedHours)} hours old`,
        );
      }

      const target = await tx.account.findUnique({ where: { id: txMerge.targetAccountId } });
      if (target === null) throw new NotFoundError("Target account not found");
      if (target.mergedIntoId !== null) {
        throw new ValidationError("Cannot reverse: the target account has since been merged into another account");
      }

      const moved = txMerge.movedJson as MovedRecords;

      if (moved.createdAliasId !== null) {
        await tx.accountAlias.delete({ where: { id: moved.createdAliasId } });
      }
      await tx.contact.updateMany({
        where: { id: { in: moved.contactIds } }, data: { accountId: txMerge.sourceAccountId },
      });
      await tx.accountAlias.updateMany({
        where: { id: { in: moved.aliasIds } }, data: { accountId: txMerge.sourceAccountId },
      });
      await tx.account.updateMany({
        where: { id: { in: moved.childAccountIds } }, data: { parentAccountId: txMerge.sourceAccountId },
      });
      await tx.account.update({
        where: { id: txMerge.sourceAccountId },
        data: { mergedIntoId: null, primaryDomain: moved.sourcePrimaryDomain },
      });

      // Guarded like state-machine.ts's applyTransition: the reversal only
      // lands if this transaction is the one that flips reversedAt, so two
      // concurrent unmerges cannot both restore the same moved records.
      const reversed = await tx.accountMerge.updateMany({
        where: { id: mergeId, reversedAt: null },
        data: { reversedAt: new Date(), reversedById: actor.userId },
      });
      if (reversed.count === 0) {
        throw new ValidationError("Merge was reversed concurrently");
      }
    },
  );
}
