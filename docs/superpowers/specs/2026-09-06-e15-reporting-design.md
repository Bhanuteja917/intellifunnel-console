# Design: PRD Epic E15 — Reporting

**Spec:** `prd.md` §E15 (P1).

## Context

E15 asks for four report surfaces:

- Client reporting: campaign performance, lead breakdown, asset performance, channel performance
- Partner scorecards: acceptance rate, throughput, reject reasons
- Internal operational dashboards
- Scheduled report delivery by email

The data these depend on now exists for real: E9 verification (`VerificationRecord`, `RejectReason`), E11 delivery (`DeliveryRun`), and E12 pacing (`reservedCount`/`deliveredCount` on `PartnerAllocation`/`CampaignChannel`) are all live on `main`. Email infra also already exists (`src/lib/email/send.ts`, used by invitations).

**Scope ruling made during brainstorming:**

E15 as PRD-scoped is five semi-independent pieces, not one:

1. Client reporting (campaign/lead/channel performance) — buildable now.
2. Partner scorecards — buildable now.
3. Internal operational dashboards — buildable now.
4. Asset performance reporting — blocked as originally scoped: no `EngagementEvent` model exists, and the E5 plan explicitly ruled ingestion out of scope pending an undefined external landing-page integration (webhook or import — nobody owns that decision yet).
5. Scheduled email delivery of reports — buildable now (email infra exists), but a distinct concern (report snapshot format + cron + template) layered on top of 1–4.

Two decisions unblock/descope this plan:

- **Asset performance (item 4) is unblocked via CSV upload.** Rather than waiting on the external ingestion-mechanism decision, this plan adds an `EngagementEvent` model fed by an admin-uploaded CSV of daily per-placement counts. A future webhook/API integration writes into the same table — same read side, no rework, no blocker.
- **Scheduled email delivery (item 5) is deferred**, to be scoped as its own follow-up once on-demand dashboards/scorecards ship. Smaller spec now, faster to ship something testable.

This plan therefore covers items 1–4 as **on-demand** dashboards only (no scheduling, no email).

**Explicitly deferred, not part of this plan:**
- Scheduled email report delivery (item 5 above) — needs E18-adjacent notification/template infra of its own.
- A webhook/API ingestion path for `EngagementEvent` — CSV is the only producer this plan builds; the model is shaped so a future producer is additive.
- Precomputed/rollup aggregate tables — dashboards query live tables at request time; revisit only if a real data volume proves this too slow.
- Tolerance-banded or trend-over-time analytics — PRD asks for point-in-time performance/scorecard views, not a BI/trend engine.

## Data model

```prisma
model EngagementEvent {
  id               String   @id @default(cuid())
  assetPlacementId String
  date             DateTime @db.Date
  impressions      Int      @default(0)
  conversions      Int      @default(0)
  importBatchId    String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  assetPlacement AssetPlacement @relation(fields: [assetPlacementId], references: [id])
  importBatch    ImportBatch?   @relation(fields: [importBatchId], references: [id])

  @@unique([assetPlacementId, date])
}
```

One row per placement per day. `@@unique([assetPlacementId, date])` makes a re-upload of an overlapping date range an upsert, not a duplicate — ops re-uploading a corrected file just replaces those rows, no separate reconciliation logic.

No new import model: `ImportBatch`/`ImportError` already exist as schema groundwork with `ImportType.metrics` seeded but unused until now — this plan is their first real consumer. `importBatchId` traces which upload wrote a row (audit + lets ops see "last updated by batch X on Y").

Org-scoping for reads joins `EngagementEvent → assetPlacement → campaignChannel → campaign.clientOrganizationId`, reusing the existing `campaignChannelOrgScopeClause` unchanged, nested one level deeper.

### Permissions

Two new permissions, following the existing `delivery:read`/`delivery:write` convention:

- `report:read` — gates the admin ops dashboard and drill-down pages. Client/partner report pages are gated by `assertPortal` only (no separate permission bit), matching how `/partner/allocations` and `/client/leads` are gated today — portal membership is itself the access boundary for those two roles.
- `report:write` — gates the `EngagementEvent` CSV upload action (OPERATIONS/CAMPAIGN_MANAGER only).

## Aggregation layer (`src/lib/reporting/`)

One module per domain. Every function is `(db, actor, params) => Promise<Report>` — plain Prisma `groupBy`/`aggregate`, with rates computed in JS after grouping so the arithmetic is unit-testable without hitting the DB. No query-builder abstraction: five fixed report shapes, not open-ended BI.

- **`campaigns.ts`** — `getCampaignPerformanceReport(db, actor, { campaignId, dateRange })`: leads submitted/accepted/rejected, contracted vs. delivered per channel, SLA-breach rate. Scoped via the existing `campaignOrgScopeClause`.
- **`leads.ts`** — `getLeadBreakdownReport(db, actor, { campaignId?, dateRange })`: counts by `verificationStatus`/`lifecycleStatus`/`rejectReasonId`, via `campaignChannelOrgScopeClause`.
- **`channels.ts`** — `getChannelPerformanceReport(db, actor, { campaignId?, dateRange })`: per-`CampaignChannel` contracted vs. `deliveredCount`/`reservedCount`, plus `DeliveryRun` success/fail/exhausted counts.
- **`engagement.ts`** — `getAssetPerformanceReport(db, actor, { campaignId?, dateRange })`: sums `EngagementEvent.impressions`/`conversions` per asset/placement; conversion rate = conversions/impressions (0 when no data has landed yet for a placement — a normal empty state, not an error).
- **`partners.ts`** — `getPartnerScorecardReport(db, actor, { partnerOrganizationId, dateRange })`: acceptance rate = accepted/(accepted+rejected) leads submitted by that partner, throughput = leads submitted per day, reject-reason breakdown counts, all as a per-partner aggregate plus a per-`PartnerAllocation` (channel) breakdown table.
- **`ops.ts`** — `getOpsDashboardReport(db, actor, { dateRange })`: cross-org rollup, internal-only — pipeline counts by stage, SLA breaches, delivery failures, top reject reasons platform-wide.
- **`shared.ts`** — `DateRange` type + `defaultDateRange()` (rolling 30 days). Called by pages, not hidden inside the lib functions, so the functions themselves stay free of an implicit "now".

**Access enforcement:** `campaigns.ts`/`leads.ts`/`channels.ts`/`engagement.ts` call `assertOrganizationAccess(actor, params.organizationId)` (resolved via the campaign) at the top when called for a client actor — internal callers (admin) pass no such restriction. `partners.ts` restricts a partner caller to `actor.organizationId` — a partner can never request another partner's scorecard. `ops.ts` requires `actor.isInternal`; the `report:read` check itself lives at the page level, matching how other admin pages gate on permission rather than inside their lib functions.

## CSV import flow

Existing `src/lib/lists/csv.ts` (`parseDelimited`/`applyMapping`/`RowError`) is reused as-is for parsing — no new parsing code. New `src/lib/reporting/engagement-import.ts`:

`importEngagementEvents(db, actor, { fileContent })` — fixed CSV headers (`assetPlacementId` or `formSlug`, `date`, `impressions`, `conversions`); no configurable column-mapping UI, since this is a fixed ops-only format, not partner-facing (unlike lead intake, which needs configurable mapping because partners control their own CSV layout).

Steps: parse rows → resolve `formSlug` to `assetPlacementId` where given → validate date parses and `impressions`/`conversions` are non-negative integers → bad rows become `ImportError` entries (`rowNumber`/`field`/`rawValue`/`message`); good rows commit regardless (same partial-success contract as lead intake — one bad row never blocks the rest of the file). Good rows `upsert` into `EngagementEvent` keyed on `(assetPlacementId, date)`, inside one transaction, tagged with a new `ImportBatch` row (`type: "metrics"`, `rowsTotal`/`rowsAccepted`/`rowsFailed`, `status: completed`). Gated by `report:write`; the upload form lives on the admin `/reports` page.

## UI

- **Admin** — new top-level `src/app/(admin)/reports/page.tsx` (cross-campaign, so not nested under a campaign like the pacing/delivery pages are): the ops dashboard (`getOpsDashboardReport`) plus a campaign picker that drills into `getCampaignPerformanceReport`/`getLeadBreakdownReport`/`getChannelPerformanceReport`/`getAssetPerformanceReport` for the selected campaign, reusing the same lib functions the client portal calls. Also hosts the `EngagementEvent` CSV upload form. Gated by `report:read`.
- **Client** — new `src/app/client/reports/page.tsx`, alongside the existing `client/leads`. `assertPortal(actor, "client")` as the first line, per the documented pattern (page-level call, not relying on the layout). Campaign picker scoped to the client's own org via `campaignOrgScopeClause`; shows campaign performance, lead breakdown, asset performance, channel performance for the selected campaign.
- **Partner** — new `src/app/partner/scorecard/page.tsx`, alongside `partner/allocations`. `assertPortal(actor, "partner")` first line. No org picker — always `actor.organizationId`, passed to `getPartnerScorecardReport`. Shows the aggregate scorecard plus the per-allocation breakdown table.

All three share one new `<DateRangePicker>` client component (`src/components/reporting/`), defaulting to rolling-30-days, writing `from`/`to` into the URL query string — server components read it off `searchParams`, no client-side data fetching.

## Testing

- vitest, per reporting module (`src/lib/reporting/*.test.ts`): seed known `Lead`/`VerificationRecord`/`PartnerAllocation`/`EngagementEvent` rows via `testDb()`, assert exact aggregate numbers (acceptance rate, conversion rate, throughput counts) — real arithmetic assertions, not snapshots.
- vitest, `engagement-import.test.ts`: good/bad row mix commits the good rows and records errors for the bad ones without blocking; re-upload of the same file is idempotent (no duplicate rows); unknown-placement and non-numeric-value rows each produce a distinct `ImportError`.
- vitest: cross-org access rejected for client/partner report calls (a client actor requesting another org's campaign report, a partner actor requesting another partner's scorecard).
- vitest: `report:read`/`report:write` permission enforcement on the admin pages/action; `assertPortal` enforcement on the client and partner report pages.
- Admin/client/partner report pages spot-checked live against the dev DB, per this project's established UI-testing convention.

## Open questions / follow-ups for later epics

- Scheduled email delivery of these reports (PRD's fourth E15 bullet) is its own follow-up spec once these dashboards exist to snapshot.
- A webhook/API `EngagementEvent` producer (replacing/supplementing the CSV path) once the external landing-page integration is actually owned and designed — no rework expected on the read side.
- Precomputed rollups, if a real data volume ever makes on-the-fly aggregation too slow for the admin ops dashboard.
