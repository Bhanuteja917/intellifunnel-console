# E11: Delivery — design

**Status:** approved, ready for implementation planning
**Depends on:** E12 (pacing/quota, merged at `871e45f`) for `deliveredCount`/`reservedCount`; E9 (verification) for `clientVisible`/`acceptedAt`.

## Context

PRD epic E11 (`prd.md` lines 235–241) covers four things: client-visible lead records in the portal, configured delivery integrations per client/campaign, delivery methods (webhook, SFTP, CRM push, scheduled CSV), and a delivery run log with retry and failure alerting.

This is the first epic to build anything in a client-facing portal. `Portal.client`, `Organization.isClient`, and the `CLIENT_ADMIN`/`CLIENT_VIEWER` roles all already exist in the schema and permission matrix (from E1) but are completely unexercised — no `client` route group exists, unlike `partner`. `campaign:approveClient` is likewise a defined-but-dead permission.

A second load-bearing finding shaped this design: `LeadLifecycleStatus` already has an unused `delivered` value (`new → accepted → rejected → delivered`), but E12's `deliveredCount` counter increments at **verification-accept** time, not at any real delivery event — so today "delivered" (the counter) and "delivered" (the lifecycle value) mean different things, and the lifecycle value is never actually reached. This epic introduces the first real delivery-integration push, which can fail and retry independently of acceptance, and had to decide how the two concepts relate.

## Scope decisions

These were the load-bearing decisions made while narrowing this epic, each with the rejected alternative:

1. **`deliveredCount` (E12's quota counter) stays exactly as-is — it flips at verification-accept, unchanged.** A new, separate `DeliveryRun`/`DeliveryRunLead` log tracks the outbound push to the client's system as an independent concern. Rejected: making the outbound push the accept→delivered transition, which would require reworking E12's `counters.ts` convert step and couple quota/payout correctness to third-party webhook uptime.
2. **Delivery methods this epic: webhook and scheduled CSV only.** SFTP file drop and generic CRM push (each with their own auth model — SSH keys, Salesforce/HubSpot OAuth) are deferred to a fast-follow that adds new transport adapters onto the same `DeliveryRun` log, not a redesign.
3. **The client portal's lead list is visible on accept, unchanged from E9/E12 behavior** — `clientVisible` continues to flip `true` at verification-accept. Delivery status (`pending`/`success`/`failed`) is a separate, additional column per lead, not a visibility gate. Rejected: gating `clientVisible` on delivery success, which would leave a fully quality-approved lead invisible to the client while a webhook retries, and would require moving `clientVisible` out of `verification.ts`'s accept transaction.
4. **Client-side campaign approval (`campaign:approveClient`) is out of scope.** This epic builds only the delivered-lead view. Wiring the dormant approval permission into the portal is a separate, small follow-up epic once the portal shell exists.
5. **Delivery integration config (webhook URL, CSV schedule, field mapping) is admin-authored, not client self-service.** Keeps this epic's only client-facing surface a read-only view, rather than shipping a write flow on top of the client portal's first-ever auth boundary. Client self-service config is a later fast-follow.
6. **Failure "alerting" is an admin-visible failed/exhausted-run view, no outbound notification.** E18 (notifications) doesn't exist yet — no email/Slack infra in the repo at all. Real push alerting is E18's to build later, reading the same `DeliveryRun` log.

## Data model

```prisma
enum DeliveryMethod {
  webhook
  csv
}

enum DeliveryConfigStatus {
  active
  paused
}

enum DeliveryRunStatus {
  pending
  success
  failed
  exhausted
}

model DeliveryConfig {
  id                String                @id @default(cuid())
  campaignChannelId String                @unique
  method            DeliveryMethod
  status            DeliveryConfigStatus  @default(active)
  webhookUrl        String?
  webhookSecret     String?               // HMAC-signs the outbound payload
  csvScheduleCron   String?               // e.g. "0 6 * * *"; checked each worker tick
  fieldMappingJson  Json                  // [{ source: "contact.email", target: "Email" }, ...]
  lastCsvCursorAt   DateTime?             // watermark: leads accepted after this are not yet in a successful CSV run
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])
}

model DeliveryRun {
  id                 String            @id @default(cuid())
  campaignChannelId  String
  method             DeliveryMethod
  status             DeliveryRunStatus @default(pending)
  attemptCount       Int               @default(0)
  maxAttempts        Int               @default(5)
  nextRetryAt        DateTime?
  lastError          String?
  fileUrl            String?           // csv only — storage key from E5's adapter
  requestPayloadJson Json?             // webhook only — what was sent, for debugging/re-send
  startedAt          DateTime?
  completedAt        DateTime?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  campaignChannel CampaignChannel   @relation(fields: [campaignChannelId], references: [id])
  leads           DeliveryRunLead[]

  @@index([campaignChannelId])
  @@index([status, nextRetryAt])
}

model DeliveryRunLead {
  deliveryRunId String
  leadId        String

  deliveryRun DeliveryRun @relation(fields: [deliveryRunId], references: [id])
  lead        Lead        @relation(fields: [leadId], references: [id])

  @@id([deliveryRunId, leadId])
}
```

A webhook `DeliveryRun` always has exactly one `DeliveryRunLead` row and is created synchronously inside `verification.ts`'s accept transaction, `status: pending` — no HTTP call happens inside that transaction. A CSV `DeliveryRun` covers N leads via N `DeliveryRunLead` rows and is created entirely by the worker job described below.

## Delivery execution

Two new jobs added to `src/worker/index.ts`'s existing tick, alongside `activateDueCampaigns`/`completeFinishedCampaigns`, following the same per-job try/catch isolation so one bad row can't block the batch:

**`fireDueWebhookRuns(db, now)`** — selects `DeliveryRun` where `method: webhook`, `status IN (pending, failed)`, `nextRetryAt <= now OR nextRetryAt IS NULL`. For each: build the payload from `fieldMappingJson` applied to the lead/contact/account, HMAC-sign it with `webhookSecret`, POST with a short timeout.
- Success (2xx): `status: success`, `completedAt: now`.
- Failure (non-2xx, timeout, network error): `attemptCount++`, `lastError` set (truncated). If `attemptCount < maxAttempts`: `status: failed`, `nextRetryAt = now + backoff[attemptCount]` with backoff schedule `[1m, 5m, 30m, 2h, 6h]`. Once `attemptCount >= maxAttempts`: `status: exhausted` — terminal until a manual admin retry.

**`generateDueCsvRuns(db, now)`** — for each active `csv` `DeliveryConfig` whose cron is due since `lastCsvCursorAt`: query leads on that campaign channel with `clientVisible: true` and `acceptedAt > lastCsvCursorAt`, map fields per `fieldMappingJson`, write the CSV to storage (E5's adapter). Then in one transaction: create `DeliveryRun(status: success)` + `DeliveryRunLead` rows for every included lead, and advance `lastCsvCursorAt` to the latest included `acceptedAt`. The file write happens before the transaction — a crash between the two leaves an orphaned storage object (acceptable, cheap to leave) but never a lost or duplicated lead, since the cursor only advances on commit.

**Idempotency (webhook only, documented risk, not enforced):** a retry can double-deliver if the client's endpoint received attempt N but our read of the response failed (timeout after their 200, etc.). The outbound payload carries `deliveryRunId` as an idempotency key header — a contract for the client's endpoint to dedupe on if they choose to. We do not maintain a delivery-receipt ledger on our side to prevent this; it's an accepted risk for v1.

**Manual retry (admin action):** resets a `failed`/`exhausted` run to `status: pending`, `attemptCount: 0`, `nextRetryAt: null`. Picked up by the next tick.

## Client portal

New route group `src/app/client/` (ungrouped, matching `partner`'s convention, not `(admin)`'s bracket grouping):
- `layout.tsx` — `assertPortal(actor, "client")`, nav shell.
- `error.tsx` / `loading.tsx` — adapted from `partner`'s.
- `page.tsx` — redirects to `leads`.
- `leads/page.tsx` — the only real page in this epic. Read-only.

New masked read model `src/lib/leads/client-view.ts`, mirroring the AUTH-10 discipline already established in `partner-view.ts`:
- Scoped to `campaignChannel.campaign.clientOrganizationId === actor.organizationId`, enforced via `assertOrganizationAccess` (AUTH-9).
- Filtered to `clientVisible: true` — this alone satisfies PRD 5.2's "cannot see rejected leads / internal verification notes," since neither exists on a row that reaches this filter.
- Projects: contact/account identity, campaign/channel name, `fieldValuesJson` (qualification answers), `acceptedAt`, and a derived `deliveryStatus` (`pending`/`delivered`/`failed`) read off the lead's latest `DeliveryRunLead → DeliveryRun.status`.
- Never projects: `partnerOrganizationId`, `rejectReasonId`, any payout field, verification notes.
- Cursor-paginated (NFR-P-1), matching the verification queue and resolution queue pattern — never offset.

No write actions in this epic (decision 5 above).

## Admin UI and permissions

New page at `campaigns/[id]/channels/[channelId]/delivery/`, same location pattern as the existing pacing page:
- **Config panel:** method select (webhook/csv), the relevant fields (URL+secret, or cron+schedule), and a field-mapping builder (source-field picker → target-name text input, add/remove rows). Backed by `DeliveryConfig`, reusing the existing dialog/form patterns from the channel-type editors.
- **Run log table:** `DeliveryRun` rows for the channel — method, status, attemptCount, lastError, timestamps. A **Retry** button appears on `failed`/`exhausted` rows.

New permissions — a dedicated pair for this surface rather than borrowing `allocation:read`, following the precedent set by `89596a5` (the pacing page shipped with the wrong borrowed permission and had to be fixed to match its own boundary):
- `delivery:read` — view config + run log. Granted to `OPERATIONS`, `CAMPAIGN_MANAGER`.
- `delivery:write` — edit config, trigger retry. Granted to `OPERATIONS`.

The client side needs no new permission: `client-view.ts` is gated by the existing `campaign:read` (already in `CLIENT_READ`) plus organization scoping — it's a scoped read of data the client already has read access to, not a new capability.

## Testing plan

**Unit (vitest, matching existing `src/lib` coverage style):**
- Backoff schedule calculation and exhaustion at attempt 5.
- Field-mapping application: normal projection, missing/null source fields.
- `client-view.ts` authorization: cross-org access blocked, rejected/pending leads never appear, partner/payout/verification-note fields never projected — mirrors the existing `partner-view.ts` tests.
- `fireDueWebhookRuns` / `generateDueCsvRuns` against a mocked `db` and mocked `fetch`/storage adapter: success path, non-2xx triggers a scheduled retry, exhaustion after max attempts, CSV cursor advances only past leads actually included in a successful run.
- The admin retry action's state reset.

**Live UI check (per this project's established loop — build it, then exercise it in the dev server, not just green tests):**
- Seed or reuse a demo `CLIENT_ADMIN` account (check `reference_demo_accounts.md`; add one if the client portal has none yet), log in, confirm `/client/leads` shows only that org's accepted leads with correct field masking and no cross-org leakage.
- As admin, configure a webhook pointing at a local test receiver, accept a lead through the existing verification UI, run one worker tick manually, confirm the `DeliveryRun` reaches `success` and the payload matches the configured field mapping.
- Point the webhook at a dead port, confirm retry scheduling and eventual `exhausted` status, then confirm the admin Retry button recovers it.
- Configure a CSV `DeliveryConfig`, trigger the tick, confirm the generated file lands in storage with the correct rows/columns and that `lastCsvCursorAt` advances (a second tick doesn't re-include already-shipped leads).

## Out of scope / follow-ups

- SFTP file drop and CRM push delivery methods (new transport adapters on the same `DeliveryRun` log).
- Client-side campaign approval (`campaign:approveClient` wiring).
- Client self-service delivery configuration.
- Outbound failure alerting (email/Slack) — belongs to E18, reads the same `DeliveryRun` log once it exists.
- A delivery-receipt ledger to fully close the webhook double-delivery risk, if it proves to matter in practice.
