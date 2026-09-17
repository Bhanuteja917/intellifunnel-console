import type { Account, Contact, PartnerAllocation, Prisma, PrismaClient } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { applyMapping, parseDelimited } from "@/lib/lists/csv";
import { validateFieldValues, type LeadFieldSpecRow } from "@/lib/leads/field-validation";
import { checkDoNotContact, checkSuppression, matchesIcp, matchesTal, resolveLeadCap } from "@/lib/leads/matching";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";
import { upsertContact } from "@/lib/identity/contact";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { claimChannelSlot, claimAllocationSlot, releaseAllocationSlot } from "@/lib/allocations/counters";

export type SubmitLeadFileInput = {
  campaignChannelId: string;
  sourceType: "internal" | "partner" | "form"; // "form" accepted by the type but this plan's UI (Task 5) never sends it — file upload only
  partnerOrganizationId?: string;
  content: string;
  mapping: Record<string, string>; // CSV header -> LeadFieldSpec.fieldKey
  consentMapping?: {
    formSlug?: string;
    timestamp?: string;
    ip?: string;
    sourceUrl?: string;
  };
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

  // FR-VF-1: partner attribution on the submission, so the verification
  // queue can filter by partner. A "partner" submission must name a partner
  // that's actually allocated to this channel; an "internal" submission
  // must not claim one at all.
  let allocation: PartnerAllocation | null = null;
  if (input.sourceType === "partner") {
    if (input.partnerOrganizationId === undefined) {
      throw new ValidationError("partnerOrganizationId is required when sourceType is \"partner\"");
    }
    // `status: { not: "ended" }` is required, not optional, and must match
    // `decideLeadVerification`'s identical filter exactly: Task 2 guarantees
    // at most one *non-ended* allocation per partner+channel, but an `ended`
    // row from a prior reallocation can sit in the table alongside the live
    // one. Without this filter the two sides of a lead's lifecycle can bind
    // it to different rows — intake claiming on the ended row while verify
    // converts/releases on the live one, driving the live row's
    // `reservedCount` negative and leaking a reservation on the ended row
    // that nothing ever releases (and testing the wrong row's cap).
    allocation = await db.partnerAllocation.findFirst({
      where: {
        campaignChannelId: input.campaignChannelId,
        partnerOrganizationId: input.partnerOrganizationId,
        status: { not: "ended" },
      },
    });
    if (allocation === null) {
      // Distinguish "never allocated" from "allocation has ended" — with the
      // filter above, an operator who ended an allocation without creating
      // its replacement would otherwise be told the partner has no
      // allocation at all, which is both inaccurate and points at the wrong
      // fix. This extra read only runs on a path that is already throwing.
      const endedAllocation = await db.partnerAllocation.findFirst({
        where: {
          campaignChannelId: input.campaignChannelId,
          partnerOrganizationId: input.partnerOrganizationId,
        },
      });
      throw new ValidationError(
        endedAllocation === null
          ? "This partner has no allocation on the selected channel"
          : "This partner's allocation on the selected channel has ended — create a new allocation before submitting leads against it.",
      );
    }
  } else if (input.partnerOrganizationId !== undefined) {
    throw new ValidationError("partnerOrganizationId can only be set when sourceType is \"partner\"");
  }

  // Cap enforcement (this task): the partner+channel pair is fixed for the
  // whole submission (Task 2's uniqueness guarantee), and so is the pair of
  // reject reasons a capacity claim can fail with — both are looked up once
  // here rather than per row.
  const allocationCapReason = await db.rejectReason.findUniqueOrThrow({ where: { code: "ALLOCATION_CAP_EXCEEDED" } });
  const channelCapReason = await db.rejectReason.findUniqueOrThrow({ where: { code: "CHANNEL_CAP_REACHED" } });

  const campaign = campaignChannel.campaign;

  const specRows = await db.leadFieldSpec.findMany({ where: { campaignChannelId: input.campaignChannelId } });
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

  // The canonical fieldKey convention (companyName, companyDomain, email, ...)
  // is case-insensitive, but `values` (from validateFieldValues) is keyed by
  // whatever exact case the campaign admin typed for each LeadFieldSpec's
  // fieldKey. Build a lowercased-canonical -> actual-fieldKey lookup once per
  // submission so every canonical read below is case-insensitive too, not
  // just the "email" existence gate above.
  const canonicalKeyMap = new Map<string, string>(specRows.map((s) => [s.fieldKey.toLowerCase(), s.fieldKey]));
  const canonicalField = (values: Record<string, unknown>, canonicalKey: string): string | undefined => {
    const actualKey = canonicalKeyMap.get(canonicalKey.toLowerCase());
    return actualKey === undefined ? undefined : stringField(values[actualKey]);
  };

  const parsed = parseDelimited(input.content);

  const submission = await db.leadSubmission.create({
    data: {
      campaignChannelId: input.campaignChannelId,
      sourceType: input.sourceType,
      submittedById: actor.userId,
      partnerOrganizationId: input.partnerOrganizationId,
      mappingJson: input.mapping,
      rowsTotal: parsed.rows.length,
      status: "processing",
    },
  });

  // Batched formSlug -> ConsentTextVersion resolution (this task): scoped to
  // this submission's own campaignChannelId so a formSlug typo that happens
  // to collide with a placement on a *different* channel never attaches that
  // channel's consent text to this submission's leads.
  const placementConsentTextByFormSlug = new Map<string, string | null>();
  if (input.consentMapping?.formSlug !== undefined) {
    const slugColumn = input.consentMapping.formSlug;
    const requestedSlugs = new Set(
      parsed.rows.map((row) => row[slugColumn]?.trim()).filter((s): s is string => s !== undefined && s !== ""),
    );
    if (requestedSlugs.size > 0) {
      const placements = await db.assetPlacement.findMany({
        where: { formSlug: { in: [...requestedSlugs] }, campaignChannelId: input.campaignChannelId },
        select: { formSlug: true, consentTextVersionId: true },
      });
      for (const p of placements) placementConsentTextByFormSlug.set(p.formSlug, p.consentTextVersionId);
    }
  }

  const submissionErrors: SubmissionErrorRow[] = [];
  let rowsAccepted = 0;
  let rowsFailed = 0; // counts ROWS that never became a Lead — NOT submissionErrors.length, which can be >1 per row (a single row can fail more than one field)

  // Scoped to this one submitLeadFile call: without this, a CSV with many
  // rows for the same company but no `country` column would independently
  // resolve every row to "unmatched" (resolveAccount's name-match branch
  // requires both name AND country) and call createAccount once per row,
  // producing N accounts for one company. Domain is preferred as the cache
  // key when present (the stronger identifier); otherwise the normalized
  // company name.
  const accountIdByCompanyKey = new Map<string, string>();

  for (const [index, rawRow] of parsed.rows.entries()) {
    const rowNumber = index + 2; // header is row 1
    try {
      const mapped = applyMapping(rawRow, input.mapping);
      const { values, errors } = validateFieldValues(specs, mapped);

      if (errors.length > 0) {
        for (const e of errors) {
          submissionErrors.push({ rowNumber, field: e.field, rawValue: e.rawValue, message: e.message });
        }
        rowsFailed += 1; // one failed ROW, even though it may have pushed several entries above
        continue; // this row never becomes a Lead
      }

      const companyName = canonicalField(values, "companyName");
      const companyDomain = canonicalField(values, "companyDomain");
      const country = canonicalField(values, "country");
      const email = canonicalField(values, "email");
      // Optional account-dimension ICP criteria (industry/employeeRange/
      // revenueRange) are otherwise inert for a CSV-created account: matchesIcp
      // skips any criterion whose source value is null, so a brand-new account
      // with no industry etc. would auto-pass a mandatory criterion on it.
      const industry = canonicalField(values, "industry");
      const employeeRange = canonicalField(values, "employeeRange");
      const revenueRange = canonicalField(values, "revenueRange");

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

      // --- Step 2: account resolution (cached per company within this file) ---
      const companyKey = companyDomain !== undefined ? companyDomain.toLowerCase() : normalizeCompanyName(companyName ?? "");
      const cachedAccountId = accountIdByCompanyKey.get(companyKey);

      let account: Account;
      if (cachedAccountId !== undefined) {
        account = await db.account.findUniqueOrThrow({ where: { id: cachedAccountId } });
      } else {
        const match = await resolveAccount(db, { name: companyName, domain: companyDomain, country });

        if (match.status === "matched") {
          account = await db.account.findUniqueOrThrow({ where: { id: match.accountId } });
        } else if (match.status === "unmatched") {
          account = await createAccount(db, actor, {
            name: companyName ?? companyDomain ?? "Unknown",
            domain: companyDomain,
            country,
            industry,
            employeeRange,
            revenueRange,
          });
        } else {
          // match.status === "ambiguous": this plan does not attempt to
          // auto-resolve ambiguous account matches (same precedent as
          // importTargetAccountList — a human resolves it via the resolution
          // queue). There is no RejectReason for "a human needs to look at
          // this before we can even attempt validation" — inventing one
          // would misrepresent this as a business-rule outcome, so this row
          // produces only a LeadSubmissionError, never a Lead.
          submissionErrors.push({
            rowNumber,
            field: null,
            rawValue: null,
            message: "Account match is ambiguous — resolve manually before resubmitting",
          });
          rowsFailed += 1;
          continue;
        }
        accountIdByCompanyKey.set(companyKey, account.id);
      }

      const contact: Contact = await upsertContact(db, {
        email,
        accountId: account.id,
        firstName: canonicalField(values, "firstName"),
        lastName: canonicalField(values, "lastName"),
        jobTitle: canonicalField(values, "jobTitle"),
        seniority: canonicalField(values, "seniority"),
        jobFunction: canonicalField(values, "jobFunction"),
        phone: canonicalField(values, "phone"),
        country,
      });

      // --- Step 3: the per-row business-rule pipeline ---
      let outcome: Outcome = "passed";
      let rejectReasonCode: string | null = null;

      // The phone candidate is this row's OWN value, not `contact.phone`:
      // `upsertContact` never blanks an existing field with an undefined one,
      // so `contact.phone` can be a stale value carried over from an earlier
      // submission when this row's phone column is blank — checking that
      // against the DNC list would block a row on a number it never carried.
      const doNotContacted = await checkDoNotContact(db, campaign.clientOrganizationId, {
        email,
        domain: account.primaryDomain ?? undefined,
        phone: canonicalField(values, "phone"),
      });
      if (doNotContacted) {
        outcome = "failed";
        rejectReasonCode = "DO_NOT_CONTACT";
      }

      const suppressed = await checkSuppression(db, campaignChannel.id, {
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
        const crossCampaignDuplicate = await db.lead.findFirst({
          where: {
            contactId: contact.id,
            lifecycleStatus: { in: ["new", "accepted", "delivered"] },
            campaignChannel: {
              campaignId: { not: campaign.id },
              campaign: { clientOrganizationId: campaign.clientOrganizationId },
            },
          },
        });
        if (crossCampaignDuplicate !== null) {
          outcome = "failed";
          rejectReasonCode = "DUPLICATE_CROSS_CAMPAIGN";
        }
      }

      if (outcome !== "failed") {
        const talResult = await matchesTal(db, campaignChannel.id, account.id);
        if (talResult === "unmatched") {
          if (campaignChannel.advisoryTalMatch) {
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
        const cap = await resolveLeadCap(db, campaignChannel.id, account.id);
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
          campaignChannel.id,
          { industry: account.industry, employeeRange: account.employeeRange, revenueRange: account.revenueRange, country: account.country },
          { jobFunction: contact.jobFunction, seniority: contact.seniority, jobTitle: contact.jobTitle },
        );
        if (icp.mandatoryFailed) {
          const dimension = icp.failedDimensions[0];
          const icpCode = dimension === undefined ? undefined : ICP_CODE_BY_DIMENSION[dimension];
          if (icpCode === undefined) {
            // Invariant from Task 3: a mandatoryFailed result always pushes
            // at least one mapped dimension into failedDimensions. If this
            // ever fires, something upstream broke the invariant — surface
            // it loudly rather than silently mis-tagging the reject reason.
            throw new Error(
              `matchesIcp reported mandatoryFailed with no mappable dimension (row ${rowNumber}, failedDimensions=${JSON.stringify(icp.failedDimensions)})`,
            );
          }
          if (campaignChannel.advisoryIcpMatch) {
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

      // SRS §5.2: `passed` is a terminal automated verification status with no
      // manual step after it, so acceptance happens here rather than being
      // queued — E9's manual queue only ever handles `needsReview`, so an
      // auto-passed lead left at "new" could never be moved by anything.
      const autoAccepted = verificationStatus === "passed";
      const now = new Date();

      // Consent capture (this task, best-effort — never blocks or fails a
      // row): resolve this row's consentTextVersionId via the batched
      // formSlug map above, and pull timestamp/ip/sourceUrl from the row if
      // consentMapping named columns for them.
      const consentSlug = input.consentMapping?.formSlug !== undefined ? rawRow[input.consentMapping.formSlug]?.trim() : undefined;
      const consentTextVersionId = consentSlug !== undefined && consentSlug !== ""
        ? placementConsentTextByFormSlug.get(consentSlug) ?? null
        : null;
      const rawConsentTimestamp = input.consentMapping?.timestamp !== undefined ? rawRow[input.consentMapping.timestamp] : undefined;
      const parsedConsentTimestamp = rawConsentTimestamp !== undefined ? new Date(rawConsentTimestamp) : null;
      const consentAcceptedAt = parsedConsentTimestamp !== null && !Number.isNaN(parsedConsentTimestamp.getTime())
        ? parsedConsentTimestamp
        : submission.submittedAt;
      const consentIp = input.consentMapping?.ip !== undefined ? rawRow[input.consentMapping.ip]?.trim() || null : null;
      const consentSourceUrl = input.consentMapping?.sourceUrl !== undefined ? rawRow[input.consentMapping.sourceUrl]?.trim() || null : null;

      await db.$transaction(async (tx) => {
        // --- Cap enforcement: only for a row that isn't already failed for an
        // unrelated reason (a row that was going to be rejected anyway must
        // not also be charged against capacity it was never going to use). ---
        let finalVerificationStatus = verificationStatus;
        let finalRejectReasonId = rejectReasonId;
        let finalAcceptedAt: Date | null = autoAccepted ? now : null;
        let finalClientVisible = autoAccepted;
        let finalLifecycleStatus: "new" | "accepted" = autoAccepted ? "accepted" : "new";

        if (verificationStatus !== "failed") {
          const wantsDelivered = verificationStatus === "passed";

          if (input.partnerOrganizationId !== undefined) {
            const allocationClaimed = await claimAllocationSlot(tx, allocation!.id, wantsDelivered);
            if (!allocationClaimed) {
              finalVerificationStatus = "failed";
              finalRejectReasonId = allocationCapReason.id;
              finalAcceptedAt = null;
              finalClientVisible = false;
              finalLifecycleStatus = "new";
            }
          }

          if (finalVerificationStatus !== "failed") {
            const channelClaimed = await claimChannelSlot(tx, input.campaignChannelId, wantsDelivered);
            if (!channelClaimed) {
              if (input.partnerOrganizationId !== undefined) {
                // The allocation claim above succeeded but the channel is
                // full — undo it so this row consumes neither.
                await releaseAllocationSlot(tx, allocation!.id, wantsDelivered);
              }
              finalVerificationStatus = "failed";
              finalRejectReasonId = channelCapReason.id;
              finalAcceptedAt = null;
              finalClientVisible = false;
              finalLifecycleStatus = "new";
            }
          }
        }

        const lead = await tx.lead.create({
          data: {
            campaignChannelId: input.campaignChannelId,
            submissionId: submission.id,
            contactId: contact.id,
            // Deliberately the CSV-asserted account, which can diverge from
            // contact.accountId if this email was previously matched to a
            // different account under a different company name — a known,
            // accepted limitation; cross-account contact reconciliation is
            // out of scope for this epic.
            accountId: account.id,
            sourceType: input.sourceType,
            verificationStatus: finalVerificationStatus,
            lifecycleStatus: finalLifecycleStatus, // "needsReview"/"failed" stay at "new" — E9 decides those
            clientVisible: finalClientVisible,
            ...(finalLifecycleStatus === "accepted"
              ? {
                  acceptedAt: finalAcceptedAt,
                  // Verification completed instantly via automation — no manual-review clock ever ran, so there is nothing to measure.
                  verificationElapsedMinutes: 0,
                  verificationElapsedBusinessMinutes: 0,
                  slaBreached: false,
                }
              : {}),
            rejectReasonId: finalRejectReasonId,
            fieldValuesJson: values as Prisma.InputJsonValue,
          },
        });
        // Best-effort consent capture: for EVERY lead created here regardless
        // of outcome (accepted, needsReview, DNC/suppressed/cap-rejected,
        // etc.) — consent capture never blocks or fails a row.
        await tx.leadConsent.create({
          data: {
            leadId: lead.id,
            consentTextVersionId,
            acceptedAt: consentAcceptedAt,
            ipAddress: consentIp,
            sourceUrl: consentSourceUrl,
          },
        });
        await tx.leadStatusHistory.create({
          data: {
            leadId: lead.id,
            dimension: "verification",
            fromValue: null,
            toValue: finalVerificationStatus,
          },
        });
        if (finalLifecycleStatus === "accepted") {
          await tx.leadStatusHistory.create({
            data: {
              leadId: lead.id,
              dimension: "lifecycle",
              fromValue: "new",
              toValue: "accepted",
              changedByUserId: null, // automated acceptance — no human actor, consistent with the verification row above
            },
          });
        }
      });
      rowsAccepted += 1; // this row produced a Lead — "passed"/"needsReview"/"failed" all count as accepted at the file-structural level
    } catch (err) {
      // Any unexpected failure anywhere in this row's processing (a
      // malformed campaign config slipping past a gate, a transient DB
      // error, the ICP invariant check above, etc.) degrades to a row-level
      // failure exactly like a field-validation error — it must never abort
      // the whole loop, or every row after it silently vanishes from the
      // counts and the LeadSubmission is stuck at "processing" forever.
      submissionErrors.push({
        rowNumber,
        field: null,
        rawValue: null,
        message: err instanceof Error ? err.message : String(err),
      });
      rowsFailed += 1;
    }
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
