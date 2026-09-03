import type { Account, Prisma, PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { normalizeDomain } from "@/lib/normalise/domain";
import { normalizeCompanyName } from "@/lib/normalise/name";

export type AccountMatch =
  | { status: "matched"; accountId: string; matchedOn: "domain" | "nameCountry" | "alias" }
  | { status: "unmatched" }
  | { status: "ambiguous"; candidateIds: string[] };

type Db = PrismaClient | Prisma.TransactionClient;

const LIVE = { deletedAt: null, mergedIntoId: null } as const;

/** FR-ID-1: domain first, then normalised name plus country, then alias. */
export async function resolveAccount(
  client: Db,
  input: { name?: string; domain?: string; country?: string },
): Promise<AccountMatch> {
  const domain = input.domain === undefined ? null : normalizeDomain(input.domain);

  if (domain !== null) {
    const byDomain = await client.account.findFirst({ where: { primaryDomain: domain, ...LIVE } });
    if (byDomain !== null) {
      return { status: "matched", accountId: byDomain.id, matchedOn: "domain" };
    }
  }

  if (input.name !== undefined && input.country !== undefined) {
    const normalizedName = normalizeCompanyName(input.name);
    const byName = await client.account.findMany({
      where: { normalizedName, country: input.country, ...LIVE },
      select: { id: true },
    });
    if (byName.length === 1 && byName[0] !== undefined) {
      return { status: "matched", accountId: byName[0].id, matchedOn: "nameCountry" };
    }
    // FR-ID-2: ambiguous matches are flagged rather than guessed.
    if (byName.length > 1) {
      return { status: "ambiguous", candidateIds: byName.map((a) => a.id) };
    }
  }

  const aliasValues = [
    domain,
    input.name === undefined ? null : normalizeCompanyName(input.name),
  ].filter((value): value is string => value !== null);

  if (aliasValues.length > 0) {
    const aliases = await client.accountAlias.findMany({
      where: { value: { in: aliasValues }, account: LIVE },
      select: { accountId: true },
      distinct: ["accountId"],
    });
    if (aliases.length === 1 && aliases[0] !== undefined) {
      return { status: "matched", accountId: aliases[0].accountId, matchedOn: "alias" };
    }
    if (aliases.length > 1) {
      return { status: "ambiguous", candidateIds: aliases.map((a) => a.accountId) };
    }
  }

  return { status: "unmatched" };
}

export async function createAccount(
  db: PrismaClient,
  actor: Actor,
  input: {
    name: string;
    domain?: string;
    country?: string;
    industry?: string;
    employeeRange?: string;
    revenueRange?: string;
    parentAccountId?: string;
  },
): Promise<Account> {
  assertPermission(actor, "account:write");
  const primaryDomain = input.domain === undefined ? null : normalizeDomain(input.domain);

  return withAudit<Account>(
    db,
    actor,
    (created) => ({
      entityType: "Account",
      entityId: created.id,
      action: "create",
      after: { name: created.name, primaryDomain: created.primaryDomain },
    }),
    (tx) =>
      tx.account.create({
        data: {
          name: input.name,
          normalizedName: normalizeCompanyName(input.name),
          primaryDomain,
          country: input.country,
          industry: input.industry,
          employeeRange: input.employeeRange,
          revenueRange: input.revenueRange,
          parentAccountId: input.parentAccountId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}
