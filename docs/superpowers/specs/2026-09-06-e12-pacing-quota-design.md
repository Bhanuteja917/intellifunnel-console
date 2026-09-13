# Design: PRD Epic E12 — Pacing and quota

**Spec:** `prd.md` §E12 (P0), §E9 bullet "Replacement tracking against the same allocation quota" (§227), §E7's deferred `AllocationCounter` note.

## Context

E7 (`2026-09-05-partner-allocation-design.md`) landed `PartnerAllocation` but explicitly deferred `AllocationCounter`/cap enforcement — "those need real submission/verification volume to mean anything." That volume now exists: E8 intake (`src/lib/leads/intake.ts`) and E9 verification (`src/lib/leads/verification.ts`) are both live on `main`. E12 is the epic that wires counters into those two paths and adds the enforcement + pacing signals the PRD asks for:

- Authoritative, transactional delivery counters per campaign channel and per allocation
- Delivered vs. expected-to-date against the flight window
- Behind-pace and ahead-of-pace signals
- Per-partner rejection rate monitoring
- Volume caps enforced at intake

Two gaps found during brainstorming that E12 must close before counters can mean anything:

1. **No deterministic lead→allocation binding.** `submitLeadFile` resolves a partner submission's allocation via `db.partnerAllocation.findFirst({ campaignChannelId, partnerOrganizationId })` (`intake.ts:95`) — but nothing stops `createAllocation` (`src/lib/allocations/crud.ts:33`) from creating a second row for the same partner+channel, so `findFirst` is not guaranteed to pick the row a per-allocation counter should credit.
2. **No client portal exists yet** (`src/app`'s only route groups are `(admin)` and `partner`), so PRD §E7-role-table's client-facing pacing view has no host page. That surface is E11/E15's to build, not E12's.

**Scope ruling made during brainstorming:**

1. Enforce one active (non-`ended`) `PartnerAllocation` per partner+channel — closes gap 1 without an `allocationId` FK migration on `Lead`/`LeadSubmission`.
2. Add `reservedCount`/`deliveredCount` to both `PartnerAllocation` and `CampaignChannel`, updated transactionally at intake and at verification decide.
3. Enforce caps at intake by claiming a counter slot atomically before a row is allowed to reach `needsReview` or auto-`passed`.
4. Pacing UI ships for admin (`campaigns/[id]/channels/[channelId]`) and partner (`/partner/allocations`) only. Client-facing pacing view is out of scope — no page exists to put it on.
5. Per-partner rejection rate is computed on read, not a stored counter — it's a display metric with no transactional-integrity requirement.

**Explicitly deferred, not part of this plan:**
- Any client-portal work (belongs to E11/E15, once that portal exists).
- `AllocationCounterEvent`-style ledger/audit table — `LeadStatusHistory` already logs every dimension transition with a timestamp and actor, which is enough to reconstruct counter history if ever needed.
- Tolerance-banded pace signals (e.g. "within 5% counts as on-pace") — P0 ships a plain behind/on/ahead comparison; banding is a tuning follow-up.
- E14 payout computation, E13 metrics ingestion, E15 reporting — unaffected by this plan beyond the counters it now makes available to them.

## Data model

```prisma
model PartnerAllocation {
  // ...unchanged fields...
  reservedCount  Int @default(0)
  deliveredCount Int @default(0)
}

model CampaignChannel {
  // ...unchanged fields...
  reservedCount  Int @default(0)
  deliveredCount Int @default(0)
}
```

No `RejectReasonCategory` change needed: `ALLOCATION_CAP_EXCEEDED` already exists in `prisma/seed/reject-reasons.ts` (`category: duplicate`, `isPartnerReplaceable: false`) — seeded but unused until now, since cap enforcement never existed before this plan. Only one new seed row is needed, `CHANNEL_CAP_REACHED`, matching that same `category: duplicate` / `isPartnerReplaceable: false` convention its sibling cap reasons (`ACCOUNT_CAP_REACHED`, `ALLOCATION_CAP_EXCEEDED`) already use — a quota-full condition isn't something the partner fixes and resubmits the same lead for; they wait for room (a rejection freeing a slot) or an admin raising the cap.

`allocatedQuantity`/`contractedQuantity` remain the caps; `reservedCount + deliveredCount` is the amount currently spoken for. No new model — matches `LeadSubmission.rowsAccepted`/`rowsFailed`'s existing denormalized-counter convention.

### Allocation-uniqueness guard

`createAllocation` (`src/lib/allocations/crud.ts:33`) gains a check: reject with `ValidationError` if a non-`ended` `PartnerAllocation` already exists for `(campaignChannelId, partnerOrganizationId)`. Backed by a partial unique index (hand-added to the generated migration SQL, since Prisma's schema DSL can't express partial uniqueness):

```sql
CREATE UNIQUE INDEX "PartnerAllocation_channel_partner_active_key"
  ON "PartnerAllocation" ("campaignChannelId", "partnerOrganizationId")
  WHERE "status" != 'ended';
```

The app-level check alone races under concurrent creates; the index is the actual guarantee. Existing "reallocate" UI flow (`updateAllocationAction` → `updateAllocation`) is unaffected — it edits a row in place and was never creating duplicates.

### Backfill

Existing seeded/demo data (per `reference_demo_accounts` memory) has accepted and pending leads predating this plan, all against zero-valued counters. The `CREATE UNIQUE INDEX` above will fail outright if any partner+channel pair already has two non-`ended` allocations — the migration must query for that first and fail loudly (surfacing the offending rows for a manual `ended`/merge decision) rather than silently applying an index that can't be built, or building the index without checking and getting an opaque constraint-violation error instead.

Once the index is in place, the migration's data-fix step, run once:

- `CampaignChannel.deliveredCount` = count of that channel's `accepted` leads; `reservedCount` = count of `needsReview` leads.
- `PartnerAllocation.deliveredCount`/`reservedCount` = same counts, scoped to leads whose submission's `partnerOrganizationId` matches that allocation's partner (now safe to resolve 1:1 given the uniqueness guard above).

## Enforcement

Extends the existing per-row `db.$transaction` in `submitLeadFile` (the one that already writes `Lead` + `LeadStatusHistory` together) — no new transaction boundary, just more work inside the existing one.

**Intake, per row, before the `Lead` write:**

1. If partner-sourced: conditional claim via `tx.$executeRaw` (Prisma's `updateMany` `where` cannot compare two columns' sum against a third column, so this needs raw SQL, unlike `decideLeadVerification`'s single-column `needsReview` guard) — `UPDATE "PartnerAllocation" SET "reservedCount" = "reservedCount" + 1 WHERE id = $1 AND "reservedCount" + "deliveredCount" < "allocatedQuantity"` (`deliveredCount` in place of `reservedCount` when this row's outcome is `"passed"`). `$executeRaw` returns the affected-row count directly. Zero rows updated → this row's outcome becomes `failed`, reject reason `ALLOCATION_CAP_EXCEEDED` (the existing seeded-but-unused reason); skip step 2.
2. Same raw conditional claim against `CampaignChannel.reservedCount`/`deliveredCount`/`contractedQuantity`, always (partner- and internal-sourced rows both consume channel capacity). Zero rows updated → compensate by decrementing the step-1 allocation claim back by 1 (still inside the same transaction — this is defense-in-depth, not the atomicity mechanism, since the whole per-row transaction rolls back together on any later failure anyway), outcome `failed`, reason `CHANNEL_CAP_REACHED`.
3. Outcome `"passed"` (intake auto-accept) claims directly into `deliveredCount` instead of `reservedCount` in both steps above. Outcome `"needsReview"` claims into `reservedCount`. Outcome `"failed"` (any other reason) claims nothing.

**Verification decide** (`decideLeadVerification`, inside its existing `db.$transaction`):
- Accept: `reservedCount - 1, deliveredCount + 1` on `CampaignChannel`, and on `PartnerAllocation` too if the lead is partner-sourced. Net cap usage is unchanged (already reserved), so no re-check against the cap is needed here.
- Reject: `reservedCount - 1` only, on both rows as applicable. This frees the slot — satisfying PRD §227's "replacement tracking against the same allocation quota" with no separate replacement counter: a partner's resubmission simply competes for the now-open slot at the next intake pass.
- Resolving *which* allocation to adjust: the initial `db.lead.findUniqueOrThrow` in `decideLeadVerification` (`verification.ts:89`) must additionally select `submission.partnerOrganizationId`. The matching `PartnerAllocation` is then `findFirst({ campaignChannelId: lead.campaignChannelId, partnerOrganizationId, status: { not: "ended" } })` — the `status: { not: "ended" }` filter is required, not optional, since an `ended` allocation from before a reallocation can still be sitting in the table alongside the live one, and only the live one holds counters that matter.

Internal-sourced leads (`sourceType: "internal"`, no `partnerOrganizationId`) only ever touch `CampaignChannel` counters.

## Pacing calculation

Pure function, no DB access — testable in isolation:

```ts
// src/lib/allocations/pacing.ts
import { operatingDayStart } from "@/lib/time/operating-day";

const DAY_MS = 24 * 60 * 60 * 1000;

// Both endpoints inclusive: a 1-day window (startDate === endDate) has
// totalDays === 1, and on that day elapsedDays === 1 (100% expected).
export function expectedToDate(cap: number, startDate: Date, endDate: Date, asOf: Date, timeZone: string): number {
  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
  const today = operatingDayStart(asOf, timeZone);
  const rawElapsedDays = Math.round((today.getTime() - startDate.getTime()) / DAY_MS) + 1;
  const elapsedDays = Math.min(Math.max(rawElapsedDays, 0), totalDays);
  return cap * (elapsedDays / totalDays);
}

export type PaceSignal = "behind" | "onPace" | "ahead";
export function paceSignal(delivered: number, expected: number): PaceSignal {
  if (delivered < expected) return "behind";
  if (delivered > expected) return "ahead";
  return "onPace";
}
```

Day-boundary math reuses `operatingDayStart` (`src/lib/time/operating-day.ts`), the same helper the codebase already uses to compare `@db.Date` flight-window columns against "now" in the operating timezone — not `sla.ts`'s business-day/holiday skipping, which doesn't apply here: PRD row 366 ties pacing to the same *clock* as the SLA math (day boundaries in `operatingTimezone`), not the same *calendar* (pacing counts every calendar day, weekends and holidays included, since a flight window doesn't pause pacing expectations for a weekend). `timeZone` is the `operatingTimezone` platform setting, read once by the caller via `getSetting(db, "operatingTimezone")`.

Per-partner rejection rate: computed on read, aggregating `Lead` rows joined to `RejectReason` grouped by `(campaignChannelId, partnerOrganizationId via submission)` — no stored counter, since it's a monitoring display value with no cap/enforcement dependency.

## UI

**Admin** — no `channels/[channelId]/page.tsx` exists today (only its `placements/` and `allocations/` sub-pages do, reached via link buttons from `campaigns/[id]/page.tsx`'s Channels table). New sibling page `src/app/(admin)/campaigns/[id]/channels/[channelId]/pacing/page.tsx`, reached the same way (a "Pacing" column added to that table, alongside the existing "Placements"/"Allocations" columns at `campaigns/[id]/page.tsx:124-125,144-157`). Shows: delivered / reserved / cap for the channel, expected-to-date, behind/on/ahead badge, and a per-partner rejection-rate table (partner org, rejected count, rejection rate) for allocations on that channel.

**Partner** — `getAllocationsForPartner` (`src/lib/allocations/partner-view.ts`) gains `deliveredCount`, `reservedCount`, and a computed pace badge in `PartnerAllocationView`; `/partner/allocations` renders them per-card. Still selects nothing from `campaignChannel.campaign` — stays inside the existing AUTH-10 read-model boundary.

## Testing

- vitest: concurrent-submission race (two simultaneous `submitLeadFile` calls against an allocation one slot from full — assert exactly one succeeds, the other gets `ALLOCATION_CAP_EXCEEDED`).
- vitest: `createAllocation` rejects a second non-`ended` row for the same partner+channel; the partial unique index is exercised directly (two concurrent raw inserts) to confirm the DB-level guarantee, not just the app-level check.
- vitest: verification reject frees the reserved slot (submit at cap → reject the pending lead → next submission for the same allocation now succeeds).
- vitest: `expectedToDate`/`paceSignal` pure-function cases (start of window, mid-window, past `endDate`, zero-day window).
- Admin pacing panel and partner allocation cards spot-checked live against the dev DB, per this project's established UI-testing convention.

## Open questions / follow-ups for later epics

- Tolerance-banded pace signals (vs. the plain comparison this plan ships) — revisit once real campaign data shows whether a flat comparison is too noisy in practice.
- Per-partner rejection-rate *alerting* (vs. this plan's read-only monitoring table) is not specified by the PRD bullet and isn't built here.
- E11 (delivery) and E15 (reporting) both consume `deliveredCount`/pace signals once built; no interface changes anticipated but worth confirming when those epics are scoped.
- A future `(client)` portal's pacing view (PRD's client-role pacing bullet) reads the same counters this plan introduces — no rework expected, just a new read model in the client-portal epic's own style.
