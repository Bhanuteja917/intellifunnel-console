import type { DoNotContactType, IcpDimension, IcpOperator, Prisma, PrismaClient } from "@prisma/client";
import { hashSuppressionValue, isSuppressed } from "@/lib/lists/suppression";
import { resolveAccountCap } from "@/lib/lists/target-accounts";
import { emailDomain, normalizeEmail } from "@/lib/normalise/email";
import { normalizeDomain } from "@/lib/normalise/domain";
import { normalizePhone } from "@/lib/normalise/phone";

type Db = PrismaClient | Prisma.TransactionClient;

export type IcpMatchResult = {
  mandatoryFailed: boolean;
  failedDimensions: string[]; // IcpDimension values that failed, mandatory or not, for the caller's/report's benefit
};

export async function checkDoNotContact(
  db: PrismaClient,
  clientOrganizationId: string,
  candidate: { email?: string; domain?: string; phone?: string },
  now: Date = new Date(),
): Promise<boolean> {
  const conditions: { type: DoNotContactType; valueHash: string }[] = [];
  if (candidate.email !== undefined) {
    conditions.push({ type: "email", valueHash: hashSuppressionValue(normalizeEmail(candidate.email)) });
    const domain = emailDomain(candidate.email);
    if (domain !== null) conditions.push({ type: "domain", valueHash: hashSuppressionValue(domain) });
  }
  if (candidate.domain !== undefined) {
    const domain = normalizeDomain(candidate.domain);
    if (domain !== null) conditions.push({ type: "domain", valueHash: hashSuppressionValue(domain) });
  }
  if (candidate.phone !== undefined) {
    const phone = normalizePhone(candidate.phone);
    if (phone !== null) conditions.push({ type: "phone", valueHash: hashSuppressionValue(phone) });
  }
  if (conditions.length === 0) return false;

  // `DoNotContact.expiresAt` is optional; an entry past its expiry must stop
  // blocking. The value-match `OR` and the expiry `OR` are kept in separate
  // clauses (the latter under `AND`) so they intersect rather than merge into
  // one big disjunction.
  const hit = await db.doNotContact.findFirst({
    where: {
      clientOrganizationId,
      OR: conditions,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * Thin wrapper around `isSuppressed` so Task 4's pipeline can import every
 * matching check from this one module. No behaviour is added on top.
 */
export async function checkSuppression(
  db: PrismaClient,
  campaignChannelId: string,
  candidate: { email?: string; domain?: string; accountId?: string },
): Promise<boolean> {
  return isSuppressed(db, campaignChannelId, candidate);
}

/**
 * Thin wrapper around `resolveAccountCap` so Task 4's pipeline can import
 * every matching check from this one module. No behaviour is added on top.
 */
export async function resolveLeadCap(db: PrismaClient, campaignChannelId: string, accountId: string): Promise<number | null> {
  return resolveAccountCap(db, campaignChannelId, accountId);
}

/**
 * FR-IN-4 step 7: target-account-list match.
 *
 * `"noList"` means the channel has zero `ChannelTargetAccountList` rows —
 * i.e. the TAL check doesn't apply to this channel at all. The caller
 * (Task 4) must treat `"noList"` as "check doesn't apply, don't fail or
 * flag," not as a match failure.
 */
export async function matchesTal(db: Db, campaignChannelId: string, accountId: string): Promise<"noList" | "matched" | "unmatched"> {
  const listCount = await db.channelTargetAccountList.count({ where: { campaignChannelId } });
  if (listCount === 0) return "noList";

  const entry = await db.targetAccountEntry.findFirst({
    where: { accountId, list: { channels: { some: { campaignChannelId } } } },
  });
  return entry === null ? "unmatched" : "matched";
}

type CriterionOutcome = "pass" | "fail" | "skip";

/**
 * Resolves the source value for a dimension and evaluates one criterion
 * against it, per the Task 3 brief's dimension → field mapping and
 * per-operator rules.
 */
function evaluateCriterion(
  dimension: IcpDimension,
  operator: IcpOperator,
  valuesJson: Prisma.JsonValue,
  account: { industry: string | null; employeeRange: string | null; revenueRange: string | null; country: string | null },
  contact: { jobFunction: string | null; seniority: string | null; jobTitle: string | null },
): CriterionOutcome {
  let v: string | null;
  switch (dimension) {
    case "industry":
      v = account.industry;
      break;
    case "employeeRange":
      v = account.employeeRange;
      break;
    case "revenueRange":
      v = account.revenueRange;
      break;
    case "country":
      v = account.country;
      break;
    case "jobFunction":
      v = contact.jobFunction;
      break;
    case "seniority":
      v = contact.seniority;
      break;
    case "jobTitle":
      v = contact.jobTitle;
      break;
    case "region":
    case "custom":
      // Neither Account nor Contact has a corresponding column in this
      // schema. FR-IN-4 step 9: "ICP criteria match on available fields" —
      // so a criterion on either dimension is always skipped.
      return "skip";
  }

  if (v === null) return "skip";
  const value = v;

  const rawValues = Array.isArray(valuesJson) ? valuesJson : [];
  const entries = rawValues.map((entry) => String(entry));

  switch (operator) {
    case "in":
      return entries.some((entry) => entry.toLowerCase() === value.toLowerCase()) ? "pass" : "fail";
    case "notIn":
      return entries.every((entry) => entry.toLowerCase() !== value.toLowerCase()) ? "pass" : "fail";
    case "contains":
      return entries.some((entry) => value.toLowerCase().includes(entry.toLowerCase())) ? "pass" : "fail";
    case "between": {
      const num = Number(value);
      const min = Number(entries[0]);
      const max = Number(entries[1]);
      // employeeRange/revenueRange are stored as bucketed strings (e.g.
      // "50-200") with no canonical numeric encoding in this schema — if the
      // source value or bounds aren't parseable numbers, skip rather than
      // guess at a parse.
      if (!Number.isFinite(num) || !Number.isFinite(min) || !Number.isFinite(max)) return "skip";
      return num >= min && num <= max ? "pass" : "fail";
    }
  }
}

/**
 * FR-IN-4 step 9: ICP match. Runs every `IcpCriterion` for the channel
 * through the dimension mapping and operator rules; a failed mandatory
 * criterion sets `mandatoryFailed`, and every failed criterion (mandatory or
 * not) is recorded in `failedDimensions` for reporting. Skipped criteria
 * (unavailable field, or an unparseable `between`) never affect the result.
 */
export async function matchesIcp(
  db: Db,
  campaignChannelId: string,
  account: { industry: string | null; employeeRange: string | null; revenueRange: string | null; country: string | null },
  contact: { jobFunction: string | null; seniority: string | null; jobTitle: string | null },
): Promise<IcpMatchResult> {
  const criteria = await db.icpCriterion.findMany({ where: { campaignChannelId } });

  let mandatoryFailed = false;
  const failedDimensions: string[] = [];

  for (const criterion of criteria) {
    const outcome = evaluateCriterion(criterion.dimension, criterion.operator, criterion.valuesJson, account, contact);
    if (outcome === "fail") {
      failedDimensions.push(criterion.dimension);
      if (criterion.isMandatory) mandatoryFailed = true;
    }
  }

  return { mandatoryFailed, failedDimensions };
}
