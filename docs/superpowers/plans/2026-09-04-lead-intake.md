# Lead Model and Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `Lead` data model (currently entirely absent from the schema — the root blocker for PRD epics E9-E13 and E16-E19) and build PRD epic E8 (lead intake) on top of it: CSV upload with column mapping, per-row automated validation, and a staging area where no lead is client-visible until it passes.

**Architecture:** New Prisma models (`Lead`, `LeadSubmission`, `LeadSubmissionError`, plus 4 small enums) scoped to `CampaignChannel` rather than a not-yet-built `Allocation` (PRD epic E7 — see Global Constraints for why). A new `src/lib/leads/` package holds three layers: field validation (`field-validation.ts`, checks a raw row against a campaign's `LeadFieldSpec`s), matching (`matching.ts`, wraps/extends existing suppression + target-account-list + a brand-new ICP matcher), and orchestration (`intake.ts`, the pipeline that ties parsing → validation → account/contact resolution → matching → `Lead` creation into one transaction-safe flow, run per file upload). A new campaign-scoped route (`/campaigns/[id]/leads`, `/campaigns/[id]/leads/upload`) provides the UI, following the same file-content-plus-mapping pattern the existing (backend-only) `importTargetAccountList`/`importSuppressionList` functions already use — no file storage layer exists in this codebase and this plan doesn't add one; the whole file's text content is read client-side and passed straight through one server action call, same as those two functions.

**Tech Stack:** Prisma migration, `papaparse` (already a dependency, via the existing `src/lib/lists/csv.ts` helpers — reused, not reimplemented), Next.js server actions, shadcn/ui.

**Spec:** `srs.md` §4.7 (Leads data model), §5.2-5.4 (lead state machines), §6.1 (FR-IN-1 through FR-IN-8, lead intake functional requirements) and `prd.md` §7 E8. Read those sections before starting — this plan implements a deliberately-scoped SLICE of them; the Global Constraints section below states exactly which requirements are in scope for this plan and which are intentionally deferred, and why. Treat every deferral listed there as authoritative — it is not an oversight.

## Global Constraints

**Scope — what this plan implements from FR-IN-4's 11-step validation chain, in order, with short-circuit on the first non-advisory failure:**
1. Required field spec (per `LeadFieldSpec.isRequired`/`rejectIfMissing`)
2. Format validation (data type, `allowedValuesJson`, `validationPattern`, plus a generic-personal-email-domain check)
3. Do-not-contact check — **implemented as a literal no-op that always passes**, per FR-IN-4 step 3's own text: *"(phase 5; no-op until then)"*. Do not implement real DNC enforcement even though the `DoNotContact` model already exists in the schema — the spec phases this deliberately, independent of whether the dependency exists.
4. Suppression check (reuses the existing `isSuppressed` function verbatim)
5. Duplicate check within campaign
7. Target account list match (reuses/extends existing TAL infrastructure; advisory per `Campaign.advisoryTalMatch`)
8. Per-account cap check (reuses the existing `resolveAccountCap` function verbatim)
9. ICP criteria match (new — no ICP evaluator exists anywhere in this codebase today; advisory per `Campaign.advisoryIcpMatch`)

**Deliberately deferred (do not implement in this plan) — each is a genuine missing dependency, not implementer discretion:**
- **Step 6** (cross-campaign duplicate check) and the **allocation-cap portion of FR-IN-6** — both need PRD epic E7 (partner allocation), which has zero schema/code today (confirmed: only `Organization.isPartner` exists). `Lead.allocationId` and `LeadSubmission.allocationId` from the SRS's entity list are likewise **omitted from the schema this plan adds** — they'll be added in E7's own migration, alongside the allocation-cap check. This plan uses `campaignChannelId` as `Lead`/`LeadSubmission`'s scoping FK instead (the SRS lists both `campaignChannelId` and `allocationId` on `Lead`; only the former is buildable today).
- **Step 10** (qualifying question answers) — no answer-evaluation logic exists for `QualificationQuestion.acceptableAnswersJson` anywhere in this codebase (confirmed: it's written once, at channel-type-version-publish time, and never read back). Building this needs its own answer-to-question column-mapping UI, which is a real second feature, not a corner of this one.
- **Step 11** (consent completeness) — needs `EngagementEvent`/`ConsentTextVersion`, which belong to PRD epics E5/E19 (asset placements, form capture) and don't exist.
- Everything in PRD epics E9 (verification), E10 (enrichment), E11 (delivery), E16 (compliance) that the SRS's full `Lead` entity has fields for: `allocationId`, `engagementEventId`, `acceptedAt`, `rejectedAt`, `replacementForLeadId`, `deliveredAt`, `verificationElapsedMinutes`, `verificationElapsedBusinessMinutes`, `slaBreached`, `anonymisedAt`, `legalHold` are **all omitted from the `Lead` model this plan creates**. Every one of them is written only by a state transition (acceptance, delivery, anonymisation) that belongs to a later epic's own migration. A lead this plan creates always has `lifecycleStatus: "new"` and `clientVisible: false` — this plan's code never writes anything else to either field, matching FR-IN-1 ("No lead is client-visible before verification passes") and the epic boundary between E8 (intake, stops at staging) and E9 (verification, owns acceptance/rejection). `LeadFieldValue` (the SRS's "optional normalised alternative... where per-field querying is needed") is also omitted — the SRS itself calls it optional, and `fieldValuesJson` covers v1.

**The canonical fieldKey convention (a design decision this plan makes, since `LeadFieldSpec.fieldKey` is arbitrary per campaign and `LeadFieldSpec.dataType` alone can't tell the intake pipeline which field is company name vs. job title):** the intake pipeline resolves Account/Contact fields by looking for specific, case-insensitive `fieldKey` values on the campaign's `LeadFieldSpec`s: `email` (required — a campaign with no `email`-keyed field cannot use lead intake at all, and the upload UI must say so), `companyName`, `companyDomain`, `firstName`, `lastName`, `jobTitle`, `phone`, `seniority`, `jobFunction`, `country`. A `LeadFieldSpec` with any other `fieldKey` is still validated and stored in `fieldValuesJson`, it just doesn't feed account/contact resolution. Document this convention prominently wherever a campaign admin configures lead field specs (a one-line hint is enough — this plan does not add UI for it beyond that, since Tasks 1/2/3 of the prior `campaign-config-editors` plan already built the lead field spec editor).

**Reject reason vocabulary is closed (FR-IN-5): no free-text reasons.** `prisma/seed/reject-reasons.ts` already has codes for most checks this plan needs (`MISSING_REQUIRED_FIELD`, `INVALID_EMAIL_FORMAT`, `INVALID_PHONE_FORMAT`, `GENERIC_EMAIL_DOMAIN`, `ICP_INDUSTRY_MISMATCH`, `ICP_SIZE_MISMATCH`, `ICP_GEO_MISMATCH`, `ICP_SENIORITY_MISMATCH`, `NOT_ON_TARGET_ACCOUNT_LIST`, `SUPPRESSED_ACCOUNT`, `SUPPRESSED_CONTACT`, `DUPLICATE_IN_CAMPAIGN`, `ACCOUNT_CAP_REACHED`) but is missing codes for number/date/url/boolean format failures and `allowedValuesJson`/`validationPattern` mismatches — Task 1 adds two new codes (`INVALID_FIELD_FORMAT`, `VALUE_NOT_ALLOWED`) to close that gap. Every check this plan implements must resolve to one of these existing-or-added codes; never invent a new one outside Task 1's seed addition.

**Every mutation goes through a server action calling `requireActor()`, wrapped in `toActionResult`** — same pattern as every existing action in this codebase (see `src/app/(admin)/campaigns/[id]/actions.ts`).

**No file storage layer exists and this plan does not add one.** Follow `importTargetAccountList`'s exact shape (`src/lib/lists/target-accounts.ts`): the caller reads the whole uploaded file as text and passes `{ content: string, mapping: Record<string,string> }` in one call. `LeadSubmission.fileKey` exists in the schema (matching the SRS) but this plan's code never sets it, same as `ImportBatch.fileKey` today.

**TypeScript must pass with zero errors: `npx tsc --noEmit`.** Run `npx eslint <changed files>` too. Run `npx prisma generate` after any schema change, before typechecking.

**Commit at the end of each task**, `git add` only the files that task's Files section lists.

---

## Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed/reject-reasons.ts`
- Create: a new Prisma migration (via `npx prisma migrate dev --name add_lead_intake`)

**Interfaces:**
- Produces: `Lead`, `LeadSubmission`, `LeadSubmissionError` models; `LeadSourceType`, `LeadVerificationStatus`, `LeadLifecycleStatus`, `LeadEnrichmentStatus`, `LeadStatusDimension` enums; back-relations on `CampaignChannel`, `Contact`, `Account`, `RejectReason`. Every later task in this plan depends on these exact names/fields.

- [ ] **Step 1: Read for conventions**

  Read `prisma/schema.prisma` in full (it's long — skim the parts you've seen before, read closely: the `Campaign`, `CampaignChannel`, `Contact`, `Account`, `RejectReason`, `ImportBatch`/`ImportError`, `CampaignStatusHistory` models, and every enum). Note the established conventions this plan's new models must follow exactly: `id String @id @default(cuid())`; `createdAt DateTime @default(now())` / `updatedAt DateTime @updatedAt`; `createdById String?` / `updatedById String?` as **plain nullable strings with no `@relation`** (this codebase never FKs audit-actor columns to `User` — don't be the first); enum values in `lowerCamel` for multi-word names (e.g. `pendingInternalApproval`, not `pending_internal_approval` or `PendingInternalApproval`).

- [ ] **Step 2: Add the enums**

  ```prisma
  enum LeadSourceType {
    internal
    partner
    form
  }

  enum LeadVerificationStatus {
    pending
    autoValidating
    failed
    needsReview
    passed
  }

  enum LeadLifecycleStatus {
    new
    accepted
    rejected
    delivered
  }

  enum LeadEnrichmentStatus {
    notRequired
    pending
    inProgress
    complete
  }

  enum LeadStatusDimension {
    verification
    lifecycle
    enrichment
  }
  ```

  `LeadSubmission.status` reuses the **existing** `ImportStatus` enum (`pending | processing | completed | failed`, already used by `ImportBatch.status`) rather than a new one-off enum — same lifecycle shape, no reason to duplicate it.

- [ ] **Step 3: Add `LeadSubmission`**

  ```prisma
  model LeadSubmission {
    id                String         @id @default(cuid())
    campaignChannelId String
    sourceType        LeadSourceType
    submittedById     String
    fileKey           String?
    mappingJson       Json
    rowsTotal         Int            @default(0)
    rowsAccepted      Int            @default(0)
    rowsFailed        Int            @default(0)
    status            ImportStatus   @default(pending)
    submittedAt       DateTime       @default(now())
    createdAt         DateTime       @default(now())
    updatedAt         DateTime       @updatedAt

    campaignChannel CampaignChannel       @relation(fields: [campaignChannelId], references: [id])
    leads           Lead[]
    errors          LeadSubmissionError[]

    @@index([campaignChannelId, status])
  }

  model LeadSubmissionError {
    id           String   @id @default(cuid())
    submissionId String
    rowNumber    Int
    field        String?
    rawValue     String?
    message      String
    createdAt    DateTime @default(now())

    submission LeadSubmission @relation(fields: [submissionId], references: [id])

    @@index([submissionId, rowNumber])
  }
  ```

  `LeadSubmissionError` deliberately mirrors `ImportError`'s exact shape (`rowNumber`, `field`, `rawValue`, `message`) — same reporting contract FR-IN-3 asks for — but is its own model with its own FK to `LeadSubmission`, rather than reusing `ImportError` (whose `batchId` is a hard FK to `ImportBatch` specifically — repointing it would either weaken that constraint or require a second nullable FK column on a model two other working import flows depend on; not worth the risk for a two-model addition this cheap).

- [ ] **Step 4: Add `Lead`**

  ```prisma
  model Lead {
    id                 String                 @id @default(cuid())
    campaignChannelId  String
    submissionId       String
    contactId          String
    accountId          String
    sourceType         LeadSourceType
    verificationStatus LeadVerificationStatus @default(pending)
    lifecycleStatus    LeadLifecycleStatus    @default(new)
    enrichmentStatus   LeadEnrichmentStatus   @default(notRequired)
    clientVisible      Boolean                @default(false)
    rejectReasonId     String?
    fieldValuesJson    Json
    createdAt          DateTime               @default(now())
    updatedAt          DateTime               @updatedAt

    campaignChannel CampaignChannel     @relation(fields: [campaignChannelId], references: [id])
    submission      LeadSubmission      @relation(fields: [submissionId], references: [id])
    contact         Contact             @relation(fields: [contactId], references: [id])
    account         Account             @relation(fields: [accountId], references: [id])
    rejectReason    RejectReason?       @relation(fields: [rejectReasonId], references: [id])
    statusHistory   LeadStatusHistory[]

    @@index([campaignChannelId, verificationStatus])
    @@index([accountId])
    @@index([contactId])
  }

  model LeadStatusHistory {
    id              String              @id @default(cuid())
    leadId          String
    dimension       LeadStatusDimension
    fromValue       String?
    toValue         String
    changedByUserId String?
    changedAt       DateTime            @default(now())
    reason          String?

    lead Lead @relation(fields: [leadId], references: [id])

    @@index([leadId, dimension])
  }
  ```

  `LeadStatusHistory` mirrors the existing `CampaignStatusHistory` pattern — write one row whenever intake sets a lead's initial `verificationStatus` (Task 4 does this: `dimension: "verification"`, `fromValue: null`, `toValue: <the computed status>`).

- [ ] **Step 5: Add back-relations to existing models**

  Add to `CampaignChannel`: `leadSubmissions LeadSubmission[]` and `leads Lead[]`.
  Add to `Contact`: `leads Lead[]`.
  Add to `Account`: `leads Lead[]`.
  Add to `RejectReason`: `leads Lead[]`.

- [ ] **Step 6: Extend the reject reason seed vocabulary**

  In `prisma/seed/reject-reasons.ts`, add two entries to `REJECT_REASONS` (no schema/enum change needed — `RejectReasonCategory` already has `dataQuality`):

  ```ts
  { code: "INVALID_FIELD_FORMAT", label: "Value does not match the expected format", category: "dataQuality", isPartnerReplaceable: true },
  { code: "VALUE_NOT_ALLOWED", label: "Value is outside the field's allowed values", category: "dataQuality", isPartnerReplaceable: true },
  ```

  These cover number/date/url/boolean type mismatches and `validationPattern`/`allowedValuesJson` failures (Task 2), which the existing vocabulary has no code for (it only has dedicated codes for email/phone).

- [ ] **Step 7: Migrate and seed**

  `npx prisma migrate dev --name add_lead_intake` (this also runs `prisma generate`). Then re-run the reject-reason seed so the two new codes actually exist in the dev database: `npx tsx prisma/seed/reject-reasons.ts` won't work standalone (it only exports a function) — instead run the project's existing seed entrypoint, `npm run db:seed` (`tsx prisma/seed/index.ts`), which is idempotent (`upsert` on `code`) so it's safe to re-run even though it also touches roles/settings/funnel-stages/channel-types.

- [ ] **Step 8: Verify**

  `npx tsc --noEmit` clean (this alone won't catch much yet since nothing references the new models, but confirms the generated Prisma client is well-formed). Confirm via `docker compose exec -T postgres psql -U postgres -d console -c "select code from \"RejectReason\" where code in ('INVALID_FIELD_FORMAT','VALUE_NOT_ALLOWED');"` that both new rows exist (2 rows). Confirm the new tables exist: `\dt` in psql, or `select table_name from information_schema.tables where table_name in ('Lead','LeadSubmission','LeadSubmissionError','LeadStatusHistory');` (4 rows).

- [ ] **Step 9: Commit**

  `git add prisma/schema.prisma prisma/seed/reject-reasons.ts prisma/migrations/` and commit. Migrations are generated files — include the whole new migration directory `prisma/migrations/<timestamp>_add_lead_intake/`.

---

## Task 2: Field validation and phone normalization

**Files:**
- Create: `src/lib/normalise/phone.ts`
- Create: `src/lib/leads/field-validation.ts`

**Interfaces:**
- Produces: `normalizePhone(input: string): string | null` in `src/lib/normalise/phone.ts` — returns a normalized phone string, or `null` if the input isn't a plausible phone number. Unlike `normalizeEmail` (which throws), this returns `null` on failure — deliberately different, because Task 4's orchestration needs to distinguish "not a phone value" from "threw," and a phone field is usually optional while email is the one field this whole pipeline requires (see the canonical fieldKey convention).
- Produces: `validateFieldValues(specs: LeadFieldSpecRow[], rawRow: Record<string,string>): FieldValidationResult` in `src/lib/leads/field-validation.ts` — the pure, single-row validator Task 4 calls once per CSV row.
- Consumes: nothing from another task (Task 1's schema doesn't need to exist for this file to compile — it has no Prisma imports at all, it's pure data transformation).

- [ ] **Step 1: Read for context**

  Read `src/lib/normalise/email.ts` and `src/lib/normalise/domain.ts` in full (for the normalization style/error-handling convention to match), and `src/lib/campaigns/crud.ts`'s `LeadFieldSpecInput` type (the shape a `LeadFieldSpec` row has: `fieldKey`, `label`, `dataType`, `isRequired`, `rejectIfMissing`, `allowedValues?`, `validationPattern?`).

- [ ] **Step 2: `src/lib/normalise/phone.ts`**

  Keep this simple — this codebase has zero phone-handling precedent to match, so don't over-build a full E.164 library. Strip everything except digits and a leading `+`, require between 7 and 15 digits (E.164's own digit-count bounds, the one universally-agreed constraint), return `null` for anything outside that.

  ```ts
  export function normalizePhone(input: string): string | null {
    const trimmed = input.trim();
    const hasLeadingPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/[^\d]/g, "");
    if (digits.length < 7 || digits.length > 15) return null;
    return hasLeadingPlus ? `+${digits}` : digits;
  }
  ```

- [ ] **Step 3: `src/lib/leads/field-validation.ts`**

  ```ts
  import { normalizeEmail, emailDomain } from "@/lib/normalise/email";
  import { normalizePhone } from "@/lib/normalise/phone";
  import type { LeadFieldDataType } from "@prisma/client";

  export type LeadFieldSpecRow = {
    fieldKey: string;
    dataType: LeadFieldDataType;
    isRequired: boolean;
    rejectIfMissing: boolean;
    allowedValues?: unknown[];
    validationPattern?: string;
  };

  export type FieldValidationError = {
    field: string;
    rawValue: string | null;
    rejectReasonCode: "MISSING_REQUIRED_FIELD" | "INVALID_EMAIL_FORMAT" | "INVALID_PHONE_FORMAT" | "GENERIC_EMAIL_DOMAIN" | "INVALID_FIELD_FORMAT" | "VALUE_NOT_ALLOWED";
    message: string;
  };

  export type FieldValidationResult = {
    values: Record<string, unknown>; // fieldKey -> normalized value, ready for fieldValuesJson
    errors: FieldValidationError[];  // empty means the row's field validation passed
  };

  const GENERIC_EMAIL_DOMAINS = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
    "icloud.com", "live.com", "msn.com", "protonmail.com",
  ]);

  export function validateFieldValues(specs: LeadFieldSpecRow[], rawRow: Record<string, string>): FieldValidationResult {
    const values: Record<string, unknown> = {};
    const errors: FieldValidationError[] = [];

    for (const spec of specs) {
      const raw = rawRow[spec.fieldKey]?.trim() ?? "";
      const isMissing = raw === "";

      if (isMissing) {
        if (spec.isRequired && spec.rejectIfMissing) {
          errors.push({ field: spec.fieldKey, rawValue: null, rejectReasonCode: "MISSING_REQUIRED_FIELD", message: `${spec.fieldKey} is required` });
        }
        continue; // nothing more to validate on an absent value
      }

      switch (spec.dataType) {
        case "email": {
          let normalized: string;
          try {
            normalized = normalizeEmail(raw);
          } catch {
            errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_EMAIL_FORMAT", message: `${raw} is not a valid email` });
            break;
          }
          const domain = emailDomain(normalized);
          if (domain !== null && GENERIC_EMAIL_DOMAINS.has(domain)) {
            errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "GENERIC_EMAIL_DOMAIN", message: `${domain} is a personal/generic email domain` });
            break;
          }
          values[spec.fieldKey] = normalized;
          break;
        }
        case "phone": {
          const normalized = normalizePhone(raw);
          if (normalized === null) {
            errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_PHONE_FORMAT", message: `${raw} is not a valid phone number` });
            break;
          }
          values[spec.fieldKey] = normalized;
          break;
        }
        case "number": {
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a number` });
            break;
          }
          values[spec.fieldKey] = n;
          break;
        }
        case "boolean": {
          const lower = raw.toLowerCase();
          if (!["true", "false", "yes", "no", "1", "0"].includes(lower)) {
            errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a boolean` });
            break;
          }
          values[spec.fieldKey] = ["true", "yes", "1"].includes(lower);
          break;
        }
        case "date": {
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) {
            errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a date` });
            break;
          }
          values[spec.fieldKey] = d.toISOString();
          break;
        }
        case "url": {
          try {
            new URL(raw);
            values[spec.fieldKey] = raw;
          } catch {
            errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a valid URL` });
          }
          break;
        }
        case "string":
        default:
          values[spec.fieldKey] = raw;
          break;
      }

      // allowedValues / validationPattern apply on top of a type-valid value (skip if the type check above already errored this field).
      const alreadyErroredThisField = errors.some((e) => e.field === spec.fieldKey);
      if (!alreadyErroredThisField) {
        if (spec.allowedValues !== undefined && spec.allowedValues.length > 0 && !spec.allowedValues.some((v) => String(v).toLowerCase() === raw.toLowerCase())) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "VALUE_NOT_ALLOWED", message: `${raw} is not one of the allowed values for ${spec.fieldKey}` });
          delete values[spec.fieldKey];
        } else if (spec.validationPattern !== undefined && !new RegExp(spec.validationPattern).test(raw)) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} does not match the required pattern for ${spec.fieldKey}` });
          delete values[spec.fieldKey];
        }
      }
    }

    return { values, errors };
  }
  ```

  This function returns ALL errors for a row (every failing field), not just the first — that's a deliberate difference from FR-IN-4's overall short-circuit-across-checks rule (Task 4 owns that, at the level of "which of the 6 pipeline steps fails first"); within step 1+2 (field-level validation), reporting every bad field in one pass is strictly more useful for a partner fixing their CSV and costs nothing extra.

- [ ] **Step 4: Verify**

  `npx tsc --noEmit` clean. No server/DB interaction to curl-check here — this is a pure function. Write a short throwaway script (`tsx`, delete after) exercising a handful of cases (missing required field, bad email, generic-domain email, bad phone, out-of-range number, allowed-values mismatch, a fully-valid row) and print the results, paste the output into your report as evidence instead of (or in addition to) unit tests — this codebase has no test runner wired into this workflow's verification convention so far (every prior plan in this session verified via `tsc` + manual/curl checks, not `vitest`, even though `vitest` is a project dependency) - stay consistent with that.

- [ ] **Step 5: Commit**

  `git add src/lib/normalise/phone.ts src/lib/leads/field-validation.ts` and commit.

---

## Task 3: Matching checks (suppression wrapper, TAL match, ICP match, DNC no-op)

**Files:**
- Create: `src/lib/leads/matching.ts`

**Interfaces:**
- Consumes: `Lead`/`LeadSubmission` models from Task 1 (only for types — this file's functions take plain arguments, they don't do intake orchestration).
- Produces:
  - `checkDoNotContact(): boolean` — always `false` (not on DNC). See Global Constraints — this is a deliberate no-op, not a stub to fill in later within this plan.
  - `checkSuppression(db: PrismaClient, campaignId: string, candidate: { email?: string; domain?: string; accountId?: string }): Promise<boolean>` — thin re-export/wrapper around the existing `isSuppressed` from `src/lib/lists/suppression.ts`. (A wrapper, not a re-export, only so this module has one consistent naming scheme for Task 4 to import from — don't add any behavior on top of `isSuppressed`.)
  - `matchesTal(db: PrismaClient, campaignId: string, accountId: string): Promise<"noList" | "matched" | "unmatched">` — new. `"noList"` means the campaign has zero `CampaignTargetAccountList` rows, i.e. FR-IN-4 step 7's "where the campaign requires it" doesn't apply; the caller (Task 4) must treat `"noList"` as "check doesn't apply, don't fail or flag," not as a match failure.
  - `resolveLeadCap(db: PrismaClient, campaignId: string, accountId: string): Promise<number | null>` — thin re-export/wrapper around the existing `resolveAccountCap` from `src/lib/lists/target-accounts.ts`.
  - `matchesIcp(db: PrismaClient, campaignId: string, account: { industry: string | null; employeeRange: string | null; revenueRange: string | null; country: string | null }, contact: { jobFunction: string | null; seniority: string | null; jobTitle: string | null }): Promise<IcpMatchResult>` — new, the one genuinely new algorithm in this task.

  ```ts
  export type IcpMatchResult = {
    mandatoryFailed: boolean;
    failedDimensions: string[]; // IcpDimension values that failed, mandatory or not, for the caller's/report's benefit
  };
  ```

- [ ] **Step 1: Read for context**

  Read `src/lib/lists/suppression.ts`'s `isSuppressed` function and `src/lib/lists/target-accounts.ts`'s `resolveAccountCap` function in full (both already exist, you're wrapping them, not reimplementing). Read `src/lib/campaigns/crud.ts`'s `IcpCriterionInput` type and the `IcpDimension`/`IcpOperator` enum values (`prisma/schema.prisma`, search for `enum IcpDimension` and `enum IcpOperator`).

- [ ] **Step 2: `checkSuppression`, `matchesTal`, `resolveLeadCap`, `checkDoNotContact`**

  ```ts
  import type { Prisma, PrismaClient } from "@prisma/client";
  import { isSuppressed } from "@/lib/lists/suppression";
  import { resolveAccountCap } from "@/lib/lists/target-accounts";

  type Db = PrismaClient | Prisma.TransactionClient;

  /** FR-IN-4 step 3: deliberately a no-op. See this plan's Global Constraints. */
  export function checkDoNotContact(): boolean {
    return false;
  }

  export async function checkSuppression(
    db: Db,
    campaignId: string,
    candidate: { email?: string; domain?: string; accountId?: string },
  ): Promise<boolean> {
    return isSuppressed(db, campaignId, candidate);
  }

  export async function resolveLeadCap(db: Db, campaignId: string, accountId: string): Promise<number | null> {
    return resolveAccountCap(db, campaignId, accountId);
  }

  export async function matchesTal(db: Db, campaignId: string, accountId: string): Promise<"noList" | "matched" | "unmatched"> {
    const listCount = await db.campaignTargetAccountList.count({ where: { campaignId } });
    if (listCount === 0) return "noList";

    const entry = await db.targetAccountEntry.findFirst({
      where: { accountId, list: { campaigns: { some: { campaignId } } } },
    });
    return entry === null ? "unmatched" : "matched";
  }
  ```

  Check `isSuppressed`'s exact parameter type before wiring `checkSuppression` through — match it precisely rather than guessing (Task 3's own read step above covers this).

- [ ] **Step 3: `matchesIcp`**

  Per-criterion dimension → source field mapping (only these dimensions are evaluated; `region` and `custom` have no corresponding `Account`/`Contact` column in this schema, so a criterion on either dimension is always **skipped**, per FR-IN-4 step 9's own phrasing — "ICP criteria match on **available fields**"):

  | Dimension | Source |
  |---|---|
  | `industry` | `account.industry` |
  | `employeeRange` | `account.employeeRange` |
  | `revenueRange` | `account.revenueRange` |
  | `country` | `account.country` |
  | `jobFunction` | `contact.jobFunction` |
  | `seniority` | `contact.seniority` |
  | `jobTitle` | `contact.jobTitle` |

  Per-criterion evaluation given the resolved source value `v: string | null` and `criterion.valuesJson: unknown[]` (cast each entry to `String(...)` before comparing — case-insensitive):
  - If `v === null` → **skip** this criterion (field not available on this account/contact).
  - `operator === "in"` → pass if `v` case-insensitively equals any entry.
  - `operator === "notIn"` → pass if `v` case-insensitively equals none of the entries.
  - `operator === "contains"` → pass if `v` case-insensitively contains any entry as a substring.
  - `operator === "between"` → try `Number(v)` and `Number(valuesJson[0])`/`Number(valuesJson[1])`; if all three are finite numbers, pass if `v`'s number is within `[min, max]` inclusive. If `v` isn't numeric (e.g. `employeeRange`/`revenueRange` stored as a bucketed string like `"50-200"`, which this schema has no canonical numeric encoding for), **skip** this criterion — don't guess at a parse. Leave a one-line comment explaining why.

  Overall result: run every `IcpCriterion` for the campaign (`db.icpCriterion.findMany({ where: { campaignId } })`) through the table above. A criterion result of `fail` where `criterion.isMandatory === true` sets `mandatoryFailed = true` and adds its `dimension` to `failedDimensions`; a `fail` where `isMandatory === false` only adds to `failedDimensions` (informational, never blocks — this is independent of the campaign-level `advisoryIcpMatch` flag, which Task 4 reads separately to decide whether a `mandatoryFailed: true` result blocks outright or routes to `needsReview`). A `skip` never adds to `failedDimensions` and never affects `mandatoryFailed`.

- [ ] **Step 4: Verify**

  `npx tsc --noEmit` clean. Write a throwaway `tsx` script (delete after, note in your report exactly what it did and that you deleted it — follow the pattern earlier tasks in this session's prior plans used for DB-touching verification) that: creates or reuses a test campaign with 2-3 `IcpCriterion` rows (mandatory `in` on `industry`, advisory `contains` on `jobTitle`), a `TargetAccountEntry`, and a `SuppressionEntry`; calls all four functions against a matching and a non-matching input; prints the results. Confirm nothing you created lingers afterward (delete any campaign/criteria/list rows your script made, unless you reused fixtures already seeded earlier in this session — check first with a read query before assuming you need to create anything).

- [ ] **Step 5: Commit**

  `git add src/lib/leads/matching.ts` and commit.

---

## Task 4: Intake orchestration

**Files:**
- Create: `src/lib/leads/intake.ts`

**Interfaces:**
- Consumes: `validateFieldValues` (Task 2), `checkDoNotContact`/`checkSuppression`/`matchesTal`/`resolveLeadCap`/`matchesIcp` (Task 3), `parseDelimited`/`applyMapping` (existing, `src/lib/lists/csv.ts`), `resolveAccount`/`createAccount` (existing, `src/lib/identity/account-resolution.ts`), `upsertContact` (existing, `src/lib/identity/contact.ts`).
- Produces: `submitLeadFile(db: PrismaClient, actor: Actor, input: SubmitLeadFileInput): Promise<SubmitLeadFileResult>` — the one function Task 5's server action calls.

  ```ts
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
  ```

- [ ] **Step 1: Read for context**

  Read `src/lib/lists/target-accounts.ts`'s `importTargetAccountList` in full — it's the closest existing precedent for "parse a file, loop rows, resolve an account per row, batch-write errors, update batch counters" and this task's structure should read like its sibling. Also read `src/lib/identity/account-resolution.ts` (`resolveAccount`, `createAccount`) and `src/lib/identity/contact.ts` (`upsertContact`) in full — there is no existing "find-or-create Account+Contact from a raw row" convenience function, you're the first caller to need to orchestrate both.

- [ ] **Step 2: Account/contact resolution per row**

  Given a row's normalized field values (from Task 2's `validateFieldValues`), using the canonical fieldKey convention (Global Constraints):

  1. `resolveAccount(db, { name: values.companyName, domain: values.companyDomain, country: values.country })`.
  2. If `status === "matched"` → use `accountId`.
  3. If `status === "unmatched"` → call `createAccount(db, actor, { name: values.companyName ?? values.companyDomain ?? "Unknown", domain: values.companyDomain, country: values.country })`. A row with neither `companyName` nor `companyDomain` present can't reasonably create an account — in that case, fail the row with `rejectReasonCode: "MISSING_REQUIRED_FIELD"`, `field: "companyName"`, before calling `createAccount` at all (don't let it default to a useless `"Unknown"` account — that fallback in the call above is only for the case where exactly one of the two is present).
  4. If `status === "ambiguous"` → this plan does not attempt to auto-resolve ambiguity (existing precedent in `importTargetAccountList` doesn't either — it records `matchStatus: "ambiguous"` for a human to resolve later via the existing resolution queue at `src/lib/identity/resolution-queue.ts`). Fail the row: no dedicated reject code exists for this in the vocabulary, so record it as a `LeadSubmissionError` (not a `Lead` row at all — this is a structural intake failure, not a business-rule rejection) with `message: "Account match is ambiguous — resolve manually before resubmitting"`. This is the one case in this pipeline where a row produces neither a `Lead` nor a business-rule-rejected `Lead`, only a `LeadSubmissionError` — document why in a code comment (there's no `RejectReason` for "a human needs to look at this before we can even attempt validation," and inventing one would misrepresent it as a business-rule outcome).
  5. Once `accountId` is resolved, `upsertContact(db, { email: values.email, accountId, firstName: values.firstName, lastName: values.lastName, jobTitle: values.jobTitle, seniority: values.seniority, jobFunction: values.jobFunction, phone: values.phone, country: values.country })`.

- [ ] **Step 3: The per-row pipeline**

  For each row (after Task 2's field validation has already run and, if it produced errors, the row is recorded as a `LeadSubmissionError` per field-error and skipped — a row with ANY field-validation error never reaches account resolution or business-rule checks, since there's nothing valid to resolve against):

  Load once per submission (not per row): the campaign's `LeadFieldSpec[]` (for Task 2), the `Campaign` row (for `advisoryTalMatch`/`advisoryIcpMatch`/`defaultMaxLeadsPerAccount`/`id`), via `campaignChannel.campaign`.

  ```
  outcome = "passed"          // "passed" | "needsReview" | "failed"
  rejectReasonCode = null     // set on first failure (blocking or advisory) that isn't overridden by a later blocking failure

  1. checkDoNotContact() -> always false, no-op, continue

  2. checkSuppression(db, campaignId, { email, domain: accountDomain, accountId })
     if true: outcome = "failed"; rejectReasonCode = "SUPPRESSED_ACCOUNT"; STOP (short-circuit, blocking)

  3. duplicate-within-campaign: db.lead.findFirst({ where: { contactId, campaignChannel: { campaignId } } })
     if found: outcome = "failed"; rejectReasonCode = "DUPLICATE_IN_CAMPAIGN"; STOP (blocking)

  4. matchesTal(db, campaignId, accountId)
     if "unmatched":
       if campaign.advisoryTalMatch: outcome = max(outcome, "needsReview"); if rejectReasonCode is null: rejectReasonCode = "NOT_ON_TARGET_ACCOUNT_LIST" — do NOT stop, continue to next check
       else: outcome = "failed"; rejectReasonCode = "NOT_ON_TARGET_ACCOUNT_LIST"; STOP (blocking)
     if "noList" or "matched": continue, no effect

  5. resolveLeadCap(db, campaignId, accountId) -> cap
     if cap !== null:
       acceptedCount = db.lead.count({ where: { accountId, campaignChannel: { campaignId }, lifecycleStatus: "accepted" } })
       if acceptedCount >= cap: outcome = "failed"; rejectReasonCode = "ACCOUNT_CAP_REACHED"; STOP (blocking — this check has no advisory mode per the spec)

  6. matchesIcp(db, campaignId, account, contact) -> { mandatoryFailed, failedDimensions }
     if mandatoryFailed:
       icpCode = pick one of ICP_INDUSTRY_MISMATCH / ICP_SIZE_MISMATCH / ICP_GEO_MISMATCH / ICP_SENIORITY_MISMATCH based on failedDimensions[0] (map industry->ICP_INDUSTRY_MISMATCH, employeeRange/revenueRange->ICP_SIZE_MISMATCH, country/region->ICP_GEO_MISMATCH, jobFunction/seniority/jobTitle->ICP_SENIORITY_MISMATCH — see mapping table below)
       if campaign.advisoryIcpMatch: outcome = max(outcome, "needsReview"); if rejectReasonCode is null: rejectReasonCode = icpCode
       else: outcome = "failed"; rejectReasonCode = icpCode; STOP (blocking)
  ```

  `max(outcome, "needsReview")` means: if `outcome` is currently `"passed"`, set it to `"needsReview"`; if it's already `"failed"` or `"needsReview"`, leave it. `"failed"` set by a later blocking check always overrides an earlier advisory `"needsReview"` (a blocking failure is always worse) — this is naturally what the pseudocode above does since a blocking failure's branch unconditionally sets `outcome = "failed"` and `STOP`s regardless of the current value.

  ICP dimension → reject code mapping (for step 6 above):
  ```ts
  const ICP_CODE_BY_DIMENSION: Record<string, string> = {
    industry: "ICP_INDUSTRY_MISMATCH",
    employeeRange: "ICP_SIZE_MISMATCH",
    revenueRange: "ICP_SIZE_MISMATCH",
    country: "ICP_GEO_MISMATCH",
    jobFunction: "ICP_SENIORITY_MISMATCH",
    seniority: "ICP_SENIORITY_MISMATCH",
    jobTitle: "ICP_SENIORITY_MISMATCH",
  };
  ```

  After the pipeline, map `outcome` to `Lead.verificationStatus`: `"passed"` → `"passed"`, `"needsReview"` → `"needsReview"`, `"failed"` → `"failed"`. `lifecycleStatus` is **always** `"new"` regardless of `outcome` (Global Constraints — acceptance/rejection are E9's job, not this pipeline's). `clientVisible` is **always** `false`.

- [ ] **Step 4: `submitLeadFile` — the transaction**

  ```ts
  export async function submitLeadFile(
    db: PrismaClient,
    actor: Actor,
    input: SubmitLeadFileInput,
  ): Promise<SubmitLeadFileResult> {
    assertPermission(actor, "campaign:write"); // reuse this permission — lead intake is a campaign-operations action, no dedicated "lead:write" permission exists and this plan does not add one; note this explicitly in your report as a scope decision, not an oversight, so the controller can confirm or correct it in review.

    const campaignChannel = await db.campaignChannel.findUniqueOrThrow({
      where: { id: input.campaignChannelId },
      include: { campaign: true },
    });
    assertOrganizationAccess(actor, campaignChannel.campaign.clientOrganizationId);

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

    const submissionErrors: { rowNumber: number; field: string | null; rawValue: string | null; message: string }[] = [];
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

      // ... account/contact resolution (Step 2), the per-row pipeline (Step 3) ...
      // On success: create the Lead row + a LeadStatusHistory row (dimension: "verification", fromValue: null, toValue: <verificationStatus>), increment rowsAccepted.
      // On ambiguous-account: push exactly one entry to submissionErrors instead (Step 2.4), increment rowsFailed, don't increment rowsAccepted.
    }

    await db.leadSubmissionError.createMany({ data: submissionErrors.map((e) => ({ ...e, submissionId: submission.id })) });
    await db.leadSubmission.update({
      where: { id: submission.id },
      data: { rowsAccepted, rowsFailed, status: "completed" },
    });

    return { submissionId: submission.id, rowsTotal: parsed.rows.length, rowsAccepted, rowsFailed };
  }
  ```

  This is scaffolding, not complete code — fill in Steps 2 and 3's logic inside the loop yourself, following the pseudocode precisely. **`rowsFailed` counts distinct rows, not error entries** — `submissionErrors` can hold more than one entry for the same `rowNumber` (Task 2's `validateFieldValues` deliberately reports every bad field on a row, not just the first), so `submissionErrors.length` is the wrong count for `LeadSubmission.rowsFailed`; increment a separate `rowsFailed` counter exactly once per row that fails, as shown above. Get this wrong and a partner's error report will look like it rejected more rows than it actually did. **Do not wrap the whole per-row loop in one giant `db.$transaction`** — `importTargetAccountList`/`importSuppressionList` don't either (confirm this yourself by re-reading them), because a large multi-row CSV in one transaction risks lock contention and timeout; each row's `Lead`-creation (account resolve/create + contact upsert + lead create + status-history create) is the unit that should be transactionally consistent with itself (wrap just that part per row in `db.$transaction(async (tx) => {...})`), not the whole file. `rowsAccepted` counts rows that produced a `Lead` record, regardless of `verificationStatus` (`"passed"`, `"needsReview"`, and `"failed"` from the business-rule pipeline all count as accepted — they became a `Lead`); `rowsFailed` counts rows that never became a `Lead` at all (field-validation errors, ambiguous-account rows). This matches the plan's earlier note that `rowsAccepted`/`rowsFailed` are about the file-level structural outcome, not the business-rule verdict — don't conflate the two.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Using the seeded test campaign from prior plans in this session (`cmtn0l8hz00002f3p61qoqg4p` — check it still exists and has at least one `CampaignChannel`; if the campaign has no channel yet, add one first via the existing `AddChannelDialog` UI or `addCampaignChannel` function directly), and after adding at least one `LeadFieldSpec` with `fieldKey: "email"` to it (via the existing lead field spec editor UI, or directly via `setLeadFieldSpec`), write a throwaway `tsx` script (delete after, report what it did) that calls `submitLeadFile` with a small in-memory CSV string (3-4 rows: one fully valid, one with a bad email, one duplicate of another). Print the `SubmitLeadFileResult` and query the created `Lead`/`LeadSubmissionError` rows to confirm the counts and `verificationStatus`es make sense. Clean up the rows your script created (or leave them and note it — this fixture will be reused by Tasks 5/6's own verification, so leaving one clean successful submission in place is fine and arguably useful; just say so explicitly).

- [ ] **Step 6: Commit**

  `git add src/lib/leads/intake.ts` and commit.

---

## Task 5: Upload UI and server action

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/leads/upload/page.tsx`
- Create: `src/app/(admin)/campaigns/[id]/leads/upload/upload-form.tsx`
- Create: `src/app/(admin)/campaigns/[id]/leads/actions.ts`

**Interfaces:**
- Produces: `submitLeadFileAction(input: { campaignChannelId: string; sourceType: "internal" | "partner"; content: string; mapping: Record<string,string> }): Promise<ActionResult<{ submissionId: string; rowsTotal: number; rowsAccepted: number; rowsFailed: number }>>`.
- Consumes: `submitLeadFile` (Task 4).

- [ ] **Step 1: Read for context**

  Read `src/app/(admin)/campaigns/new/new-campaign-form.tsx` and `src/app/(admin)/campaigns/new/page.tsx` (the full-page-not-modal pattern this app uses for substantial forms — breadcrumb comes from the shared top bar automatically per the earlier sidebar-redesign plan, don't add a page-level breadcrumb). Read `src/app/(admin)/campaigns/[id]/page.tsx` (as it currently stands, after the `campaign-config-editors` plan) for how it fetches `campaign`/`channels`.

- [ ] **Step 2: `src/app/(admin)/campaigns/[id]/leads/actions.ts`**

  ```tsx
  "use server";

  import { revalidatePath } from "next/cache";
  import { db } from "@/lib/db";
  import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
  import { submitLeadFile } from "@/lib/leads/intake";

  export async function submitLeadFileAction(input: {
    campaignChannelId: string;
    campaignId: string; // only for revalidatePath — not passed into submitLeadFile
    sourceType: "internal" | "partner";
    content: string;
    mapping: Record<string, string>;
  }): Promise<ActionResult<{ submissionId: string; rowsTotal: number; rowsAccepted: number; rowsFailed: number }>> {
    return toActionResult(async () => {
      const actor = await requireActor();
      const result = await submitLeadFile(db, actor, {
        campaignChannelId: input.campaignChannelId,
        sourceType: input.sourceType,
        content: input.content,
        mapping: input.mapping,
      });
      revalidatePath(`/campaigns/${input.campaignId}/leads`);
      return result;
    });
  }
  ```

- [ ] **Step 3: `src/app/(admin)/campaigns/[id]/leads/upload/page.tsx`**

  Server component. `requireActor()`, `assertPermission(actor, "campaign:write")`. Fetch the campaign (`getCampaignForActor` from `@/lib/campaigns/crud`, same as the main detail page) — you need its `channels` (for the channel picker, label each option `${channel.channelTypeVersion.definitionJson.name ?? channel.channelTypeVersion.definitionJson.code} — ${channel.startDate}..${channel.endDate}`, matching the existing detail page's own rendering of a channel's label) and its `leadFieldSpecs` (for the mapping form — pass `{fieldKey, label, isRequired}[]` down as props). Render `<UploadForm campaignId={campaign.id} channels={...} leadFieldKeys={...} />` inside a full-page layout (title "Upload leads", a description paragraph, "Back to campaign" link) matching `campaigns/new/page.tsx`'s structure.

- [ ] **Step 4: `src/app/(admin)/campaigns/[id]/leads/upload/upload-form.tsx`**

  Client component. Three-part form on one page (no wizard/stepper needed — this is a single scrollable form, simpler than it sounds):
  1. Channel select (from `channels` prop) and source-type select (`internal` | `partner` — a plain two-option `Select`, no UI distinction needed beyond that since there's no partner portal to source it from yet; an internal ops user picks `partner` manually to record where a batch came from).
  2. A native `<input type="file" accept=".csv" />`. On change, read the file client-side with `file.text()` (`await file.text()`, store in component state as `content: string`), and parse just the header row for the mapping UI below — do NOT re-implement CSV parsing client-side; the simplest correct approach is `content.split("\n")[0].split(",").map(h => h.trim())` for a **header preview only** (this is display-only, to populate the mapping dropdowns; the actual parse-with-quoting-and-escaping happens server-side via `parseDelimited` inside `submitLeadFile`, so a naive client-side header split is fine even though it wouldn't be robust enough for full row parsing).
  3. Once headers are known, render one `Select` per `leadFieldKeys` entry (label = spec's `label`, required specs marked with `*`), each mapping that field to one of the CSV headers (`Select` options = the parsed headers, plus an explicit "— not mapped —" option for non-required fields). Build the `mapping: Record<string,string>` as `{ [csvHeader]: fieldKey }` — **note the direction**: `applyMapping` (existing, `src/lib/lists/csv.ts`) expects `mapping[sourceColumnHeader] = canonicalKey`, so make sure the `Select`'s selected fieldKey is stored keyed by the CSV header string, not the other way around — get this backwards and every row silently maps to nothing.

  On submit: call `submitLeadFileAction`, `useTransition` + `toast` per this codebase's established pattern (see `new-campaign-form.tsx`). On success, `toast.success(`${result.data.rowsAccepted} of ${result.data.rowsTotal} rows accepted`)` and `router.push(`/campaigns/${campaignId}/leads`)`.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Curl-check (session cookie, as throughout this session) that `GET /campaigns/<id>/leads/upload` for the seeded test campaign returns 200 and the page renders (grep for the channel select / file input's presence — file inputs render as `<input type="file"` in the raw HTML, that's a reasonable grep target). Actually driving a file upload through curl against a server action isn't practical (same reasoning prior plans in this session used for dialogs) — note that in your report; `tsc` cleanliness plus a structural read of your own diff against the brief is this step's primary gate, same as before.

- [ ] **Step 6: Commit**

  `git add "src/app/(admin)/campaigns/[id]/leads/upload/page.tsx" "src/app/(admin)/campaigns/[id]/leads/upload/upload-form.tsx" "src/app/(admin)/campaigns/[id]/leads/actions.ts"` and commit.

---

## Task 6: Submissions and staged-leads list

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/leads/page.tsx`
- Create: `src/app/(admin)/campaigns/[id]/leads/submission-errors.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 5's `/leads/upload` route (linked from this page); `actions.ts` as Task 5 left it (append nothing new unless you need a "view submission errors" action — a plain server-component data fetch is enough, no new action needed for a read-only view).

- [ ] **Step 1: Read for context**

  Read the current `src/app/(admin)/campaigns/[id]/page.tsx` (as left by the `campaign-config-editors` plan — it now has ICP criteria, lead field spec, and Channels cards) and `src/app/(admin)/campaigns/page.tsx` (for the list-page table pattern: filters via a zustand store, `CampaignTable`-style rendering — you likely don't need a client-side filter store here, a plain server-rendered table is enough given the expected row counts, but look at `campaign-table.tsx` for the `Badge`/status-styling convention to match).

- [ ] **Step 2: `src/app/(admin)/campaigns/[id]/leads/page.tsx`**

  Server component. `requireActor()`, `getCampaignForActor` (for the channel list / breadcrumb-adjacent title), then two queries: `db.leadSubmission.findMany({ where: { campaignChannel: { campaignId: id } }, include: { errors: { take: 10 } }, orderBy: { submittedAt: "desc" } })` and `db.lead.findMany({ where: { campaignChannel: { campaignId: id } }, include: { account: true, contact: true, rejectReason: true }, orderBy: { createdAt: "desc" }, take: 100 })`. Render two `Card`s: "Submissions" (table: submitted date, source type, rows total/accepted/failed, status badge, a link/expander to `<SubmissionErrors>` if `rowsFailed > 0`) and "Leads" (table: account name, contact email, verification status badge, reject reason label if any, created date) — same `Table`/`Badge` components used throughout this app's other list views. Add an "Upload leads" button (`Link` to `./leads/upload`) in the Submissions card's header, matching the `flex flex-row items-center justify-between` `CardHeader` convention already used on the campaigns list page and the campaign detail page's Channels card.

  Status badge coloring: match `campaign-table.tsx`'s `statusVariant` pattern — `"passed"` → `default`, `"failed"` → `destructive`, `"needsReview"`/`"pending"`/`"autoValidating"` → `outline`.

- [ ] **Step 3: `src/app/(admin)/campaigns/[id]/leads/submission-errors.tsx`**

  A small client component (or a server component rendered conditionally, your judgment — no interactivity is strictly required here beyond maybe a "show all" toggle if a submission has more than 10 errors, which is optional polish, not required) that renders a `LeadSubmission`'s `errors` as a table: row number, field, raw value, message. No download/export functionality in this task — FR-IN-3 asks for a "downloadable error report" but this plan's scope stops at an on-page viewable one; note this as a deliberate, small, cheap-to-add-later deferral in your report (a CSV-export button is a follow-up, not core to "no lead is client-visible before verification passes," which is this epic's actual load-bearing requirement).

- [ ] **Step 4: Wire a link from the campaign detail page**

  In `src/app/(admin)/campaigns/[id]/page.tsx`, add a `Link` to `./leads` somewhere sensible near the top (next to the existing status badges, or as its own small row) — e.g. `<Link href={`/campaigns/${campaign.id}/leads`}><Button variant="outline" size="sm">View leads</Button></Link>`. This is the only change to this file — don't touch the ICP/lead-field-spec/Channels cards.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Curl-check `GET /campaigns/<id>/leads` returns 200 and shows the submission/lead rows Task 4's verification step created (if you left that fixture in place per Task 4's own note) — grep for a recognizable value from that test data (an email, or the submission's row counts) in the response. Also confirm `GET /campaigns/<id>` still 200s and now contains a link to `/campaigns/<id>/leads`.

- [ ] **Step 6: Commit**

  `git add "src/app/(admin)/campaigns/[id]/leads/page.tsx" "src/app/(admin)/campaigns/[id]/leads/submission-errors.tsx" "src/app/(admin)/campaigns/[id]/page.tsx"` and commit.
