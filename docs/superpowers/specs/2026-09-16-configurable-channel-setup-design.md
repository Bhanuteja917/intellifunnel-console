# Configurable Channel Setup Checklist

## Problem

A channel's setup checklist is hardcoded. `computeChannelReadiness` knows two
steps, `placement` and `allocations`, configured through a `stepConfigJson`
column holding `enabled | optional | skipped` per step. Channel terms, ICP and
lead spec are not steps at all — they are inline gates inside
`assertChannelReadyForApproval`.

Three things follow from that:

1. **Operators cannot change what a channel requires.** A client who insists on
   a suppression list before launch has no way to express it, and no gate
   enforces it.
2. **Impression-only channels are blocked by gates that do not apply to them.**
   `assertChannelReadyForApproval` demands at least one ICP criterion and an
   `email` lead field spec from every channel. Programmatic display counts
   impressions and produces no leads, so it can never satisfy either, and can
   never be submitted for approval.
3. **A channel submitted by mistake is stuck.** `draft → pending` is one-way.
   Only a client rejection returns a channel to `draft`, so correcting a typo
   means asking the client to reject the work.

## Scope

This spec covers the step machinery, the rewritten gate, withdraw-to-draft, and
the admin checklist editor.

Deliberately **out of scope**, deferred to a follow-up spec: target-account-list
and suppression-list management UI, channel-level list join tables, and unioning
those lists into lead intake. The two list step keys exist in the enum and the
catalog here, but are not selectable — see "Deferred steps" below.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Who defines a step | Fixed catalog in code | Every step needs real completion logic and a real destination. A data-defined step can be configured into something nobody can ever complete. |
| Where config lives | `ChannelSetupStep` rows, one per channel per step | Add/remove a step is insert/delete. Absent row means the step is off, which removes the need for a `skipped` state. |
| Where defaults come from | Catalog, keyed off `ChannelTypeDefinition` flags | No new configuration surface. Matches how `requiresAsset` already drives the placement step. |
| Locked steps | `channelTerms` only | Approval snapshots in `lib/approvals/status.ts` assume terms exist. Everything else is a judgment call that belongs to the operator. |
| ICP / lead spec | Seeded required when `producesLeads`, absent otherwise | Fixes the impression-only channel. Still removable, because the operator knows more about the deal than the flag does. |
| Withdraw | `campaign:submitInternal`, no approval row | The same people who submit can unsubmit. The client never decided, so there is nothing to snapshot. |
| Client visibility | None | The checklist gates when IIF may submit. It does not change what the client reviews. |

## Data model

```prisma
enum ChannelSetupStepKey {
  channelTerms
  icp
  leadSpec
  placement
  allocations
  targetAccountList
  suppressionList
}

enum ChannelSetupRequirement {
  required
  optional
}

model ChannelSetupStep {
  id                String                  @id @default(cuid())
  campaignChannelId String
  stepKey           ChannelSetupStepKey
  requirement       ChannelSetupRequirement @default(required)
  sortOrder         Int
  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])

  @@unique([campaignChannelId, stepKey])
  @@index([campaignChannelId])
}
```

`CampaignChannel` gains `setupSteps ChannelSetupStep[]` and loses
`stepConfigJson`.

A row's presence means the step is on the checklist. Its absence means the step
was removed or never seeded. `sortOrder` is seeded from catalog order and is not
user-editable in this spec.

### Migration

One migration, `add_channel_setup_step`, in three statements:

1. Create the enums and the table.
2. Backfill one row set per existing `CampaignChannel`, reading
   `stepConfigJson` and the channel's frozen `channelTypeVersion.definitionJson`:
   - `channelTerms` → always a `required` row.
   - `icp`, `leadSpec` → `required` row when `definitionJson->>'producesLeads'`
     is true, otherwise no row. This matches the gate that was actually being
     enforced before the migration for lead channels, and unblocks the
     impression-only channels that were stuck.
   - `placement` → no row when `requiresAsset` is false or
     `stepConfigJson->>'placement'` is `skipped`; an `optional` row when the
     override is `optional`; a `required` row otherwise.
   - `allocations` → no row when the override is `skipped`; a `required` row
     when it is `enabled`; an `optional` row otherwise, which is the prior
     default.
   - `targetAccountList`, `suppressionList` → no row.
3. Drop `CampaignChannel.stepConfigJson`.

The backfill must run as SQL inside the migration, not as an application script,
so a deploy cannot leave the table empty and every channel's gate wide open.

## Catalog

New module `src/lib/channels/step-catalog.ts`:

```ts
export type ChannelFacts = {
  hasTerms: boolean;
  icpCount: number;
  hasEmailSpec: boolean;
  activePlacementCount: number;
  allocationCount: number;
};

export type CatalogEntry = {
  key: ChannelSetupStepKey;
  title: string;
  hint: string;
  cta: string;
  href: (campaignId: string, channelId: string) => string;
  locked: boolean;
  available: boolean;
  applies: (def: ChannelTypeDefinition) => boolean;
  seedDefault: (def: ChannelTypeDefinition) => ChannelSetupRequirement | null;
  isDone: (facts: ChannelFacts) => boolean;
};
```

`seedDefault` returning `null` means no row at creation. `applies` returning
false keeps the step out of the add picker for that channel type.

| Key | locked | applies | seedDefault | isDone |
|---|---|---|---|---|
| `channelTerms` | yes | always | `required` | `hasTerms` |
| `icp` | no | always | `required` if `producesLeads`, else `null` | `icpCount > 0` |
| `leadSpec` | no | `producesLeads` | `required` if `producesLeads`, else `null` | `hasEmailSpec` |
| `placement` | no | `requiresAsset` | `required` if `requiresAsset`, else `null` | `activePlacementCount > 0` |
| `allocations` | no | always | `optional` | `allocationCount > 0` |
| `targetAccountList` | no | always | `null` | deferred |
| `suppressionList` | no | always | `null` | deferred |

`icp` applies to every channel type but `leadSpec` does not. An impression-only
channel can still carry targeting criteria worth recording and gating on, so an
operator may add `icp` back to one. A lead field spec describes the shape of a
lead, so on a channel that produces none it is meaningless rather than merely
unusual, and the picker does not offer it.

`hasTerms` is true when the channel has a positive `contractedQuantity` and a
non-null `clientUnitPriceMinor`, both of which are required at creation. The
step is therefore always complete in practice; it exists so the checklist reads
as a full account of what a channel needs, and so the locked-row behaviour has
something to protect.

### Deferred steps

`targetAccountList` and `suppressionList` carry `available: false`. They are
excluded from the add picker and never seeded, so no channel can hold one. A
step with no working `isDone` would make a channel unsubmittable with no way for
the operator to clear it. The follow-up spec flips `available` to true once
those steps have real completion logic and a destination page.

## Readiness

`src/lib/channels/readiness.ts` is rewritten as a join over rows, catalog and
facts. `StepConfig` and `StepOverride` are deleted along with the tri-state
branching.

```ts
export type ChannelStep = {
  key: ChannelSetupStepKey;
  title: string; hint: string; cta: string; href: string;
  requirement: ChannelSetupRequirement;
  locked: boolean;
  done: boolean;
};

export function computeChannelReadiness(
  steps: { stepKey: ChannelSetupStepKey; requirement: ChannelSetupRequirement; sortOrder: number }[],
  facts: ChannelFacts,
  ids: { campaignId: string; channelId: string },
): ChannelReadiness;
```

`loadChannelReadiness` loads the rows and gathers `ChannelFacts` in a single
batched round of counts, then delegates to the pure function. Rows whose
`stepKey` has no catalog entry are ignored rather than throwing, so removing a
catalog entry in future cannot break a page render.

## Gate

`assertChannelReadyForApproval` in `src/lib/campaigns/state-machine.ts` drops
its inline ICP and email-spec checks and its `stepConfigJson` read. New body:
load readiness, find the first step with `requirement === "required"` and
`done === false`, and throw `ValidationError` naming that step's title. When
every required step is done, the channel submits.

An impression-only channel carries no `icp` or `leadSpec` row, so nothing blocks
it. A channel whose operator marked `allocations` required cannot submit until a
partner allocation exists.

## Withdraw

New export in `state-machine.ts`, alongside `submitChannelForApproval`:

```ts
export async function withdrawChannelFromApproval(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<CampaignChannel>;
```

Asserts `campaign:submitInternal` and organization access through the existing
`loadAccessibleChannel`. Throws `InvalidStateTransitionError` when the channel is
not `pending`. In one transaction: sets `status: "draft"`, writes an audit row
with action `transition:draft` and `after.reason = "withdrawn"`, then calls
`updateCampaignStatus`. No `ChannelApproval` row is written, because no decision
was made.

Campaign status is derived, and any draft channel forces its campaign to `draft`
(`deriveCampaignStatus`, state-machine.ts). Withdrawing therefore re-opens terms
editing across that campaign's other channels. This already happens on client
rejection; withdraw is a second route to the same state, not a new one.

## Server actions

Three new actions in
`src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`, backed by
functions in `src/lib/channels/setup-steps.ts`:

- `addChannelSetupStepAction(campaignId, channelId, stepKey)` — rejects a key
  that is unavailable, does not apply to the channel type, or already has a row.
- `removeChannelSetupStepAction(campaignId, channelId, stepKey)` — rejects a
  locked step.
- `setChannelStepRequirementAction(campaignId, channelId, stepKey, requirement)`
  — rejects demoting a locked step to `optional`.

Every one asserts `campaign:write`, asserts organization access, and asserts the
channel is `draft`. A fourth action, `withdrawChannelFromApprovalAction`, wraps
the state-machine function. All write audit rows.

Editing outside `draft` is refused server-side. The UI only hides the controls.

The `stepConfig` input threaded through `src/lib/campaigns/channels.ts`,
`src/lib/campaigns/crud.ts` (which creates channels alongside a campaign) and
both `actions.ts` layers is replaced by an optional
`setupSteps: { stepKey, requirement }[]`. The `StepConfig` type is deleted, so
the compiler finds every call site.

## UI

**Setup checklist card**, `channels/[channelId]/page.tsx`. When the channel is
`draft`, each row gains a requirement toggle and a remove button; locked rows
render neither. An "Add step" dropdown lists catalog entries that are
`available`, `applies` to this channel type, and have no row yet, and is hidden
when that list is empty. Outside `draft` the card renders as it does today.

**Status control**, `channel-status-control.tsx`. The `pending` branch currently
renders a bare `<Badge>`. It gains a "Withdraw to draft" button in a confirm
dialog, warning that the channel leaves the client's approval queue.

**Creation form**, `channels/new/new-channel-form.tsx`. The placement-only
override is replaced by a picker over the seeded catalog, letting the operator
adjust requirements before the channel exists. Submitting sends a list of
`{ stepKey, requirement }`, and `createCampaignChannel` writes those rows in the
same transaction as the channel. Omitting the list seeds catalog defaults.

**Terms dialog**, `edit-channel-dialog.tsx`. Its `stepConfig` handling is
removed. Step editing belongs to the checklist card.

## Testing

Pure unit tests, no database:

- `seedDefault` per definition flags — `producesLeads: false` seeds neither
  `icp` nor `leadSpec`; `requiresAsset: false` seeds no `placement`.
- `computeChannelReadiness` — ordering, `done` per step, rows with unknown keys
  ignored, empty row set yields an empty checklist.

Integration tests against the real database:

- Creating a channel seeds exactly the expected rows for a lead channel and for
  an impression-only channel.
- An impression-only channel with no ICP and no lead spec submits successfully.
  This is the regression that motivates the spec.
- Submit is refused when a `required` step is incomplete, and the error names
  that step.
- Submit succeeds when an incomplete step is `optional`.
- `channelTerms` cannot be removed or demoted.
- A step that is unavailable or does not apply cannot be added.
- Step edits are refused when the channel is not `draft`.
- Withdraw moves `pending` → `draft`, writes the audit row, writes no
  `ChannelApproval`, and re-derives campaign status.
- Withdraw is refused from `draft`, `live`, `scheduled` and `completed`.
- Withdraw is refused for an actor lacking `campaign:submitInternal`.

Migration test — each prior `stepConfigJson` shape (`null`, `{}`,
`{placement:"optional"}`, `{placement:"skipped"}`, `{allocations:"enabled"}`)
backfills to the expected row set, for both a lead channel and an
impression-only channel.

## Follow-up spec

Target-account-list and suppression-list support, flipping `available` to true
for the two deferred catalog entries, is covered by
[2026-09-17-channel-target-suppression-lists-design.md](./2026-09-17-channel-target-suppression-lists-design.md).
That spec **supersedes** the two-tier sketch originally written here (a
campaign-level baseline unioned with new channel-level tables): the
campaign-level tables turned out to have zero UI and zero rows in every
environment, so there was no baseline to preserve. It re-keys the existing
`CampaignTargetAccountList`/`CampaignSuppressionList` tables to the channel
directly instead of adding a second tier alongside them.
