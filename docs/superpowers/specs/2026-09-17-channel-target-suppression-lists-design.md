# Channel Target Account & Suppression Lists

## Problem

`ChannelSetupStepKey` already has `targetAccountList` and `suppressionList`
entries, and `src/lib/lists/target-accounts.ts` / `suppression.ts` already know
how to import a CSV into a `TargetAccountList` / `SuppressionList` and attach
it to a campaign. None of it is reachable from the app: both catalog entries
carry `available: false` (`step-catalog.ts:79-101`), and grepping `src/app`
for `importTargetAccountList`, `attachTargetAccountList`,
`importSuppressionList` or `attachSuppressionList` returns nothing. There is no
page to upload a list, no way to add accounts one at a time, no way to
download what was uploaded, and clients reviewing a channel for approval
cannot see either list at all — `ClientChannelDetail`
(`src/lib/approvals/client-channel-view.ts:43-67`) has no field for it.

Separately, the attach functions link a list to a **campaign**
(`CampaignTargetAccountList`, `CampaignSuppressionList` — `campaignId`, no
`campaignChannelId`), while the checklist step that is supposed to gate on
"is a list attached" lives on the **channel**. A campaign can have several
channels; today's schema cannot tell you which channel a list belongs to.

## Scope

This spec: re-scopes list attachment to the channel, builds the upload +
manual-entry + download UI for both list types, wires the two catalog entries
on, and exposes a read-only list summary + download to the client approval
view.

Out of scope: changing how `matchesTal`/`isSuppressed` are used at delivery
time beyond the parameter rename forced by re-scoping; any change to what a
client can *approve or reject* (see Decisions).

### Supersedes the follow-up note in the prior spec

[2026-09-16-configurable-channel-setup-design.md](./2026-09-16-configurable-channel-setup-design.md#follow-up-spec)
sketched a **two-tier** model: keep `CampaignTargetAccountList` as a campaign-wide
baseline, add new `ChannelTargetAccountList`/`ChannelSuppressionList` tables on
top, and union both tiers in `isSuppressed`/`matchesTal`. Discussed with the
operator and rejected in favor of a single tier, channel-only: the
campaign-level tables have zero UI and zero rows in every environment, so
there is no baseline to preserve, and a second tier is complexity with no
current user. This spec re-keys the existing campaign-level tables to the
channel directly instead of adding a second table alongside them.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tiering | Single tier, channel-scoped, replacing the campaign-scoped tables | No campaign-level baseline exists in practice (dead code, zero rows); a second tier is speculative complexity. See "Supersedes" above. |
| List identity | One active list per channel per type | The checklist step and the UI card both speak of "the" target account list / suppression list for a channel, not a set of them. Re-attaching (CSV upload or first manual add after a detach) replaces the previous list rather than adding a second one. |
| Manual entry vs. CSV entries | Same underlying list/entry tables, no special-casing | A manually added row and a CSV-imported row both become a `TargetAccountEntry`/`SuppressionEntry` on the channel's one list. `isSuppressed`/`matchesTal` and CSV export don't need to know which path an entry came in through. |
| First manual add with no list yet | Silently creates an empty list (`name: "Manual entries"`) and attaches it | Matches the CSV path's create-then-attach shape; the operator adding one row by hand shouldn't be forced through an upload dialog first. |
| Download | Generate CSV on demand from the DB, not via the storage adapter | These lists are small (hundreds to low thousands of rows), read far less often than delivery CSVs, and don't need `storage.put`/presigned-URL indirection. A GET route that queries and streams is simpler and always current. |
| Client visibility | Read-only summary + download, no new approval decision | `ChannelApproval` only ever gated terms/ICP/lead-spec. These lists are reference data the client can see and pull while approving the channel, not something with its own approve/reject state — confirmed with the operator. |
| Client download auth | Re-run the same `campaignChannel.findFirst` org-scoping guard `getClientChannelDetail` already uses, inside the export route itself | The export route is a distinct request, not a render of already-authorized data — it re-checks `clientOrganizationId` rather than trusting a link that was valid when the page rendered. |
| Draft gating | Upload / manual add / remove / detach require `channel.status === "draft"`, same as ICP and lead-spec editors | Consistent with every other channel-scoped editor (`assertChannelDraftAndAccessible`). Download and the client view are read-only and not gated by draft status. |

## Data model

Rename and re-key both join tables (Prisma model rename + column swap in one
migration):

```prisma
model ChannelTargetAccountList {
  id                String   @id @default(cuid())
  campaignChannelId String
  listId            String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel   @relation(fields: [campaignChannelId], references: [id])
  list            TargetAccountList @relation(fields: [listId], references: [id])

  @@unique([campaignChannelId, listId])
  @@index([campaignChannelId])
}

model ChannelSuppressionList {
  id                String   @id @default(cuid())
  campaignChannelId String
  listId            String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])
  list            SuppressionList @relation(fields: [listId], references: [id])

  @@unique([campaignChannelId, listId])
  @@index([campaignChannelId])
}
```

`TargetAccountList`/`SuppressionList`/`TargetAccountEntry`/`SuppressionEntry`
are unchanged — still an org-owned, reusable pool; only the join to a campaign
becomes a join to a channel.

`CampaignChannel` gains:
```prisma
targetAccountLists ChannelTargetAccountList[]
suppressionLists   ChannelSuppressionList[]
```

`Campaign.targetAccountLists`/`Campaign.suppressionLists`
(`schema.prisma:620-621`) are deleted. `TargetAccountList.campaigns` /
`SuppressionList.campaigns` are renamed to `channels` and re-typed to the new
models.

### Migration

One migration, `rekey_list_links_to_channel`:

1. Drop `CampaignTargetAccountList` and `CampaignSuppressionList` (both are
   unwritten in every environment — no code path has ever inserted a row,
   confirmed by the grep in the Problem section).
2. Create `ChannelTargetAccountList` and `ChannelSuppressionList` as above.

No backfill: there is nothing to carry forward.

## Server logic

### `src/lib/lists/target-accounts.ts`

- `attachTargetAccountList(db, actor, campaignChannelId, listId)` — was
  keyed by `campaignId`. Uses `assertChannelDraftAndAccessible` (already
  exists, `crud.ts:247`) instead of `assertDraftAndAccessible`. Inside the
  audit transaction: delete any existing `channelTargetAccountList` row for
  this `campaignChannelId` (enforces "one active list"), then create the new
  one. Audit `entityType` becomes `"CampaignChannel"`.
- New `detachTargetAccountList(db, actor, campaignChannelId)` — asserts draft
  + access, deletes the channel's row if present. Does not delete the
  underlying `TargetAccountList`/entries (still `isReusable` pool data).
- New `addTargetAccountEntry(db, actor, campaignChannelId, entry: { rawName?, rawDomain?, country?, maxLeadsPerAccountOverride? })`
  — asserts draft + access; finds the channel's attached list or creates one
  named `"Manual entries"` and attaches it (same replace-safe path as
  `attachTargetAccountList`, minus the replace since there's nothing to
  replace); resolves the account via the existing `resolveAccount`; creates
  one `TargetAccountEntry`. Reuses the row-level validation
  `importTargetAccountList` already has (name-or-domain required, cap must be
  a positive integer) as a shared helper rather than duplicating it inline.
- New `removeTargetAccountEntry(db, actor, campaignChannelId, entryId)` —
  asserts draft + access, verifies the entry's `listId` matches the channel's
  attached list before deleting (an entry ID from a different channel/list
  must 404, not silently no-op).
- New `exportTargetAccountListCsv(db, actor, campaignChannelId)` — asserts
  `campaign:read` + org access only, **no draft gate**. Loads the channel's
  attached list and its entries ordered by `createdAt`, serializes to CSV
  (`name,domain,matchStatus,maxLeadsPerAccountOverride`). Returns `null` if no
  list is attached (caller 404s).
- `resolveAccountCap(db, campaignChannelId, accountId)` — keeps its
  `db.campaignChannel.findUnique` (still needed for the
  `defaultMaxLeadsPerAccount` fallback), but stops using its `campaignId`
  field as a detour: queries `channelTargetAccountList` by `campaignChannelId`
  directly instead of by the channel's `campaignId`.

### `src/lib/lists/suppression.ts`

Same four additions/changes, mirrored: `attachSuppressionList`,
`detachSuppressionList`, `addSuppressionEntry(db, actor, campaignChannelId, { type, value })`
(reuses the existing per-type normalize/hash/resolve branches from
`importSuppressionList`'s loop body, extracted into a shared helper so import
and manual-add can't drift), `removeSuppressionEntry`,
`exportSuppressionListCsv` (`type,value` columns — never exports `valueHash`).
`isSuppressed(db, campaignChannelId, candidate)` — was keyed by `campaignId`,
now queries `channelSuppressionList` by `campaignChannelId`.

### `src/lib/leads/matching.ts`

`checkSuppression(db, campaignChannelId, candidate)` and
`matchesTal(db, campaignChannelId, accountId)` — both thin wrappers,
reparametrized from `campaignId` to `campaignChannelId`. Comments updated
(the `"noList"` comment on `matchesTal` currently says "campaign has zero
`CampaignTargetAccountList` rows" — becomes "channel has zero
`ChannelTargetAccountList` rows").

### `src/lib/leads/intake.ts`

Two call sites change from `campaign.id` to `campaignChannel.id`:
- `checkSuppression(db, campaign.id, {...})` → `checkSuppression(db, campaignChannel.id, {...})` (line 352).
- `matchesTal(db, campaign.id, account.id)` → `matchesTal(db, campaignChannel.id, account.id)` (line 390).

`campaignChannel` is already in scope at both call sites (used at line 392 and
405), so this is a mechanical rename, not a restructure.

## Catalog & readiness

`ChannelFacts` (`step-catalog.ts:6-11`) gains:
```ts
hasTargetAccountList: boolean;
targetAccountCount: number;
hasSuppressionList: boolean;
suppressionCount: number;
```

`loadChannelFacts` in `readiness.ts` adds two queries (batched alongside the
existing ICP/lead-spec/placement counts): find the channel's
`channelTargetAccountList`/`channelSuppressionList` row (if any), and count
that list's entries.

`step-catalog.ts` entries for `targetAccountList` and `suppressionList`
(currently `available: false`, `step-catalog.ts:79-101`):
- `available: true`.
- `href: tab("lists")` (was `tab("terms")`).
- `isDone: (f) => f.hasTargetAccountList` / `(f) => f.hasSuppressionList`.

Both `seedDefault` stay `() => null` — like `allocations`, these are steps an
operator adds deliberately via the checklist's "Add step" picker, never
auto-seeded.

## Admin UI

**Tab.** `channels/[channelId]/page.tsx`: add `{ id: "lists", label: "Lists" }`
to `TABS`. Visibility follows the existing `hasPlacementStep` pattern
(`page.tsx:120,126`): compute `hasTalStep`/`hasSuppressionStep` from
`readiness.steps`, show the tab when either is present.

**New component** `channels/[channelId]/channel-lists-tab.tsx`, rendering two
`ListCard`s (one local subcomponent, parameterized by list type):

- Header: list name (or "No list attached yet"), row count, last-updated.
- **Upload CSV** — dialog reusing the file-input → PapaParse header-preview →
  column-mapping flow from `leads/upload/upload-form.tsx`, trimmed to this
  list's columns (target accounts: name/domain/country/cap; suppression:
  type/value). Submits to a new server action; the channel is fixed by the
  route, so there's no channel picker (unlike the lead upload form).
- **Add manually** — inline form (not a full dialog): name+domain+cap fields
  for target accounts, type+value fields for suppression. Appends one row,
  clears the form, keeps focus for fast repeated entry.
- Entry table (first 50 rows, with a note to download for the full list),
  per-row remove button.
- **Download CSV** button — links to the export route. Always visible when a
  list is attached, regardless of channel draft status.
- **Remove list** — only rendered when `channel.status === "draft"`.

All write controls (upload, add, remove-entry, remove-list) hidden when the
channel is not `draft`, mirroring the terms/ICP editors elsewhere on this
page. Download is never hidden.

**Server actions** — added to
`channels/[channelId]/actions.ts`: `uploadTargetAccountListAction`,
`addTargetAccountEntryAction`, `removeTargetAccountEntryAction`,
`detachTargetAccountListAction`, and the four suppression equivalents. Each
asserts `campaign:write` and delegates to the lib functions above, which
re-assert draft + access server-side (the UI hiding controls is not the
enforcement).

**Export routes** — `src/app/api/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts`
and `.../suppression-list/export/route.ts`. `requireActor()`, assert
`campaign:read` + org access via the channel's campaign, call
`exportTargetAccountListCsv`/`exportSuppressionListCsv`, 404 if nothing is
attached, otherwise stream `text/csv` with
`Content-Disposition: attachment; filename="<channel-label>-target-accounts.csv"`.

## Client-facing

`ClientChannelDetail` (`client-channel-view.ts:43-67`) gains:
```ts
targetAccountList: { rowCount: number; downloadUrl: string } | null;
suppressionList: { rowCount: number; downloadUrl: string } | null;
```
`null` when no list is attached (or the step isn't on the channel's
checklist) — the client page renders nothing for that row rather than an
empty-state card. `getClientChannelDetail` computes these via the same
`channelTargetAccountList`/`channelSuppressionList` lookups as the admin
facts, inside the existing org-scoped `campaignChannel.findFirst` guard
(`client-channel-view.ts:87-92`) so a client can never see another
organization's list.

**Client export routes** — new,
`src/app/api/client/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts`
(+ suppression variant). Same `requireActor()` + `exportTargetAccountListCsv`
call as the admin route, but the org check is the client one: re-run
`db.campaignChannel.findFirst` scoped to
`campaign.clientOrganizationId === actor.organizationId` (matching
`client-channel-view.ts:91`) before calling export, rather than the admin
route's internal-org check. This is a second route, not a shared one, because
the two authorization rules are genuinely different (internal org access vs.
client org ownership) and conflating them risks the wrong one firing.

**Client page.** `src/app/client/campaigns/[id]/channels/[channelId]/page.tsx`
gets a small read-only section — "Target account list — 128 accounts —
Download CSV" / "Suppression list — 40 entries — Download CSV" — rendered
only when the corresponding field is non-null. Placed alongside the existing
terms/ICP/lead-spec summary, not as a new tab (there's no client-side tab
structure to extend here today).

## Testing

Pure unit tests, no database:
- CSV row validation for manual add mirrors the import validation (name-or-domain
  required for target accounts, known type + normalizable value for
  suppression) — same rejection messages either path.
- `isDone` for both catalog entries reads `hasTargetAccountList`/`hasSuppressionList`.

Integration tests against the real database:
- Attaching a list to channel A does not make it visible on channel B of the
  same campaign (this is the regression the whole spec exists to fix).
- Uploading a second CSV to a channel that already has one replaces it —
  old entries are gone, `channelTargetAccountList` still has exactly one row.
- Manual add with no list yet creates a `"Manual entries"` list and attaches
  it; a second manual add reuses that same list.
- Removing an entry that belongs to a different channel's list 404s rather
  than deleting.
- Upload/add/remove/detach are refused when the channel is not `draft`;
  export is not.
- `resolveAccountCap` and `isSuppressed`/`matchesTal` only see entries
  attached to the channel being evaluated, not sibling channels.
- Client `getClientChannelDetail` returns `null` for a step that was never
  added to the channel's checklist, and a populated summary when a list is
  attached; a client from a different organization gets `NotFoundError` from
  both the page data and the export route.
- Export routes 404 when no list is attached, and stream valid CSV
  (round-trips through `parseDelimited`) when one is.
