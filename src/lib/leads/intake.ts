import type { Account, Contact, Prisma, PrismaClient } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { applyMapping, parseDelimited } from "@/lib/lists/csv";
import { validateFieldValues, type LeadFieldSpecRow } from "@/lib/leads/field-validation";
import { checkDoNotContact, checkSuppression, matchesIcp, matchesTal, resolveLeadCap } from "@/lib/leads/matching";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";
import { upsertContact } from "@/lib/identity/contact";

export type SubmitLeadFileInput = {
  campaignChannelId: string;
  sourceType: "internal" | "partner" | "form"; // "form" accepted by the type but this plan's UI (Task 5) never sends it — file upload only
  content: string;
  mapping: Record<string, string>; // CSV header -> LeadFieldSpec.fieldKey
};

export type SubmitLeadFileResult = {
  submissionId: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsFailed: number;
};

type Outcome = "passed" | "needsReview" | "failed";

type SubmissionErrorRow = { rowNumber: number; field: string | null; rawValue: string | null; message: string };

/**
 * ICP dimension → RejectReason.code mapping (Task 4 brief, Step 3). Only the
 * seven dimensions `matchesIcp` can ever put into `failedDimensions` appear
 * here — `region`/`custom` are always skipped inside `matchesIcp` itself and
 * can never reach this map.
 */
const ICP_CODE_BY_DIMENSION: Record<string, string> = {
  industry: "ICP_INDUSTRY_MISMATCH",
  employeeRange: "ICP_SIZE_MISMATCH",
  revenueRange: "ICP_SIZE_MISMATCH",
  country: "ICP_GEO_MISMATCH",
  jobFunction: "ICP_SENIORITY_MISMATCH",
  seniority: "ICP_SENIORITY_MISMATCH",
  jobTitle: "ICP_SENIORITY_MISMATCH",
};

/** `validateFieldValues` only ever puts a non-empty string into `values[key]` for a `"string"`/`"email"`/`"phone"`/`"url"`/`"date"` spec — this narrows that back for the identity fields this pipeline reads directly. */
function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * FR-IN-4: the one entry point Task 5's server action calls to turn an
 * uploaded file into `Lead` rows. Reads the campaign's `LeadFieldSpec[]` and
 * `Campaign` config once per submission, then for every row: runs Task 2's
 * field validation, resolves/creates the row's `Account` and upserts its
 * `Contact`, runs Task 3's business-rule pipeline against them, and writes a
 * `Lead` (+ `LeadStatusHistory`) reflecting the outcome.
 *
 * Transaction-scoping note (see this task's brief and Task 3's own report):
 * Task 3's `checkSuppression`/`resolveLeadCap` and this module's own
 * `createAccount` call are all typed to take a plain `PrismaClient`, not the
 * `PrismaClient | Prisma.TransactionClient` union — `createAccount` opens its
 * own `db.$transaction` internally (via `withAudit`), which doesn't exist on
 * a `Prisma.TransactionClient`. That forces account resolution/creation,
 * contact upsert, and the whole business-rule pipeline to run on the
 * top-level `db` client, before any `db.$transaction` is opened — which is
 * also exactly where they belong logically, since their job is to decide the
 * row's outcome, not to perform the row's durable write. Only the two writes
 * that must be atomic with each other — `Lead.create` and the matching
 * `LeadStatusHistory.create` — run inside a per-row `db.$transaction`.
 */
export async function submitLeadFile(
  db: PrismaClient,
  actor: Actor,
  input: SubmitLeadFileInput,
): Promise<SubmitLeadFileResult> {
  // Lead intake is a campaign-operations action; this plan adds no dedicated
  // "lead:write" permission, so it reuses "campaign:write" (see report).
  assertPermission(actor, "campaign:write");

  const campaignChannel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: input.campaignChannelId },
    include: { campaign: true },
  });
  assertOrganizationAccess(actor, campaignChannel.campaign.clientOrganizationId);

  const campaign = campaignChannel.campaign;

  const specRows = await db.leadFieldSpec.findMany({ where: { campaignId: campaignChannel.campaignId } });
  if (!specRows.some((s) => s.fieldKey.toLowerCase() === "email")) {
    throw new ValidationError("This campaign has no 'email' lead field configured — lead intake needs one.");
  }
  // Project Prisma's LeadFieldSpec rows into the plain LeadFieldSpecRow shape
  // Task 2's validateFieldValues expects (Json -> unknown[], null -> undefined):
  const specs: LeadFieldSpecRow[] = specRows.map((s) => ({
    fieldKey: s.fieldKey,
    dataType: s.dataType,
    isRequired: s.isRequired,
    rejectIfMissing: s.rejectIfMissing,
    allowedValues: (s.allowedValuesJson as unknown[] | null) ?? undefined,
    validationPattern: s.validationPattern ?? undefined,
  }));

  const parsed = parseDelimited(input.content);

  const submission = await db.leadSubmission.create({
    data: {
      campaignChannelId: input.campaignChannelId,
      sourceType: input.sourceType,
      submittedById: actor.userId,
      mappingJson: input.mapping,
      rowsTotal: parsed.rows.length,
      status: "processing",
    },
  });

  const submissionErrors: SubmissionErrorRow[] = [];
  let rowsAccepted = 0;
  let rowsFailed = 0; // counts ROWS that never became a Lead — NOT submissionErrors.length, which can be >1 per row (a single row can fail more than one field)

  for (const [index, rawRow] of parsed.rows.entries()) {
    const rowNumber = index + 2; // header is row 1
    const mapped = applyMapping(rawRow, input.mapping);
    const { values, errors } = validateFieldValues(specs, mapped);

    if (errors.length > 0) {
      for (const e of errors) {
        submissionErrors.push({ rowNumber, field: e.field, rawValue: e.rawValue, message: e.message });
      }
      rowsFailed += 1; // one failed ROW, even though it may have pushed several entries above
      continue; // this row never becomes a Lead
    }

    const companyName = stringField(values.companyName);
    const companyDomain = stringField(values.companyDomain);
    const country = stringField(values.country);
    const email = stringField(values.email);

    // Defensive: the campaign is required to have an "email" LeadFieldSpec
    // (checked above), but nothing forces that spec to be
    // isRequired+rejectIfMissing, so field validation alone can't guarantee
    // `email` survived into `values`. upsertContact requires a real email
    // string, so treat an absent one here as a structural intake failure
    // rather than let it crash with a Prisma error deeper in the pipeline.
    if (email === undefined) {
      submissionErrors.push({
        rowNumber,
        field: "email",
        rawValue: null,
        message: "email is required to create or match a contact",
      });
      rowsFailed += 1;
      continue;
    }

    // --- Step 2: account resolution ---
    const match = await resolveAccount(db, { name: companyName, domain: companyDomain, country });

    let account: Account;
    if (match.status === "matched") {
      account = await db.account.findUniqueOrThrow({ where: { id: match.accountId } });
    } else if (match.status === "unmatched") {
      if (companyName === undefined && companyDomain === undefined) {
        // Neither field present — creating an account would only produce a
        // useless "Unknown" record. Fail the row structurally: no Account
        // was ever resolved, so there is nothing to attach a Lead to.
        submissionErrors.push({
          rowNumber,
          field: "companyName",
          rawValue: null,
          message: "Row has neither a company name nor a company domain — cannot resolve or create an account",
        });
        rowsFailed += 1;
        continue;
      }
      account = await createAccount(db, actor, {
        name: companyName ?? companyDomain ?? "Unknown",
        domain: companyDomain,
        country,
      });
    } else {
      // match.status === "ambiguous": this plan does not attempt to
      // auto-resolve ambiguous account matches (same precedent as
      // importTargetAccountList — a human resolves it via the resolution
      // queue). There is no RejectReason for "a human needs to look at this
      // before we can even attempt validation" — inventing one would
      // misrepresent this as a business-rule outcome, so this row produces
      // only a LeadSubmissionError, never a Lead.
      submissionErrors.push({
        rowNumber,
        field: null,
        rawValue: null,
        message: "Account match is ambiguous — resolve manually before resubmitting",
      });
      rowsFailed += 1;
      continue;
    }

    const contact: Contact = await upsertContact(db, {
      email,
      accountId: account.id,
      firstName: stringField(values.firstName),
      lastName: stringField(values.lastName),
      jobTitle: stringField(values.jobTitle),
      seniority: stringField(values.seniority),
      jobFunction: stringField(values.jobFunction),
      phone: stringField(values.phone),
      country,
    });

    // --- Step 3: the per-row business-rule pipeline ---
    let outcome: Outcome = "passed";
    let rejectReasonCode: string | null = null;

    checkDoNotContact(); // always false, deliberate no-op (see Task 3's brief / Global Constraints)

    const suppressed = await checkSuppression(db, campaign.id, {
      email,
      domain: account.primaryDomain ?? undefined,
      accountId: account.id,
    });
    if (suppressed) {
      outcome = "failed";
      rejectReasonCode = "SUPPRESSED_ACCOUNT";
    }

    if (outcome !== "failed") {
      const duplicate = await db.lead.findFirst({
        where: { contactId: contact.id, campaignChannel: { campaignId: campaign.id } },
      });
      if (duplicate !== null) {
        outcome = "failed";
        rejectReasonCode = "DUPLICATE_IN_CAMPAIGN";
      }
    }

    if (outcome !== "failed") {
      const talResult = await matchesTal(db, campaign.id, account.id);
      if (talResult === "unmatched") {
        if (campaign.advisoryTalMatch) {
          if (outcome === "passed") outcome = "needsReview";
          if (rejectReasonCode === null) rejectReasonCode = "NOT_ON_TARGET_ACCOUNT_LIST";
          // advisory: do not stop, continue to the next check
        } else {
          outcome = "failed";
          rejectReasonCode = "NOT_ON_TARGET_ACCOUNT_LIST";
        }
      }
      // "noList" or "matched": no effect, continue
    }

    if (outcome !== "failed") {
      const cap = await resolveLeadCap(db, campaign.id, account.id);
      if (cap !== null) {
        const acceptedCount = await db.lead.count({
          where: { accountId: account.id, campaignChannel: { campaignId: campaign.id }, lifecycleStatus: "accepted" },
        });
        if (acceptedCount >= cap) {
          // No advisory mode for this check per the spec.
          outcome = "failed";
          rejectReasonCode = "ACCOUNT_CAP_REACHED";
        }
      }
    }

    if (outcome !== "failed") {
      const icp = await matchesIcp(
        db,
        campaign.id,
        { industry: account.industry, employeeRange: account.employeeRange, revenueRange: account.revenueRange, country: account.country },
        { jobFunction: contact.jobFunction, seniority: contact.seniority, jobTitle: contact.jobTitle },
      );
      if (icp.mandatoryFailed) {
        const dimension = icp.failedDimensions[0];
        const icpCode = dimension === undefined ? undefined : ICP_CODE_BY_DIMENSION[dimension];
        if (icpCode === undefined) {
          // Invariant from Task 3: a mandatoryFailed result always pushes at
          // least one mapped dimension into failedDimensions. If this ever
          // fires, something upstream broke the invariant — surface it
          // loudly rather than silently mis-tagging the reject reason.
          throw new Error(
            `matchesIcp reported mandatoryFailed with no mappable dimension (row ${rowNumber}, failedDimensions=${JSON.stringify(icp.failedDimensions)})`,
          );
        }
        if (campaign.advisoryIcpMatch) {
          if (outcome === "passed") outcome = "needsReview";
          if (rejectReasonCode === null) rejectReasonCode = icpCode;
        } else {
          outcome = "failed";
          rejectReasonCode = icpCode;
        }
      }
    }

    const verificationStatus = outcome; // "passed" | "needsReview" | "failed" map 1:1 onto LeadVerificationStatus

    let rejectReasonId: string | null = null;
    if (rejectReasonCode !== null) {
      const reason = await db.rejectReason.findUniqueOrThrow({ where: { code: rejectReasonCode } });
      rejectReasonId = reason.id;
    }

    await db.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          campaignChannelId: input.campaignChannelId,
          submissionId: submission.id,
          contactId: contact.id,
          accountId: account.id,
          sourceType: input.sourceType,
          verificationStatus,
          lifecycleStatus: "new", // always "new" at intake — acceptance/rejection is E9's job, not this pipeline's
          clientVisible: false,
          rejectReasonId,
          fieldValuesJson: values as Prisma.InputJsonValue,
        },
      });
      await tx.leadStatusHistory.create({
        data: {
          leadId: lead.id,
          dimension: "verification",
          fromValue: null,
          toValue: verificationStatus,
        },
      });
    });
    rowsAccepted += 1; // this row produced a Lead — "passed"/"needsReview"/"failed" all count as accepted at the file-structural level
  }

  if (submissionErrors.length > 0) {
    await db.leadSubmissionError.createMany({
      data: submissionErrors.map((e) => ({ ...e, submissionId: submission.id })),
    });
  }
  await db.leadSubmission.update({
    where: { id: submission.id },
    data: { rowsAccepted, rowsFailed, status: "completed" },
  });

  return { submissionId: submission.id, rowsTotal: parsed.rows.length, rowsAccepted, rowsFailed };
}
