# Plan: PRD Epic E7 — Partner allocation

**Spec:** `docs/superpowers/specs/2026-09-05-partner-allocation-design.md` (full design), `prd.md` §E7 (P0), §4.6/§4.3/§5.3, `srs.md` §4.6 (Allocation), AUTH-10.

## Context

Six SDD plans have landed on `feat/phase-1-foundation` so far, all admin-side (`(admin)` route group). E7 is the first epic requiring genuinely new infrastructure rather than an extension of an existing pattern: a partner-portal-reachable UI.

The identity/role layer is already in place from E1: `Organization.isPartner`, `PARTNER_ADMIN`/`PARTNER_OPERATOR` roles (seeded, `portal: "partner"`), and `Actor.portal`/`isPartner` all exist and need no changes. What's genuinely missing, and what this plan builds: the `PartnerAllocation` model itself, an admin-side allocate/reallocate UI, a partner-portal route group with its own auth gate (nothing today enforces `actor.portal` — role permissions are the only current gate), and a client-identity-masked read model for the partner side.

**Scope, per the design doc:** allocate/reallocate + the allocation appearing in a minimal partner view once active. `AllocationCounter` (submitted/accepted/rejected/replacementsOwed) and cap enforcement, partner lead submission UI (E8), rejection feedback UI (E9), replacement requests (E9), and payout computation (E14) are all explicitly out of scope for this plan — see the design doc's "Explicitly deferred" section.

## Global Constraints

**Permissions:** two new `Permission` values, `"allocation:read"` and `"allocation:write"`. `OPERATIONS` gets both (PRD §4.1 names partner allocation as Operations' responsibility). `PARTNER_ADMIN`/`PARTNER_OPERATOR` get `allocation:read` only. No other role gets either. `SUPER_ADMIN` gets both via the existing bypass in `hasPermission`.

**First portal-level gate in the codebase.** Until now, `(admin)`'s layout only calls `requireActor()` and relies entirely on per-action `assertPermission` checks — nothing anywhere checks `actor.portal`. `src/app/partner/layout.tsx` is the first place that does: `if (actor.portal !== "partner") throw new ForbiddenError(...)`. This plan does **not** retroactively add a symmetrical `actor.portal === "admin"` check to `(admin)/layout.tsx` — not required for E7 to function (permission checks already prevent a partner actor from doing anything destructive in `(admin)`), and out of scope here (noted in the design doc as a follow-up once a `(client)` portal exists too).

**Partner read model is AUTH-10, not field-filtering.** `getAllocationsForPartner` (Task 4) is a distinct query with its own `select` that never reaches `campaignChannel.campaign` at all — client name, other partners' allocations, and campaign pricing are structurally absent from the query result, not merely omitted from the output type. It is scoped unconditionally by `actor.organizationId`, with **no `isInternal` bypass** (unlike every admin-side org-scoping query in this codebase) — an internal actor calling this function should get nothing, since its whole reason to exist is a partner's own restricted view.

**New top-level URL segment, not a route group.** `(admin)` uses a route group specifically to keep its routes at the bare root (`/campaigns`, not `/admin/campaigns`). The partner portal instead gets an honest `src/app/partner/...` prefix — a real segment — which gives `proxy.ts` a single clean matcher entry and reads unambiguously in a browser URL bar for a non-employee user.

**Verification convention** (same as every prior plan this session): `npx tsc --noEmit` + `npx eslint <files>` as primary gates; curl with a session cookie (`POST /api/auth/sign-in/email`, `bhanu@intellifunnel.io`/`TestPass123!` for an internal actor) for HTTP-reachable checks; throwaway `tsx` scripts (written, run, deleted, before/after state confirmed) against the shared dev DB for logic not reachable via HTTP or requiring a partner-portal session that doesn't yet exist in the dev DB.

## Task 1: Data model

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
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

  @@index([campaignChannelId])
  @@index([partnerOrganizationId])
}
```

- [ ] **Step 1: Add the enum and model**

  Add `AllocationStatus` and `PartnerAllocation` exactly as above, placed near `CampaignChannel` in the schema file (same section as the other campaign-adjacent models). Money is minor-units-integer + separate ISO currency column, mirroring `CampaignChannel.clientUnitPriceMinor`/`currency`. `ended` replaces `completed` since an allocation doesn't "complete" the way a campaign does — it's ended by an operator.

- [ ] **Step 2: Add the two back-relations**

  On `CampaignChannel` (around line 681, next to `assets AssetPlacement[]`), add:
  ```prisma
  allocations PartnerAllocation[]
  ```
  On `Organization` (around line 92, next to `assets Asset[]`), add:
  ```prisma
  allocations PartnerAllocation[]
  ```
  Nothing else on either model changes — same precedent as E5 Task 2 adding `AssetPlacement[]` without disturbing existing fields.

- [ ] **Step 3: Migrate and generate**

  Run `npm run db:migrate -- --name add_partner_allocation`. Confirm the migration applies cleanly against the dev DB. Run `npm run db:generate` (the migrate command runs this automatically, but confirm `@prisma/client` now exports `PartnerAllocation`/`AllocationStatus` types by checking `node_modules/.prisma/client/index.d.ts` or just proceeding to Task 2, which will fail to typecheck if it didn't).

- [ ] **Step 4: Verify**

  `npx tsc --noEmit` clean (no consumers yet, so this only checks the schema/migration itself compiles). `npx prisma validate`.

- [ ] **Step 5: Commit**

  ```bash
  git add prisma/schema.prisma prisma/migrations
  git commit -m "feat(db): add PartnerAllocation model (E7)"
  ```

---

## Task 2: Permissions

**Files:**
- Modify: `src/lib/auth/permissions.ts`

- [ ] **Step 1: Add the two permission values**

  In the `Permission` union type, add `"allocation:read" | "allocation:write"` (append after `"asset:write"`, matching the union's existing ordering-by-recency).

- [ ] **Step 2: Grant them in `MATRIX`**

  Add `"allocation:read", "allocation:write"` to `OPERATIONS`'s array. Add `"allocation:read"` to both `PARTNER_ADMIN`'s and `PARTNER_OPERATOR`'s arrays. Leave every other role's array untouched — `CAMPAIGN_MANAGER`, `QUALITY`, `ACCOUNT_MANAGER`, `FINANCE`, `CLIENT_ADMIN`, `CLIENT_VIEWER` get neither.

- [ ] **Step 3: Verify**

  `npx tsc --noEmit` clean. Write a throwaway `tsx` script that imports `hasPermission` and asserts: an actor with `roles: ["OPERATIONS"]` has both `allocation:read` and `allocation:write`; an actor with `roles: ["PARTNER_OPERATOR"]` has `allocation:read` but not `allocation:write`; an actor with `roles: ["CAMPAIGN_MANAGER"]` has neither. Delete the script after confirming.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/auth/permissions.ts
  git commit -m "feat(auth): add allocation:read/write permissions (E7)"
  ```

---

## Task 3: Admin allocate/reallocate UI

**Files:**
- Create: `src/lib/allocations/crud.ts`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/page.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/new/page.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/new/new-allocation-form.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/[allocationId]/page.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/[allocationId]/edit-allocation-form.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/allocation-status-control.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/actions.ts`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx` (one more link per channel row, alongside the existing "Placements" link)

**Interfaces:**
```ts
// src/lib/allocations/crud.ts
export type CreateAllocationInput = {
  campaignChannelId: string;
  partnerOrganizationId: string;
  allocatedQuantity: number;
  payoutRate: string; // decimal string, converted via toMinorUnits
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
  revealClientIdentity: boolean;
};
export async function createAllocation(db: PrismaClient, actor: Actor, input: CreateAllocationInput): Promise<PartnerAllocation>;

export type UpdateAllocationInput = {
  allocationId: string;
  allocatedQuantity: number;
  payoutRate: string;
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
  revealClientIdentity: boolean;
};
export async function updateAllocation(db: PrismaClient, actor: Actor, input: UpdateAllocationInput): Promise<PartnerAllocation>;

export type SetAllocationStatusInput = { allocationId: string; status: AllocationStatus };
export async function setAllocationStatus(db: PrismaClient, actor: Actor, input: SetAllocationStatusInput): Promise<PartnerAllocation>;
```

This mirrors E5 Task 5's placement-management structure exactly, one level up (allocations are siblings of placements under a campaign channel): a `page.tsx` list, a `new/` create flow, an edit page for the "plain edit" reallocation model (no history/versioning — there's no live counter yet to reconcile across a split), and a small-`Select`-triggers-a-server-action status control mirroring `PlacementStatusControl`.

- [ ] **Step 1: Read for context**

  Read `src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/` in full (page.tsx, new/page.tsx, new-placement-form.tsx, placement-status-control.tsx, actions.ts) and `src/lib/assets/placements.ts` — this task reproduces that exact shape one level up. Also read `src/lib/campaigns/crud.ts`'s `addCampaignChannel` for the validation style (positive-integer quantity, date-window checks) and `src/lib/money/currency.ts` for `toMinorUnits`/`fromMinorUnits`.

- [ ] **Step 2: `src/lib/allocations/crud.ts`**

  `createAllocation`: `assertPermission(actor, "allocation:write")`. Fetch the `CampaignChannel` by `input.campaignChannelId`; `NotFoundError` if missing. Fetch the `Organization` by `input.partnerOrganizationId`; `NotFoundError` if missing, `ValidationError("Organisation is not a partner organisation")` if `isPartner` is false. Validate `input.allocatedQuantity` is a positive integer (same two checks as `addCampaignChannel`'s `contractedQuantity`: `> 0`, `Number.isInteger`), and `input.endDate.getTime() >= input.startDate.getTime()` (`ValidationError` otherwise). Convert `payoutRateMinor = toMinorUnits(input.payoutRate, input.payoutCurrency)` (this also validates the currency is supported, throwing `ValidationError` for an unknown one). `db.partnerAllocation.create` with `createdById`/`updatedById: actor.userId`, `status` defaulting to `"draft"` (the schema default — don't pass it explicitly unless you want to be explicit, either is fine).

  `updateAllocation`: `assertPermission(actor, "allocation:write")`. Fetch the existing allocation by `input.allocationId`; `NotFoundError` if missing. Same quantity/date/currency validation as `createAllocation`. `db.partnerAllocation.update` setting `allocatedQuantity`, `payoutRateMinor` (recomputed via `toMinorUnits`), `payoutCurrency`, `startDate`, `endDate`, `revealClientIdentity`, `updatedById: actor.userId`. Does not touch `status` or `campaignChannelId`/`partnerOrganizationId` — those are fixed at creation (reallocating to a different partner or channel is a new allocation, not an edit).

  `setAllocationStatus`: `assertPermission(actor, "allocation:write")`. Fetch existing; `NotFoundError` if missing. Plain `db.partnerAllocation.update({ where: { id }, data: { status: input.status, updatedById: actor.userId } })` — any-to-any transition, no state-machine complexity, matching `setPlacementStatus`'s precedent (the PRD doesn't specify a constrained flow for `AllocationStatus` either).

- [ ] **Step 3: `allocations/page.tsx`** — list

  `requireActor()`, `assertPermission(actor, "allocation:read")`. Resolve the campaign via `getCampaignForActor(db, actor, id)` (404 via `notFound()` on `NotFoundError`, same try/catch as `placements/page.tsx`), find the channel in `campaign.channels` by `channelId` (404 if not found). Query:
  ```ts
  const allocations = await db.partnerAllocation.findMany({
    where: { campaignChannelId: channelId },
    include: { partnerOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  ```
  Table columns: partner org name, quantity, payout rate (`fromMinorUnits(a.payoutRateMinor, a.payoutCurrency)` prefixed with the currency, same style as the campaign page's unit-price cell), window (`startDate`–`endDate`, `.toISOString().slice(0, 10)` each), status badge, `revealClientIdentity` (a `Badge` or plain "Yes"/"No" — your call, keep it simple). Each row's status cell links to the edit page (`./allocations/${allocation.id}`) rather than showing an inline status control (the status control lives on the edit page here, unlike placements, since the edit page is also where the other editable fields live — no reason to duplicate the control in two places). "New allocation" button gated on `hasPermission(actor, "allocation:write")`, linking to `./allocations/new`.

- [ ] **Step 4: `allocations/new/page.tsx` + `new-allocation-form.tsx`**

  `page.tsx`: `requireActor()`, `assertPermission(actor, "allocation:write")`, resolve campaign+channel same as Step 3. Fetch partner orgs:
  ```ts
  const partnerOrgs = await db.organization.findMany({
    where: { isPartner: true, status: "active" },
    select: { id: true, name: true, defaultPayoutCurrency: true },
    orderBy: { name: "asc" },
  });
  ```
  Pass `partnerOrgs` into `<NewAllocationForm>` along with `campaignId`/`campaignChannelId`.

  `new-allocation-form.tsx` (client component, mirrors `new-placement-form.tsx`'s shape): a `Select` for partner org (options from `partnerOrgs`); on selection, set `payoutCurrency` state to the selected org's `defaultPayoutCurrency` (fall back to `""` if null — the field stays editable regardless, per the design doc's "editable per allocation" note). Inputs: quantity (`type="number"`, `min="1"`, `step="1"`), payout rate (text input, decimal string, same style as `AddChannelDialog`'s unit-price input), payout currency (text input or a `Select` of `CURRENCY_EXPONENTS` keys — reuse whichever is less code; a plain text `Input` defaulted from the org and freely editable is simplest and matches how `clientUnitPrice`'s currency is handled elsewhere: currency is picked once at the campaign level via a `Select`, so use a `Select` populated from `Object.keys(CURRENCY_EXPONENTS)` here, imported from `@/lib/money/currency`), start/end date (`type="date"` inputs, no `min`/`max` constraint — the design doc doesn't require the allocation window to nest inside the channel window), a `revealClientIdentity` checkbox defaulting unchecked (use the existing checkbox primitive if one exists under `@/components/ui/`; otherwise a plain `<input type="checkbox">` styled minimally is fine — check `components/ui/` first). On submit, call `createAllocationAction`, toast, then `router.push` back to the list page.

- [ ] **Step 5: `allocations/[allocationId]/page.tsx` + `edit-allocation-form.tsx` + `allocation-status-control.tsx`**

  `page.tsx`: `requireActor()`, `assertPermission(actor, "allocation:write")` (this page's whole purpose is editing — read-only viewing of one allocation isn't a separate case worth building). Resolve campaign+channel same as Step 3. Fetch the allocation:
  ```ts
  const allocation = await db.partnerAllocation.findUnique({
    where: { id: allocationId },
    include: { partnerOrganization: { select: { name: true } } },
  });
  ```
  `notFound()` if missing or `allocation.campaignChannelId !== channelId` (same "does this child actually belong to this parent" check `placements/page.tsx` does for its channel). Render the partner org name (read-only, not editable — reallocating to a different partner is a new allocation per Step 2's note) plus `<EditAllocationForm>` pre-filled from the allocation's current values (`fromMinorUnits(allocation.payoutRateMinor, allocation.payoutCurrency)` for the rate string, dates as `.toISOString().slice(0, 10)`) and `<AllocationStatusControl>` for the status.

  `edit-allocation-form.tsx`: same field set as `new-allocation-form.tsx` minus the partner-org picker, pre-filled, calling `updateAllocationAction` on submit, `router.refresh()` (not `push` — stay on the edit page after saving, matching how a settings/edit page typically behaves; if this app has an established "edit in place, refresh, stay" pattern elsewhere prefer that convention instead — check `icp-criteria-editor.tsx` or `lead-field-spec-editor.tsx` quickly for precedent since those are the closest "edit and stay" examples in this codebase).

  `allocation-status-control.tsx`: copy `placement-status-control.tsx`'s shape exactly, swapping `AssetPlacementStatus`/`PLACEMENT_STATUSES` for `AllocationStatus`/`["draft", "active", "paused", "ended"]` and `setPlacementStatusAction`/`setAllocationStatusAction`.

- [ ] **Step 6: `allocations/actions.ts`**

  `createAllocationAction(input)`: `toActionResult` wrapping `requireActor()` + trim/validate `payoutRate`/`payoutCurrency` non-empty (same shape as `createAssetPlacementAction`'s trim checks) + `createAllocation(db, actor, {...})`, `revalidatePath` the list page, return `{ id }`.

  `updateAllocationAction(input)`: same shape, calls `updateAllocation`, `revalidatePath`s both the list and the edit page (`./allocations/${allocationId}`).

  `setAllocationStatusAction(campaignId, campaignChannelId, allocationId, status)`: mirrors `setPlacementStatusAction` exactly — `campaignId`/`campaignChannelId` are only for `revalidatePath`.

- [ ] **Step 7: Wire the campaign detail page link**

  In `src/app/(admin)/campaigns/[id]/page.tsx`, in the Channels table, add one more `TableHead`/`TableCell` per row (next to the existing "Placements" button/link cell) linking to `./channels/${channel.id}/allocations`, same `Button variant="outline" size="sm"` style as the "Placements" link. Don't touch the ICP/lead-field-spec cards on this page, matching every prior plan's rule for this file.

- [ ] **Step 8: Verify**

  `npx tsc --noEmit` clean. Curl-check (signed in as `bhanu@intellifunnel.io`, an internal actor) the list/new pages both 200 for a fixture campaign channel. Throwaway script: `createAllocation` for a non-partner organization — confirm it's rejected with the expected `ValidationError`; `createAllocation` for a real partner org with quantity `0` — rejected; a valid allocation — confirm it's queryable and defaults to `status: "draft"`; `updateAllocation` changing the payout rate/currency — confirm `payoutRateMinor` recomputes correctly; `setAllocationStatus` to `"active"` — confirm it updates without touching the other fields.

- [ ] **Step 9: Commit**

  ```bash
  git add src/lib/allocations src/app/\(admin\)/campaigns/\[id\]/channels/\[channelId\]/allocations src/app/\(admin\)/campaigns/\[id\]/page.tsx
  git commit -m "feat(admin): allocate/reallocate UI for partner allocations (E7)"
  ```

---

## Task 4: Partner-facing read model (AUTH-10)

**Files:**
- Create: `src/lib/allocations/partner-view.ts`

**Interfaces:**
```ts
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
export async function getAllocationsForPartner(db: PrismaClient, actor: Actor): Promise<PartnerAllocationView[]>;
```

- [ ] **Step 1: Write `partner-view.ts`**

  ```ts
  import type { PrismaClient } from "@prisma/client";
  import { assertPermission, type Actor } from "@/lib/auth/permissions";
  import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

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

  /**
   * AUTH-10: a distinct read model, not field-filtering applied to the admin
   * response. The `select` below never reaches `campaignChannel.campaign` at
   * all — client name, other partners' allocations, and campaign pricing are
   * structurally absent from the query result, not merely omitted from the
   * output type. Scoped unconditionally by `actor.organizationId` — no
   * `isInternal` bypass, unlike every admin-side org-scoping query in this
   * codebase: an internal actor calling this gets nothing, since this
   * function's entire reason to exist is a partner's own restricted view.
   */
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
  The channel-type label reads the frozen `channelTypeVersion.definitionJson` snapshot — the same convention E9 established and E5 reused — so a later edit to the live `ChannelType` can't retroactively change what an already-active allocation displayed. `revealClientIdentity` is stored on the model but this function doesn't yet branch on it: there is no client-identifying field in the query to conditionally include, and that branch gets added when a future surface (E8's submission UI) actually needs to reveal something.

- [ ] **Step 2: Verify**

  `npx tsc --noEmit` clean. Throwaway script:
  1. Create two partner organizations, A and B (`isPartner: true`).
  2. Using Task 3's `createAllocation`, create an active allocation for A and one for B on the *same* `CampaignChannel` (use `setAllocationStatus` to flip both to `"active"` after creating as `"draft"`).
  3. Build an `Actor` object by hand with `organizationId` set to A's id, `roles: ["PARTNER_OPERATOR"]`, `isPartner: true`, `isInternal: false`, `portal: "partner"` (no DB user needed — `getAllocationsForPartner` only reads `actor.organizationId`/permissions, not the user row).
  4. Call `getAllocationsForPartner` — confirm exactly one row comes back (A's), and `JSON.stringify` the result contains no substring matching B's org name, the campaign's name, or the client organization's name.
  5. Create a `draft` and a `paused` allocation for A on a different channel — confirm neither appears in A's result.
  6. Confirm the admin-side query (`db.partnerAllocation.findMany` with the full `include` from Task 3's list page) still returns every field for both A and B unaffected — regression check per the design doc's testing convention.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/allocations/partner-view.ts
  git commit -m "feat(allocations): AUTH-10 partner-facing read model (E7)"
  ```

---

## Task 5: Partner portal shell + gating

**Files:**
- Modify: `src/components/app-sidebar.tsx` (accept `nav`/`title`/`subtitle` as props instead of hardcoding, so the partner layout can reuse it without duplicating the logout dropdown)
- Modify: `src/app/(admin)/layout.tsx` (pass the now-extracted admin nav/title/subtitle)
- Create: `src/app/partner/layout.tsx`
- Create: `src/app/partner/loading.tsx`
- Create: `src/app/partner/error.tsx`
- Create: `src/app/partner/allocations/page.tsx`
- Modify: `src/proxy.ts`

- [ ] **Step 1: Read for context**

  Read `src/components/app-sidebar.tsx`, `src/app/(admin)/layout.tsx`, `src/app/(admin)/loading.tsx`, `src/app/(admin)/error.tsx`, and `src/proxy.ts` in full — this task extends all four.

- [ ] **Step 2: Generalize `app-sidebar.tsx`**

  Change the component's props from `{ user: {...} }` to:
  ```ts
  type NavItem = { href: string; label: string };
  export function AppSidebar({
    user,
    nav,
    title,
    subtitle,
  }: {
    user: { name: string; email: string };
    nav: readonly NavItem[];
    title: string;
    subtitle: string;
  }) { ... }
  ```
  Replace the hardcoded module-level `NAV` array's usages with the `nav` prop, and replace the hardcoded `"IntelliFunnelLabs"`/`"Admin Console"` strings in the header with `title`/`subtitle`. Delete the module-level `NAV` constant (it moves to being passed in by each caller). Everything else in the file (logout logic, avatar, dropdown) is unchanged.

- [ ] **Step 3: Update `(admin)/layout.tsx`**

  Define the admin nav array where the old module-level `NAV` used to live in `app-sidebar.tsx` — either inline in this file or as a small local constant — with the same seven entries currently in `AppSidebar`'s `NAV` (Campaigns, Channel types, Organisations, Resolution queue, Verification, Assets, Consent texts). Pass `nav={ADMIN_NAV}`, `title="IntelliFunnelLabs"`, `subtitle="Admin Console"` to `<AppSidebar>`.

- [ ] **Step 4: `src/app/partner/layout.tsx`**

  ```tsx
  import { db } from "@/lib/db";
  import { requireActor } from "@/lib/auth/require";
  import { ForbiddenError } from "@/lib/errors";
  import { AppSidebar } from "@/components/app-sidebar";
  import { HeaderBreadcrumb } from "@/components/header-breadcrumb";
  import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
  } from "@/components/ui/sidebar";

  const PARTNER_NAV = [{ href: "/partner/allocations", label: "Allocations" }] as const;

  export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
    const actor = await requireActor();
    // First portal-level gate in the codebase — see Global Constraints.
    if (actor.portal !== "partner") {
      throw new ForbiddenError("This portal is for partner users");
    }
    const user = await db.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { name: true, email: true },
    });

    return (
      <SidebarProvider>
        <AppSidebar user={user} nav={PARTNER_NAV} title="IntelliFunnelLabs" subtitle="Partner Portal" />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <HeaderBreadcrumb />
          </header>
          <main className="p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    );
  }
  ```
  Check `HeaderBreadcrumb` doesn't hardcode any admin-only route assumptions (read it quickly) — if it does, either fix it to be route-agnostic or drop it from this layout and use a plain heading instead; don't leave a breadcrumb that silently mislabels partner routes.

- [ ] **Step 5: `src/app/partner/loading.tsx`**

  Copy `(admin)/loading.tsx` verbatim (same `Skeleton` shell) — this is what lets `partner/error.tsx` actually render instead of escaping to Next's global error document, per the `(admin)` precedent (see the "stream admin pages so the error boundary actually renders" commit, `50526a0`).

- [ ] **Step 6: `src/app/partner/error.tsx`**

  Copy the shape of `(admin)/error.tsx`, adjusted copy for a partner audience (no "administrator"/"role" language — a partner user doesn't manage roles):
  ```tsx
  "use client";

  import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
  import { Button } from "@/components/ui/button";

  export default function PartnerError({ retry }: { error: Error; retry: () => void }) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This page could not be loaded.</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          You may not have access to it. If you think this is wrong, contact your IntelliFunnelLabs account representative.
          <Button variant="outline" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  ```

- [ ] **Step 7: `src/app/partner/allocations/page.tsx`**

  ```tsx
  import { db } from "@/lib/db";
  import { requireActor } from "@/lib/auth/require";
  import { getAllocationsForPartner } from "@/lib/allocations/partner-view";
  import { fromMinorUnits } from "@/lib/money/currency";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  } from "@/components/ui/table";

  export default async function PartnerAllocationsPage() {
    const actor = await requireActor();
    const allocations = await getAllocationsForPartner(db, actor);

    return (
      <Card>
        <CardHeader><CardTitle>Your allocations</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel type</TableHead>
                <TableHead>Funnel stage</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Payout rate</TableHead>
                <TableHead>Window</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No active allocations.
                  </TableCell>
                </TableRow>
              )}
              {allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.channelTypeName}</TableCell>
                  <TableCell>{a.funnelStageCode}</TableCell>
                  <TableCell>{a.allocatedQuantity}</TableCell>
                  <TableCell>
                    {a.payoutCurrency} {fromMinorUnits(a.payoutRateMinor, a.payoutCurrency)}
                  </TableCell>
                  <TableCell>
                    {a.startDate.toISOString().slice(0, 10)} – {a.endDate.toISOString().slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }
  ```
  Read-only: no actions, no forms, matching the design doc's scope for this pass.

- [ ] **Step 8: `src/proxy.ts`**

  Add `"/partner"` and `"/partner/:path*"` to the `matcher` array (same two-entry shape as every other segment already listed).

- [ ] **Step 9: Verify**

  `npx tsc --noEmit` clean, `npx eslint` clean on all changed files.

  Curl, signed in as `bhanu@intellifunnel.io` (an internal, non-partner actor): `GET /partner/allocations` — confirm the response body contains the partner error boundary's text ("This page could not be loaded") and not the allocations table. (Next streams the error boundary's content within the document for a server-render throw caught by `error.tsx` — check body content rather than asserting a specific status code, since no existing plan in this codebase asserts one for this case either.)

  Throwaway script to build a real partner-portal session for the positive-path check (there's no partner user in the dev DB yet):
  1. `db.organization.create({ data: { name: "Test Partner Co", isPartner: true, defaultPayoutCurrency: "USD" } })`.
  2. Read `src/lib/invitations/invitations.ts`'s `acceptInvitation` doc comment for the exact `auth.$context` `internalAdapter.createUser` + `linkAccount` call shape (it explains why `auth.api.signUpEmail` can't be used directly — `emailAndPassword.disableSignUp` blocks it). Use the same primitives to create a Better Auth credential for a test email/password.
  3. `db.user.create` with `authUserId` set to the id from step 2, `organizationId` from step 1, `status: "active"`.
  4. `db.role.findUnique({ where: { code: "PARTNER_OPERATOR" } })`, then `db.userRole.create` linking the two.
  5. Using Task 3's `createAllocation` + `setAllocationStatus`, create one `active` allocation on any existing campaign channel for this partner org.
  6. `curl -c cookies.txt -X POST /api/auth/sign-in/email -d '{"email":"...","password":"..."}'` with the test credentials, then `curl -b cookies.txt /partner/allocations` — confirm 200 and the response contains the one allocation's channel type name and quantity.
  7. Confirm the same partner actor hitting an `(admin)` route (e.g. `curl -b cookies.txt /campaigns`) still gets turned away — this is pre-existing behavior (permission checks, not a portal gate) and this plan doesn't change it, but it's worth confirming nothing in this task's changes broke it.

- [ ] **Step 10: Commit**

  ```bash
  git add src/components/app-sidebar.tsx src/app/\(admin\)/layout.tsx src/app/partner src/proxy.ts
  git commit -m "feat(partner): partner-portal shell with portal-level gating (E7)"
  ```
