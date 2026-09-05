# Design: PRD Epic E7 — Partner allocation

**Spec:** `prd.md` §E7 (P0), §4.6/§4.3/§5.3, `srs.md` §4.6 (Allocation), AUTH-10.

## Context

Six SDD plans have landed on `feat/phase-1-foundation` so far, all admin-side (`(admin)` route group). E7 is the first epic requiring genuinely new infrastructure rather than an extension of an existing pattern: a partner-portal-reachable UI.

Research done while scoping this (both during E5 planning and this design pass) found the identity/role layer is already further along than initially assumed:

- `Organization.isPartner`, `PARTNER_ADMIN`/`PARTNER_OPERATOR` roles, and `Actor.portal`/`isPartner` are all already in place from E1.
- Organization creation and the invitation flow (`src/lib/invitations/invitations.ts`) already handle partner orgs and partner-portal roles generically — no new work needed there.
- What's genuinely missing: the `PartnerAllocation` model itself, an admin-side allocate/reallocate UI, a partner-portal route group with its own auth gate (nothing today enforces `actor.portal` — role permissions are the only current gate), and a client-identity-masked read model for the partner side.

**Scope ruling made during brainstorming:** E7's own PRD bullet list is narrower than "build the partner portal" — it's allocate/reallocate + the allocation appearing in a minimal partner view once active. Partner file upload (E8's bullet, "Partner file upload with column mapping...") and rejection feedback to partners (E9's bullet) are explicitly separate epics with their own partner-facing surfaces to add later. This plan builds only:

1. The `PartnerAllocation` model and admin-side allocate/reallocate UI.
2. A minimal partner-portal shell with one page: the partner's own active allocations, masked per AUTH-10.

**Explicitly deferred, not part of this plan:**
- `AllocationCounter` (submitted/accepted/rejected/replacementsOwed) and wiring it into E8's intake or E9's verification transactions. No counter model, no cap enforcement yet — those need real submission/verification volume to mean anything, and retrofitting two already-shipped, already-reviewed plans is a bigger, separate piece of work.
- Partner lead submission UI (E8), rejection feedback UI (E9), replacement request UI (E9).
- Payout computation (E14) — `payoutRateMinor`/`payoutCurrency` are stored on the allocation per the PRD, but nothing computes a payout from them yet.
- Any `(client)` portal work — out of scope for E7, though this plan's portal-gating pattern (see below) is written to generalize to it later.

## Data model

```prisma
enum AllocationStatus {
  draft
  active
  paused
  ended
}

model PartnerAllocation {
  id                    String            @id @default(cuid())
  campaignChannelId     String
  partnerOrganizationId String
  allocatedQuantity     Int
  payoutRateMinor       BigInt
  payoutCurrency        String            @db.Char(3)
  startDate             DateTime          @db.Date
  endDate               DateTime          @db.Date
  status                AllocationStatus  @default(draft)
  revealClientIdentity  Boolean           @default(false)
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt
  createdById           String?
  updatedById           String?

  campaignChannel     CampaignChannel @relation(fields: [campaignChannelId], references: [id])
  partnerOrganization Organization    @relation(fields: [partnerOrganizationId], references: [id])
}
```

Mirrors `CampaignChannel`'s own conventions: money as integer minor units + a separate ISO currency column (`clientUnitPriceMinor`/`currency` → `payoutRateMinor`/`payoutCurrency`), and the same `draft/active/paused` status shape (`ended` in place of `completed`, since an allocation doesn't "complete" the way a campaign does — it's ended by an operator). `payoutCurrency` defaults from the partner organization's `defaultPayoutCurrency` at creation, per the PRD ("inherited from the partner organisation's default and overridable per allocation"), but is a plain editable field on the row, not derived at read time.

No `AllocationCounter` model this pass (see Explicitly Deferred above). `CampaignChannel` and `Organization` both gain a back-relation (`allocations PartnerAllocation[]`) — nothing else on either model changes, matching E5 Task 2's precedent for adding a back-relation without disturbing existing fields.

## Permissions

Two new `Permission` values: `"allocation:read"`, `"allocation:write"`.

- `OPERATIONS`: both (matches PRD §4.1 — "Partner allocation" is Operations' stated responsibility). `SUPER_ADMIN` gets both via the existing bypass.
- `PARTNER_ADMIN`, `PARTNER_OPERATOR`: `allocation:read` only.
- No other role gets either.

## Admin allocate/reallocate UI

Mirrors E5 Task 5's placement-management structure exactly, one level up (allocations are siblings of placements under a campaign channel):

**Files:**
- `src/lib/allocations/crud.ts` — `createAllocation(db, actor, input)`, `updateAllocation(db, actor, { allocationId, ...editableFields })`.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/page.tsx` — list: partner org name, quantity, payout rate/currency, window, status, `revealClientIdentity`. "New allocation" link.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/new/page.tsx` + form — partner-org picker (`Organization` where `isPartner: true`), quantity, payout rate (string input converted via the existing `toMinorUnits` helper, same as `CampaignChannel.clientUnitPrice`), payout currency (defaulted from the picked partner's `defaultPayoutCurrency`, editable), start/end dates, `revealClientIdentity` checkbox (default unchecked).
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/[allocationId]/page.tsx` + edit form — same fields editable in place via `updateAllocation` (the "plain edit" reallocation model — no history/versioning, since there's no live counter yet to reconcile across a split), plus a status `Select` (any-to-any transitions: `draft`/`active`/`paused`/`ended`), mirroring `AssetStatusControl`/`PlacementStatusControl`'s established small-`Select`-triggers-a-server-action pattern.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/actions.ts` — `createAllocationAction`, `updateAllocationAction`.
- Modify `src/app/(admin)/campaigns/[id]/page.tsx` — one more link column on the Channels table ("Allocations"), alongside E5's "Placements" column, same style.

## Partner portal shell + gating

New top-level URL segment `src/app/partner/` — a real segment, not a parenthetical route group. `(admin)` uses a route group specifically to keep its routes at the bare root (`/campaigns`, not `/admin/campaigns`); the partner portal instead gets an honest `/partner/...` prefix, which also gives `proxy.ts` a single clean matcher entry and reads unambiguously in a browser URL bar for a non-employee user.

- `src/app/partner/layout.tsx`: `requireActor()`, then `if (actor.portal !== "partner") throw new ForbiddenError("This portal is for partner users")`. This is the first portal-level gate in the codebase — until now, `(admin)`'s layout only calls `requireActor()` and relies entirely on per-action `assertPermission` checks to limit what a non-admin-portal actor can actually do. Establishes the pattern the future `(client)` portal will reuse. A minimal sidebar (one link: "Allocations" — no campaign/org/channel-type chrome from the admin shell).
- `src/app/partner/allocations/page.tsx` — the only page this pass. Lists the signed-in partner org's active allocations via `getAllocationsForPartner` (below). Read-only: no actions, no forms.
- `src/proxy.ts` matcher gains `"/partner"`, `"/partner/:path*"`.

## Partner-facing read model (AUTH-10)

AUTH-10: "Partner-facing responses are assembled from a restricted projection... a distinct read model, not field filtering applied to the admin response." Concretely:

```ts
// src/lib/allocations/partner-view.ts
export type PartnerAllocationView = {
  id: string;
  channelTypeName: string;
  funnelStageCode: string;
  allocatedQuantity: number;
  payoutRateMinor: bigint;
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
};

export async function getAllocationsForPartner(
  db: PrismaClient,
  actor: Actor,
): Promise<PartnerAllocationView[]> {
  assertPermission(actor, "allocation:read");
  const rows = await db.partnerAllocation.findMany({
    where: { partnerOrganizationId: actor.organizationId, status: "active" },
    select: {
      id: true, allocatedQuantity: true, payoutRateMinor: true, payoutCurrency: true,
      startDate: true, endDate: true,
      campaignChannel: { select: { channelTypeVersion: { select: { definitionJson: true } } } },
    },
  });
  return rows.map((r) => {
    const def = r.campaignChannel.channelTypeVersion.definitionJson as ChannelTypeDefinition;
    return {
      id: r.id, channelTypeName: def.name, funnelStageCode: def.funnelStageCode,
      allocatedQuantity: r.allocatedQuantity, payoutRateMinor: r.payoutRateMinor,
      payoutCurrency: r.payoutCurrency, startDate: r.startDate, endDate: r.endDate,
    };
  });
}
```

Key properties:
- **Scoped unconditionally by `actor.organizationId`** — no `isInternal` bypass, unlike every admin-side org-scoping query in this codebase. This function's entire reason to exist is a partner's own restricted view; an internal actor calling it should get nothing (they use the admin-side query instead), not everything.
- **The Prisma `select` never reaches `campaignChannel.campaign` at all.** Client name, other partners' allocations, total contracted campaign volume, and campaign pricing are structurally absent from the query result — not merely omitted from the output type. A future field added to `PartnerAllocation` or `CampaignChannel` cannot silently leak through this function without an explicit edit to its own `select`.
- **Channel-type label reads the frozen `channelTypeVersion.definitionJson` snapshot** — the same convention established in E9 and reused throughout E5, for the same reason: a later edit to the live `ChannelType` must not retroactively change what an already-active allocation displayed.
- Per this design's earlier scoping call, the label shown is the channel type name/funnel stage only — not a masked campaign name/pseudonym. Full campaign-spec detail (ICP, TAL, asset, questions) is out of scope here; it belongs to whichever epic builds the actual partner lead-submission surface (E8).

`revealClientIdentity` is stored on the model (so a future partner-facing surface — e.g. E8's submission UI — can honor a per-allocation override) but this pass's read model does not yet branch on it, since there is no client-identifying field in the query to conditionally include. That branch gets added when a future surface actually needs to reveal something conditionally.

## Testing

Matches this session's established verification convention: `npx tsc --noEmit` + `npx eslint`; curl with a session cookie for HTTP-reachable checks (including confirming a `PARTNER_ADMIN` actor is redirected/forbidden from `(admin)` routes is out of scope — that's not a new behavior this plan changes — but that a non-partner actor visiting `/partner/allocations` gets `ForbiddenError`, and a partner actor sees only their own org's active allocations); throwaway `tsx` scripts for logic not reachable via HTTP, specifically: creating allocations for two different partner orgs on the same campaign channel and confirming `getAllocationsForPartner` for partner A never returns partner B's row or any field naming the client; confirming a `draft`/`paused`/`ended` allocation is excluded from the partner view; confirming the admin-side query's full campaign/client detail is unaffected (regression check, same spirit as Task 6's full-suite run this session that caught a real cross-task regression).

## Open questions / follow-ups for later epics

- `AllocationCounter` and real cap enforcement — needs E8/E9 integration, deliberately deferred.
- Whether `(admin)`'s own layout should retroactively gain a symmetrical `actor.portal === "admin"` check now that the pattern exists — not required for E7 to function (permission checks already prevent a partner actor from doing anything destructive in `(admin)`), but worth a follow-up ticket for defense-in-depth once a `(client)` portal exists too.
