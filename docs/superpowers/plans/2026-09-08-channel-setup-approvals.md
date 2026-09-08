# Channel Setup and Client Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make channel setup steps conditional and honest (terms need real client approval, placements only apply to asset-bearing channel types, allocation and delivery become optional), and give the client portal the screens where those approvals actually happen.

**Architecture:** Two append-only approval tables (`ChannelTermsApproval`, `PlacementApproval`) whose current state is *derived* by comparing the latest row's frozen snapshot against the live subject — so an edit invalidates an approval with no invalidation code. A single pure `computeChannelReadiness` function feeds every surface that renders or gates on setup state: the admin checklist, the channel activation guard, the campaign channels table, and the client portal's owner-attributed checklist mirror.

**Tech Stack:** Next.js (App Router, server components + server actions), Prisma 7 / PostgreSQL, TypeScript, vitest (node env, single fork, real DB), shadcn/ui + Tailwind, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-08-channel-setup-approvals-design.md`

**Execution status (2026-09-08):** all 12 tasks implemented on branch
`feat/channel-setup-approvals`. `pnpm test` passes (73 files, 468 tests),
`pnpm typecheck` is clean, and every touched file lints clean. The five
unticked steps are the in-browser walkthroughs inside each UI task's Verify
step — their automated half (typecheck + lint) passed, but the manual pass
through the running app is still outstanding. Tasks 8 and 9 share `page.tsx`
and landed in one commit.

Two pre-existing problems found while verifying, neither caused by nor fixed by
this work: `pnpm lint` fails on `src/app/(admin)/verification/page.tsx:37`
(`Date.now` called during render), and `pnpm build` fails prerendering
`/assets` because `(admin)/layout.tsx` calls `requireActor()` on a route
nothing forces to render dynamically.

## Global Constraints

- **Read the Next.js docs first.** Per `AGENTS.md`, this is not the Next.js in your training data. Before writing any route, page, layout or server-action code, read the relevant guide under `node_modules/next/dist/docs/`.
- **Package manager is pnpm.** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm db:migrate`.
- **Tests run against a real Postgres test database**, single fork, `fileParallelism: false`. Every DB test starts with `await resetDb()` then seeds what it needs (`seedRoles`, `seedFunnelStages`).
- **Never touch the dev database.** Migrations run via `pnpm db:migrate`; tests use `DATABASE_URL` from the test env only.
- **`ALLOWED_TRANSITIONS` and `assertReadyForApproval` in `src/lib/campaigns/state-machine.ts` are not to be modified.** The only edit to that file is inside `decideClientApproval` (Task 6).
- **No new `Permission` values.** `campaign:approveClient` gates client decisions; `campaign:write` gates channel edit and activation; `asset:write` gates placement status.
- **Client-portal read models follow AUTH-10 verbatim** (see the doc comment on `getLeadsForClient`, `src/lib/leads/client-view.ts:16-41`): org scoping is unconditional with **no `isInternal` bypass**, and **never** use `campaignChannelOrgScopeClause` (it resolves to `{}` for internal actors and silently unscopes the query).
- **Every page under `src/app/client/`** calls `requireActor()` then `assertPortal(actor, "client")` as its first two lines, before any data fetch.
- **Money is `BigInt` minor units.** Snapshots serialise it as a decimal string — `JSON.stringify` throws on `BigInt`.
- **Dates on channels are `@db.Date`.** Snapshots store them as `YYYY-MM-DD` strings.
- **Snapshot comparison is field-by-field, never `JSON.stringify` equality** — the column is `jsonb` and Postgres does not preserve key order.
- **Commit after every task.** Conventional Commits, and end each message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/approvals/status.ts` | Snapshot builders, field-by-field comparison, `ApprovalStatus` derivation for both subjects |
| `src/lib/approvals/decisions.ts` | `decideChannelTerms` / `decidePlacement` — permission, org scope, transaction, audit |
| `src/lib/approvals/client-view.ts` | AUTH-10 read models for the client portal |
| `src/lib/channels/readiness.ts` | Pure `computeChannelReadiness` + `loadChannelReadiness` loader |
| `src/lib/campaigns/channels.ts` | `updateCampaignChannel`, `setChannelStatus` |
| `tests/helpers/channel-factory.ts` | Shared fixture: internal org + client org + campaign + channel + actors |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts` | Channel edit / status server actions |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-terms-tab.tsx` | Terms detail + approval status + decision history |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/edit-channel-dialog.tsx` | Client component, draft-only terms edit |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-status-control.tsx` | Client component, Activate / Pause |
| `src/app/client/approvals/page.tsx` + `approvals-list.tsx` + `actions.ts` | Client approvals inbox |
| `src/app/client/campaigns/page.tsx` | Client campaign list |
| `src/app/client/campaigns/[id]/page.tsx` | Client campaign detail, tabs Overview / Channels / Leads |

**Modified:**

| File | Change |
|---|---|
| `prisma/schema.prisma` | Two new models + two back-relations |
| `src/lib/assets/placements.ts:64-90` | `setPlacementStatus` gains the client-approval gate on `active` |
| `src/lib/campaigns/state-machine.ts:224` | `decideClientApproval` activates only ready channels |
| `src/lib/leads/client-view.ts:42-46` | `filter` gains optional `campaignId` |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx` | Terms tab, readiness-driven checklist, header controls, placement approval column |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/placement-status-control.tsx` | Disable `active` when unapproved |
| `src/app/(admin)/campaigns/[id]/page.tsx` | Channels table Setup column + readiness banner |
| `src/app/client/layout.tsx` | Nav gains Campaigns and Approvals (with pending badge) |

---

### Task 1: Approval tables, snapshots and status derivation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/approvals/status.ts`
- Create: `tests/helpers/channel-factory.ts`
- Test: `tests/approval-status.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ApprovalStatus`, `ChannelTermsSnapshot`, `PlacementSnapshot`, `buildChannelTermsSnapshot(channel)`, `buildPlacementSnapshot(placement)`, `getChannelTermsApprovalStatus(db, channel)`, `getPlacementApprovalStatus(db, placement)`, and the test fixture `createChannelFixture(db, options)`.

- [x] **Step 1: Add the two models to `prisma/schema.prisma`**

Append after the existing `CampaignApproval` model:

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

Add the back-relations to the existing models — inside `model CampaignChannel`, beside `deliveryRuns`:

```prisma
  termsApprovals     ChannelTermsApproval[]
```

and inside `model AssetPlacement`, beside `engagementEvents`:

```prisma
  approvals          PlacementApproval[]
```

- [x] **Step 2: Generate the migration**

Run: `pnpm db:migrate --name add_channel_terms_and_placement_approvals`
Expected: a new folder under `prisma/migrations/` containing `CREATE TABLE "ChannelTermsApproval"` and `CREATE TABLE "PlacementApproval"`, and the Prisma client regenerated.

- [x] **Step 3: Write the shared test fixture**

Create `tests/helpers/channel-factory.ts`:

```ts
import type { CampaignChannelStatus, CampaignStatus, PrismaClient } from "@prisma/client";
import { loadActor, type Actor } from "@/lib/auth/permissions";
import { createOrganization, createUser } from "./factories";

export type ChannelFixture = {
  clientOrgId: string;
  adminActor: Actor;
  clientAdminActor: Actor;
  clientViewerActor: Actor;
  campaignId: string;
  channelId: string;
  channelTypeVersionId: string;
};

/**
 * One campaign with one channel, plus the three actors every approval test
 * needs: an internal admin who configures, a CLIENT_ADMIN who decides, and a
 * CLIENT_VIEWER who must be refused. `requiresAsset` drives the frozen channel
 * type definition, which is what makes the placement step apply or not.
 */
export async function createChannelFixture(
  db: PrismaClient,
  options: {
    requiresAsset?: boolean;
    campaignStatus?: CampaignStatus;
    channelStatus?: CampaignChannelStatus;
  } = {},
): Promise<ChannelFixture> {
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const clientOrg = await createOrganization(db, { isClient: true });

  const adminUser = await createUser(db, internalOrg.id, "CAMPAIGN_MANAGER");
  const clientAdminUser = await createUser(db, clientOrg.id, "CLIENT_ADMIN");
  const clientViewerUser = await createUser(db, clientOrg.id, "CLIENT_VIEWER");

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Test Channel",
      funnelStageId: stage.id,
      pricingUnit: "CPL",
      requiresTeleVerification: false,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: {
      channelTypeId: channelType.id,
      version: 1,
      definitionJson: {
        channelTypeId: channelType.id,
        code: channelType.code,
        name: "Test Channel",
        funnelStageCode: "MOFU",
        producesLeads: true,
        requiresAsset: options.requiresAsset ?? true,
        metricMode: "none",
        allowedMetricFields: [],
        pricingUnit: "CPL",
        requiresTeleVerification: false,
        verificationSlaBusinessDays: null,
        qualificationFormId: null,
        questions: [],
      },
      publishedById: adminUser.id,
    },
  });

  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id,
      name: "Test Campaign",
      code: `CAM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: options.campaignStatus ?? "draft",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
    },
  });

  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 45,
      clientUnitPriceMinor: 2500n,
      currency: "USD",
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-03-31"),
      status: options.channelStatus ?? "draft",
    },
  });

  return {
    clientOrgId: clientOrg.id,
    adminActor: await loadActor(db, adminUser.id),
    clientAdminActor: await loadActor(db, clientAdminUser.id),
    clientViewerActor: await loadActor(db, clientViewerUser.id),
    campaignId: campaign.id,
    channelId: channel.id,
    channelTypeVersionId: channelTypeVersion.id,
  };
}
```

- [x] **Step 4: Write the failing test**

Create `tests/approval-status.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import {
  buildChannelTermsSnapshot,
  getChannelTermsApprovalStatus,
  getPlacementApprovalStatus,
} from "@/lib/approvals/status";

describe("channel terms approval status", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("is pending when no decision exists", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("pending");
  });

  it("is approved when the latest decision approves the current terms", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel),
      },
    });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("approved");
  });

  it("is changesRequested when the latest decision rejects", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "rejected",
        decidedByUserId: fx.clientAdminActor.userId,
        comments: "price is wrong",
        termsSnapshotJson: buildChannelTermsSnapshot(channel),
      },
    });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("changesRequested");
  });

  it("needs re-approval once the terms change after an approval", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel),
      },
    });

    const edited = await db.campaignChannel.update({
      where: { id: channel.id },
      data: { contractedQuantity: 60 },
    });

    expect(await getChannelTermsApprovalStatus(db, edited)).toBe("reapprovalNeeded");
  });

  it("lets a newer decision supersede an older one", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    const snapshot = buildChannelTermsSnapshot(channel);

    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "rejected",
        decidedByUserId: fx.clientAdminActor.userId,
        comments: "not yet",
        termsSnapshotJson: snapshot,
        decidedAt: new Date("2026-01-01T10:00:00Z"),
      },
    });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: snapshot,
        decidedAt: new Date("2026-01-02T10:00:00Z"),
      },
    });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("approved");
  });
});

describe("placement approval status", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("is pending with no decision and approved after one that matches", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const asset = await db.asset.create({
      data: { ownerOrganizationId: fx.clientOrgId, name: "A", type: "whitepaper", language: "en", status: "active" },
    });
    const assetVersion = await db.assetVersion.create({
      data: { assetId: asset.id, version: 1, fileName: "a.pdf", storageKey: "k", mimeType: "application/pdf", sizeBytes: 10 },
    });
    const placement = await db.assetPlacement.create({
      data: {
        campaignChannelId: fx.channelId,
        assetId: asset.id,
        assetVersionId: assetVersion.id,
        landingPageUrl: "https://example.com/lp",
        formSlug: `slug-${Date.now()}`,
      },
    });

    expect(await getPlacementApprovalStatus(db, placement)).toBe("pending");

    await db.placementApproval.create({
      data: {
        assetPlacementId: placement.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        placementSnapshotJson: {
          landingPageUrl: placement.landingPageUrl,
          assetVersionId: placement.assetVersionId,
          formSlug: placement.formSlug,
          consentTextVersionId: placement.consentTextVersionId,
        },
      },
    });

    expect(await getPlacementApprovalStatus(db, placement)).toBe("approved");

    const moved = await db.assetPlacement.update({
      where: { id: placement.id },
      data: { landingPageUrl: "https://example.com/lp-v2" },
    });

    expect(await getPlacementApprovalStatus(db, moved)).toBe("reapprovalNeeded");
  });
});
```

- [x] **Step 5: Run the test to verify it fails**

Run: `pnpm test tests/approval-status.test.ts`
Expected: FAIL — cannot resolve `@/lib/approvals/status`.

- [x] **Step 6: Implement `src/lib/approvals/status.ts`**

```ts
import type { AssetPlacement, CampaignChannel, Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type ApprovalStatus = "pending" | "approved" | "changesRequested" | "reapprovalNeeded";

export type ChannelTermsSnapshot = {
  contractedQuantity: number;
  clientUnitPriceMinor: string;
  currency: string;
  startDate: string;
  endDate: string;
  channelTypeVersionId: string;
};

export type PlacementSnapshot = {
  landingPageUrl: string;
  assetVersionId: string;
  formSlug: string;
  consentTextVersionId: string | null;
};

type ChannelTermsSubject = Pick<
  CampaignChannel,
  "id" | "contractedQuantity" | "clientUnitPriceMinor" | "currency" | "startDate" | "endDate" | "channelTypeVersionId"
>;

type PlacementSubject = Pick<
  AssetPlacement,
  "id" | "landingPageUrl" | "assetVersionId" | "formSlug" | "consentTextVersionId"
>;

/** `@db.Date` columns compare as calendar days, never as instants. */
const day = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * `clientUnitPriceMinor` is a BigInt column and JSON.stringify throws on
 * BigInt, so money travels through the snapshot as a decimal string.
 */
export function buildChannelTermsSnapshot(channel: ChannelTermsSubject): ChannelTermsSnapshot {
  return {
    contractedQuantity: channel.contractedQuantity,
    clientUnitPriceMinor: channel.clientUnitPriceMinor.toString(),
    currency: channel.currency,
    startDate: day(channel.startDate),
    endDate: day(channel.endDate),
    channelTypeVersionId: channel.channelTypeVersionId,
  };
}

export function buildPlacementSnapshot(placement: PlacementSubject): PlacementSnapshot {
  return {
    landingPageUrl: placement.landingPageUrl,
    assetVersionId: placement.assetVersionId,
    formSlug: placement.formSlug,
    consentTextVersionId: placement.consentTextVersionId,
  };
}

/**
 * Field-by-field, never JSON.stringify equality: the stored column is jsonb
 * and Postgres does not preserve key order, so two equal snapshots can
 * serialise to different strings.
 */
function termsSnapshotsMatch(stored: unknown, current: ChannelTermsSnapshot): boolean {
  if (stored === null || typeof stored !== "object") return false;
  const s = stored as Partial<ChannelTermsSnapshot>;
  return (
    s.contractedQuantity === current.contractedQuantity &&
    s.clientUnitPriceMinor === current.clientUnitPriceMinor &&
    s.currency === current.currency &&
    s.startDate === current.startDate &&
    s.endDate === current.endDate &&
    s.channelTypeVersionId === current.channelTypeVersionId
  );
}

function placementSnapshotsMatch(stored: unknown, current: PlacementSnapshot): boolean {
  if (stored === null || typeof stored !== "object") return false;
  const s = stored as Partial<PlacementSnapshot>;
  return (
    s.landingPageUrl === current.landingPageUrl &&
    s.assetVersionId === current.assetVersionId &&
    s.formSlug === current.formSlug &&
    (s.consentTextVersionId ?? null) === current.consentTextVersionId
  );
}

function derive(
  latest: { decision: "approved" | "rejected" } | null,
  matches: boolean,
): ApprovalStatus {
  if (latest === null) return "pending";
  if (latest.decision === "rejected") return "changesRequested";
  return matches ? "approved" : "reapprovalNeeded";
}

export async function getChannelTermsApprovalStatus(
  db: Db,
  channel: ChannelTermsSubject,
): Promise<ApprovalStatus> {
  const latest = await db.channelTermsApproval.findFirst({
    where: { campaignChannelId: channel.id },
    orderBy: { decidedAt: "desc" },
    select: { decision: true, termsSnapshotJson: true },
  });
  if (latest === null) return derive(null, false);
  return derive(latest, termsSnapshotsMatch(latest.termsSnapshotJson, buildChannelTermsSnapshot(channel)));
}

export async function getPlacementApprovalStatus(
  db: Db,
  placement: PlacementSubject,
): Promise<ApprovalStatus> {
  const latest = await db.placementApproval.findFirst({
    where: { assetPlacementId: placement.id },
    orderBy: { decidedAt: "desc" },
    select: { decision: true, placementSnapshotJson: true },
  });
  if (latest === null) return derive(null, false);
  return derive(latest, placementSnapshotsMatch(latest.placementSnapshotJson, buildPlacementSnapshot(placement)));
}
```

- [x] **Step 7: Run the test to verify it passes**

Run: `pnpm test tests/approval-status.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add prisma/schema.prisma prisma/migrations src/lib/approvals/status.ts tests/helpers/channel-factory.ts tests/approval-status.test.ts
git commit -m "$(cat <<'EOF'
feat(approvals): add channel terms and placement approval records

Status is derived by comparing the latest decision's frozen snapshot with
the live subject, so a later edit invalidates an approval with no
invalidation code path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Channel readiness module

**Files:**
- Create: `src/lib/channels/readiness.ts`
- Test: `tests/channel-readiness.test.ts`

**Interfaces:**
- Consumes: `ApprovalStatus`, `getChannelTermsApprovalStatus` (Task 1); `ChannelTypeDefinition` from `src/lib/channel-types/versions.ts`.
- Produces: `StepOwner`, `ChannelStepId`, `ChannelStep`, `ChannelReadiness`, `computeChannelReadiness(input)`, `loadChannelReadiness(db, campaignChannelId)`.

- [x] **Step 1: Write the failing test**

Create `tests/channel-readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeChannelReadiness } from "@/lib/channels/readiness";

const base = {
  definition: { requiresAsset: true },
  termsStatus: "approved" as const,
  activePlacementCount: 1,
  allocationCount: 0,
  hasDeliveryConfig: false,
};

describe("computeChannelReadiness", () => {
  it("is ready with approved terms and a live placement, ignoring allocations and delivery", () => {
    const result = computeChannelReadiness(base);
    expect(result.ready).toBe(true);
    expect(result.requiredTotal).toBe(2);
    expect(result.requiredDone).toBe(2);
  });

  it("drops the placement step for a channel type that needs no asset", () => {
    const result = computeChannelReadiness({
      ...base,
      definition: { requiresAsset: false },
      activePlacementCount: 0,
    });
    expect(result.steps.map((s) => s.id)).toEqual(["terms", "allocations", "delivery"]);
    expect(result.requiredTotal).toBe(1);
    expect(result.ready).toBe(true);
  });

  it("is not ready while terms are unapproved", () => {
    for (const termsStatus of ["pending", "changesRequested", "reapprovalNeeded"] as const) {
      const result = computeChannelReadiness({ ...base, termsStatus });
      expect(result.ready, termsStatus).toBe(false);
    }
  });

  it("is not ready when an asset-bearing channel has no live placement", () => {
    expect(computeChannelReadiness({ ...base, activePlacementCount: 0 }).ready).toBe(false);
  });

  it("marks allocations and delivery optional and never counts them as required", () => {
    const result = computeChannelReadiness({ ...base, allocationCount: 3, hasDeliveryConfig: true });
    const optional = result.steps.filter((s) => !s.required).map((s) => s.id);
    expect(optional).toEqual(["allocations", "delivery"]);
    expect(result.requiredTotal).toBe(2);
  });

  it("attributes the terms step to the client and the rest to the agency", () => {
    const result = computeChannelReadiness({ ...base, termsStatus: "pending" });
    expect(result.steps.find((s) => s.id === "terms")?.owner).toBe("client");
    expect(result.steps.find((s) => s.id === "delivery")?.owner).toBe("agency");
  });

  it("marks a completed step's owner as done", () => {
    const result = computeChannelReadiness(base);
    expect(result.steps.find((s) => s.id === "terms")?.owner).toBe("done");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/channel-readiness.test.ts`
Expected: FAIL — cannot resolve `@/lib/channels/readiness`.

- [x] **Step 3: Implement `src/lib/channels/readiness.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { getChannelTermsApprovalStatus, type ApprovalStatus } from "@/lib/approvals/status";

type Db = PrismaClient | Prisma.TransactionClient;

export type StepOwner = "client" | "agency" | "done";
export type ChannelStepId = "terms" | "placement" | "allocations" | "delivery";
export type ChannelTab = "terms" | "placements" | "allocations" | "delivery";

export type ChannelStep = {
  id: ChannelStepId;
  title: string;
  hint: string;
  cta: string;
  tab: ChannelTab;
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

export type ReadinessInput = {
  definition: Partial<ChannelTypeDefinition>;
  termsStatus: ApprovalStatus;
  activePlacementCount: number;
  allocationCount: number;
  hasDeliveryConfig: boolean;
};

/**
 * The single source of truth for "is this channel set up". Every surface that
 * renders or gates on setup state calls this: the admin checklist, the channel
 * activation guard, the campaign channels table, and the client portal's
 * checklist mirror — so they can never disagree.
 *
 * Pure, so the whole matrix is unit-testable; callers do their own counting.
 */
export function computeChannelReadiness(input: ReadinessInput): ChannelReadiness {
  const termsDone = input.termsStatus === "approved";
  const placementDone = input.activePlacementCount > 0;

  const steps: ChannelStep[] = [
    {
      id: "terms",
      title: "Channel terms",
      hint: "Volume, unit price and flight window, approved by the client",
      cta: "Review",
      tab: "terms",
      required: true,
      done: termsDone,
      owner: termsDone ? "done" : "client",
    },
  ];

  // requiresAsset is the frozen channel-type flag: a channel type with no
  // asset has no collection point to configure, so the step does not exist
  // for it rather than sitting permanently incomplete.
  if (input.definition.requiresAsset === true) {
    steps.push({
      id: "placement",
      title: "Add a placement",
      hint: "Asset version, landing page, form slug, consent text",
      cta: "Add",
      tab: "placements",
      required: true,
      done: placementDone,
      owner: placementDone ? "done" : "agency",
    });
  }

  steps.push(
    {
      id: "allocations",
      title: "Allocate partner quota",
      hint: "Optional — leave the quota unallocated to run this channel in-house",
      cta: "Allocate",
      tab: "allocations",
      required: false,
      done: input.allocationCount > 0,
      owner: input.allocationCount > 0 ? "done" : "agency",
    },
    {
      id: "delivery",
      title: "Configure delivery",
      hint: "Optional — can be configured at any time, including after launch",
      cta: "Configure",
      tab: "delivery",
      required: false,
      done: input.hasDeliveryConfig,
      owner: input.hasDeliveryConfig ? "done" : "agency",
    },
  );

  const required = steps.filter((s) => s.required);
  const requiredDone = required.filter((s) => s.done).length;

  return {
    steps,
    ready: requiredDone === required.length,
    requiredDone,
    requiredTotal: required.length,
  };
}

/**
 * Convenience loader for callers that hold a channel id. Runs no permission
 * check of its own — every caller has already asserted access to the campaign
 * this channel belongs to. Queries are sequential so the function is safe to
 * call with an interactive transaction client.
 */
export async function loadChannelReadiness(db: Db, campaignChannelId: string): Promise<ChannelReadiness> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: campaignChannelId },
    include: { channelTypeVersion: { select: { definitionJson: true } } },
  });

  const termsStatus = await getChannelTermsApprovalStatus(db, channel);
  const activePlacementCount = await db.assetPlacement.count({
    where: { campaignChannelId, status: "active" },
  });
  const allocationCount = await db.partnerAllocation.count({ where: { campaignChannelId } });
  const deliveryConfig = await db.deliveryConfig.findUnique({
    where: { campaignChannelId },
    select: { id: true },
  });

  return computeChannelReadiness({
    definition: (channel.channelTypeVersion.definitionJson ?? {}) as Partial<ChannelTypeDefinition>,
    termsStatus,
    activePlacementCount,
    allocationCount,
    hasDeliveryConfig: deliveryConfig !== null,
  });
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/channel-readiness.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/channels/readiness.ts tests/channel-readiness.test.ts
git commit -m "$(cat <<'EOF'
feat(channels): derive channel setup readiness from one pure function

Placement applies only to requiresAsset channel types; allocations and
delivery become optional and never gate readiness.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Approval decision functions

**Files:**
- Create: `src/lib/approvals/decisions.ts`
- Test: `tests/approval-decisions.test.ts`

**Interfaces:**
- Consumes: `buildChannelTermsSnapshot`, `buildPlacementSnapshot` (Task 1); `createChannelFixture` (Task 1).
- Produces: `decideChannelTerms(db, actor, { campaignChannelId, decision, comments? })`, `decidePlacement(db, actor, { assetPlacementId, decision, comments? })`.

- [x] **Step 1: Write the failing test**

Create `tests/approval-decisions.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { decideChannelTerms } from "@/lib/approvals/decisions";
import { getChannelTermsApprovalStatus } from "@/lib/approvals/status";
import { ForbiddenError, ValidationError } from "@/lib/errors";

describe("decideChannelTerms", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("records a client approval and flips the derived status", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("approved");
  });

  it("writes an audit row for the decision", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const approval = await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const audit = await db.auditLog.findFirst({
      where: { entityType: "ChannelTermsApproval", entityId: approval.id },
    });
    expect(audit?.action).toBe("approved");
  });

  it("refuses a rejection with no comment", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      decideChannelTerms(db, fx.clientAdminActor, {
        campaignChannelId: fx.channelId,
        decision: "rejected",
        comments: "   ",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a CLIENT_VIEWER", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      decideChannelTerms(db, fx.clientViewerActor, {
        campaignChannelId: fx.channelId,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a client admin from another organisation", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const otherOrg = await createOrganization(db, { isClient: true });
    const otherUser = await createUser(db, otherOrg.id, "CLIENT_ADMIN");
    const otherActor = await loadActor(db, otherUser.id);

    await expect(
      decideChannelTerms(db, otherActor, { campaignChannelId: fx.channelId, decision: "approved" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/approval-decisions.test.ts`
Expected: FAIL — cannot resolve `@/lib/approvals/decisions`.

- [x] **Step 3: Implement `src/lib/approvals/decisions.ts`**

```ts
import { Prisma, type ApprovalDecision, type ChannelTermsApproval, type PlacementApproval, type PrismaClient } from "@prisma/client";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { buildChannelTermsSnapshot, buildPlacementSnapshot } from "@/lib/approvals/status";

/** A rejection the agency cannot act on is useless; an approval needs no note. */
function normaliseComments(decision: ApprovalDecision, comments: string | undefined): string | null {
  const trimmed = (comments ?? "").trim();
  if (decision === "rejected" && trimmed === "") {
    throw new ValidationError("A change request needs a comment explaining what to change");
  }
  return trimmed === "" ? null : trimmed;
}

export async function decideChannelTerms(
  db: PrismaClient,
  actor: Actor,
  input: { campaignChannelId: string; decision: ApprovalDecision; comments?: string },
): Promise<ChannelTermsApproval> {
  assertPermission(actor, "campaign:approveClient");

  const channel = await db.campaignChannel.findUnique({
    where: { id: input.campaignChannelId },
    include: { campaign: { select: { clientOrganizationId: true, deletedAt: true } } },
  });
  if (channel === null || channel.campaign.deletedAt !== null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  const comments = normaliseComments(input.decision, input.comments);

  return db.$transaction(async (tx) => {
    // Re-read inside the transaction so the snapshot and the decision cannot
    // diverge: an edit committing in the gap would otherwise leave the client
    // recorded as having approved terms they never saw (FR-CS-1's reasoning).
    const fresh = await tx.campaignChannel.findUniqueOrThrow({ where: { id: input.campaignChannelId } });

    const approval = await tx.channelTermsApproval.create({
      data: {
        campaignChannelId: fresh.id,
        decision: input.decision,
        decidedByUserId: actor.userId,
        comments,
        termsSnapshotJson: buildChannelTermsSnapshot(fresh) as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    await writeAudit(tx, actor, {
      entityType: "ChannelTermsApproval",
      entityId: approval.id,
      action: input.decision,
      after: { campaignChannelId: fresh.id, decision: input.decision, comments },
    });

    return approval;
  });
}

export async function decidePlacement(
  db: PrismaClient,
  actor: Actor,
  input: { assetPlacementId: string; decision: ApprovalDecision; comments?: string },
): Promise<PlacementApproval> {
  assertPermission(actor, "campaign:approveClient");

  const placement = await db.assetPlacement.findUnique({
    where: { id: input.assetPlacementId },
    include: {
      campaignChannel: {
        select: { campaign: { select: { clientOrganizationId: true, deletedAt: true } } },
      },
    },
  });
  if (placement === null || placement.campaignChannel.campaign.deletedAt !== null) {
    throw new NotFoundError("Placement not found");
  }
  assertOrganizationAccess(actor, placement.campaignChannel.campaign.clientOrganizationId);

  const comments = normaliseComments(input.decision, input.comments);

  return db.$transaction(async (tx) => {
    const fresh = await tx.assetPlacement.findUniqueOrThrow({ where: { id: input.assetPlacementId } });

    const approval = await tx.placementApproval.create({
      data: {
        assetPlacementId: fresh.id,
        decision: input.decision,
        decidedByUserId: actor.userId,
        comments,
        placementSnapshotJson: buildPlacementSnapshot(fresh) as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    await writeAudit(tx, actor, {
      entityType: "PlacementApproval",
      entityId: approval.id,
      action: input.decision,
      after: { assetPlacementId: fresh.id, decision: input.decision, comments },
    });

    return approval;
  });
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/approval-decisions.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/approvals/decisions.ts tests/approval-decisions.test.ts
git commit -m "$(cat <<'EOF'
feat(approvals): record client decisions on channel terms and placements

Snapshots are built inside the deciding transaction so a concurrent edit
cannot land between the snapshot and the decision.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Placement activation gate

**Files:**
- Modify: `src/lib/assets/placements.ts:64-90`
- Test: `tests/placement-approval-gate.test.ts`

**Interfaces:**
- Consumes: `getPlacementApprovalStatus` (Task 1), `decidePlacement` (Task 3).
- Produces: no new exports — `setPlacementStatus` keeps its signature and gains a gate.

- [x] **Step 1: Write the failing test**

Create `tests/placement-approval-gate.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { decidePlacement } from "@/lib/approvals/decisions";
import { setPlacementStatus } from "@/lib/assets/placements";
import { ValidationError } from "@/lib/errors";

async function setup() {
  const db = testDb();
  const fx = await createChannelFixture(db);
  const asset = await db.asset.create({
    data: { ownerOrganizationId: fx.clientOrgId, name: "A", type: "whitepaper", language: "en", status: "active" },
  });
  const assetVersion = await db.assetVersion.create({
    data: { assetId: asset.id, version: 1, fileName: "a.pdf", storageKey: "k", mimeType: "application/pdf", sizeBytes: 10 },
  });
  const placement = await db.assetPlacement.create({
    data: {
      campaignChannelId: fx.channelId,
      assetId: asset.id,
      assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com/lp",
      formSlug: `slug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  return { db, fx, placement };
}

describe("setPlacementStatus — client approval gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("refuses to activate a placement the client has not approved", async () => {
    const { db, fx, placement } = await setup();

    await expect(
      setPlacementStatus(db, fx.adminActor, { placementId: placement.id, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to activate a placement the client rejected", async () => {
    const { db, fx, placement } = await setup();
    await decidePlacement(db, fx.clientAdminActor, {
      assetPlacementId: placement.id,
      decision: "rejected",
      comments: "wrong landing page",
    });

    await expect(
      setPlacementStatus(db, fx.adminActor, { placementId: placement.id, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("activates once the client approves", async () => {
    const { db, fx, placement } = await setup();
    await decidePlacement(db, fx.clientAdminActor, {
      assetPlacementId: placement.id,
      decision: "approved",
    });

    const updated = await setPlacementStatus(db, fx.adminActor, {
      placementId: placement.id,
      status: "active",
    });
    expect(updated.status).toBe("active");
  });

  it("refuses again once the approved URL changes", async () => {
    const { db, fx, placement } = await setup();
    await decidePlacement(db, fx.clientAdminActor, {
      assetPlacementId: placement.id,
      decision: "approved",
    });
    await db.assetPlacement.update({
      where: { id: placement.id },
      data: { landingPageUrl: "https://example.com/other", status: "draft" },
    });

    await expect(
      setPlacementStatus(db, fx.adminActor, { placementId: placement.id, status: "active" }),
    ).rejects.toThrow(/changed since the client approved/);
  });

  it("still allows pausing and archiving without any approval", async () => {
    const { db, fx, placement } = await setup();

    const paused = await setPlacementStatus(db, fx.adminActor, {
      placementId: placement.id,
      status: "paused",
    });
    expect(paused.status).toBe("paused");

    const archived = await setPlacementStatus(db, fx.adminActor, {
      placementId: placement.id,
      status: "archived",
    });
    expect(archived.status).toBe("archived");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/placement-approval-gate.test.ts`
Expected: FAIL — the first test activates successfully instead of throwing.

- [x] **Step 3: Add the gate to `setPlacementStatus`**

In `src/lib/assets/placements.ts`, add the import:

```ts
import { getPlacementApprovalStatus } from "@/lib/approvals/status";
```

and extend the existing `if (input.status === "active")` block — after the asset-status check, before the update:

```ts
    // The client signs off on the live landing page URL before it can collect
    // leads. A later edit to the placement makes the old approval stale (the
    // snapshot stops matching), which reads as not-approved here.
    const approvalStatus = await getPlacementApprovalStatus(db, existing);
    if (approvalStatus !== "approved") {
      throw new ValidationError(
        approvalStatus === "reapprovalNeeded"
          ? "This placement changed since the client approved it — it needs approval again before going live"
          : "The client has not approved this placement's landing page URL yet",
      );
    }
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/placement-approval-gate.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Run the existing placement suites for regressions**

Run: `pnpm test tests/asset-placements.test.ts tests/asset-placement-requirement.test.ts`
Expected: any failure here is a test that activated a placement without an approval — fix it by adding a `decidePlacement(...)` approval to that test's setup, not by weakening the gate.

- [x] **Step 6: Commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/assets/placements.ts tests/placement-approval-gate.test.ts tests/asset-placements.test.ts tests/asset-placement-requirement.test.ts
git commit -m "$(cat <<'EOF'
feat(placements): require client approval before a placement goes live

Pausing, archiving and returning to draft stay unrestricted — they put
nothing in front of a lead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Channel terms editing and channel activation

**Files:**
- Create: `src/lib/campaigns/channels.ts`
- Test: `tests/campaign-channel-edit.test.ts`

**Interfaces:**
- Consumes: `assertDraftAndAccessible` (`src/lib/campaigns/crud.ts:123`), `loadChannelReadiness` (Task 2), `toMinorUnits` (`src/lib/money/currency.ts`), `withAudit`.
- Produces: `UpdateCampaignChannelInput`, `updateCampaignChannel(db, actor, campaignChannelId, input)`, `setChannelStatus(db, actor, { campaignChannelId, status })`.

- [x] **Step 1: Write the failing test**

Create `tests/campaign-channel-edit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { setChannelStatus, updateCampaignChannel } from "@/lib/campaigns/channels";
import { decideChannelTerms } from "@/lib/approvals/decisions";
import { getChannelTermsApprovalStatus } from "@/lib/approvals/status";
import { ValidationError } from "@/lib/errors";

const validEdit = {
  contractedQuantity: 60,
  clientUnitPrice: "30.00",
  currency: "USD",
  startDate: new Date("2026-02-01"),
  endDate: new Date("2026-03-31"),
};

describe("updateCampaignChannel", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("updates terms on a draft campaign", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const updated = await updateCampaignChannel(db, fx.adminActor, fx.channelId, validEdit);

    expect(updated.contractedQuantity).toBe(60);
    expect(updated.clientUnitPriceMinor).toBe(3000n);
  });

  it("invalidates an existing approval by making the snapshot stale", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const updated = await updateCampaignChannel(db, fx.adminActor, fx.channelId, validEdit);

    expect(await getChannelTermsApprovalStatus(db, updated)).toBe("reapprovalNeeded");
  });

  it("refuses once the campaign is past draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "pendingInternalApproval" });

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, validEdit),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a currency that differs from the campaign's", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, { ...validEdit, currency: "GBP" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a window outside the campaign flight", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, {
        ...validEdit,
        endDate: new Date("2027-06-01"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a fractional quantity", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      updateCampaignChannel(db, fx.adminActor, fx.channelId, { ...validEdit, contractedQuantity: 1.5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("setChannelStatus", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("refuses to activate a channel that is not ready", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "scheduled" });

    await expect(
      setChannelStatus(db, fx.adminActor, { campaignChannelId: fx.channelId, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("activates a ready channel on a scheduled campaign", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "scheduled", requiresAsset: false });
    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const updated = await setChannelStatus(db, fx.adminActor, {
      campaignChannelId: fx.channelId,
      status: "active",
    });
    expect(updated.status).toBe("active");
  });

  it("refuses to activate while the campaign is still a draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });
    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    await expect(
      setChannelStatus(db, fx.adminActor, { campaignChannelId: fx.channelId, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("pauses and resumes an active channel without re-checking readiness", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "live",
      channelStatus: "active",
      requiresAsset: true,
    });

    const paused = await setChannelStatus(db, fx.adminActor, {
      campaignChannelId: fx.channelId,
      status: "paused",
    });
    expect(paused.status).toBe("paused");

    const resumed = await setChannelStatus(db, fx.adminActor, {
      campaignChannelId: fx.channelId,
      status: "active",
    });
    expect(resumed.status).toBe("active");
  });

  it("refuses a status this control does not own", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { campaignStatus: "live", channelStatus: "active" });

    await expect(
      setChannelStatus(db, fx.adminActor, { campaignChannelId: fx.channelId, status: "completed" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/campaign-channel-edit.test.ts`
Expected: FAIL — cannot resolve `@/lib/campaigns/channels`.

- [x] **Step 3: Implement `src/lib/campaigns/channels.ts`**

```ts
import type { CampaignChannel, CampaignChannelStatus, PrismaClient } from "@prisma/client";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { assertDraftAndAccessible } from "@/lib/campaigns/crud";
import { loadChannelReadiness } from "@/lib/channels/readiness";
import { toMinorUnits } from "@/lib/money/currency";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type UpdateCampaignChannelInput = {
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: Date;
  endDate: Date;
};

/**
 * Terms are editable only while both the campaign and the channel are drafts —
 * the same constraint addCampaignChannel enforces. Editing does not touch any
 * approval row: the stored snapshot simply stops matching, so the derived
 * status becomes "reapprovalNeeded" on its own.
 *
 * channelTypeVersionId is deliberately not editable. It carries the frozen
 * question set and the requiresAsset flag; swapping it under a configured
 * channel would silently change which setup steps apply.
 */
export async function updateCampaignChannel(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: UpdateCampaignChannelInput,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");

  const channel = await db.campaignChannel.findUnique({ where: { id: campaignChannelId } });
  if (channel === null) throw new NotFoundError("Channel not found");

  const campaign = await assertDraftAndAccessible(db, actor, channel.campaignId);
  if (channel.status !== "draft") {
    throw new ValidationError(`Channel is ${channel.status}; terms can only be edited while it is a draft`);
  }

  if (input.contractedQuantity <= 0) throw new ValidationError("Contracted quantity must be positive");
  if (!Number.isInteger(input.contractedQuantity)) {
    throw new ValidationError("Contracted quantity must be a whole number");
  }
  if (input.currency !== campaign.currency) {
    throw new ValidationError(
      `Channel currency ${input.currency} does not match the campaign's ${campaign.currency}`,
    );
  }
  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new ValidationError("Channel end date precedes its start date");
  }
  if (
    input.startDate.getTime() < campaign.startDate.getTime() ||
    input.endDate.getTime() > campaign.endDate.getTime()
  ) {
    throw new ValidationError("Channel window must sit inside the campaign flight window");
  }

  const clientUnitPriceMinor = toMinorUnits(input.clientUnitPrice, input.currency);
  const costBudgetMinor =
    input.costBudget === undefined ? null : toMinorUnits(input.costBudget, input.currency);

  return withAudit<CampaignChannel>(
    db,
    actor,
    {
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "update",
      before: {
        contractedQuantity: channel.contractedQuantity,
        clientUnitPriceMinor: channel.clientUnitPriceMinor.toString(),
        startDate: channel.startDate.toISOString().slice(0, 10),
        endDate: channel.endDate.toISOString().slice(0, 10),
      },
      after: {
        contractedQuantity: input.contractedQuantity,
        clientUnitPriceMinor: clientUnitPriceMinor.toString(),
        startDate: input.startDate.toISOString().slice(0, 10),
        endDate: input.endDate.toISOString().slice(0, 10),
      },
    },
    async (tx) => {
      // Re-verify draft status inside the transaction (FR-CS-2): a client
      // approval can commit between the outer check and this write.
      await assertDraftAndAccessible(tx, actor, channel.campaignId);

      return tx.campaignChannel.update({
        where: { id: campaignChannelId },
        data: {
          contractedQuantity: input.contractedQuantity,
          clientUnitPriceMinor,
          costBudgetMinor,
          currency: input.currency,
          startDate: input.startDate,
          endDate: input.endDate,
          updatedById: actor.userId,
        },
      });
    },
  );
}

/**
 * Manual per-channel activation, for operating channels inside a campaign that
 * has already launched. The campaign state machine stays authoritative for
 * launch itself, so this refuses to activate before the campaign is scheduled.
 *
 * Readiness is checked only on the draft -> active hop. Pausing a channel whose
 * terms were edited after activation must stay possible, and so must resuming
 * it.
 */
export async function setChannelStatus(
  db: PrismaClient,
  actor: Actor,
  input: { campaignChannelId: string; status: CampaignChannelStatus },
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");

  if (input.status !== "active" && input.status !== "paused") {
    throw new ValidationError(
      `Channel status ${input.status} is set by the campaign lifecycle, not this control`,
    );
  }

  const channel = await db.campaignChannel.findUnique({
    where: { id: input.campaignChannelId },
    include: { campaign: { select: { status: true, clientOrganizationId: true, deletedAt: true } } },
  });
  if (channel === null || channel.campaign.deletedAt !== null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  if (input.status === "paused" && channel.status !== "active") {
    throw new ValidationError(`Channel is ${channel.status}; only an active channel can be paused`);
  }

  if (input.status === "active" && channel.status === "draft") {
    if (channel.campaign.status !== "scheduled" && channel.campaign.status !== "live") {
      throw new ValidationError(
        `Campaign is ${channel.campaign.status}; channels activate once the campaign is scheduled or live`,
      );
    }
    const readiness = await loadChannelReadiness(db, input.campaignChannelId);
    if (!readiness.ready) {
      const outstanding = readiness.steps.filter((s) => s.required && !s.done).map((s) => s.title);
      throw new ValidationError(`Channel setup is incomplete: ${outstanding.join(", ")}`);
    }
  }

  return withAudit<CampaignChannel>(
    db,
    actor,
    {
      entityType: "CampaignChannel",
      entityId: input.campaignChannelId,
      action: "setStatus",
      before: { status: channel.status },
      after: { status: input.status },
    },
    async (tx) =>
      tx.campaignChannel.update({
        where: { id: input.campaignChannelId },
        data: { status: input.status, updatedById: actor.userId },
      }),
  );
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/campaign-channel-edit.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/campaigns/channels.ts tests/campaign-channel-edit.test.ts
git commit -m "$(cat <<'EOF'
feat(channels): edit draft channel terms and activate ready channels

Editing terms leaves any prior approval stale by snapshot mismatch, so
re-approval is required with no invalidation code path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Campaign client approval activates only ready channels

**Files:**
- Modify: `src/lib/campaigns/state-machine.ts:224`
- Test: `tests/campaign-approval-channel-activation.test.ts`

**Interfaces:**
- Consumes: `loadChannelReadiness` (Task 2), `decideChannelTerms` (Task 3).
- Produces: no new exports.

- [x] **Step 1: Write the failing test**

Create `tests/campaign-approval-channel-activation.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { decideChannelTerms } from "@/lib/approvals/decisions";
import { decideClientApproval } from "@/lib/campaigns/state-machine";

describe("decideClientApproval — channel activation", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("activates ready channels and leaves unready ones in draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "pendingClientApproval",
      requiresAsset: false,
    });

    // A second channel on the same campaign, deliberately left unapproved.
    const unready = await db.campaignChannel.create({
      data: {
        campaignId: fx.campaignId,
        channelTypeVersionId: fx.channelTypeVersionId,
        contractedQuantity: 10,
        clientUnitPriceMinor: 1000n,
        currency: "USD",
        startDate: new Date("2026-02-01"),
        endDate: new Date("2026-03-31"),
        status: "draft",
      },
    });

    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const approver = await createUser(db, fx.clientOrgId, "CLIENT_ADMIN");
    await decideClientApproval(db, await loadActor(db, approver.id), fx.campaignId, "approved");

    const ready = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    const stillDraft = await db.campaignChannel.findUniqueOrThrow({ where: { id: unready.id } });

    expect(ready.status).toBe("active");
    expect(stillDraft.status).toBe("draft");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/campaign-approval-channel-activation.test.ts`
Expected: FAIL — `stillDraft.status` is `"active"`, because the current code activates every channel.

- [x] **Step 3: Make the activation readiness-aware**

In `src/lib/campaigns/state-machine.ts`, add the import:

```ts
import { loadChannelReadiness } from "@/lib/channels/readiness";
```

and replace the blanket activation inside `decideClientApproval`:

```ts
    await tx.campaignChannel.updateMany({ where: { campaignId }, data: { status: "active" } });
```

with:

```ts
    // Activating a channel whose terms the client never approved, or whose
    // asset-bearing type has no live placement, would put an unconfigured
    // channel live. Only ready channels flip; the rest stay draft for an
    // operator to activate via setChannelStatus once complete.
    const channelsToConsider = await tx.campaignChannel.findMany({
      where: { campaignId },
      select: { id: true },
    });
    for (const candidate of channelsToConsider) {
      const readiness = await loadChannelReadiness(tx, candidate.id);
      if (readiness.ready) {
        await tx.campaignChannel.update({ where: { id: candidate.id }, data: { status: "active" } });
      }
    }
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/campaign-approval-channel-activation.test.ts`
Expected: PASS.

- [x] **Step 5: Run the campaign approval suite for regressions**

Run: `pnpm test tests/campaign-approval.test.ts`
Expected: PASS. A test that asserted "all channels are active after client approval" now needs its channel to be ready first — add a `decideChannelTerms(..., "approved")` to that test's setup rather than reverting the behaviour.

- [x] **Step 6: Commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/campaigns/state-machine.ts tests/campaign-approval-channel-activation.test.ts tests/campaign-approval.test.ts
git commit -m "$(cat <<'EOF'
fix(campaigns): activate only ready channels on client approval

ALLOWED_TRANSITIONS and assertReadyForApproval are unchanged; the bulk
updateMany that flipped every channel is the only edit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Client-portal read models

**Files:**
- Create: `src/lib/approvals/client-view.ts`
- Modify: `src/lib/leads/client-view.ts:42-46`
- Test: `tests/client-approvals-view.test.ts`

**Interfaces:**
- Consumes: `getChannelTermsApprovalStatus`, `getPlacementApprovalStatus` (Task 1); `loadChannelReadiness` (Task 2).
- Produces: `ClientApprovalItem`, `listClientApprovals(db, actor, filter?)`, `countPendingClientApprovals(db, actor)`, `ClientCampaignRow`, `getClientCampaigns(db, actor)`, `ClientCampaignDetail`, `getClientCampaignDetail(db, actor, campaignId)`.

- [x] **Step 1: Write the failing test**

Create `tests/client-approvals-view.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { decideChannelTerms } from "@/lib/approvals/decisions";
import {
  countPendingClientApprovals,
  getClientCampaignDetail,
  getClientCampaigns,
  listClientApprovals,
} from "@/lib/approvals/client-view";

describe("client approval read models", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("lists the channel's terms as pending for its own client", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    const items = await listClientApprovals(db, fx.clientAdminActor);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("channelTerms");
    expect(items[0]?.subjectId).toBe(fx.channelId);
    expect(items[0]?.status).toBe("pending");
    expect(await countPendingClientApprovals(db, fx.clientAdminActor)).toBe(1);
  });

  it("stops counting an item once it is approved", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });
    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    expect(await countPendingClientApprovals(db, fx.clientAdminActor)).toBe(0);
    const items = await listClientApprovals(db, fx.clientAdminActor, { pendingOnly: false });
    expect(items[0]?.status).toBe("approved");
  });

  it("never leaks another organisation's approvals", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });
    const otherOrg = await createOrganization(db, { isClient: true });
    const otherUser = await createUser(db, otherOrg.id, "CLIENT_ADMIN");
    const otherActor = await loadActor(db, otherUser.id);

    expect(await listClientApprovals(db, otherActor)).toHaveLength(0);
    expect(await countPendingClientApprovals(db, otherActor)).toBe(0);
    void fx;
  });

  it("scopes an internal actor to nothing rather than everything", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    // AUTH-10: org scoping is unconditional, with no isInternal bypass. An
    // internal actor's own organisation owns no campaigns, so it sees none.
    expect(await listClientApprovals(db, fx.adminActor)).toHaveLength(0);
  });

  it("returns the campaign list with a needs-you count", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    const rows = await getClientCampaigns(db, fx.clientAdminActor);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.campaignId).toBe(fx.campaignId);
    expect(rows[0]?.needsYouCount).toBe(1);
  });

  it("returns per-channel readiness on the campaign detail", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });

    const detail = await getClientCampaignDetail(db, fx.clientAdminActor, fx.campaignId);

    expect(detail.channels).toHaveLength(1);
    expect(detail.channels[0]?.readiness.ready).toBe(false);
    expect(detail.channels[0]?.readiness.steps.find((s) => s.id === "terms")?.owner).toBe("client");
  });

  it("refuses a campaign belonging to another organisation", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false });
    const otherOrg = await createOrganization(db, { isClient: true });
    const otherUser = await createUser(db, otherOrg.id, "CLIENT_ADMIN");
    const otherActor = await loadActor(db, otherUser.id);

    await expect(getClientCampaignDetail(db, otherActor, fx.campaignId)).rejects.toThrow();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/client-approvals-view.test.ts`
Expected: FAIL — cannot resolve `@/lib/approvals/client-view`.

- [x] **Step 3: Implement `src/lib/approvals/client-view.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import {
  getChannelTermsApprovalStatus,
  getPlacementApprovalStatus,
  type ApprovalStatus,
} from "@/lib/approvals/status";
import { computeChannelReadiness, type ChannelReadiness } from "@/lib/channels/readiness";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { fromMinorUnits } from "@/lib/money/currency";

export type ClientApprovalItem = {
  kind: "channelTerms" | "placement";
  subjectId: string;
  campaignId: string;
  campaignName: string;
  campaignCode: string;
  channelLabel: string;
  status: ApprovalStatus;
  summary: { label: string; value: string }[];
  lastComments: string | null;
  lastDecidedAt: Date | null;
};

export type ClientCampaignRow = {
  campaignId: string;
  name: string;
  code: string;
  status: string;
  startDate: Date;
  endDate: Date;
  contractedQuantity: number;
  deliveredCount: number;
  needsYouCount: number;
};

export type ClientCampaignChannel = {
  channelId: string;
  label: string;
  contractedQuantity: number;
  unitPrice: string;
  currency: string;
  startDate: Date;
  endDate: Date;
  deliveredCount: number;
  termsStatus: ApprovalStatus;
  readiness: ChannelReadiness;
  placements: { placementId: string; landingPageUrl: string; status: ApprovalStatus }[];
};

export type ClientCampaignDetail = {
  campaignId: string;
  name: string;
  code: string;
  status: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  channels: ClientCampaignChannel[];
};

const PENDING: ApprovalStatus[] = ["pending", "changesRequested", "reapprovalNeeded"];

/**
 * AUTH-10 read model. Org scoping is unconditional — `clientOrganizationId:
 * actor.organizationId` always applies, with no `isInternal` bypass — and the
 * shared `campaignChannelOrgScopeClause` helper is deliberately NOT used here:
 * it resolves to `{}` for an internal actor, which would silently return every
 * organisation's approvals. Partner identity, payout rates and cost budgets
 * are structurally absent from every `select` below rather than filtered out
 * afterwards.
 */
export async function listClientApprovals(
  db: PrismaClient,
  actor: Actor,
  filter: { campaignId?: string; pendingOnly?: boolean } = {},
): Promise<ClientApprovalItem[]> {
  assertPermission(actor, "campaign:read");

  const channels = await db.campaignChannel.findMany({
    where: {
      campaign: {
        clientOrganizationId: actor.organizationId,
        deletedAt: null,
        ...(filter.campaignId === undefined ? {} : { id: filter.campaignId }),
      },
    },
    select: {
      id: true,
      contractedQuantity: true,
      clientUnitPriceMinor: true,
      currency: true,
      startDate: true,
      endDate: true,
      channelTypeVersionId: true,
      campaign: { select: { id: true, name: true, code: true } },
      channelTypeVersion: { select: { definitionJson: true } },
      assets: {
        select: {
          id: true,
          landingPageUrl: true,
          assetVersionId: true,
          formSlug: true,
          consentTextVersionId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const items: ClientApprovalItem[] = [];

  for (const channel of channels) {
    const definition = (channel.channelTypeVersion.definitionJson ?? {}) as Partial<ChannelTypeDefinition>;
    const channelLabel = definition.name ?? definition.code ?? "Channel";

    const termsStatus = await getChannelTermsApprovalStatus(db, channel);
    const lastTerms = await db.channelTermsApproval.findFirst({
      where: { campaignChannelId: channel.id },
      orderBy: { decidedAt: "desc" },
      select: { comments: true, decidedAt: true },
    });

    items.push({
      kind: "channelTerms",
      subjectId: channel.id,
      campaignId: channel.campaign.id,
      campaignName: channel.campaign.name,
      campaignCode: channel.campaign.code,
      channelLabel,
      status: termsStatus,
      summary: [
        { label: "Volume", value: `${channel.contractedQuantity} leads` },
        {
          label: "Unit price",
          value: `${channel.currency} ${fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)}`,
        },
        {
          label: "Window",
          value: `${channel.startDate.toISOString().slice(0, 10)} – ${channel.endDate.toISOString().slice(0, 10)}`,
        },
      ],
      lastComments: lastTerms?.comments ?? null,
      lastDecidedAt: lastTerms?.decidedAt ?? null,
    });

    for (const placement of channel.assets) {
      const status = await getPlacementApprovalStatus(db, placement);
      const lastPlacement = await db.placementApproval.findFirst({
        where: { assetPlacementId: placement.id },
        orderBy: { decidedAt: "desc" },
        select: { comments: true, decidedAt: true },
      });

      items.push({
        kind: "placement",
        subjectId: placement.id,
        campaignId: channel.campaign.id,
        campaignName: channel.campaign.name,
        campaignCode: channel.campaign.code,
        channelLabel,
        status,
        summary: [
          { label: "Landing page", value: placement.landingPageUrl },
          { label: "Form", value: placement.formSlug },
        ],
        lastComments: lastPlacement?.comments ?? null,
        lastDecidedAt: lastPlacement?.decidedAt ?? null,
      });
    }
  }

  return filter.pendingOnly === false ? items : items.filter((i) => PENDING.includes(i.status));
}

export async function countPendingClientApprovals(db: PrismaClient, actor: Actor): Promise<number> {
  const items = await listClientApprovals(db, actor, { pendingOnly: true });
  return items.length;
}

export async function getClientCampaigns(db: PrismaClient, actor: Actor): Promise<ClientCampaignRow[]> {
  assertPermission(actor, "campaign:read");

  const campaigns = await db.campaign.findMany({
    where: { clientOrganizationId: actor.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      startDate: true,
      endDate: true,
      channels: { select: { contractedQuantity: true, deliveredCount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const pending = await listClientApprovals(db, actor, { pendingOnly: true });

  return campaigns.map((campaign) => ({
    campaignId: campaign.id,
    name: campaign.name,
    code: campaign.code,
    status: campaign.status,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    contractedQuantity: campaign.channels.reduce((sum, c) => sum + c.contractedQuantity, 0),
    deliveredCount: campaign.channels.reduce((sum, c) => sum + c.deliveredCount, 0),
    needsYouCount: pending.filter((p) => p.campaignId === campaign.id).length,
  }));
}

export async function getClientCampaignDetail(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<ClientCampaignDetail> {
  assertPermission(actor, "campaign:read");

  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, clientOrganizationId: actor.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      startDate: true,
      endDate: true,
      currency: true,
      channels: {
        select: {
          id: true,
          contractedQuantity: true,
          clientUnitPriceMinor: true,
          currency: true,
          startDate: true,
          endDate: true,
          deliveredCount: true,
          channelTypeVersionId: true,
          channelTypeVersion: { select: { definitionJson: true } },
          deliveryConfig: { select: { id: true } },
          assets: {
            select: {
              id: true,
              status: true,
              landingPageUrl: true,
              assetVersionId: true,
              formSlug: true,
              consentTextVersionId: true,
            },
          },
          _count: { select: { allocations: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (campaign === null) throw new NotFoundError("Campaign not found");

  const channels: ClientCampaignChannel[] = [];

  for (const channel of campaign.channels) {
    const definition = (channel.channelTypeVersion.definitionJson ?? {}) as Partial<ChannelTypeDefinition>;
    const termsStatus = await getChannelTermsApprovalStatus(db, channel);

    const placements: ClientCampaignChannel["placements"] = [];
    for (const placement of channel.assets) {
      placements.push({
        placementId: placement.id,
        landingPageUrl: placement.landingPageUrl,
        status: await getPlacementApprovalStatus(db, placement),
      });
    }

    channels.push({
      channelId: channel.id,
      label: definition.name ?? definition.code ?? "Channel",
      contractedQuantity: channel.contractedQuantity,
      unitPrice: fromMinorUnits(channel.clientUnitPriceMinor, channel.currency),
      currency: channel.currency,
      startDate: channel.startDate,
      endDate: channel.endDate,
      deliveredCount: channel.deliveredCount,
      termsStatus,
      readiness: computeChannelReadiness({
        definition,
        termsStatus,
        activePlacementCount: channel.assets.filter((a) => a.status === "active").length,
        allocationCount: channel._count.allocations,
        hasDeliveryConfig: channel.deliveryConfig !== null,
      }),
      placements,
    });
  }

  return {
    campaignId: campaign.id,
    name: campaign.name,
    code: campaign.code,
    status: campaign.status,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    currency: campaign.currency,
    channels,
  };
}
```

- [x] **Step 4: Add the campaign filter to the leads read model**

In `src/lib/leads/client-view.ts`, change the `filter` parameter of `getLeadsForClient` from
`{ limit?: number; cursor?: string }` to `{ limit?: number; cursor?: string; campaignId?: string }`,
and inside the `where` clause change the channel constraint to:

```ts
      campaignChannel: {
        campaign: {
          clientOrganizationId: actor.organizationId,
          ...(filter.campaignId === undefined ? {} : { id: filter.campaignId }),
        },
      },
```

The unconditional `clientOrganizationId` stays exactly where it is — the new key is nested beside it, never spread over it.

- [x] **Step 5: Run the tests to verify they pass**

Run: `pnpm test tests/client-approvals-view.test.ts tests/client-view.test.ts`
Expected: PASS — 7 new tests, and the existing client-view suite unaffected.

- [x] **Step 6: Commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/approvals/client-view.ts src/lib/leads/client-view.ts tests/client-approvals-view.test.ts
git commit -m "$(cat <<'EOF'
feat(client): add AUTH-10 read models for client approvals and campaigns

Org scoping is unconditional with no isInternal bypass, and the shared
scope-clause helper is deliberately avoided — it unscopes internal actors.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Admin channel page — terms tab, readiness checklist, header controls

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-terms-tab.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/edit-channel-dialog.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-status-control.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx`

**Interfaces:**
- Consumes: `loadChannelReadiness` (Task 2), `updateCampaignChannel` / `setChannelStatus` (Task 5), `getChannelTermsApprovalStatus` (Task 1).
- Produces: `updateChannelAction`, `setChannelStatusAction` server actions.

- [x] **Step 1: Read the Next.js docs for server actions and dynamic routes**

Read `node_modules/next/dist/docs/` — the guides covering server actions, `searchParams`, and dynamic route params. The `params`/`searchParams` in this codebase are Promises that must be awaited; confirm the current contract before writing.

- [x] **Step 2: Write the server actions**

Create `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { CampaignChannelStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { setChannelStatus, updateCampaignChannel } from "@/lib/campaigns/channels";

export async function updateChannelAction(input: {
  campaignId: string;
  campaignChannelId: string;
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: string;
  endDate: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await updateCampaignChannel(db, actor, input.campaignChannelId, {
      contractedQuantity: input.contractedQuantity,
      clientUnitPrice: input.clientUnitPrice,
      costBudget: input.costBudget,
      currency: input.currency,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}`);
    revalidatePath(`/campaigns/${input.campaignId}`);
    return null;
  });
}

export async function setChannelStatusAction(input: {
  campaignId: string;
  campaignChannelId: string;
  status: CampaignChannelStatus;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setChannelStatus(db, actor, {
      campaignChannelId: input.campaignChannelId,
      status: input.status,
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}`);
    revalidatePath(`/campaigns/${input.campaignId}`);
    return null;
  });
}
```

- [x] **Step 3: Write the terms tab**

Create `channel-terms-tab.tsx` — a server component taking the channel, its `ApprovalStatus`, and the decision history. It renders:

- A card headed "Channel terms" listing contracted quantity, unit price (`fromMinorUnits`), cost budget, currency, window, and the channel type name — the same values the client sees in their approval dialog.
- A status `Badge`: `approved` → default, `pending` → secondary with the copy "Awaiting client approval", `changesRequested` → destructive, `reapprovalNeeded` → destructive with "Terms changed since approval — needs re-approval".
- A "Decision history" `Table` (Decision, Decided by, When, Comments) fed by `db.channelTermsApproval.findMany({ where: { campaignChannelId }, orderBy: { decidedAt: "desc" }, include: { ... } })`. Empty state: "No decision recorded yet — the client reviews these terms in their portal."

Note in the card that decisions are made by the client in their own portal; there is no admin approve button.

- [x] **Step 4: Write the edit dialog and status control**

`edit-channel-dialog.tsx` — `"use client"`, a `Dialog` with number/text/date inputs for quantity, unit price, cost budget and the window, calling `updateChannelAction`, toasting via `sonner`, then `router.refresh()`. Follow `src/app/(admin)/organizations/invite-user-dialog.tsx` for structure. The trigger button is disabled with an explanatory `title` when the campaign is not `draft` or the channel is not `draft`.

`channel-status-control.tsx` — `"use client"`, an Activate button when the channel is `draft` or `paused` and a Pause button when it is `active`, calling `setChannelStatusAction`. When readiness is not `ready`, the Activate button is disabled and its `title` names the outstanding required steps.

- [x] **Step 5: Wire the channel page to readiness**

In `page.tsx`:

- Add `{ id: "terms", label: "Terms" }` to `TABS`, placed after `overview`.
- Replace the hardcoded `checklist` array with `const readiness = await loadChannelReadiness(db, channelId);` and render `readiness.steps`, required steps first, optional ones under a separator with an "Optional" `Badge`.
- Replace `setupComplete` with `readiness.ready`, and the "Setup steps" stat card value with `${readiness.requiredDone} / ${readiness.requiredTotal}`.
- Change the checklist card's subtitle from "A channel goes live once all four are in place." to `A channel is ready once its ${readiness.requiredTotal} required step${readiness.requiredTotal === 1 ? "" : "s"} ${readiness.requiredTotal === 1 ? "is" : "are"} in place. Optional steps can be completed at any time.`
- Hide the `placements` tab entirely when the step list contains no `placement` step.
- Render `EditChannelDialog` and `ChannelStatusControl` in the header card beside the badges.
- Render `<ChannelTermsTab />` when `tab === "terms"`.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint`
Then run the app and walk the flow in the browser: open a channel, confirm the checklist shows 2 required steps (or 1 for a `requiresAsset: false` channel type), confirm "Review" now lands on the Terms tab, confirm Activate is disabled with a reason, and confirm Edit channel is disabled once the campaign leaves draft.

- [x] **Step 7: Commit**

```bash
git add "src/app/(admin)/campaigns/[id]/channels/[channelId]"
git commit -m "$(cat <<'EOF'
feat(channels): terms tab, readiness checklist and channel controls

The Review CTA pointed at the tab it was already on; it now opens a real
terms view with the client's decision history.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Placement approval status in the admin UI

**Files:**
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx` (`PlacementsTab`)
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/placement-status-control.tsx`

**Interfaces:**
- Consumes: `getPlacementApprovalStatus` (Task 1).
- Produces: nothing new.

- [x] **Step 1: Add the approval column**

In `PlacementsTab`, after loading placements, resolve each one's status:

```ts
  const withStatus = await Promise.all(
    placements.map(async (placement) => ({
      placement,
      approvalStatus: await getPlacementApprovalStatus(db, placement),
    })),
  );
```

Add a "Client approval" column between "Consent text" and "Status", rendering a `Badge`: `approved` default, `pending` secondary ("awaiting client"), `changesRequested` destructive, `reapprovalNeeded` destructive ("changed since approval"). Where the status is `changesRequested`, show the client's latest comment underneath in muted small text.

- [x] **Step 2: Gate the status control**

Pass `approvalStatus` into `PlacementStatusControl` as a new prop. Inside, disable the `active` `SelectItem` when `approvalStatus !== "approved"` and render the reason as muted text beneath the select. The server-side gate from Task 4 remains the real enforcement — this only avoids an error the operator could have been warned about.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
In the browser: create a placement, confirm it shows "awaiting client", confirm the `active` option is disabled, approve it from the client portal (after Task 11), then confirm activation works.

- [x] **Step 4: Commit**

```bash
git add "src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx" "src/app/(admin)/campaigns/[id]/channels/[channelId]/placements/placement-status-control.tsx"
git commit -m "$(cat <<'EOF'
feat(placements): surface client approval state on the placements tab

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Campaign page setup column and readiness banner

**Files:**
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `loadChannelReadiness` (Task 2).
- Produces: nothing new.

- [x] **Step 1: Load readiness per channel**

Where the campaign's channels are listed, resolve readiness for each:

```ts
  const channelReadiness = new Map(
    await Promise.all(
      campaign.channels.map(async (channel) => [channel.id, await loadChannelReadiness(db, channel.id)] as const),
    ),
  );
```

- [x] **Step 2: Add the Setup column**

Add a "Setup" column to the channels table showing one `Badge variant="outline"` per **incomplete required** step (using `step.title`), plus a muted line `${readiness.requiredDone} of ${readiness.requiredTotal} steps done`. Optional steps are not shown as missing — a channel with no allocations and no delivery config reads as ready.

- [x] **Step 3: Add the readiness banner**

Above the channels table, when any channel is not ready, render a bordered callout: heading `${n} channel${n === 1 ? "" : "s"} not ready to go live`, body listing each unready channel's outstanding required steps, and a link to the first unready channel's page.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
In the browser: a campaign with an unapproved channel shows the banner and the pills; approving the terms clears both.

- [x] **Step 5: Commit**

```bash
git add "src/app/(admin)/campaigns/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(campaigns): show per-channel setup state on the campaign page

Optional steps are excluded from the missing-step pills, so an in-house
channel with no allocations reads as ready.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Client portal approvals inbox

**Files:**
- Create: `src/app/client/approvals/page.tsx`
- Create: `src/app/client/approvals/approvals-list.tsx`
- Create: `src/app/client/approvals/actions.ts`
- Modify: `src/app/client/layout.tsx`

**Interfaces:**
- Consumes: `listClientApprovals`, `countPendingClientApprovals` (Task 7); `decideChannelTerms`, `decidePlacement` (Task 3).
- Produces: `decideChannelTermsAction`, `decidePlacementAction`.

- [x] **Step 1: Write the server actions**

Create `src/app/client/approvals/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalDecision } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { decideChannelTerms, decidePlacement } from "@/lib/approvals/decisions";

export async function decideChannelTermsAction(input: {
  campaignChannelId: string;
  campaignId: string;
  decision: ApprovalDecision;
  comments?: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPortal(actor, "client");
    await decideChannelTerms(db, actor, {
      campaignChannelId: input.campaignChannelId,
      decision: input.decision,
      comments: input.comments,
    });
    revalidatePath("/client/approvals");
    revalidatePath(`/client/campaigns/${input.campaignId}`);
    return null;
  });
}

export async function decidePlacementAction(input: {
  assetPlacementId: string;
  campaignId: string;
  decision: ApprovalDecision;
  comments?: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPortal(actor, "client");
    await decidePlacement(db, actor, {
      assetPlacementId: input.assetPlacementId,
      decision: input.decision,
      comments: input.comments,
    });
    revalidatePath("/client/approvals");
    revalidatePath(`/client/campaigns/${input.campaignId}`);
    return null;
  });
}
```

- [x] **Step 2: Write the page**

Create `src/app/client/approvals/page.tsx` — a server component whose first two lines are `const actor = await requireActor();` then `assertPortal(actor, "client");`, before any data fetch (the layout's own check is not enough; see the doc comment on `assertPortal`). It loads `listClientApprovals(db, actor, { pendingOnly: false })`, splits the items into "Channel terms" and "Landing pages" by `kind`, and passes each group plus `hasPermission(actor, "campaign:approveClient")` to `ApprovalsList`.

Pending items render first. Empty state: "Nothing needs your approval right now."

- [x] **Step 3: Write the list component**

Create `approvals-list.tsx` — `"use client"`. Each row shows the campaign name and code, the channel label, the `summary` label/value pairs, and a status `Badge`. For items whose status is pending/changesRequested/reapprovalNeeded **and** when the viewer can decide, render "Approve" and "Request a change" buttons; both open a `Dialog` showing the same summary rows plus a comments `textarea`. "Request a change" requires a non-empty comment before its submit button enables (the server also rejects an empty one). Decided items render read-only with their decision, date and comment.

A `CLIENT_VIEWER` sees every row and no buttons, with a muted note that only a client admin can decide.

- [x] **Step 4: Add the nav entries**

In `src/app/client/layout.tsx`, extend `CLIENT_NAV` to `Campaigns` (`/client/campaigns`), `Approvals` (`/client/approvals`), `Leads`, `Reports`. Load `countPendingClientApprovals(db, actor)` inside the existing post-`assertPortal` block and pass it to the sidebar so Approvals carries a count badge. This means widening `AppSidebar`'s `nav` prop from `{ href, label }[]` to `{ href, label, badge?: number }[]` in `src/components/app-sidebar.tsx` and rendering the badge only when it is present and non-zero — the admin and partner layouts pass no badge and are unaffected. Keep the layout's `assertPortal` inside its existing try/catch — an uncaught throw there wins over the page's own check and reaches the wrong error boundary.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint`
In the browser, signed in as a CLIENT_ADMIN: the Approvals badge shows the pending count, approving channel terms clears it, and the admin channel page's checklist now shows the terms step done. Sign in as a CLIENT_VIEWER and confirm the buttons are absent.

- [x] **Step 6: Commit**

```bash
git add src/app/client/approvals src/app/client/layout.tsx
git commit -m "$(cat <<'EOF'
feat(client): add the approvals inbox for terms and landing pages

Decisions are gated on campaign:approveClient, so CLIENT_VIEWER can read
the queue but not act on it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Client portal campaigns list and detail

**Files:**
- Create: `src/app/client/campaigns/page.tsx`
- Create: `src/app/client/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `getClientCampaigns`, `getClientCampaignDetail` (Task 7); `getLeadsForClient` with `campaignId` (Task 7); the approval dialogs from Task 11.
- Produces: nothing new.

- [x] **Step 1: Write the campaigns list**

Create `src/app/client/campaigns/page.tsx` — `requireActor()` then `assertPortal(actor, "client")` first, then `getClientCampaigns(db, actor)`. Render a `Card` + `Table`: Campaign (name over monospace code), Flight (start – end), Delivery (a progress bar plus `${deliveredCount} / ${contractedQuantity}`), Status badge, and "Needs you" — a badge with `needsYouCount` when non-zero, otherwise a muted dash. Rows link to `/client/campaigns/{id}`.

Above the table, when any campaign has `needsYouCount > 0`, render a callout: `${total} item${total === 1 ? "" : "s"} need you before ${firstCampaignName} can launch`, with a button linking to `/client/approvals`.

- [x] **Step 2: Write the campaign detail**

Create `src/app/client/campaigns/[id]/page.tsx` with `searchParams`-driven tabs (`overview` | `channels` | `leads`), mirroring the tab pattern in the admin channel page.

- **Overview** — the owner-attributed checklist. For each channel, render its `readiness.steps` with the mockup's owner column: `client` → a badge reading "you" and a primary CTA linking to `/client/approvals`; `agency` → a muted "agency" badge and a disabled "Track" button; `done` → a filled check mark. Below it, stat cards (Contracted, Accepted, Awaiting you) and a delivery pace bar.
- **Channels** — one card per channel: label, volume, unit price, window, terms status badge, and the placement list with each landing page URL and its approval badge.
- **Leads** — `getLeadsForClient(db, actor, { campaignId })` rendered with the same columns as `src/app/client/leads/page.tsx`.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
In the browser: the client campaign list shows the needs-you count, the overview checklist attributes the terms step to "you" and the placement step to "agency", and the leads tab shows only that campaign's leads.

- [x] **Step 4: Run the whole suite**

Run: `pnpm test`
Expected: PASS, with no regressions in the existing suites.

- [x] **Step 5: Commit**

```bash
git add src/app/client/campaigns
git commit -m "$(cat <<'EOF'
feat(client): add campaign list and detail with the setup checklist mirror

The checklist is the same computeChannelReadiness output the admin sees,
rendered with per-step ownership.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| `ChannelTermsApproval` / `PlacementApproval` models, migration | 1 |
| Snapshot contents, BigInt/date handling, field-by-field comparison | 1 |
| Approval status derivation table | 1 |
| Readiness module, conditional placement step, optional steps | 2 |
| Decision functions, permission, org scope, rejection comment rule, audit | 3 |
| Placement activation gate | 4 |
| `updateCampaignChannel`, `setChannelStatus` | 5 |
| `decideClientApproval` activates only ready channels | 6 |
| AUTH-10 client read models, `getLeadsForClient` campaignId | 7 |
| Admin terms tab, checklist, header controls | 8 |
| Placement approval column and gated status control | 9 |
| Campaign setup pills and readiness banner | 10 |
| Client nav, approvals inbox, decision dialogs | 11 |
| Client campaign list, detail, owner-attributed checklist | 12 |
