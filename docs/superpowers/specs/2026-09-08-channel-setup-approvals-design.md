# Design: Channel setup rework and client-facing approvals

**Mockups:** `Campaign Channel Flow.dc.html`, `Client Portal.dc.html` (design canvas, `~/Downloads/Organization management unified flow/`)

## Context

Channel setup today is a fixed four-step checklist on the channel overview tab
(`src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx:98-105`), and every
step of it is wrong in some way:

- **Channel terms** is hardcoded `done: true` with a "Review" CTA linking to
  `tab: "overview"` — the tab the checklist is already on. The link does
  nothing, and there is no terms detail view anywhere.
- **Add a placement** is unconditional, but `ChannelTypeDefinition.requiresAsset`
  (`src/lib/channel-types/versions.ts:24`) already distinguishes channel types
  that need a collection point from those that don't. It is currently read in
  exactly one place — the campaign approval gate at
  `src/lib/campaigns/state-machine.ts:132` — and never in the UI.
- **Allocate partner quota** is treated as mandatory, but a campaign can be run
  entirely in-house. `LeadSourceType.internal` and the nullable
  `LeadSubmission.partnerOrganizationId` already support zero-partner delivery;
  only the checklist insists otherwise.
- **Configure delivery** is treated as a precondition, but delivery config is
  independent of collecting leads and can be set at any point in a channel's
  life.

Separately, both mockups introduce a client who acts for themselves. Today all
client-side decisions are admin-proxied: `decideClientApproval`
(`state-machine.ts:191`) is only ever called from
`src/app/(admin)/campaigns/actions.ts`, and the client portal
(`src/app/client/`) has just Leads and Reports. The `campaign:approveClient`
permission exists and is granted to `CLIENT_ADMIN`
(`src/lib/auth/permissions.ts:76`) but no client-facing surface uses it.

### Program decomposition

The two mockups together describe more than one spec's worth of work. Agreed
split, in build order:

1. **This spec** — channel setup semantics + the client-portal approval
   surfaces those semantics depend on.
2. **Client asset intake and brief approval** — client uploads creative, agency
   reviews (`in review` / `approved` / `changes requested`), client approves the
   targeting brief (ICP criteria + lead field spec), documents and suppression
   list upload.
3. **Admin campaign and leads UI** — campaign readiness banner, channels-table
   setup pills, lead filter chips and lead detail drawer, suggested-split card.

Visual styling is not a separate workstream: new screens reuse the existing
shadcn `Card`/`Table`/`Badge`/`Button` patterns already used across the app. The
mockups drive structure and content, not a palette change.

### Placement flow this spec sits inside

The full agreed flow is four hops:

1. Client uploads a creative asset (spec 2)
2. Agency reviews and approves the asset (spec 2)
3. Agency creates the placement — asset version, landing page URL, form slug,
   consent text — exactly as it does today
4. **Client approves the live landing page URL before the placement can go
   active** (this spec)

Hops 1 and 2 are deferred; until spec 2 lands, assets stay admin-managed and the
flow starts at hop 3.

### Explicitly out of scope

- `ALLOWED_TRANSITIONS` and `assertReadyForApproval` in `state-machine.ts` are
  unchanged. The one edit to that file is described under "Channel activation"
  below and is deliberate.
- No new `AssetPlacementStatus` enum value. Approval is a separate record, not a
  placement status.
- No new `Permission` values. `campaign:approveClient` covers client decisions;
  `campaign:write` covers channel edit and activation.

## Data model

Two new tables. No enum changes; both reuse the existing `ApprovalDecision`
(`approved` | `rejected`).

```prisma
model ChannelTermsApproval {
  id                String           @id @default(cuid())
  campaignChannelId String
  decision          ApprovalDecision
  decidedByUserId   String
  decidedAt         DateTime         @default(now())
  comments          String?
  termsSnapshotJson Json
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])

  @@index([campaignChannelId, decidedAt])
}

model PlacementApproval {
  id                    String           @id @default(cuid())
  assetPlacementId      String
  decision              ApprovalDecision
  decidedByUserId       String
  decidedAt             DateTime         @default(now())
  comments              String?
  placementSnapshotJson Json
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt
  createdById           String?
  updatedById           String?

  assetPlacement AssetPlacement @relation(fields: [assetPlacementId], references: [id])

  @@index([assetPlacementId, decidedAt])
}
```

`CampaignChannel` gains `termsApprovals ChannelTermsApproval[]`, `AssetPlacement`
gains `approvals PlacementApproval[]`. Field shape follows `CampaignApproval`
(`prisma/schema.prisma:726`) — same `decision`/`decidedByUserId`/`comments`/
snapshot quartet — but each is scoped to its own subject rather than being
polymorphic, matching the one-model-per-approvable-entity pattern already in the
schema.

One additive migration via `npm run db:migrate` — two new tables, no column
changes to existing ones, so nothing to backfill. Channels that exist when this
ships read as `pending` terms until a client decides, which is the correct
starting state.

Rows are append-only. The **latest row by `decidedAt`** is the current decision;
a client changing their mind writes a new row rather than mutating one, so the
table doubles as the decision history the terms tab renders.

### Snapshot contents and why they exist

`termsSnapshotJson`:

```ts
{ contractedQuantity, clientUnitPriceMinor: string, currency, startDate, endDate, channelTypeVersionId }
```

`placementSnapshotJson`:

```ts
{ landingPageUrl, assetVersionId, formSlug, consentTextVersionId }
```

`clientUnitPriceMinor` is a `BigInt` column and is serialised as a decimal
string in the snapshot — `JSON.stringify` throws on `BigInt`.

Snapshots exist because the mockup adds an **Edit channel** action, so terms
become mutable (see below). An approval that predates an edit must not keep
reading as approved. The placement snapshot serves the same purpose for spec 2,
where an approved placement's asset version can be replaced, and is the record
of exactly which URL the client signed off on.

### Approval status derivation

One shared helper per subject, in `src/lib/approvals/status.ts` (new file):

```ts
export type ApprovalStatus = "pending" | "approved" | "changesRequested" | "reapprovalNeeded";

export function getChannelTermsApprovalStatus(
  db: PrismaClient | Tx,
  channel: Pick<CampaignChannel, "id" | "contractedQuantity" | "clientUnitPriceMinor" | "currency" | "startDate" | "endDate" | "channelTypeVersionId">,
): Promise<ApprovalStatus>;

export function getPlacementApprovalStatus(
  db: PrismaClient | Tx,
  placement: Pick<AssetPlacement, "id" | "landingPageUrl" | "assetVersionId" | "formSlug" | "consentTextVersionId">,
): Promise<ApprovalStatus>;
```

Each loads the latest row for its subject and compares the stored snapshot with
the subject it was handed. Both accept a transaction client so gates can run
inside the same transaction as the write they guard.

| Latest row | Snapshot vs current | Status |
|---|---|---|
| none | — | `pending` |
| `rejected` | — | `changesRequested` |
| `approved` | equal | `approved` |
| `approved` | differs | `reapprovalNeeded` |

`reapprovalNeeded` behaves as not-approved everywhere a gate is evaluated; it is
distinguished from `pending` only so the UI can say "terms changed since
approval" rather than implying the client never looked.

## Readiness module

New `src/lib/channels/readiness.ts` — the single source of truth for every
surface that renders or gates on channel setup state (channel checklist, channel
header badge, campaign channels-table pills, client-portal checklist mirror, and
the activation guard).

```ts
export type StepOwner = "client" | "agency" | "done";

export type ChannelStep = {
  id: "terms" | "placement" | "allocations" | "delivery";
  title: string;
  hint: string;
  cta: string;
  tab: "terms" | "placements" | "allocations" | "delivery";
  required: boolean;
  done: boolean;
  owner: StepOwner;
};

export type ChannelReadiness = {
  steps: ChannelStep[];
  ready: boolean;
  requiredDone: number;
  requiredTotal: number;
};

export function computeChannelReadiness(input: {
  definition: ChannelTypeDefinition;
  channel: { contractedQuantity: number; clientUnitPriceMinor: bigint; currency: string };
  termsStatus: ApprovalStatus;
  activePlacementCount: number;
  allocationCount: number;
  hasDeliveryConfig: boolean;
}): ChannelReadiness;
```

Steps produced:

| Step | Included when | Required | `done` | Owner while not done |
|---|---|---|---|---|
| `terms` | always | yes | `termsStatus === "approved"` | `client` |
| `placement` | `definition.requiresAsset` | yes | `activePlacementCount > 0` | `agency` |
| `allocations` | always | **no** | `allocationCount > 0` | `agency` |
| `delivery` | always | **no** | `hasDeliveryConfig` | `agency` |

`ready = steps.filter(s => s.required).every(s => s.done)`. `requiredTotal` is 1
or 2 depending on `requiresAsset`, so the "N of M steps done" copy is honest per
channel type rather than always saying four.

Optional-step hints state why they're optional: allocations reads "Optional —
leave the quota unallocated to run this channel in-house", delivery reads
"Optional — can be configured at any time, including after launch".

The function is pure. Callers do their own counting queries; this keeps it
trivially unit-testable across the `requiresAsset` matrix.

## Gates

### Placement activation

`setPlacementStatus` (`src/lib/assets/placements.ts:64`) already special-cases
the transition to `active` — it verifies the underlying `Asset` is itself active.
The client-approval check goes in the same block:

```ts
if (input.status === "active") {
  // ...existing asset-status check...
  const status = await getPlacementApprovalStatus(db, existing);
  if (status !== "approved") {
    throw new ValidationError(
      status === "reapprovalNeeded"
        ? "This placement changed since the client approved it — it needs approval again before going live"
        : "The client has not approved this placement's landing page URL yet",
    );
  }
}
```

Moving to `paused`, `archived` or back to `draft` stays unrestricted, matching
the existing comment's reasoning: those transitions don't put anything in front
of a lead.

### Channel activation

The mockup adds an **Activate channel** button on the channel header, disabled
while setup is incomplete. New `setChannelStatus` in
`src/lib/campaigns/channels.ts` (new file — channel mutations currently live in
`crud.ts`, but `updateCampaignChannel` and `setChannelStatus` together justify
their own module rather than growing a file that already spans campaigns, ICP,
lead field specs and channels):

- Requires `campaign:write`, plus `assertOrganizationAccess` on the campaign.
- `draft -> active` requires `computeChannelReadiness(...).ready`.
- `active <-> paused` is allowed once activated, without re-checking readiness —
  pausing a channel whose terms were later edited must stay possible.
- Manual activation additionally requires the campaign to be at `scheduled` or
  `live`. The campaign state machine stays authoritative for launch; this
  control is for operating channels within a launched campaign.
- Audited via `withAudit` with `entityType: "CampaignChannel"`, `action:
  "setStatus"`.

**The one `state-machine.ts` change.** `decideClientApproval` currently does
`tx.campaignChannel.updateMany({ where: { campaignId }, data: { status: "active" } })`
(`state-machine.ts:224`) — it flips *every* channel to active on campaign
approval, regardless of setup state. With readiness now meaningful, that would
activate channels whose terms the client never approved. It becomes: compute
readiness per channel inside the transaction and activate only the ready ones,
leaving the rest in `draft` for the operator to activate once complete.
`ALLOWED_TRANSITIONS` and `assertReadyForApproval` are untouched.

### Ordering consequence

`assertReadyForApproval` still requires an **active** placement on any
`requiresAsset` channel before a campaign can be submitted for internal
approval. Since a placement can now only go active after the client approves its
URL, the client acts *before* internal approval. That is consistent with the
client-portal mockup, whose pre-launch checklist shows items owned by the client
alongside "Agency finishes channel setup" while the campaign is still being set
up. The client portal therefore does **not** gate approval surfaces on campaign
status.

## Editing channel terms

`updateCampaignChannel` in `src/lib/campaigns/channels.ts`, mirroring
`addCampaignChannel` (`crud.ts:288`) and importing its exported
`assertDraftAndAccessible` (`crud.ts:123`):

- Requires `campaign:write` and `assertDraftAndAccessible` on the campaign — the
  same constraint `addCampaignChannel` uses, so terms are editable only while
  the campaign is a draft.
- Additionally requires `channel.status === "draft"`.
- Editable fields: `contractedQuantity`, `clientUnitPrice`, `costBudget`,
  `currency`, `startDate`, `endDate`. `channelTypeVersionId` is **not** editable
  — changing it would change the frozen question set and `requiresAsset` under
  an already-configured channel; delete and re-add instead.
- Reuses `addCampaignChannel`'s validation verbatim: positive whole quantity,
  currency matching the campaign, end after start, window inside the campaign
  flight.
- Re-verifies draft status inside the transaction (FR-CS-2), like every other
  mutation in that file.
- Audited via `withAudit` with `before`/`after` terms.

No approval-invalidation code is needed: a prior approval's snapshot stops
matching, so `getChannelTermsApprovalStatus` returns `reapprovalNeeded` on its
own. That is the reason the status is derived rather than stored.

The admin mockup shows **Edit channel** on a campaign sitting at
`pendingInternalApproval`. This design keeps the draft-only rule anyway — terms
edited mid-review would invalidate the review that is in flight — so the button
renders in that state but is disabled, with a tooltip naming the campaign status
blocking it.

## Approval decisions

`src/lib/approvals/decisions.ts`:

```ts
export async function decideChannelTerms(
  db: PrismaClient, actor: Actor,
  input: { campaignChannelId: string; decision: ApprovalDecision; comments?: string },
): Promise<ChannelTermsApproval>;

export async function decidePlacement(
  db: PrismaClient, actor: Actor,
  input: { assetPlacementId: string; decision: ApprovalDecision; comments?: string },
): Promise<PlacementApproval>;
```

Both:

- `assertPermission(actor, "campaign:approveClient")` — so `CLIENT_ADMIN` and
  `SUPER_ADMIN` can decide, `CLIENT_VIEWER` cannot.
- `assertOrganizationAccess(actor, campaign.clientOrganizationId)` after loading
  the subject through its channel to the campaign.
- Reject with `ValidationError` when `decision === "rejected"` and `comments` is
  empty — a rejection the agency can't act on is useless. Approvals may omit
  comments.
- Build the snapshot **inside the transaction** that writes the row, for the
  same reason `decideClientApproval` does (`state-machine.ts:203-206`): a
  concurrent edit must not land between snapshot and decision.
- `writeAudit` with `entityType: "ChannelTermsApproval"` / `"PlacementApproval"`,
  `action: decision`, `after: { subjectId, decision, comments }`.

## Client portal

Nav becomes Campaigns, Approvals (with a pending count badge), Leads, Reports.
Assets and Documents arrive with spec 2.

Every page follows the portal convention documented on `assertPortal`
(`src/lib/auth/permissions.ts:137-154`): `requireActor()` then `assertPortal(actor,
"client")` as the first two lines, before any data fetch, with the layout's own
call kept inside its existing try/catch.

### Read models

`src/lib/approvals/client-view.ts`, written to the AUTH-10 convention that
`src/lib/leads/client-view.ts` documents at length:

- Org scoping is unconditional — `campaign: { clientOrganizationId:
  actor.organizationId }` always applies, with **no `isInternal` bypass** and
  **no use of `campaignChannelOrgScopeClause`**, which resolves to `{}` for
  internal actors and would silently unscope the query.
- Partner identity, payout rates and cost budgets are structurally absent from
  the `select`, not filtered out after the fact.

```ts
export type ClientApprovalItem = {
  kind: "channelTerms" | "placement";
  subjectId: string;
  campaignId: string;
  campaignName: string;
  campaignCode: string;
  channelLabel: string;
  status: ApprovalStatus;
  summary: Record<string, string>;   // terms: qty/unit price/window · placement: URL/asset/consent text
  lastComments: string | null;
  lastDecidedAt: Date | null;
};

export function listClientApprovals(db, actor, filter?: { campaignId?: string; pendingOnly?: boolean }): Promise<ClientApprovalItem[]>;
export function countPendingClientApprovals(db, actor): Promise<number>;   // nav badge
export function getClientCampaigns(db, actor): Promise<ClientCampaignRow[]>;
export function getClientCampaignDetail(db, actor, campaignId): Promise<ClientCampaignDetail>;
```

`ClientCampaignDetail` carries the per-channel `ChannelReadiness` so the client
checklist and the admin checklist are literally the same computation, with the
`owner` field driving the mockup's owner column.

### Pages

- `src/app/client/campaigns/page.tsx` — campaign list: name/code, flight,
  delivery progress bar, status badge, "Needs you" count. A banner above the
  table when anything is pending, linking to the approvals inbox.
- `src/app/client/campaigns/[id]/page.tsx` — tabs Overview | Channels | Leads.
  Overview renders the owner-attributed checklist (client-owned steps get a
  primary CTA, agency-owned steps a muted "Track"), the stat cards and the
  delivery pace card. Channels lists each channel with its terms status and
  placement approval states. The mockup's Brief & spec and Assets tabs belong to
  spec 2 and are not added here; Channels replaces them as the tab this spec's
  content needs. The Leads tab reuses `getLeadsForClient`, whose `filter`
  argument gains an optional `campaignId` — the only change to that module.
- `src/app/client/approvals/page.tsx` — inbox grouped into "Channel terms" and
  "Landing pages", each row with Approve and Request a change. Both open a
  dialog showing the exact snapshot being decided plus a comments field
  (required on rejection). Items already decided render read-only with their
  decision, decider and comment.

Server actions live in `src/app/client/approvals/actions.ts`, wrap
`decideChannelTerms`/`decidePlacement` in `toActionResult`, and `revalidatePath`
both the approvals inbox and the campaign detail.

`CLIENT_VIEWER` sees every screen but no decision controls — the pages check
`hasPermission(actor, "campaign:approveClient")` for rendering, and the lib
functions assert it regardless.

## Admin surfaces

`src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx`:

- **New `terms` tab** — contracted quantity, unit price, budget, currency,
  window, channel type; the current approval status as a badge; the full
  decision history (decision, who, when, comments) from `ChannelTermsApproval`.
  The checklist's "Review" CTA points here, fixing the dead link.
- **Checklist** is rendered from `computeChannelReadiness`, with required steps
  first and optional steps below a separator, each optional row badged
  "Optional". The card's subtitle stops claiming "all four" and reports
  `requiredDone / requiredTotal`.
- **Header** — the `ready` / `setup incomplete` badge comes from readiness;
  Edit channel (draft-only) and Activate/Pause channel controls sit beside it,
  Activate disabled with a tooltip naming the outstanding required step.
- **Placements tab** — a new approval-status column per placement, and the
  status select refuses `active` while unapproved (the server already throws;
  the control disables the option and shows the reason).
- **Placements tab** also surfaces "awaiting client approval" prominently, since
  that is now the blocking hop between creating a placement and it collecting
  leads.

`src/app/(admin)/campaigns/[id]/page.tsx` — the channels table gains a Setup
column with a pill per incomplete required step and an "N of M steps done" line,
plus a readiness banner above the table when any channel is not ready. Optional
steps are not counted in either.

## Testing

Vitest, against the isolated test database (never the dev DB):

- `computeChannelReadiness` across the matrix: `requiresAsset` true/false;
  terms approved/pending/rejected/stale; zero allocations and no delivery config
  must still yield `ready: true` when the required steps pass.
- Approval status derivation: no rows; approved; rejected; approved-then-edited
  yields `reapprovalNeeded`; a newer decision supersedes an older one.
- `setPlacementStatus` refuses `active` with no approval, with a rejection, and
  with a stale approval; permits it after a matching approval; still permits
  `paused`/`archived` in all cases.
- `updateCampaignChannel` rejects a non-draft campaign, a non-draft channel, a
  currency mismatch, and a window outside the campaign flight; a successful edit
  flips a previously-approved channel to `reapprovalNeeded`.
- `decideClientApproval` activates only ready channels and leaves the rest in
  `draft`.
- Auth: a client actor from another organisation cannot see or decide another
  org's approvals (both the read model and the decision path); `CLIENT_VIEWER`
  is denied on decide; an internal actor gets no unscoped read through
  `listClientApprovals`.

Each new UI flow is also walked in the browser as it is built, not left to
automated tests alone.

## Follow-ups

- Spec 2 (client asset intake, brief approval, documents) closes hops 1–2 of the
  placement flow and adds the Assets/Documents portal sections.
- Spec 3 (admin campaign and leads UI) covers the lead filter chips, lead detail
  drawer and the suggested-split card from the admin mockup.
- Notification on a pending approval (email or in-app) is not part of any of the
  three specs; the badge and banner are the only prompts today.
- A rejected channel-terms decision has no automated remedy path beyond the
  agency editing the terms and the client deciding again. That is sufficient
  while terms are draft-only editable; revisit if terms ever need to change on a
  live channel.
