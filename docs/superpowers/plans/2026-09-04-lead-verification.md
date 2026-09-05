# Plan: PRD Epic E9 — Validation and verification

**Spec:** `prd.md` §E9 (P0), `srs.md` §4.7 (Leads), §5.2/5.3 (Lead verification/lifecycle state machines), §6.2 FR-VF-1..5.

## Context

E8 (lead intake, previous plan) built the `Lead`/`LeadSubmission`/`LeadSubmissionError`/`LeadStatusHistory` schema and the `submitLeadFile` pipeline (`src/lib/leads/intake.ts`), which writes every lead with `lifecycleStatus: "new"` and a `verificationStatus` of `passed` | `needsReview` | `failed` from automated checks only. Nothing currently moves a lead out of `needsReview`, nothing ever sets `lifecycleStatus: "accepted" | "rejected"`, and `clientVisible` never becomes `true`. This plan builds that: the manual verification queue, tele-verification capture, and the accept/reject decision itself (FR-VF-1..4), plus one missing automated check (cross-campaign dedupe) that belongs in the intake pipeline but was out of E8's scope.

The reject-reason vocabulary already anticipates this epic: `prisma/seed/reject-reasons.ts` already seeds `DUPLICATE_CROSS_CAMPAIGN`, `TELE_UNREACHABLE`, `TELE_DENIED_INTEREST`, `ALLOCATION_CAP_EXCEEDED`, `CONSENT_MISSING`, `CONSENT_INVALID`, `QUALIFYING_ANSWER_UNACCEPTABLE`, `QUALIFYING_ANSWER_MISSING` — none of them are applied by any code path yet. This plan wires up `DUPLICATE_CROSS_CAMPAIGN`, `TELE_UNREACHABLE`, and `TELE_DENIED_INTEREST`. **No new reject-reason codes need seeding.**

## Global Constraints

**Scope actually implemented (FR-VF-1..4, partial):**
- FR-VF-1: manual verification queue for `needsReview` leads, with campaign filter and self-assignment. ✅ in scope.
- FR-VF-2: tele-verification gate (`VerificationRecord` with `method: "tele"`, populated `callSystem`/`callReferenceId`) before acceptance, when `channelType.requiresTeleVerification`. ✅ in scope. The platform validates the reference is present, not that the call happened — no telephony integration is built or needed.
- FR-VF-2a-e: business-day SLA computation (elapsed raw + business minutes, breach flag, 75%-highlight, per-channel-type override falling back to the platform default, calendar changes don't retroactively recompute stored breach status). ✅ in scope.
- FR-VF-3: transactional acceptance (`acceptedAt`, `clientVisible: true`, `lifecycleStatus: "accepted"`, `verificationStatus: "passed"` if it wasn't already, one `$transaction`). ✅ in scope, **except** "increments the campaign channel and allocation counters" — see deferrals below.
- FR-VF-4: rejection records a reason code. ✅ in scope. "Notifies the submitting partner" — deferred, no partner portal exists.
- FR-VF-5 (replacement tracking): **deferred entirely** — depends on `Allocation` (PRD E7), which does not exist in the schema at all. No `replacementForLeadId` field is added in this plan; adding it now with no consumer would be dead schema. Revisit when E7 lands.
- PRD's E9 "automated rules: cross-campaign dedupe": **added to `intake.ts`** (Task 3) as a new blocking check, since it belongs in the automated pipeline, not the manual queue, and E8's plan closed before this was scoped.
- PRD's E9 "automated rules: consent completeness": **deferred** — depends on `EngagementEvent`/`ConsentTextVersion` being populated by form capture (E5/E19), which doesn't exist. No `sourceType: "form"` lead can be produced today (E8 only builds `internal`/`partner` upload paths), so there is nothing to check consent completeness against yet.
- "Increments the campaign channel and allocation counters": **deferred**. `Allocation` doesn't exist (no counter to increment there). `CampaignChannel` has no running "accepted count" column — quota fulfillment/auto-complete (FR-CS-3) is a campaign-state-machine concern, computed by counting `Lead` rows with `lifecycleStatus: "accepted"` when needed (already how `resolveLeadCap`'s per-account cap works in `intake.ts`), not a field this plan adds. Do not add a counter column to `CampaignChannel`.
- `Lead.deliveredAt`, `Lead.anonymisedAt`, `Lead.legalHold`: **deferred** — E11 (delivery) and E16 (compliance) concerns, no consumer yet.

**Verification convention** (same as the lead-intake plan, no browser automation available): `npx tsc --noEmit` + `npx eslint <files>` as the primary gate; curl with a session cookie (`POST /api/auth/sign-in/email`, `bhanu@intellifunnel.io` / `TestPass123!`) for HTTP-reachable checks; throwaway `tsx` scripts (written, run, deleted, before/after state confirmed) against the shared dev DB for logic not reachable via HTTP.

**Permissions:** two new `Permission` values, `"lead:read"` and `"lead:write"`, granted to `QUALITY` only (not `OPERATIONS` or `CAMPAIGN_MANAGER`) — the PRD's role table (§2.3) explicitly assigns "Reviews leads, applies reject reasons, audits consent" to the Quality/Verification role, distinct from Operations' "partner allocation, lead intake" duties. `SUPER_ADMIN` gets both via the existing bypass in `hasPermission`. `lead:read` gates viewing the verification queue; `lead:write` gates assign/accept/reject.

**SLA computation is a snapshot, not a live-updated column:** `Lead.verificationElapsedMinutes`, `verificationElapsedBusinessMinutes`, and `slaBreached` are computed and written **once, at the accept/reject decision** — not recomputed on every read. This matches FR-VF-2e ("changing the calendar affects future calculations only; breach status already recorded is not recomputed") without needing a background job. For leads still awaiting a decision, the queue UI computes elapsed/breach status **live, in memory, for display only** (75%-amber / breached-red highlighting) — nothing is written to the DB until a decision is made.

**Cross-campaign dedupe scope** (Task 3): a lead is a cross-campaign duplicate when the same `contactId` already has a `Lead` row on a **different campaign belonging to the same `clientOrganizationId`**, with `lifecycleStatus` in `{"new", "accepted", "delivered"}` (i.e., not already rejected there — a contact rejected everywhere else is not "already served"). This is a **blocking** check with no advisory mode, inserted immediately after the existing `DUPLICATE_IN_CAMPAIGN` check in `intake.ts`, same unconditional-block precedent as `DUPLICATE_IN_CAMPAIGN` and `ACCOUNT_CAP_REACHED` (neither has an advisory toggle either).

**Assignment is self-assign only:** `Lead.assignedToUserId`/`assignedAt` support one action — "claim" (assign the lead to the current actor). No reassignment or unassign UI in this plan; a `SUPER_ADMIN` can still clear it directly in the DB if ever needed, and the fields are simple enough that a reassignment action is a trivial follow-up.

**Tele-verification review is one form, not two steps:** when `channelType.requiresTeleVerification` is true, the same accept/reject action in the review UI includes the tele-verification fields (`callSystem`, `callReferenceId`, `callOccurredAt`, `callDurationSeconds`, `notes`) and creates the `VerificationRecord` as part of the same decision — there is no separate "log the call" step before "make the decision" step.

## Task 1: Schema — `VerificationRecord`, `Lead` SLA/assignment fields, permissions

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/auth/permissions.ts`
- New migration (via `npx prisma migrate dev --name add_lead_verification`)

- [ ] **Step 1:** Add to `prisma/schema.prisma`:

  ```prisma
  enum VerificationMethod {
    auto
    manual
    tele
  }

  enum VerificationOutcome {
    pass
    fail
    needsReview
  }

  model VerificationRecord {
    id               String               @id @default(cuid())
    leadId           String
    method           VerificationMethod
    ruleResultsJson  Json?
    outcome          VerificationOutcome
    verifiedByUserId String?
    callSystem       String?
    callReferenceId  String?
    callOccurredAt   DateTime?
    callDurationSeconds Int?
    callRecordingKey String?  // reserved, unused in v1 — see srs.md §4.7
    notes            String?
    occurredAt       DateTime @default(now())

    lead Lead @relation(fields: [leadId], references: [id])

    @@index([leadId])
  }
  ```

  Add to the existing `Lead` model:
  ```prisma
  acceptedAt                        DateTime?
  rejectedAt                        DateTime?
  assignedToUserId                  String?
  assignedAt                        DateTime?
  verificationElapsedMinutes        Int?
  verificationElapsedBusinessMinutes Int?
  slaBreached                       Boolean   @default(false)
  ```
  And a back-relation: `verificationRecords VerificationRecord[]`.

  Run `npx prisma migrate dev --name add_lead_verification`. This is purely additive (one new model, one new enum pair, six new nullable/defaulted columns on `Lead`) — no existing column is altered or dropped.

- [ ] **Step 2:** In `src/lib/auth/permissions.ts`, add `"lead:read"` and `"lead:write"` to the `Permission` union, and add both to `QUALITY`'s array only:
  ```ts
  QUALITY: ["organization:read", "account:read", "campaign:read", "channelType:read", "lead:read", "lead:write"],
  ```
  Do not add these to any other role's array.

- [ ] **Step 3: Verify**

  `npx tsc --noEmit` clean. `npx prisma validate`. Live psql (or a throwaway script) confirms the migration applied and the new table/columns exist. Confirm via a throwaway script that `hasPermission({..., roles: ["QUALITY"]}, "lead:write")` returns `true` and the same for `CAMPAIGN_MANAGER`/`OPERATIONS` returns `false`.

- [ ] **Step 4: Commit**

---

## Task 2: Business-day SLA computation

**Files:**
- Create: `src/lib/leads/sla.ts`

**Interfaces:**
- `computeVerificationSla(db: Db, params: { createdAt: Date; asOf: Date; channelTypeId: string }): Promise<{ elapsedMinutes: number; elapsedBusinessMinutes: number; allowedBusinessDays: number; breached: boolean; percentElapsed: number }>`

- [ ] **Step 1: Read for context**

  Read `prisma/schema.prisma`'s `Holiday` model (fields: `date` `@db.Date`, `name`, `country`, `isActive`, unique on `[country, date]`). Read `src/lib/settings/settings.ts` for `getSetting(db, "defaultVerificationSlaBusinessDays" | "operatingTimezone" | "workingDays")` and the `WeekDay` type it uses. Read `src/lib/time/operating-day.ts`'s `operatingDayStart` for the existing timezone-boundary convention to stay consistent with (day boundaries computed in the configured `operatingTimezone`, not server-local time or naive UTC).

- [ ] **Step 2: `allowedBusinessDays` resolution**

  `channelType.verificationSlaBusinessDays ?? await getSetting(db, "defaultVerificationSlaBusinessDays")`. The caller passes `channelTypeId`; look up `db.channelType.findUniqueOrThrow({ where: { id: channelTypeId } })` for `verificationSlaBusinessDays`.

- [ ] **Step 3: Business-day elapsed calculation**

  Walk calendar days from `createdAt`'s operating-day (via `operatingDayStart`) to `asOf`'s operating-day, in the `operatingTimezone` setting. For each calendar day in that range (inclusive of the start day, exclusive of `asOf`'s partial day — use whole elapsed days plus a same-day fraction, simplest correct approach: count whole calendar days between the two operating-day boundaries, then subtract one business-day-unit for each day in that range that is NOT in `workingDays` (from settings, e.g. `["MO","TU","WE","TH","FR"]`) or that has an active `Holiday` row for the country configured... **country is ambiguous here (Holiday is per-country, but there's no single "the" country to scope by)** — for v1, treat all active `Holiday` rows as applying regardless of country (i.e., ignore the `country` column when filtering, treat the table as one shared calendar) and note this in a code comment as a known simplification consistent with the SRS's own §11 risk #1 ("A single holiday list is assumed... per-country calendars will be needed before the SLA reporting is trusted" — already an acknowledged open risk in the spec itself, not a new one this plan introduces).

  `elapsedMinutes = asOf.getTime() - createdAt.getTime()` in whole minutes (simple wall-clock elapsed, no calendar logic — this is FR-VF-2c's "raw elapsed time").

  `elapsedBusinessMinutes`: of the whole elapsed span, count only minutes falling on a working day (per `workingDays` and non-holiday) — for v1, a day-level granularity is sufficient (per PlatformSetting's own `workingHours` note: "used only if hour-level SLA precision is enabled; day-level is the default"), so compute this as `elapsedBusinessDays * 1440` where `elapsedBusinessDays` is the count of working-calendar days strictly between `createdAt`'s day and `asOf`'s day (inclusive of both endpoints' days if they are working days), not fractional. Keep the algorithm simple and testable — no hour-level partial-day logic in v1.

  `breached = elapsedBusinessMinutes > allowedBusinessDays * 1440`.
  `percentElapsed = elapsedBusinessMinutes / (allowedBusinessDays * 1440)`.

- [ ] **Step 4: Verify**

  `npx tsc --noEmit` clean. Throwaway script: (a) a lead created on a Friday in the operating timezone, `asOf` the following Monday morning, with `workingDays = MO-FR` and no holidays — assert business-day elapsed is small (the weekend doesn't count), matching FR-VF-2b's literal example ("arriving Friday evening is not in breach on Monday morning") for a 3-business-day SLA; (b) a holiday inserted on a weekday within the elapsed range — assert it's excluded from the business-day count; (c) a `channelType.verificationSlaBusinessDays` override present — assert it wins over the platform default; (d) absent — assert the platform default is used.

- [ ] **Step 5: Commit**

---

## Task 3: Cross-campaign dedupe check (intake pipeline)

**Files:**
- Modify: `src/lib/leads/intake.ts`

**Interfaces:** no new exported function — this is one new check inlined into `submitLeadFile`'s existing per-row pipeline.

- [ ] **Step 1: Read for context**

  Read `src/lib/leads/intake.ts` lines ~255-335 (the existing per-row business-rule pipeline: `checkDoNotContact`, the existing `DUPLICATE_IN_CAMPAIGN` check at ~267-275, `matchesTal`, `resolveLeadCap`, `matchesIcp`, in that order) and the `campaign` object already loaded earlier in the function (confirm it carries `clientOrganizationId` — `db.campaign.findUniqueOrThrow` should already select or default-include it; check and add to the `select`/default fetch if not already present).

- [ ] **Step 2: Insert the check**

  Immediately after the existing `DUPLICATE_IN_CAMPAIGN` check (`if (outcome !== "failed") { ... }` block ending around line 275) and before the TAL check, insert:

  ```ts
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
  ```

  No advisory mode — this is an unconditional block, same as `DUPLICATE_IN_CAMPAIGN`.

- [ ] **Step 3: Verify**

  `npx tsc --noEmit` clean. Throwaway script: (a) same contact, two different campaigns under the same client org, second submission gets `DUPLICATE_CROSS_CAMPAIGN` and `verificationStatus: "failed"`; (b) same contact, two campaigns under *different* client orgs — no dedupe fires, second lead is created normally; (c) same contact re-submitted to a campaign where their prior cross-campaign lead was `rejected` — no dedupe fires (rejected doesn't count as "already served"); (d) confirm this check runs *after* `DUPLICATE_IN_CAMPAIGN` and *before* `matchesTal` in the diff (ordering matters for which `rejectReasonCode` wins when multiple would apply — the plan's precedence is first-blocking-check-wins, unchanged from before).

- [ ] **Step 4: Commit**

---

## Task 4: Manual verification queue UI

**Files:**
- Create: `src/app/(admin)/verification/page.tsx`
- Create: `src/app/(admin)/verification/actions.ts`
- Create: `src/app/(admin)/verification/queue-row-actions.tsx`

**Interfaces:**
- Produces: `assignLeadToSelfAction(leadId: string): Promise<ActionResult<{ assignedToUserId: string }>>`.
- Consumes: Task 2's `computeVerificationSla` (for live, non-persisted highlighting only).

- [ ] **Step 1: Read for context**

  Read `src/app/(admin)/resolution-queue/page.tsx`, `actions.ts`, and `queue-row-actions.tsx` in full — this is the established work-queue pattern (server component fetch, `Table` + status `Badge`, row-action client component, cursor-based pagination per `NFR-P-1`, `assertPermission` + org-scoping). This queue follows the identical shape, adapted for: (a) `lead:read`/`lead:write` instead of `account:write`, (b) leads scoped `verificationStatus: "needsReview"` across all campaigns visible to the actor (org-scoped the same way `getCampaignForActor`/`listUnresolvedEntries` scope — via `campaignChannel.campaign.clientOrganizationId` matching `actor.organizationId` for non-internal actors; internal actors see all), (c) a campaign filter (`?campaignId=`, query param, same convention as any other filtered list page in this app — check `campaigns/page.tsx`'s zustand filter store only if this page's filter needs match that complexity; a single query-param filter almost certainly does not, keep it a plain `<select>` + server-side re-fetch via a `Link`/form, no client state store needed).

- [ ] **Step 2: `src/app/(admin)/verification/page.tsx`**

  Server component. `requireActor()`, `assertPermission(actor, "lead:read")`. Query:
  ```ts
  db.lead.findMany({
    where: {
      verificationStatus: "needsReview",
      ...(actor.isInternal ? {} : { campaignChannel: { campaign: { clientOrganizationId: actor.organizationId } } }),
      ...(campaignIdFilter ? { campaignChannel: { campaignId: campaignIdFilter } } : {}),
    },
    include: {
      account: true,
      contact: true,
      rejectReason: true,
      campaignChannel: { include: { campaign: true, channelTypeVersion: { include: { channelType: true } } } },
    },
    orderBy: { createdAt: "asc" }, // oldest first — the queue's whole point is age-ordering
    take: 50,
  })
  ```
  For each row, call `computeVerificationSla(db, { createdAt: lead.createdAt, asOf: new Date(), channelTypeId: lead.campaignChannel.channelTypeVersion.channelType.id })` and use `percentElapsed`/`breached` for row highlighting: `breached` → destructive-styled row/badge, `percentElapsed >= 0.75` → outline/amber-styled badge, else default. Render campaign name, account name, contact email, `assignedToUserId` (as "Unassigned" or the assignee, resolve via a `db.user.findMany` batched lookup — do not N+1 per row), an SLA badge, and a row action: "Claim" (if unassigned) linking to `assignLeadToSelfAction`, or a link to `/verification/${lead.id}` (Task 6's review page) if already assigned to the current actor. A plain `<select>`-driven campaign filter above the table (options: distinct campaigns among the fetched leads' own campaign channels — or, simpler and correct, `db.campaign.findMany` scoped the same way, `distinct: ...` not needed if you just list all campaigns visible to the actor that have at least one `needsReview` lead; keep this simple, do not over-engineer the filter's option list).

- [ ] **Step 3: `src/app/(admin)/verification/actions.ts`**

  ```ts
  "use server";
  export async function assignLeadToSelfAction(leadId: string): Promise<ActionResult<{ assignedToUserId: string }>> {
    return toActionResult(async () => {
      const actor = await requireActor();
      assertPermission(actor, "lead:write");
      const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { campaignChannel: { include: { campaign: true } } } });
      if (!actor.isInternal && lead.campaignChannel.campaign.clientOrganizationId !== actor.organizationId) {
        throw new ForbiddenError("Lead not accessible to this actor");
      }
      const updated = await db.lead.update({ where: { id: leadId }, data: { assignedToUserId: actor.userId, assignedAt: new Date() } });
      revalidatePath("/verification");
      return { assignedToUserId: updated.assignedToUserId! };
    });
  }
  ```
  (Match this codebase's exact `ActionResult`/`toActionResult`/`ForbiddenError` import paths — verify against an existing actions.ts file rather than guessing.)

- [ ] **Step 4: `queue-row-actions.tsx`** — client component, `useTransition` + `toast`, "Claim" button calling `assignLeadToSelfAction`, matching `resolution-queue`'s `queue-row-actions.tsx` pattern exactly.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Curl-check `GET /verification` 200s and shows a `needsReview` fixture lead (reuse or create one via a throwaway script — E8's fixture campaign may not have a `needsReview` lead surviving; check first). Confirm the campaign filter query param changes the result set.

- [ ] **Step 6: Commit**

---

## Task 5: Accept/reject decision + tele-verification capture

**Files:**
- Create: `src/lib/leads/verification.ts`
- Modify: `src/app/(admin)/verification/actions.ts`

**Interfaces:**
- Produces: `decideLeadVerification(db: Db, actor: Actor, input: { leadId: string; decision: "accept" | "reject"; rejectReasonCode?: string; tele?: { callSystem: string; callReferenceId: string; callOccurredAt?: Date; callDurationSeconds?: number; notes?: string; outcome: "pass" | "fail" } }): Promise<{ lead: Lead }>`
- `acceptLeadAction`/`rejectLeadAction` server actions wrapping it, in the same `actions.ts` from Task 4.

- [ ] **Step 1: Read for context**

  Read the exact `LeadStatusHistory` write pattern already established in `intake.ts` (dimension `"verification"`/`"lifecycle"`, `fromValue`/`toValue` as the enum's string value, `changedByUserId` currently never set per the E8 plan's own documented deferral — **this task should set it**, since a human actor is now making the decision, unlike intake's automated pipeline). Read `intake.ts`'s existing `$transaction` usage as the pattern to follow for the accept/reject write.

- [ ] **Step 2: `src/lib/leads/verification.ts`**

  `decideLeadVerification`:
  1. Fetch the lead with `campaignChannel.channelTypeVersion.channelType` included.
  2. Permission + org-scope check (`lead:write`, same `clientOrganizationId` check as Task 4's action).
  3. If `decision === "accept"` and `channelType.requiresTeleVerification` is true: `input.tele` is required (throw a `ValidationError` if absent, same error class `intake.ts`/`field-validation.ts` already use); create a `VerificationRecord` with `method: "tele"`, the supplied `callSystem`/`callReferenceId`/`callOccurredAt`/`callDurationSeconds`/`notes`, `outcome: input.tele.outcome === "pass" ? "pass" : "fail"`, `verifiedByUserId: actor.userId`. If `input.tele.outcome === "fail"`, force `decision` to behave as a rejection with `rejectReasonCode` defaulting to `"TELE_UNREACHABLE"` if the caller didn't explicitly pass one from `{"TELE_UNREACHABLE", "TELE_DENIED_INTEREST"}` — do not accept a lead whose own tele-verification just failed.
  4. If `decision === "accept"` and no tele-verification is required: create a `VerificationRecord` with `method: "manual"`, `outcome: "pass"`, `verifiedByUserId: actor.userId`, no call fields.
  5. If `decision === "reject"`: `rejectReasonCode` is required (throw if absent); look up `db.rejectReason.findUniqueOrThrow({ where: { code } })`; if `channelType.requiresTeleVerification` and no tele info was supplied, still create a `VerificationRecord` with `method: "manual"`, `outcome: "fail"` (a manual reject doesn't require the tele fields — only *acceptance* requires proof of a completed tele-verification, matching FR-VF-2's literal wording: "require ... before **acceptance**").
  6. Compute the SLA snapshot via Task 2's `computeVerificationSla(db, { createdAt: lead.createdAt, asOf: new Date(), channelTypeId: channelType.id })`.
  7. In one `db.$transaction`: update the `Lead` — for accept: `verificationStatus: "passed"`, `lifecycleStatus: "accepted"`, `clientVisible: true`, `acceptedAt: now`, plus the SLA snapshot fields; for reject: `verificationStatus: "failed"`, `lifecycleStatus: "rejected"`, `rejectedAt: now`, `rejectReasonId`, plus the SLA snapshot fields (`clientVisible` stays `false`). Write two `LeadStatusHistory` rows (dimension `"verification"` and `"lifecycle"`, each with the real `fromValue`/`toValue`, `changedByUserId: actor.userId`).
  8. Return the updated lead.

- [ ] **Step 3: Server actions in `actions.ts`**

  `acceptLeadAction(leadId: string, tele?: {...}): Promise<ActionResult<{ leadId: string }>>` and `rejectLeadAction(leadId: string, rejectReasonCode: string, tele?: {...}): Promise<ActionResult<{ leadId: string }>>`, both thin wrappers calling `decideLeadVerification`, `revalidatePath("/verification")` and `revalidatePath(`/campaigns/${campaignId}/leads`)` (fetch `campaignId` from the returned lead's `campaignChannel.campaign.id`).

- [ ] **Step 4: Verify**

  `npx tsc --noEmit` clean. Throwaway script scenarios: (a) accept a `needsReview` lead on a channel with `requiresTeleVerification: false` — no tele fields required, lead becomes `accepted`/`clientVisible: true`; (b) accept on a `requiresTeleVerification: true` channel without tele info — throws; (c) same, with tele info and `outcome: "pass"` — succeeds, `VerificationRecord` created with `method: "tele"`; (d) same, with `outcome: "fail"` — lead is rejected instead (not accepted), reject reason defaults to `TELE_UNREACHABLE`; (e) reject with a reject reason code — lead becomes `rejected`, `clientVisible` stays `false`; (f) confirm `LeadStatusHistory` gets exactly 2 new rows per decision, both with `changedByUserId` populated; (g) confirm the SLA snapshot fields are non-null after either decision and match a hand-computed expectation for a lead created a known duration ago.

- [ ] **Step 5: Commit**

---

## Task 6: Review page (queue detail UI)

**Files:**
- Create: `src/app/(admin)/verification/[leadId]/page.tsx`
- Create: `src/app/(admin)/verification/[leadId]/review-form.tsx`

**Interfaces:**
- Consumes: Task 5's `acceptLeadAction`/`rejectLeadAction`.

- [ ] **Step 1: Read for context**

  Read `campaigns/[id]/leads/upload/page.tsx` + `upload-form.tsx` (Task 5/6 of the lead-intake plan) for this app's full-page-form + client-form-component pattern. Read the `Lead.fieldValuesJson` shape (a flat `Record<string, string>` keyed by canonical/spec fieldKey, per `intake.ts`) and the campaign's `qualificationForm`/`QualificationQuestion` models (via `campaignChannel.qualificationForm.questions`) for rendering the qualifying-answer review section — match each question to its answer via whatever key `fieldValuesJson` actually uses for question answers (check how `QualificationQuestion` and lead field capture relate; if there is no established wiring from questions to `fieldValuesJson` yet — this is plausible, since qualifying-answer *evaluation* was explicitly deferred in the E8 plan — render the raw `fieldValuesJson` as a label/value list instead of attempting a question-keyed mapping that doesn't exist yet, and note this as a deliberate simplification in your report).

- [ ] **Step 2: `page.tsx`**

  Server component. `requireActor()`, `assertPermission(actor, "lead:read")`. Fetch the lead by `leadId` param with `account`, `contact`, `campaignChannel.campaign`, `campaignChannel.channelTypeVersion.channelType` included. 404 (`notFound()`) if not found or not org-scoped-accessible. Render: account/contact summary, `fieldValuesJson` as a label/value table, the live (non-persisted) SLA badge from Task 2's `computeVerificationSla`, and `<ReviewForm>` with `requiresTeleVerification` and the active `RejectReason` list (`db.rejectReason.findMany({ where: { isActive: true } })`) passed as props.

- [ ] **Step 3: `review-form.tsx`**

  Client component. Two actions: "Accept" and "Reject". If `requiresTeleVerification`, show the tele fields (`callSystem`, `callReferenceId`, required text inputs; `callOccurredAt` datetime input; `callDurationSeconds` number input; a pass/fail radio for the tele outcome) above both buttons — both Accept and Reject can supply them, per Task 5's Step 2.5 (a manual reject doesn't strictly need them, but the reviewer may still be recording a failed tele-verification as the actual reason for rejecting, so don't hide the fields behind "only shown for Accept"). Reject additionally requires picking a `RejectReason` from the passed-in list (`Select`, grouped or plain, showing `label`). On success (`useTransition` + `toast`, same pattern as `upload-form.tsx`), `router.push("/verification")`.

- [ ] **Step 4: Verify**

  `npx tsc --noEmit` clean. Curl-check `GET /verification/<leadId>` for a fixture `needsReview` lead returns 200 and the raw HTML contains the account/contact/field-values content and (if applicable) the tele-verification inputs.

- [ ] **Step 5: Commit**
