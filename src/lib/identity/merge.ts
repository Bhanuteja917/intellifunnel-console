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

  const [source, target] = await Promise.all([
    db.account.findUnique({ where: { id: input.sourceAccountId } }),
    db.account.findUnique({ where: { id: input.targetAccountId } }),
  ]);
  if (source === null || target === null) throw new NotFoundError("Account not found");
  if (source.mergedIntoId !== null) throw new ValidationError("Source is already merged");
  if (target.mergedIntoId !== null) throw new ValidationError("Target is already merged");

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
      const contacts = await tx.contact.findMany({
        where: { accountId: source.id }, select: { id: true },
      });
      const aliases = await tx.accountAlias.findMany({
        where: { accountId: source.id }, select: { id: true },
      });
      const children = await tx.account.findMany({
        where: { parentAccountId: source.id }, select: { id: true },
      });

      await tx.contact.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
      await tx.accountAlias.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
      await tx.account.updateMany({
        where: { parentAccountId: source.id }, data: { parentAccountId: target.id },
      });

      // The source's domain must keep resolving, now to the target. Freeing it
      // from the source first respects the unique constraint on primaryDomain.
      let createdAliasId: string | null = null;
      if (source.primaryDomain !== null) {
        await tx.account.update({ where: { id: source.id }, data: { primaryDomain: null } });
        const alias = await tx.accountAlias.create({
          data: { accountId: target.id, value: source.primaryDomain, type: "domain" },
        });
        createdAliasId = alias.id;
      }

      await tx.account.update({
        where: { id: source.id },
        data: { mergedIntoId: target.id, updatedById: actor.userId },
      });

      const moved: MovedRecords = {
        contactIds: contacts.map((c) => c.id),
        aliasIds: aliases.map((a) => a.id),
        childAccountIds: children.map((c) => c.id),
        sourcePrimaryDomain: source.primaryDomain,
        createdAliasId,
      };

      const merge = await tx.accountMerge.create({
        data: {
          sourceAccountId: source.id,
          targetAccountId: target.id,
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

  const merge = await db.accountMerge.findUnique({ where: { id: mergeId } });
  if (merge === null) throw new NotFoundError("Merge record not found");
  if (merge.reversedAt !== null) throw new ValidationError("Merge is already reversed");

  const elapsedHours = (Date.now() - merge.mergedAt.getTime()) / 3_600_000;
  if (elapsedHours > ACCOUNT_MERGE_REVERSAL_HOURS) {
    throw new ValidationError(
      `Merges are reversible for ${ACCOUNT_MERGE_REVERSAL_HOURS} hours; this one is ${Math.floor(elapsedHours)} hours old`,
    );
  }

  const moved = merge.movedJson as MovedRecords;

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
      if (moved.createdAliasId !== null) {
        await tx.accountAlias.delete({ where: { id: moved.createdAliasId } });
      }
      await tx.contact.updateMany({
        where: { id: { in: moved.contactIds } }, data: { accountId: merge.sourceAccountId },
      });
      await tx.accountAlias.updateMany({
        where: { id: { in: moved.aliasIds } }, data: { accountId: merge.sourceAccountId },
      });
      await tx.account.updateMany({
        where: { id: { in: moved.childAccountIds } }, data: { parentAccountId: merge.sourceAccountId },
      });
      await tx.account.update({
        where: { id: merge.sourceAccountId },
        data: { mergedIntoId: null, primaryDomain: moved.sourcePrimaryDomain },
      });
      await tx.accountMerge.update({
        where: { id: mergeId },
        data: { reversedAt: new Date(), reversedById: actor.userId },
      });
    },
  );
}
