# Channel Target Account & Suppression Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator attach a target-account list and a suppression list to a channel (CSV upload or manual entry), download either as CSV, and let the client see and download the same lists during approval.

**Architecture:** Re-key the existing (unused) campaign-scoped `CampaignTargetAccountList`/`CampaignSuppressionList` join tables to the channel via a Prisma migration, extend `src/lib/lists/target-accounts.ts` and `suppression.ts` with manual-entry/detach/export functions alongside their existing import/attach functions, flip the two deferred `step-catalog.ts` entries on, and build a "Lists" tab (admin) plus a read-only summary (client) on top.

**Tech Stack:** Next.js (App Router, server actions), Prisma + Postgres, Vitest (real DB, `resetDb()` truncate-between-tests), PapaParse for CSV parse/unparse, shadcn/ui components (Dialog, Card, Table).

**Spec:** [docs/superpowers/specs/2026-09-17-channel-target-suppression-lists-design.md](../specs/2026-09-17-channel-target-suppression-lists-design.md)

## Global Constraints

- One active list per channel per type: attaching (CSV or first manual add) replaces any previously attached list for that channel — enforced in code, not by a DB constraint.
- Every write (upload, manual add, remove entry, detach) requires `channel.status === "draft"`, enforced via `assertChannelDraftAndAccessible` — never trust the UI hiding a control.
- Read (export CSV, client view) is never draft-gated.
- `campaignChannelId` is never a schema-unique field alone on the join tables (only `(campaignChannelId, listId)` is) — always query with `findFirst`, never `findUnique`, when looking up "the channel's list."
- CSV serialization uses `Papa.unparse(rows)`, matching `src/lib/delivery/csv-runner.ts:47`. CSV parsing reuses `parseDelimited`/`applyMapping` from `src/lib/lists/csv.ts`, unchanged.
- Server actions: `"use server"` file, each body wrapped in `toActionResult(async () => { const actor = await requireActor(); ... })`, returning `Promise<ActionResult<T>>` (`src/lib/auth/require.ts`).
- Test files live in top-level `tests/`, suffix `*.test.ts`, run against a real Postgres via `resetDb()` in `beforeEach`, actors built via `loadActor(db, (await createUser(...)).id)`.

---

## File Structure

**Modified:**
- `prisma/schema.prisma` — rename/re-key `CampaignTargetAccountList` → `ChannelTargetAccountList`, `CampaignSuppressionList` → `ChannelSuppressionList`.
- `src/lib/lists/target-accounts.ts` — re-key `attachTargetAccountList`/`resolveAccountCap`, add `detachTargetAccountList`, `addTargetAccountEntry`, `removeTargetAccountEntry`, `exportTargetAccountListCsv`, `importAndAttachTargetAccountList`.
- `src/lib/lists/suppression.ts` — mirror of the above, plus re-key `isSuppressed`.
- `src/lib/leads/matching.ts` — re-key `checkSuppression`, `matchesTal` from `campaignId` to `campaignChannelId`.
- `src/lib/leads/intake.ts` — two call sites pass `campaignChannel.id` instead of `campaign.id`.
- `src/lib/channels/step-catalog.ts` — `ChannelFacts` gains 4 fields; `targetAccountList`/`suppressionList` entries flip `available: true`, `href` moves to `tab("lists")`, `isDone` reads the new facts.
- `src/lib/channels/readiness.ts` — `loadChannelFacts` computes the 4 new facts.
- `src/lib/approvals/client-channel-view.ts` — `ClientChannelDetail` gains `targetAccountList`/`suppressionList` summaries.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts` — 8 new server actions.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx` — add the "Lists" tab.
- `src/app/client/campaigns/[id]/channels/[channelId]/page.tsx` — add the read-only list summary block.
- `tests/target-accounts.test.ts`, `tests/suppression.test.ts`, `tests/channel-readiness.test.ts`, `tests/channel-step-catalog.test.ts`, `tests/client-channel-view.test.ts` — updated for the new signatures/facts.

**Created:**
- `prisma/migrations/<timestamp>_rekey_list_links_to_channel/migration.sql` — via `pnpm db:migrate`.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-lists-tab.tsx` — async server component, fetches both lists' data.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/target-account-list-card.tsx` — client component: upload dialog, manual-add form, entry table, download, detach.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/suppression-list-card.tsx` — same shape, suppression fields.
- `src/app/api/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts` — admin CSV export.
- `src/app/api/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts` — admin CSV export.
- `src/app/api/client/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts` — client CSV export.
- `src/app/api/client/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts` — client CSV export.
- `tests/channel-lists.test.ts` — new tests for the manual-entry/detach/export functions (both list types).

---

### Task 1: Re-key the schema and rewire every existing caller

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/lists/target-accounts.ts:139-202` (`attachTargetAccountList`, `resolveAccountCap`)
- Modify: `src/lib/lists/suppression.ts:163-233` (`attachSuppressionList`, `isSuppressed`)
- Modify: `src/lib/leads/matching.ts:56-90` (`checkSuppression`, `matchesTal`)
- Modify: `src/lib/leads/intake.ts:352,390`
- Modify: `tests/target-accounts.test.ts`
- Modify: `tests/suppression.test.ts`

**Interfaces:**
- Produces: `attachTargetAccountList(db, actor, campaignChannelId: string, listId: string): Promise<void>` (was keyed by `campaignId`). `resolveAccountCap(db, campaignChannelId, accountId): Promise<number | null>` (signature unchanged, body re-keyed). `attachSuppressionList(db, actor, campaignChannelId, listId): Promise<void>`. `isSuppressed(db, campaignChannelId, candidate): Promise<boolean>` (was `campaignId`). `checkSuppression(db, campaignChannelId, candidate): Promise<boolean>`, `matchesTal(db, campaignChannelId, accountId): Promise<"noList" | "matched" | "unmatched">` (both were `campaignId`).
- Consumes (unchanged from existing code): `assertChannelDraftAndAccessible(db, actor, campaignChannelId)` from `src/lib/campaigns/crud.ts:247`, returning `CampaignChannel & { campaign: Campaign }`.

- [ ] **Step 1: Edit the Prisma schema**

In `prisma/schema.prisma`, replace the `CampaignTargetAccountList` model (currently lines 912-925) with:

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
```

Replace `CampaignSuppressionList` (currently lines 978-991) with:

```prisma
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

In `model Campaign` (around line 617-618), delete:
```prisma
  targetAccountLists CampaignTargetAccountList[]
  suppressionLists   CampaignSuppressionList[]
```

In `model CampaignChannel` (currently ending at line 703, right before `@@index([campaignId])`), add:
```prisma
  targetAccountLists ChannelTargetAccountList[]
  suppressionLists   ChannelSuppressionList[]
```

In `model TargetAccountList`, rename `campaigns CampaignTargetAccountList[]` to:
```prisma
  channels ChannelTargetAccountList[]
```

In `model SuppressionList`, rename `campaigns CampaignSuppressionList[]` to:
```prisma
  channels ChannelSuppressionList[]
```

- [ ] **Step 2: Run the migration**

```bash
pnpm db:migrate
```

When prompted for a migration name, enter `rekey_list_links_to_channel`. Confirm it applies cleanly (no data to lose — both old tables are unwritten in every environment).

- [ ] **Step 3: Regenerate the Prisma client**

```bash
pnpm db:generate
```

- [ ] **Step 4: Re-key `attachTargetAccountList` and `resolveAccountCap`**

In `src/lib/lists/target-accounts.ts`, replace `attachTargetAccountList` (lines 139-167):

```ts
export async function attachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  listId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "attachTargetAccountList", after: { listId } },
    async (tx) => {
      // Re-verify draft status inside the transaction: the outer check can go
      // stale if a client approval commits in the gap (FR-CS-2).
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      // One active list per channel: replace, don't accumulate.
      await tx.channelTargetAccountList.deleteMany({ where: { campaignChannelId } });
      await tx.channelTargetAccountList.create({
        data: {
          campaignChannelId,
          listId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
    },
  );
}
```

Replace `resolveAccountCap` (lines 173-202):

```ts
/**
 * Cap resolution (SRS §4.3): the entry override wins if set, otherwise the
 * channel default applies, otherwise the account is uncapped.
 */
export async function resolveAccountCap(
  db: PrismaClient,
  campaignChannelId: string,
  accountId: string,
): Promise<number | null> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    select: { defaultMaxLeadsPerAccount: true },
  });
  if (channel === null) throw new NotFoundError("Campaign channel not found");

  const link = await db.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
  if (link !== null) {
    const entry = await db.targetAccountEntry.findFirst({
      where: {
        listId: link.listId,
        accountId,
        maxLeadsPerAccountOverride: { not: null },
      },
      orderBy: { maxLeadsPerAccountOverride: "asc" },
    });
    if (entry?.maxLeadsPerAccountOverride != null) return entry.maxLeadsPerAccountOverride;
  }

  return channel.defaultMaxLeadsPerAccount;
}
```

Change the import at the top of the file from `assertDraftAndAccessible` to `assertChannelDraftAndAccessible`:
```ts
import { assertChannelDraftAndAccessible } from "@/lib/campaigns/crud";
```

- [ ] **Step 5: Re-key `attachSuppressionList` and `isSuppressed`**

In `src/lib/lists/suppression.ts`, replace `attachSuppressionList` (lines 163-191):

```ts
export async function attachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  listId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "attachSuppressionList", after: { listId } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      await tx.channelSuppressionList.deleteMany({ where: { campaignChannelId } });
      await tx.channelSuppressionList.create({
        data: {
          campaignChannelId,
          listId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
    },
  );
}
```

Replace `isSuppressed` (lines 193-233):

```ts
export async function isSuppressed(
  db: PrismaClient,
  campaignChannelId: string,
  candidate: { email?: string; domain?: string; accountId?: string },
): Promise<boolean> {
  const links = await db.channelSuppressionList.findMany({
    where: { campaignChannelId },
    select: { listId: true },
  });
  if (links.length === 0) return false;
  const listIds = links.map((l) => l.listId);

  const conditions: { type: SuppressionEntryType; value: string }[] = [];

  if (candidate.email !== undefined) {
    const email = normalizeEmail(candidate.email);
    conditions.push({ type: "email", value: email }, { type: "contact", value: email });
    const domain = emailDomain(candidate.email);
    if (domain !== null) conditions.push({ type: "domain", value: domain });
  }
  if (candidate.domain !== undefined) {
    const domain = normalizeDomain(candidate.domain);
    if (domain !== null) conditions.push({ type: "domain", value: domain });
  }
  if (conditions.length === 0 && candidate.accountId === undefined) return false;

  const hit = await db.suppressionEntry.findFirst({
    where: {
      listId: { in: listIds },
      OR: [
        ...conditions.map((c) => ({ type: c.type, value: c.value })),
        ...(candidate.accountId === undefined
          ? []
          : [{ type: "account" as const, accountId: candidate.accountId }]),
      ],
    },
    select: { id: true },
  });

  return hit !== null;
}
```

Change the import from `assertDraftAndAccessible` to `assertChannelDraftAndAccessible`:
```ts
import { assertChannelDraftAndAccessible } from "@/lib/campaigns/crud";
```

- [ ] **Step 6: Re-key `checkSuppression` and `matchesTal`**

In `src/lib/leads/matching.ts`, replace `checkSuppression` (lines 56-62):

```ts
/**
 * Thin wrapper around `isSuppressed` so Task 4's pipeline can import every
 * matching check from this one module. No behaviour is added on top.
 */
export async function checkSuppression(
  db: PrismaClient,
  campaignChannelId: string,
  candidate: { email?: string; domain?: string; accountId?: string },
): Promise<boolean> {
  return isSuppressed(db, campaignChannelId, candidate);
}
```

Replace `matchesTal` (lines 72-88):

```ts
/**
 * FR-IN-4 step 7: target-account-list match.
 *
 * `"noList"` means the channel has zero `ChannelTargetAccountList` rows —
 * i.e. the TAL check doesn't apply to this channel at all. The caller
 * (Task 4) must treat `"noList"` as "check doesn't apply, don't fail or
 * flag," not as a match failure.
 */
export async function matchesTal(db: Db, campaignChannelId: string, accountId: string): Promise<"noList" | "matched" | "unmatched"> {
  const listCount = await db.channelTargetAccountList.count({ where: { campaignChannelId } });
  if (listCount === 0) return "noList";

  const entry = await db.targetAccountEntry.findFirst({
    where: { accountId, list: { channels: { some: { campaignChannelId } } } },
  });
  return entry === null ? "unmatched" : "matched";
}
```

- [ ] **Step 7: Update the two `intake.ts` call sites**

In `src/lib/leads/intake.ts`, line 352, change:
```ts
      const suppressed = await checkSuppression(db, campaign.id, {
```
to:
```ts
      const suppressed = await checkSuppression(db, campaignChannel.id, {
```

Line 390, change:
```ts
        const talResult = await matchesTal(db, campaign.id, account.id);
```
to:
```ts
        const talResult = await matchesTal(db, campaignChannel.id, account.id);
```

- [ ] **Step 8: Update `tests/target-accounts.test.ts` for the new signature**

In the `resolveAccountCap` and `attachTargetAccountList` describe blocks, every call currently passing `campaign.id` to `attachTargetAccountList` must pass `channel.id` instead. Replace the three call sites:

```ts
    await attachTargetAccountList(db, manager, channel.id, listId);
```//(was `campaign.id`, in "prefers the entry override" and "falls back to the channel default")

```ts
    await expect(attachTargetAccountList(db, manager, channel.id, listId)).rejects.toThrow(ValidationError);
```
in `"rejects attachment when campaign is not in draft status"` — but that test currently moves the *campaign* to `"live"` while the channel stays `"draft"`. Since the gate is now `assertChannelDraftAndAccessible` (checks `channel.status`, not `campaign.status`), rewrite that test to move the **channel** out of draft instead:

```ts
  it("rejects attachment when the channel is not in draft status", async () => {
    const { db, ops, manager, client } = await setup();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "DRAFT-CHECK",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const channel = await createChannelForCampaign(db, campaign.id);
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
    });

    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });

    await expect(attachTargetAccountList(db, manager, channel.id, listId)).rejects.toThrow(ValidationError);
  });
```

- [ ] **Step 9: Update `tests/suppression.test.ts` for the new signature**

Add a channel to the shared `setup()` fixture and update every `attachSuppressionList`/`isSuppressed` call to use `channel.id`:

```ts
import { createCampaignWithChannel } from "./helpers/channel-factory";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const { campaign, campaignChannel } = await createCampaignWithChannel(db, {
    clientOrganizationId: client.id,
    campaignStatus: "draft",
    channelStatus: "draft",
  });
  return { db, ops, manager, client, campaign, channel: campaignChannel };
}
```

Then in every test using `campaign` for `attachSuppressionList`/`isSuppressed`, switch to `channel.id`, e.g.:
```ts
    await attachSuppressionList(db, manager, channel.id, listId);
    expect(await isSuppressed(db, channel.id, { accountId: account.id })).toBe(true);
```
and in `"ignores lists not attached to the campaign"`:
```ts
    expect(await isSuppressed(db, channel.id, { domain: "competitor.com" })).toBe(false);
```
and in `"rejects attachment to a non-draft campaign"`, rename to `"rejects attachment to a non-draft channel"` and move the **channel** to `"pending"` instead of the campaign to `"live"`:
```ts
  it("rejects attachment to a non-draft channel", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });

    await expect(() => attachSuppressionList(db, manager, channel.id, listId)).rejects.toThrow(ValidationError);
  });
```

- [ ] **Step 9b: Add the channel-isolation regression test**

This is the exact regression the spec exists to fix (a list attached to one channel must never leak to a sibling channel on the same campaign), so it gets its own explicit test rather than relying on it being implied by the other tests. Append to `tests/target-accounts.test.ts`:

```ts
describe("channel scoping (regression guard)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("does not leak a list attached to one channel onto a sibling channel", async () => {
    const { db, ops, manager, client } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "ISO-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const channelA = await createChannelForCampaign(db, campaign.id);
    const channelB = await createChannelForCampaign(db, campaign.id);
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
    });
    await attachTargetAccountList(db, manager, channelA.id, listId);

    expect(await resolveAccountCap(db, channelA.id, acme.id)).toBe(3);
    expect(await resolveAccountCap(db, channelB.id, acme.id)).toBeNull();
  });

  it("replaces the channel's list rather than accumulating a second one on re-upload", async () => {
    const { db, ops, manager, client } = await setup();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "ISO-2",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const channel = await createChannelForCampaign(db, campaign.id);
    const first = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "First", content: CSV, mapping: MAPPING,
    });
    await attachTargetAccountList(db, manager, channel.id, first.listId);
    const second = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Second", content: CSV, mapping: MAPPING,
    });
    await attachTargetAccountList(db, manager, channel.id, second.listId);

    const links = await db.channelTargetAccountList.findMany({ where: { campaignChannelId: channel.id } });
    expect(links).toHaveLength(1);
    expect(links[0]?.listId).toBe(second.listId);
  });
});
```

Append the mirror pair to `tests/suppression.test.ts`:

```ts
describe("channel scoping (regression guard)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("does not leak a suppression list attached to one channel onto a sibling channel", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const { campaignChannel: channelB } = await createCampaignWithChannel(db, {
      clientOrganizationId: client.id, campaignStatus: "draft", channelStatus: "draft",
    });
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, listId);

    expect(await isSuppressed(db, channel.id, { domain: "competitor.com" })).toBe(true);
    expect(await isSuppressed(db, channelB.id, { domain: "competitor.com" })).toBe(false);
  });

  it("replaces the channel's list rather than accumulating a second one on re-attach", async () => {
    const { db, ops, manager, client, channel } = await setup();
    const first = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "First", type: "competitor", content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, first.listId);
    const second = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Second", type: "competitor", content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, channel.id, second.listId);

    const links = await db.channelSuppressionList.findMany({ where: { campaignChannelId: channel.id } });
    expect(links).toHaveLength(1);
    expect(links[0]?.listId).toBe(second.listId);
  });
});
```

- [ ] **Step 10: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass, including every pre-existing test in `tests/target-accounts.test.ts`, `tests/suppression.test.ts`, `tests/lead-intake-caps.test.ts`, `tests/icp-matching.test.ts`, and any other suite exercising `matchesTal`/`checkSuppression`/`isSuppressed` transitively through lead intake.

- [ ] **Step 11: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. This catches any remaining reference to `campaignTargetAccountList`/`campaignSuppressionList`/`CampaignTargetAccountList`/`CampaignSuppressionList` left over anywhere in the codebase.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/lists/target-accounts.ts src/lib/lists/suppression.ts src/lib/leads/matching.ts src/lib/leads/intake.ts tests/target-accounts.test.ts tests/suppression.test.ts
git commit -m "refactor: re-key target-account/suppression list links to the channel"
```

---

### Task 2: `target-accounts.ts` — manual entry, detach, export, combined import+attach

**Files:**
- Modify: `src/lib/lists/target-accounts.ts`
- Test: `tests/channel-lists.test.ts` (new)

**Interfaces:**
- Consumes: `assertChannelDraftAndAccessible` (Task 1), `resolveAccount` from `src/lib/identity/account-resolution.ts:80` (returns `AccountMatch`), `normalizeDomain` from `src/lib/normalise/domain.ts`, `withAudit` from `src/lib/audit/audit.ts:112`.
- Produces: `detachTargetAccountList(db, actor, campaignChannelId): Promise<void>`. `addTargetAccountEntry(db, actor, campaignChannelId, input: { rawName?: string; rawDomain?: string; country?: string; maxLeadsPerAccountOverride?: number }): Promise<{ entryId: string }>`. `removeTargetAccountEntry(db, actor, campaignChannelId, entryId): Promise<void>`. `exportTargetAccountListCsv(db, actor, campaignChannelId): Promise<string | null>`. `importAndAttachTargetAccountList(db, actor, campaignChannelId, input: { name: string; content: string; mapping: Record<string,string> }): Promise<ImportResult>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/channel-lists.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createCampaignWithChannel } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount } from "@/lib/identity/account-resolution";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  addTargetAccountEntry,
  attachTargetAccountList,
  detachTargetAccountList,
  exportTargetAccountListCsv,
  importAndAttachTargetAccountList,
  importTargetAccountList,
  removeTargetAccountEntry,
} from "@/lib/lists/target-accounts";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const client = await createOrganization(db, { isClient: true });
  const { campaignChannel } = await createCampaignWithChannel(db, {
    clientOrganizationId: client.id,
    campaignStatus: "draft",
    channelStatus: "draft",
  });
  return { db, manager, ops, client, channel: campaignChannel };
}

describe("addTargetAccountEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("creates a 'Manual entries' list on the first add and reuses it on the second", async () => {
    const { db, manager, channel } = await setup();

    const first = await addTargetAccountEntry(db, manager, channel.id, { rawName: "Acme" });
    const second = await addTargetAccountEntry(db, manager, channel.id, { rawDomain: "globex.com" });

    const link = await db.channelTargetAccountList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    const list = await db.targetAccountList.findUniqueOrThrow({ where: { id: link.listId } });
    expect(list.name).toBe("Manual entries");
    const entries = await db.targetAccountEntry.findMany({ where: { listId: link.listId } });
    expect(entries.map((e) => e.id).sort()).toEqual([first.entryId, second.entryId].sort());
  });

  it("matches a manually added entry to an existing account", async () => {
    const { db, manager, ops, channel } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });

    const { entryId } = await addTargetAccountEntry(db, manager, channel.id, { rawDomain: "acme.com" });

    const entry = await db.targetAccountEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.matchStatus).toBe("matched");
    expect(entry.accountId).toBe(acme.id);
  });

  it("rejects an entry with neither name nor domain", async () => {
    const { db, manager, channel } = await setup();
    await expect(addTargetAccountEntry(db, manager, channel.id, {})).rejects.toThrow(ValidationError);
  });

  it("rejects a non-positive cap override", async () => {
    const { db, manager, channel } = await setup();
    await expect(
      addTargetAccountEntry(db, manager, channel.id, { rawName: "Acme", maxLeadsPerAccountOverride: 0 }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses to add when the channel is not draft", async () => {
    const { db, manager, channel } = await setup();
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });
    await expect(addTargetAccountEntry(db, manager, channel.id, { rawName: "Acme" })).rejects.toThrow(ValidationError);
  });
});

describe("removeTargetAccountEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("deletes an entry that belongs to the channel's list", async () => {
    const { db, manager, channel } = await setup();
    const { entryId } = await addTargetAccountEntry(db, manager, channel.id, { rawName: "Acme" });

    await removeTargetAccountEntry(db, manager, channel.id, entryId);

    expect(await db.targetAccountEntry.findUnique({ where: { id: entryId } })).toBeNull();
  });

  it("refuses to delete an entry belonging to a different channel", async () => {
    const { db, manager, channel } = await setup();
    const other = await createCampaignWithChannel(db, { campaignStatus: "draft", channelStatus: "draft" });
    const { entryId } = await addTargetAccountEntry(db, manager, other.campaignChannel.id, { rawName: "Other Co" });

    await expect(removeTargetAccountEntry(db, manager, channel.id, entryId)).rejects.toThrow(NotFoundError);
  });
});

describe("detachTargetAccountList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("removes the channel's link but keeps the underlying list", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: "Company\nAcme\n", mapping: { Company: "rawName" },
    });
    await attachTargetAccountList(db, manager, channel.id, listId);

    await detachTargetAccountList(db, manager, channel.id);

    expect(await db.channelTargetAccountList.findFirst({ where: { campaignChannelId: channel.id } })).toBeNull();
    expect(await db.targetAccountList.findUnique({ where: { id: listId } })).not.toBeNull();
  });

  it("refuses to detach when the channel is not draft", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: "Company\nAcme\n", mapping: { Company: "rawName" },
    });
    await attachTargetAccountList(db, manager, channel.id, listId);
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });

    await expect(detachTargetAccountList(db, manager, channel.id)).rejects.toThrow(ValidationError);
  });
});

describe("exportTargetAccountListCsv", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("returns null when no list is attached", async () => {
    const { db, manager, channel } = await setup();
    expect(await exportTargetAccountListCsv(db, manager, channel.id)).toBeNull();
  });

  it("returns a CSV with a header row and one row per entry", async () => {
    const { db, manager, channel } = await setup();
    await addTargetAccountEntry(db, manager, channel.id, { rawName: "Acme", rawDomain: "acme.com" });

    const csv = await exportTargetAccountListCsv(db, manager, channel.id);

    expect(csv).toContain("name,domain,matchStatus,maxLeadsPerAccountOverride");
    expect(csv).toContain("Acme,acme.com");
  });
});

describe("importAndAttachTargetAccountList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("imports a CSV and attaches the resulting list to the channel in one call", async () => {
    const { db, manager, channel } = await setup();

    const result = await importAndAttachTargetAccountList(db, manager, channel.id, {
      name: "Q4 TAL", content: "Company\nAcme\n", mapping: { Company: "rawName" },
    });

    const link = await db.channelTargetAccountList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    expect(link.listId).toBe(result.listId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test channel-lists.test.ts
```

Expected: `FAIL` — `addTargetAccountEntry`, `detachTargetAccountList`, `exportTargetAccountListCsv`, `importAndAttachTargetAccountList`, `removeTargetAccountEntry` are not exported yet.

- [ ] **Step 3: Implement the four new functions**

In `src/lib/lists/target-accounts.ts`, add the `Prisma` and `Papa` imports and `ValidationError`:
```ts
import Papa from "papaparse";
import { NotFoundError, ValidationError } from "@/lib/errors";
```
(replacing the existing `import { NotFoundError } from "@/lib/errors";` line).

Append these functions after `attachTargetAccountList`:

```ts
export async function detachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "detachTargetAccountList" },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      await tx.channelTargetAccountList.deleteMany({ where: { campaignChannelId } });
    },
  );
}

export type AddTargetAccountEntryInput = {
  rawName?: string;
  rawDomain?: string;
  country?: string;
  maxLeadsPerAccountOverride?: number;
};

/**
 * Manual counterpart to `importTargetAccountList`'s per-row loop. Requires
 * both `list:write` (it may create a list) and `campaign:write` (it mutates
 * channel-scoped state), same split of concerns as import + attach.
 */
export async function addTargetAccountEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: AddTargetAccountEntryInput,
): Promise<{ entryId: string }> {
  assertPermission(actor, "list:write");
  assertPermission(actor, "campaign:write");
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  const rawName = input.rawName?.trim();
  const rawDomain = input.rawDomain?.trim();
  if ((rawName === undefined || rawName === "") && (rawDomain === undefined || rawDomain === "")) {
    throw new ValidationError("Row needs a name or domain");
  }
  if (
    input.maxLeadsPerAccountOverride !== undefined &&
    (!Number.isInteger(input.maxLeadsPerAccountOverride) || input.maxLeadsPerAccountOverride <= 0)
  ) {
    throw new ValidationError("Cap override must be a positive integer");
  }

  const normalizedDomain = rawDomain === undefined || rawDomain === "" ? null : normalizeDomain(rawDomain);
  const match = await resolveAccount(db, { name: rawName, domain: rawDomain, country: input.country?.trim() });

  return withAudit(
    db,
    actor,
    (result: { entryId: string }) => ({
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "addTargetAccountEntry",
      after: { entryId: result.entryId },
    }),
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      let link = await tx.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
      if (link === null) {
        const list = await tx.targetAccountList.create({
          data: {
            ownerOrganizationId: channel.campaign.clientOrganizationId,
            name: "Manual entries",
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        link = await tx.channelTargetAccountList.create({
          data: { campaignChannelId, listId: list.id, createdById: actor.userId, updatedById: actor.userId },
        });
      }

      const entry = await tx.targetAccountEntry.create({
        data: {
          listId: link.listId,
          rawName: rawName ?? null,
          rawDomain: rawDomain ?? null,
          normalizedDomain,
          accountId: match.status === "matched" ? match.accountId : null,
          matchStatus: match.status,
          candidateAccountIdsJson:
            match.status === "ambiguous" ? (match.candidateIds as Prisma.InputJsonValue) : undefined,
          maxLeadsPerAccountOverride: input.maxLeadsPerAccountOverride ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      return { entryId: entry.id };
    },
  );
}

export async function removeTargetAccountEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  entryId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "removeTargetAccountEntry", after: { entryId } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      const link = await tx.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
      if (link === null) throw new NotFoundError("No target account list attached to this channel");
      const entry = await tx.targetAccountEntry.findUnique({ where: { id: entryId } });
      if (entry === null || entry.listId !== link.listId) {
        throw new NotFoundError("Target account entry not found on this channel");
      }
      await tx.targetAccountEntry.delete({ where: { id: entryId } });
    },
  );
}

export async function exportTargetAccountListCsv(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<string | null> {
  assertPermission(actor, "campaign:read");
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    select: { campaign: { select: { clientOrganizationId: true } } },
  });
  if (channel === null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  const link = await db.channelTargetAccountList.findFirst({ where: { campaignChannelId } });
  if (link === null) return null;

  const entries = await db.targetAccountEntry.findMany({
    where: { listId: link.listId },
    orderBy: { createdAt: "asc" },
  });
  return Papa.unparse(
    entries.map((e) => ({
      name: e.rawName ?? "",
      domain: e.rawDomain ?? "",
      matchStatus: e.matchStatus,
      maxLeadsPerAccountOverride: e.maxLeadsPerAccountOverride ?? "",
    })),
  );
}

export type ImportAndAttachInput = {
  name: string;
  content: string;
  mapping: Record<string, string>;
};

/**
 * Combines `importTargetAccountList` (creates the list; needs `list:write`)
 * and `attachTargetAccountList` (links it to the channel; needs
 * `campaign:write`) so the upload server action stays a single call, the same
 * way the CSV upload dialog is a single user action.
 */
export async function importAndAttachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: ImportAndAttachInput,
): Promise<ImportResult> {
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);
  const result = await importTargetAccountList(db, actor, {
    ownerOrganizationId: channel.campaign.clientOrganizationId,
    name: input.name,
    content: input.content,
    mapping: input.mapping,
  });
  await attachTargetAccountList(db, actor, campaignChannelId, result.listId);
  return result;
}
```

`assertOrganizationAccess` must already be imported at the top of the file (it is, from `@/lib/auth/permissions`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test channel-lists.test.ts
```

Expected: `PASS`, all target-account describe blocks green.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/lists/target-accounts.ts tests/channel-lists.test.ts
git commit -m "feat: manual entry, detach and CSV export for channel target account lists"
```

---

### Task 3: `suppression.ts` — manual entry, detach, export, combined import+attach

**Files:**
- Modify: `src/lib/lists/suppression.ts`
- Test: `tests/channel-lists.test.ts` (append)

**Interfaces:**
- Consumes: same as Task 2, plus `hashSuppressionValue` (`suppression.ts:28`), `normalizeEmail`/`emailDomain` from `src/lib/normalise/email.ts`.
- Produces: `detachSuppressionList(db, actor, campaignChannelId): Promise<void>`. `addSuppressionEntry(db, actor, campaignChannelId, input: { type: SuppressionEntryType; value: string }): Promise<{ entryId: string }>`. `removeSuppressionEntry(db, actor, campaignChannelId, entryId): Promise<void>`. `exportSuppressionListCsv(db, actor, campaignChannelId): Promise<string | null>`. `importAndAttachSuppressionList(db, actor, campaignChannelId, input: { name: string; type: SuppressionListType; content: string; mapping: Record<string,string> }): Promise<ImportResult>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/channel-lists.test.ts`:

```ts
import {
  addSuppressionEntry,
  attachSuppressionList,
  detachSuppressionList,
  exportSuppressionListCsv,
  importAndAttachSuppressionList,
  importSuppressionList,
  removeSuppressionEntry,
} from "@/lib/lists/suppression";

describe("addSuppressionEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("creates a 'Manual entries' list on the first add and reuses it on the second", async () => {
    const { db, manager, channel } = await setup();

    const first = await addSuppressionEntry(db, manager, channel.id, { type: "domain", value: "competitor.com" });
    const second = await addSuppressionEntry(db, manager, channel.id, { type: "email", value: "jane@blocked.com" });

    const link = await db.channelSuppressionList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    const list = await db.suppressionList.findUniqueOrThrow({ where: { id: link.listId } });
    expect(list.name).toBe("Manual entries");
    const entries = await db.suppressionEntry.findMany({ where: { listId: link.listId } });
    expect(entries.map((e) => e.id).sort()).toEqual([first.entryId, second.entryId].sort());
  });

  it("normalises the value and stores a salted hash", async () => {
    const { db, manager, channel } = await setup();

    const { entryId } = await addSuppressionEntry(db, manager, channel.id, { type: "domain", value: "https://www.Competitor.com" });

    const entry = await db.suppressionEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.value).toBe("competitor.com");
    expect(entry.valueHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolves an account-type entry and sets accountId", async () => {
    const { db, manager, ops, channel } = await setup();
    const account = await createAccount(db, ops, { name: "Acme", domain: "acme.com" });

    const { entryId } = await addSuppressionEntry(db, manager, channel.id, { type: "account", value: "acme.com" });

    const entry = await db.suppressionEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.accountId).toBe(account.id);
  });

  it("rejects an account-type entry that cannot be resolved", async () => {
    const { db, manager, channel } = await setup();
    await expect(
      addSuppressionEntry(db, manager, channel.id, { type: "account", value: "unknown.com" }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses to add when the channel is not draft", async () => {
    const { db, manager, channel } = await setup();
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });
    await expect(
      addSuppressionEntry(db, manager, channel.id, { type: "domain", value: "competitor.com" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("removeSuppressionEntry", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("deletes an entry that belongs to the channel's list", async () => {
    const { db, manager, channel } = await setup();
    const { entryId } = await addSuppressionEntry(db, manager, channel.id, { type: "domain", value: "competitor.com" });

    await removeSuppressionEntry(db, manager, channel.id, entryId);

    expect(await db.suppressionEntry.findUnique({ where: { id: entryId } })).toBeNull();
  });

  it("refuses to delete an entry belonging to a different channel", async () => {
    const { db, manager, channel } = await setup();
    const other = await createCampaignWithChannel(db, { campaignStatus: "draft", channelStatus: "draft" });
    const { entryId } = await addSuppressionEntry(db, manager, other.campaignChannel.id, { type: "domain", value: "other.com" });

    await expect(removeSuppressionEntry(db, manager, channel.id, entryId)).rejects.toThrow(NotFoundError);
  });
});

describe("detachSuppressionList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("removes the channel's link but keeps the underlying list", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: "Type,Value\ndomain,competitor.com\n", mapping: { Type: "type", Value: "value" },
    });
    await attachSuppressionList(db, manager, channel.id, listId);

    await detachSuppressionList(db, manager, channel.id);

    expect(await db.channelSuppressionList.findFirst({ where: { campaignChannelId: channel.id } })).toBeNull();
    expect(await db.suppressionList.findUnique({ where: { id: listId } })).not.toBeNull();
  });

  it("refuses to detach when the channel is not draft", async () => {
    const { db, manager, ops, client, channel } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: "Type,Value\ndomain,competitor.com\n", mapping: { Type: "type", Value: "value" },
    });
    await attachSuppressionList(db, manager, channel.id, listId);
    await db.campaignChannel.update({ where: { id: channel.id }, data: { status: "pending" } });

    await expect(detachSuppressionList(db, manager, channel.id)).rejects.toThrow(ValidationError);
  });
});

describe("exportSuppressionListCsv", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("returns null when no list is attached", async () => {
    const { db, manager, channel } = await setup();
    expect(await exportSuppressionListCsv(db, manager, channel.id)).toBeNull();
  });

  it("returns a CSV with a header row and one row per entry, never a valueHash column", async () => {
    const { db, manager, channel } = await setup();
    await addSuppressionEntry(db, manager, channel.id, { type: "domain", value: "competitor.com" });

    const csv = await exportSuppressionListCsv(db, manager, channel.id);

    expect(csv).toContain("type,value");
    expect(csv).toContain("domain,competitor.com");
    expect(csv).not.toContain("valueHash");
  });
});

describe("importAndAttachSuppressionList", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("imports a CSV and attaches the resulting list to the channel in one call", async () => {
    const { db, manager, channel } = await setup();

    const result = await importAndAttachSuppressionList(db, manager, channel.id, {
      name: "Competitors", type: "competitor",
      content: "Type,Value\ndomain,competitor.com\n", mapping: { Type: "type", Value: "value" },
    });

    const link = await db.channelSuppressionList.findFirstOrThrow({ where: { campaignChannelId: channel.id } });
    expect(link.listId).toBe(result.listId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test channel-lists.test.ts
```

Expected: the new suppression describe blocks fail — functions not exported yet. (The target-account blocks from Task 2 still pass.)

- [ ] **Step 3: Implement the four new functions**

In `src/lib/lists/suppression.ts`, add `Papa` to the imports:
```ts
import Papa from "papaparse";
```

Append after `attachSuppressionList`:

```ts
export async function detachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "detachSuppressionList" },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      await tx.channelSuppressionList.deleteMany({ where: { campaignChannelId } });
    },
  );
}

export type AddSuppressionEntryInput = { type: SuppressionEntryType; value: string };

/**
 * Manual counterpart to `importSuppressionList`'s per-row loop, one entry at
 * a time. Requires both `list:write` (it may create a list) and
 * `campaign:write` (it mutates channel-scoped state).
 */
export async function addSuppressionEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: AddSuppressionEntryInput,
): Promise<{ entryId: string }> {
  assertPermission(actor, "list:write");
  assertPermission(actor, "campaign:write");
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  const rawValue = input.value.trim();
  let value: string;
  let accountId: string | undefined;

  if (input.type === "account") {
    const match = await resolveAccount(db, { domain: rawValue });
    if (match.status !== "matched") {
      throw new ValidationError(`Could not resolve account for suppression: ${rawValue}`);
    }
    value = normalizeDomain(rawValue) ?? rawValue;
    accountId = match.accountId;
  } else {
    const normalized =
      input.type === "email" || input.type === "contact" ? normalizeEmail(rawValue) : normalizeDomain(rawValue);
    if (normalized === null) throw new ValidationError(`Could not normalise value: ${rawValue}`);
    value = normalized;
  }

  return withAudit(
    db,
    actor,
    (result: { entryId: string }) => ({
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "addSuppressionEntry",
      after: { entryId: result.entryId },
    }),
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      let link = await tx.channelSuppressionList.findFirst({ where: { campaignChannelId } });
      if (link === null) {
        const list = await tx.suppressionList.create({
          data: {
            ownerOrganizationId: channel.campaign.clientOrganizationId,
            name: "Manual entries",
            type: "custom",
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        link = await tx.channelSuppressionList.create({
          data: { campaignChannelId, listId: list.id, createdById: actor.userId, updatedById: actor.userId },
        });
      }

      const entry = await tx.suppressionEntry.upsert({
        where: { listId_type_value: { listId: link.listId, type: input.type, value } },
        update: {},
        create: {
          listId: link.listId,
          type: input.type,
          value,
          valueHash: hashSuppressionValue(value),
          accountId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      return { entryId: entry.id };
    },
  );
}

export async function removeSuppressionEntry(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  entryId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit(
    db,
    actor,
    { entityType: "CampaignChannel", entityId: campaignChannelId, action: "removeSuppressionEntry", after: { entryId } },
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);
      const link = await tx.channelSuppressionList.findFirst({ where: { campaignChannelId } });
      if (link === null) throw new NotFoundError("No suppression list attached to this channel");
      const entry = await tx.suppressionEntry.findUnique({ where: { id: entryId } });
      if (entry === null || entry.listId !== link.listId) {
        throw new NotFoundError("Suppression entry not found on this channel");
      }
      await tx.suppressionEntry.delete({ where: { id: entryId } });
    },
  );
}

export async function exportSuppressionListCsv(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<string | null> {
  assertPermission(actor, "campaign:read");
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    select: { campaign: { select: { clientOrganizationId: true } } },
  });
  if (channel === null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  const link = await db.channelSuppressionList.findFirst({ where: { campaignChannelId } });
  if (link === null) return null;

  const entries = await db.suppressionEntry.findMany({
    where: { listId: link.listId },
    orderBy: { createdAt: "asc" },
  });
  // Never export valueHash — it exists for post-anonymisation matching
  // (FR-CP-6), not for a client-facing download.
  return Papa.unparse(entries.map((e) => ({ type: e.type, value: e.value })));
}

export type ImportAndAttachSuppressionInput = {
  name: string;
  type: SuppressionListType;
  content: string;
  mapping: Record<string, string>;
};

export async function importAndAttachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  input: ImportAndAttachSuppressionInput,
): Promise<ImportResult> {
  const channel = await assertChannelDraftAndAccessible(db, actor, campaignChannelId);
  const result = await importSuppressionList(db, actor, {
    ownerOrganizationId: channel.campaign.clientOrganizationId,
    name: input.name,
    type: input.type,
    content: input.content,
    mapping: input.mapping,
  });
  await attachSuppressionList(db, actor, campaignChannelId, result.listId);
  return result;
}
```

Add the `ImportResult` type import (already exported from `target-accounts.ts` and imported once in this file at line 13 — reuse it, no new import needed since `import type { ImportResult } from "@/lib/lists/target-accounts";` already exists).

`assertOrganizationAccess` must be added to this file's import from `@/lib/auth/permissions` if not already present — check the current import line and add it alongside `assertPermission`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test channel-lists.test.ts
```

Expected: `PASS`, every describe block in the file green.

- [ ] **Step 5: Typecheck and full suite**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/lists/suppression.ts tests/channel-lists.test.ts
git commit -m "feat: manual entry, detach and CSV export for channel suppression lists"
```

---

### Task 4: Wire the catalog and readiness facts

**Files:**
- Modify: `src/lib/channels/step-catalog.ts:6-11,79-101`
- Modify: `src/lib/channels/readiness.ts` (`loadChannelFacts`)
- Modify: `tests/channel-step-catalog.test.ts`
- Modify: `tests/channel-readiness.test.ts`

**Interfaces:**
- Produces: `ChannelFacts` gains `hasTargetAccountList: boolean; targetAccountCount: number; hasSuppressionList: boolean; suppressionCount: number`. `catalogEntry("targetAccountList").available === true`, `.href(campaignId, channelId) === "/campaigns/{campaignId}/channels/{channelId}?tab=lists"`, `.isDone(facts) === facts.hasTargetAccountList` (same shape for `suppressionList`).
- Consumes: `db.channelTargetAccountList`/`db.channelSuppressionList` (Task 1), `db.targetAccountEntry.count`/`db.suppressionEntry.count`.

- [ ] **Step 1: Update the pure catalog tests (red first)**

In `tests/channel-step-catalog.test.ts`, update the `facts` object (lines 22-27) to include the new required fields:

```ts
const facts = {
  hasTerms: false,
  icpCount: 0,
  hasEmailSpec: false,
  activePlacementCount: 0,
  hasTargetAccountList: false,
  targetAccountCount: 0,
  hasSuppressionList: false,
  suppressionCount: 0,
};
```

Replace the `"marks the two deferred list steps unavailable"` test (lines 34-39) — these steps are no longer deferred:

```ts
  it("has no unavailable entries", () => {
    expect(STEP_CATALOG.filter((e) => !e.available)).toEqual([]);
  });
```

Replace the `"never seeds a deferred step"` test (lines 66-70) — still true, but no longer for the reason "deferred":

```ts
  it("never auto-seeds the target account or suppression list steps", () => {
    const plan = seedPlan(definition());
    expect(plan.map((s) => s.stepKey)).not.toContain("targetAccountList");
    expect(plan.map((s) => s.stepKey)).not.toContain("suppressionList");
  });
```

Replace `"never completes a deferred step"` (lines 105-107):

```ts
  it("completes targetAccountList and suppressionList from their own facts", () => {
    expect(catalogEntry("targetAccountList")?.isDone({ ...facts, hasTargetAccountList: true })).toBe(true);
    expect(catalogEntry("targetAccountList")?.isDone(facts)).toBe(false);
    expect(catalogEntry("suppressionList")?.isDone({ ...facts, hasSuppressionList: true })).toBe(true);
    expect(catalogEntry("suppressionList")?.isDone(facts)).toBe(false);
  });
```

Add a new test in the `href` describe block:

```ts
  it("points the list steps at the lists tab", () => {
    expect(catalogEntry("targetAccountList")?.href("cam1", "ch1")).toBe(
      "/campaigns/cam1/channels/ch1?tab=lists",
    );
    expect(catalogEntry("suppressionList")?.href("cam1", "ch1")).toBe(
      "/campaigns/cam1/channels/ch1?tab=lists",
    );
  });
```

- [ ] **Step 2: Update the readiness unit test's `facts()` helper**

In `tests/channel-readiness.test.ts`, update the `facts` helper (lines 6-12):

```ts
const facts = (overrides: Partial<ChannelFacts> = {}): ChannelFacts => ({
  hasTerms: true,
  icpCount: 0,
  hasEmailSpec: false,
  activePlacementCount: 0,
  hasTargetAccountList: false,
  targetAccountCount: 0,
  hasSuppressionList: false,
  suppressionCount: 0,
  ...overrides,
});
```

- [ ] **Step 3: Run both test files to confirm they fail on the type/behavior mismatch**

```bash
pnpm test channel-step-catalog.test.ts channel-readiness.test.ts
```

Expected: `FAIL` — `ChannelFacts` doesn't have the new fields yet (TS error surfaced as a test run failure), and the "has no unavailable entries" / "completes ... from their own facts" / "points the list steps at the lists tab" assertions fail against the current catalog.

- [ ] **Step 4: Update `step-catalog.ts`**

In `src/lib/channels/step-catalog.ts`, replace `ChannelFacts` (lines 6-11):

```ts
export type ChannelFacts = {
  hasTerms: boolean;
  icpCount: number;
  hasEmailSpec: boolean;
  activePlacementCount: number;
  hasTargetAccountList: boolean;
  targetAccountCount: number;
  hasSuppressionList: boolean;
  suppressionCount: number;
};
```

Replace the `targetAccountList` and `suppressionList` entries (lines 79-101):

```ts
  {
    key: "targetAccountList",
    title: "Attach a target account list",
    hint: "Accounts this channel may deliver against",
    cta: "Attach list",
    href: tab("lists"),
    locked: false,
    available: true,
    applies: () => true,
    seedDefault: () => null,
    isDone: (f) => f.hasTargetAccountList,
  },
  {
    key: "suppressionList",
    title: "Attach a suppression list",
    hint: "Accounts, domains and contacts this channel must never deliver",
    cta: "Attach list",
    href: tab("lists"),
    locked: false,
    available: true,
    applies: () => true,
    seedDefault: () => null,
    isDone: (f) => f.hasSuppressionList,
  },
```

- [ ] **Step 5: Update `loadChannelFacts` in `readiness.ts`**

In `src/lib/channels/readiness.ts`, replace `loadChannelFacts` (lines 50-68):

```ts
export async function loadChannelFacts(db: Db, campaignChannelId: string): Promise<ChannelFacts> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: campaignChannelId },
    select: { contractedQuantity: true, clientUnitPriceMinor: true },
  });

  const [icpCount, emailSpec, activePlacementCount, talLink, suppressionLink] = await Promise.all([
    db.icpCriterion.count({ where: { campaignChannelId } }),
    db.leadFieldSpec.findFirst({ where: { campaignChannelId, fieldKey: "email" }, select: { id: true } }),
    db.assetPlacement.count({ where: { campaignChannelId, status: "active" } }),
    db.channelTargetAccountList.findFirst({ where: { campaignChannelId }, select: { listId: true } }),
    db.channelSuppressionList.findFirst({ where: { campaignChannelId }, select: { listId: true } }),
  ]);

  const [targetAccountCount, suppressionCount] = await Promise.all([
    talLink === null ? Promise.resolve(0) : db.targetAccountEntry.count({ where: { listId: talLink.listId } }),
    suppressionLink === null ? Promise.resolve(0) : db.suppressionEntry.count({ where: { listId: suppressionLink.listId } }),
  ]);

  return {
    hasTerms: channel.contractedQuantity > 0 && channel.clientUnitPriceMinor > 0n,
    icpCount,
    hasEmailSpec: emailSpec !== null,
    activePlacementCount,
    hasTargetAccountList: talLink !== null,
    targetAccountCount,
    hasSuppressionList: suppressionLink !== null,
    suppressionCount,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm test channel-step-catalog.test.ts channel-readiness.test.ts
```

Expected: `PASS`.

- [ ] **Step 7: Full suite and typecheck**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/channels/step-catalog.ts src/lib/channels/readiness.ts tests/channel-step-catalog.test.ts tests/channel-readiness.test.ts
git commit -m "feat: turn on the target-account and suppression-list checklist steps"
```

---

### Task 5: Admin server actions

**Files:**
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`

**Interfaces:**
- Consumes: every function produced by Tasks 2-3.
- Produces: `uploadTargetAccountListAction(campaignId, channelId, input: { name: string; content: string; mapping: Record<string,string> }): Promise<ActionResult<{ listId: string; rowsAccepted: number; rowsTotal: number }>>`, `addTargetAccountEntryAction(campaignId, channelId, input: AddTargetAccountEntryInput): Promise<ActionResult<null>>`, `removeTargetAccountEntryAction(campaignId, channelId, entryId): Promise<ActionResult<null>>`, `detachTargetAccountListAction(campaignId, channelId): Promise<ActionResult<null>>`, and the four suppression equivalents (`uploadSuppressionListAction` takes `{ name, type, content, mapping }`).

- [ ] **Step 1: Add the imports**

At the top of `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`, add:

```ts
import type { SuppressionEntryType, SuppressionListType } from "@prisma/client";
import {
  addTargetAccountEntry,
  detachTargetAccountList,
  importAndAttachTargetAccountList,
  removeTargetAccountEntry,
  type AddTargetAccountEntryInput,
} from "@/lib/lists/target-accounts";
import {
  addSuppressionEntry,
  detachSuppressionList,
  importAndAttachSuppressionList,
  removeSuppressionEntry,
  type AddSuppressionEntryInput,
} from "@/lib/lists/suppression";
```

- [ ] **Step 2: Add the eight actions**

Append to the file:

```ts
export async function uploadTargetAccountListAction(
  campaignId: string,
  channelId: string,
  input: { name: string; content: string; mapping: Record<string, string> },
): Promise<ActionResult<{ listId: string; rowsAccepted: number; rowsTotal: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await importAndAttachTargetAccountList(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return { listId: result.listId, rowsAccepted: result.rowsAccepted, rowsTotal: result.rowsTotal };
  });
}

export async function addTargetAccountEntryAction(
  campaignId: string,
  channelId: string,
  input: AddTargetAccountEntryInput,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await addTargetAccountEntry(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function removeTargetAccountEntryAction(
  campaignId: string,
  channelId: string,
  entryId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await removeTargetAccountEntry(db, actor, channelId, entryId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function detachTargetAccountListAction(
  campaignId: string,
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await detachTargetAccountList(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function uploadSuppressionListAction(
  campaignId: string,
  channelId: string,
  input: { name: string; type: SuppressionListType; content: string; mapping: Record<string, string> },
): Promise<ActionResult<{ listId: string; rowsAccepted: number; rowsTotal: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await importAndAttachSuppressionList(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return { listId: result.listId, rowsAccepted: result.rowsAccepted, rowsTotal: result.rowsTotal };
  });
}

export async function addSuppressionEntryAction(
  campaignId: string,
  channelId: string,
  input: AddSuppressionEntryInput,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await addSuppressionEntry(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function removeSuppressionEntryAction(
  campaignId: string,
  channelId: string,
  entryId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await removeSuppressionEntry(db, actor, channelId, entryId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function detachSuppressionListAction(
  campaignId: string,
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await detachSuppressionList(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}
```

Note the `SuppressionEntryType` import above is used by `AddSuppressionEntryInput`'s re-export surface; if the typechecker flags it as unused because the type only appears inside the imported type alias, remove it from the explicit import list — the type still flows through `AddSuppressionEntryInput`.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/campaigns/\[id\]/channels/\[channelId\]/actions.ts
git commit -m "feat: server actions for channel target-account and suppression list management"
```

---

### Task 6: Admin UI — Lists tab

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/target-account-list-card.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/suppression-list-card.tsx`
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-lists-tab.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx`

**Interfaces:**
- Consumes: the 8 actions from Task 5; `db.channelTargetAccountList`/`db.channelSuppressionList`/`db.targetAccountEntry`/`db.suppressionEntry` (Task 1).
- Produces: `<ChannelListsTab campaignId channelId canWrite channelStatus />`, rendered from `page.tsx` when `tab === "lists"`.

- [ ] **Step 1: Build the target-account list card**

Create `src/app/(admin)/campaigns/[id]/channels/[channelId]/target-account-list-card.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addTargetAccountEntryAction,
  detachTargetAccountListAction,
  removeTargetAccountEntryAction,
  uploadTargetAccountListAction,
} from "./actions";

type Entry = { id: string; rawName: string | null; rawDomain: string | null; matchStatus: string };

type Props = {
  campaignId: string;
  channelId: string;
  listName: string | null;
  rowCount: number;
  entries: Entry[];
  editable: boolean;
  downloadHref: string;
};

const UNMAPPED = "__unmapped__";
const CANONICAL_KEYS = [
  { key: "rawName", label: "Name" },
  { key: "rawDomain", label: "Domain" },
  { key: "country", label: "Country" },
  { key: "maxLeadsPerAccountOverride", label: "Max leads override" },
];

export function TargetAccountListCard({ campaignId, channelId, listName, rowCount, entries, editable, downloadHref }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [name, setName] = useState("Target accounts");
  const [content, setContent] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerByKey, setHeaderByKey] = useState<Record<string, string>>({});
  const [manualName, setManualName] = useState("");
  const [manualDomain, setManualDomain] = useState("");
  const [manualCap, setManualCap] = useState("");

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    const text = await file.text();
    setContent(text);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, preview: 1 });
    setHeaders(parsed.meta.fields ?? []);
    setHeaderByKey({});
  }

  const mapping = Object.fromEntries(
    Object.entries(headerByKey).filter(([, header]) => header !== UNMAPPED && header !== "").map(([key, header]) => [header, key]),
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  function submitUpload() {
    if (content === null) return;
    startTransition(async () => {
      const result = await uploadTargetAccountListAction(campaignId, channelId, { name, content, mapping });
      if (result.ok) {
        toast.success(`${result.data.rowsAccepted} of ${result.data.rowsTotal} rows staged`);
        setUploadOpen(false);
        setContent(null);
        setHeaders([]);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitManual() {
    run(
      () =>
        addTargetAccountEntryAction(campaignId, channelId, {
          rawName: manualName.trim() === "" ? undefined : manualName.trim(),
          rawDomain: manualDomain.trim() === "" ? undefined : manualDomain.trim(),
          maxLeadsPerAccountOverride: manualCap.trim() === "" ? undefined : Number.parseInt(manualCap, 10),
        }),
      "Account added",
    );
    setManualName("");
    setManualDomain("");
    setManualCap("");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Target account list</CardTitle>
          <p className="text-sm text-muted-foreground">
            {listName === null ? "No list attached yet" : `${listName} — ${rowCount} accounts`}
          </p>
        </div>
        {rowCount > 0 && (
          <Button asChild size="sm" variant="outline">
            <a href={downloadHref}>Download CSV</a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editable && (
          <div className="flex flex-wrap items-end gap-2 border-b pb-4">
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>Upload CSV</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload target accounts</DialogTitle>
                  <DialogDescription>Replaces any list already attached to this channel.</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="tal-name">List name</FieldLabel>
                    <Input id="tal-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="tal-file">CSV file</FieldLabel>
                    <input id="tal-file" type="file" accept=".csv" onChange={handleFile} className="text-sm" />
                  </Field>
                  {headers.length > 0 &&
                    CANONICAL_KEYS.map((field) => (
                      <Field key={field.key}>
                        <FieldLabel htmlFor={`tal-map-${field.key}`}>{field.label}</FieldLabel>
                        <Select
                          value={headerByKey[field.key] ?? ""}
                          onValueChange={(value) => setHeaderByKey((prev) => ({ ...prev, [field.key]: value }))}
                        >
                          <SelectTrigger id={`tal-map-${field.key}`} className="w-full">
                            <SelectValue placeholder="Select column..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value={UNMAPPED}>— not mapped —</SelectItem>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>{header}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    ))}
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={pending}>Cancel</Button>
                  <Button onClick={submitUpload} disabled={pending || content === null}>Upload</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Input placeholder="Name" value={manualName} onChange={(e) => setManualName(e.target.value)} className="w-36" />
            <Input placeholder="Domain" value={manualDomain} onChange={(e) => setManualDomain(e.target.value)} className="w-36" />
            <Input placeholder="Cap" value={manualCap} onChange={(e) => setManualCap(e.target.value)} className="w-20" />
            <Button size="sm" onClick={submitManual} disabled={pending || (manualName.trim() === "" && manualDomain.trim() === "")}>
              Add
            </Button>

            {rowCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive"
                disabled={pending}
                onClick={() => run(() => detachTargetAccountListAction(campaignId, channelId), "List removed")}
              >
                Remove list
              </Button>
            )}
          </div>
        )}

        {entries.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Match</TableHead>
                {editable && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.rawName ?? "—"}</TableCell>
                  <TableCell>{entry.rawDomain ?? "—"}</TableCell>
                  <TableCell>{entry.matchStatus}</TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => removeTargetAccountEntryAction(campaignId, channelId, entry.id), "Entry removed")}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rowCount > entries.length && (
          <p className="text-xs text-muted-foreground">
            Showing the first {entries.length} of {rowCount} — download the CSV for the full list.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Build the suppression list card**

Create `src/app/(admin)/campaigns/[id]/channels/[channelId]/suppression-list-card.tsx`, following the same shape with suppression's two fields (`type`, `value`):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import type { SuppressionEntryType, SuppressionListType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addSuppressionEntryAction,
  detachSuppressionListAction,
  removeSuppressionEntryAction,
  uploadSuppressionListAction,
} from "./actions";

type Entry = { id: string; type: SuppressionEntryType; value: string };

type Props = {
  campaignId: string;
  channelId: string;
  listName: string | null;
  rowCount: number;
  entries: Entry[];
  editable: boolean;
  downloadHref: string;
};

const UNMAPPED = "__unmapped__";
const ENTRY_TYPES: SuppressionEntryType[] = ["account", "domain", "email", "contact"];

export function SuppressionListCard({ campaignId, channelId, listName, rowCount, entries, editable, downloadHref }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [name, setName] = useState("Suppression list");
  const [listType, setListType] = useState<SuppressionListType>("custom");
  const [content, setContent] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerByKey, setHeaderByKey] = useState<Record<string, string>>({});
  const [manualType, setManualType] = useState<SuppressionEntryType>("domain");
  const [manualValue, setManualValue] = useState("");

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    const text = await file.text();
    setContent(text);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, preview: 1 });
    setHeaders(parsed.meta.fields ?? []);
    setHeaderByKey({});
  }

  const mapping = Object.fromEntries(
    Object.entries(headerByKey).filter(([, header]) => header !== UNMAPPED && header !== "").map(([key, header]) => [header, key]),
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  function submitUpload() {
    if (content === null) return;
    startTransition(async () => {
      const result = await uploadSuppressionListAction(campaignId, channelId, { name, type: listType, content, mapping });
      if (result.ok) {
        toast.success(`${result.data.rowsAccepted} of ${result.data.rowsTotal} rows staged`);
        setUploadOpen(false);
        setContent(null);
        setHeaders([]);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitManual() {
    run(() => addSuppressionEntryAction(campaignId, channelId, { type: manualType, value: manualValue.trim() }), "Entry added");
    setManualValue("");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Suppression list</CardTitle>
          <p className="text-sm text-muted-foreground">
            {listName === null ? "No list attached yet" : `${listName} — ${rowCount} entries`}
          </p>
        </div>
        {rowCount > 0 && (
          <Button asChild size="sm" variant="outline">
            <a href={downloadHref}>Download CSV</a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editable && (
          <div className="flex flex-wrap items-end gap-2 border-b pb-4">
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>Upload CSV</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload suppression list</DialogTitle>
                  <DialogDescription>Replaces any list already attached to this channel.</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="sup-name">List name</FieldLabel>
                    <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sup-file">CSV file</FieldLabel>
                    <input id="sup-file" type="file" accept=".csv" onChange={handleFile} className="text-sm" />
                  </Field>
                  {headers.length > 0 &&
                    [{ key: "type", label: "Type" }, { key: "value", label: "Value" }].map((field) => (
                      <Field key={field.key}>
                        <FieldLabel htmlFor={`sup-map-${field.key}`}>{field.label}</FieldLabel>
                        <Select
                          value={headerByKey[field.key] ?? ""}
                          onValueChange={(value) => setHeaderByKey((prev) => ({ ...prev, [field.key]: value }))}
                        >
                          <SelectTrigger id={`sup-map-${field.key}`} className="w-full">
                            <SelectValue placeholder="Select column..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value={UNMAPPED}>— not mapped —</SelectItem>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>{header}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    ))}
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={pending}>Cancel</Button>
                  <Button onClick={submitUpload} disabled={pending || content === null}>Upload</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Select value={manualType} onValueChange={(v) => setManualType(v as SuppressionEntryType)}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ENTRY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input placeholder="Value" value={manualValue} onChange={(e) => setManualValue(e.target.value)} className="w-48" />
            <Button size="sm" onClick={submitManual} disabled={pending || manualValue.trim() === ""}>Add</Button>

            {rowCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive"
                disabled={pending}
                onClick={() => run(() => detachSuppressionListAction(campaignId, channelId), "List removed")}
              >
                Remove list
              </Button>
            )}
          </div>
        )}

        {entries.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                {editable && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.type}</TableCell>
                  <TableCell>{entry.value}</TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => removeSuppressionEntryAction(campaignId, channelId, entry.id), "Entry removed")}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rowCount > entries.length && (
          <p className="text-xs text-muted-foreground">
            Showing the first {entries.length} of {rowCount} — download the CSV for the full list.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Build the server component that fetches data for both cards**

Create `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-lists-tab.tsx`:

```tsx
import { db } from "@/lib/db";
import { TargetAccountListCard } from "./target-account-list-card";
import { SuppressionListCard } from "./suppression-list-card";

type Props = {
  campaignId: string;
  channelId: string;
  editable: boolean;
  hasTalStep: boolean;
  hasSuppressionStep: boolean;
};

export async function ChannelListsTab({ campaignId, channelId, editable, hasTalStep, hasSuppressionStep }: Props) {
  const [talLink, suppressionLink] = await Promise.all([
    hasTalStep
      ? db.channelTargetAccountList.findFirst({ where: { campaignChannelId: channelId }, include: { list: true } })
      : Promise.resolve(null),
    hasSuppressionStep
      ? db.channelSuppressionList.findFirst({ where: { campaignChannelId: channelId }, include: { list: true } })
      : Promise.resolve(null),
  ]);

  const [talEntries, talCount, suppressionEntries, suppressionCount] = await Promise.all([
    talLink === null
      ? Promise.resolve([])
      : db.targetAccountEntry.findMany({ where: { listId: talLink.listId }, orderBy: { createdAt: "asc" }, take: 50 }),
    talLink === null ? Promise.resolve(0) : db.targetAccountEntry.count({ where: { listId: talLink.listId } }),
    suppressionLink === null
      ? Promise.resolve([])
      : db.suppressionEntry.findMany({ where: { listId: suppressionLink.listId }, orderBy: { createdAt: "asc" }, take: 50 }),
    suppressionLink === null ? Promise.resolve(0) : db.suppressionEntry.count({ where: { listId: suppressionLink.listId } }),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {hasTalStep && (
        <TargetAccountListCard
          campaignId={campaignId}
          channelId={channelId}
          listName={talLink?.list.name ?? null}
          rowCount={talCount}
          entries={talEntries.map((e) => ({ id: e.id, rawName: e.rawName, rawDomain: e.rawDomain, matchStatus: e.matchStatus }))}
          editable={editable}
          downloadHref={`/api/campaigns/${campaignId}/channels/${channelId}/target-accounts/export`}
        />
      )}
      {hasSuppressionStep && (
        <SuppressionListCard
          campaignId={campaignId}
          channelId={channelId}
          listName={suppressionLink?.list.name ?? null}
          rowCount={suppressionCount}
          entries={suppressionEntries.map((e) => ({ id: e.id, type: e.type, value: e.value }))}
          editable={editable}
          downloadHref={`/api/campaigns/${campaignId}/channels/${channelId}/suppression-list/export`}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the tab into `page.tsx`**

In `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx`:

Add the import:
```ts
import { ChannelListsTab } from "./channel-lists-tab";
```

Add to `TABS` (currently lines 39-46), after `"terms"`:
```ts
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "terms", label: "Terms" },
  { id: "lists", label: "Lists" },
  { id: "placements", label: "Placements" },
  { id: "allocations", label: "Allocations" },
  { id: "pacing", label: "Pacing" },
  { id: "delivery", label: "Delivery & runs" },
] as const;
```

After `const hasLeadSpecStep = ...` (line 122), add:
```ts
  const hasTalStep = readiness.steps.some((s) => s.key === "targetAccountList");
  const hasSuppressionStep = readiness.steps.some((s) => s.key === "suppressionList");
```

Update the `visibleTabs` filter (lines 125-128):
```ts
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "placements") return hasPlacementStep;
    if (t.id === "lists") return hasTalStep || hasSuppressionStep;
    return true;
  });
```

After the `{tab === "placements" && ...}` block (lines 268-270), add:
```tsx
      {tab === "lists" && (hasTalStep || hasSuppressionStep) && (
        <ChannelListsTab
          campaignId={campaign.id}
          channelId={channel.id}
          editable={channel.status === "draft" && canWriteCampaign}
          hasTalStep={hasTalStep}
          hasSuppressionStep={hasSuppressionStep}
        />
      )}
```

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Verify in the browser**

Start the dev server (`preview_start` with the project's dev configuration), open a draft channel with the `targetAccountList`/`suppressionList` steps added via the existing "Edit" checklist drawer (or seed one through the admin UI's "Add step" picker), navigate to the new "Lists" tab, and confirm: uploading a small CSV creates entries and shows a row count; adding a manual entry appends a row; the "Download CSV" link returns a file (this exercises the route built in Task 7 — if Task 7 isn't done yet, expect a 404 here and revisit after it lands); "Remove list" clears the card back to "No list attached yet".

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/campaigns/[id]/channels/[channelId]/target-account-list-card.tsx" \
        "src/app/(admin)/campaigns/[id]/channels/[channelId]/suppression-list-card.tsx" \
        "src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-lists-tab.tsx" \
        "src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx"
git commit -m "feat: admin Lists tab for channel target-account and suppression lists"
```

---

### Task 7: Admin CSV export routes

**Files:**
- Create: `src/app/api/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts`
- Create: `src/app/api/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts`

**Interfaces:**
- Consumes: `exportTargetAccountListCsv`/`exportSuppressionListCsv` (Tasks 2-3).

- [ ] **Step 1: Write the target-accounts export route**

Create `src/app/api/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { exportTargetAccountListCsv } from "@/lib/lists/target-accounts";
import { ApplicationError, NotFoundError } from "@/lib/errors";

function statusForError(error: ApplicationError): number {
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  return 400;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> },
): Promise<Response> {
  const { channelId } = await params;

  try {
    const actor = await requireActor();
    const csv = await exportTargetAccountListCsv(db, actor, channelId);
    if (csv === null) throw new NotFoundError("No target account list attached to this channel");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="target-accounts-${channelId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      return NextResponse.json({ error: error.message }, { status: statusForError(error) });
    }
    throw error;
  }
}
```

- [ ] **Step 2: Write the suppression-list export route**

Create `src/app/api/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts`, identical shape:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { exportSuppressionListCsv } from "@/lib/lists/suppression";
import { ApplicationError, NotFoundError } from "@/lib/errors";

function statusForError(error: ApplicationError): number {
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  return 400;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> },
): Promise<Response> {
  const { channelId } = await params;

  try {
    const actor = await requireActor();
    const csv = await exportSuppressionListCsv(db, actor, channelId);
    if (csv === null) throw new NotFoundError("No suppression list attached to this channel");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="suppression-list-${channelId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      return NextResponse.json({ error: error.message }, { status: statusForError(error) });
    }
    throw error;
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Verify in the browser**

With the dev server running and a channel that has an attached target-account list (from Task 6's manual verification), open
`http://localhost:3000/api/campaigns/<campaignId>/channels/<channelId>/target-accounts/export` directly (or click "Download CSV" on the Lists tab) and confirm a CSV downloads with the expected header row. Repeat for the suppression route. Then confirm a channel with no list attached returns a 404 JSON body.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts" \
        "src/app/api/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts"
git commit -m "feat: admin CSV export routes for channel target-account and suppression lists"
```

---

### Task 8: Client-facing read model

**Files:**
- Modify: `src/lib/approvals/client-channel-view.ts`
- Modify: `tests/client-channel-view.test.ts`

**Interfaces:**
- Produces: `ClientChannelDetail` gains `targetAccountList: { rowCount: number; downloadUrl: string } | null` and `suppressionList: { rowCount: number; downloadUrl: string } | null`.

- [ ] **Step 1: Write the failing test**

Append to `tests/client-channel-view.test.ts`:

```ts
import { addTargetAccountEntry } from "@/lib/lists/target-accounts";
import { addSuppressionEntry } from "@/lib/lists/suppression";

  it("includes target-account and suppression list summaries when attached, null otherwise", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, { requiresAsset: false, campaignStatus: "pending" });

    const withoutLists = await getClientChannelDetail(db, fx.clientAdminActor, fx.campaignId, fx.channelId);
    expect(withoutLists.targetAccountList).toBeNull();
    expect(withoutLists.suppressionList).toBeNull();

    await addTargetAccountEntry(db, fx.adminActor, fx.channelId, { rawName: "Acme" });
    await addSuppressionEntry(db, fx.adminActor, fx.channelId, { type: "domain", value: "competitor.com" });

    const withLists = await getClientChannelDetail(db, fx.clientAdminActor, fx.campaignId, fx.channelId);
    expect(withLists.targetAccountList).toEqual({
      rowCount: 1,
      downloadUrl: `/api/client/campaigns/${fx.campaignId}/channels/${fx.channelId}/target-accounts/export`,
    });
    expect(withLists.suppressionList).toEqual({
      rowCount: 1,
      downloadUrl: `/api/client/campaigns/${fx.campaignId}/channels/${fx.channelId}/suppression-list/export`,
    });
  });
```

Note: `addTargetAccountEntry`/`addSuppressionEntry` assert `channel.status === "draft"`, but this fixture's channel is `"pending"` (`campaignStatus: "pending"` implies the channel itself may still be `"draft"` by default per `createChannelFixture`'s `channelStatus` default — check: `createChannelFixture`'s `channel.status` defaults to `options.channelStatus ?? "draft"` regardless of `campaignStatus`, so the channel stays `"draft"` here and the manual-add calls succeed even though the *campaign* is `"pending"` for `getClientChannelDetail`'s own gate, which checks `campaign.status !== "draft"`).

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test client-channel-view.test.ts
```

Expected: `FAIL` — `targetAccountList`/`suppressionList` don't exist on `ClientChannelDetail` yet.

- [ ] **Step 3: Implement**

In `src/lib/approvals/client-channel-view.ts`, add to `ClientChannelDetail` (lines 43-67):

```ts
  targetAccountList: { rowCount: number; downloadUrl: string } | null;
  suppressionList: { rowCount: number; downloadUrl: string } | null;
```

In `getClientChannelDetail`, after the `decisionRows`/`decisions` block and before the `pacingBuckets` query, add:

```ts
  const [talLink, suppressionLink] = await Promise.all([
    db.channelTargetAccountList.findFirst({ where: { campaignChannelId: channel.id }, select: { listId: true } }),
    db.channelSuppressionList.findFirst({ where: { campaignChannelId: channel.id }, select: { listId: true } }),
  ]);
  const [targetAccountCount, suppressionCount] = await Promise.all([
    talLink === null ? Promise.resolve(0) : db.targetAccountEntry.count({ where: { listId: talLink.listId } }),
    suppressionLink === null ? Promise.resolve(0) : db.suppressionEntry.count({ where: { listId: suppressionLink.listId } }),
  ]);
```

In the function's final returned object, add:

```ts
    targetAccountList:
      talLink === null
        ? null
        : { rowCount: targetAccountCount, downloadUrl: `/api/client/campaigns/${campaignId}/channels/${channelId}/target-accounts/export` },
    suppressionList:
      suppressionLink === null
        ? null
        : { rowCount: suppressionCount, downloadUrl: `/api/client/campaigns/${campaignId}/channels/${channelId}/suppression-list/export` },
```

(`campaignId`/`channelId` here are the function's own parameters, already in scope.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test client-channel-view.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Full suite and typecheck**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/approvals/client-channel-view.ts tests/client-channel-view.test.ts
git commit -m "feat: expose target-account and suppression list summaries to the client channel view"
```

---

### Task 9: Client export routes and client page UI

**Files:**
- Create: `src/app/api/client/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts`
- Create: `src/app/api/client/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts`
- Modify: `src/app/client/campaigns/[id]/channels/[channelId]/page.tsx`

**Interfaces:**
- Consumes: `exportTargetAccountListCsv`/`exportSuppressionListCsv` (Tasks 2-3), `ClientChannelDetail.targetAccountList`/`.suppressionList` (Task 8).

- [ ] **Step 1: Write the client target-accounts export route**

Create `src/app/api/client/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { exportTargetAccountListCsv } from "@/lib/lists/target-accounts";
import { ApplicationError, NotFoundError } from "@/lib/errors";

function statusForError(error: ApplicationError): number {
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  return 400;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> },
): Promise<Response> {
  const { id: campaignId, channelId } = await params;

  try {
    const actor = await requireActor();
    assertPortal(actor, "client");

    // Same org-ownership guard getClientChannelDetail uses
    // (src/lib/approvals/client-channel-view.ts) — this is a distinct
    // request, so it re-checks rather than trusting a link rendered earlier.
    const channel = await db.campaignChannel.findFirst({
      where: {
        id: channelId,
        campaignId,
        campaign: { clientOrganizationId: actor.organizationId, deletedAt: null, status: { not: "draft" } },
      },
      select: { id: true },
    });
    if (channel === null) throw new NotFoundError("Channel not found");

    const csv = await exportTargetAccountListCsv(db, actor, channelId);
    if (csv === null) throw new NotFoundError("No target account list attached to this channel");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="target-accounts-${channelId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      return NextResponse.json({ error: error.message }, { status: statusForError(error) });
    }
    throw error;
  }
}
```

- [ ] **Step 2: Write the client suppression-list export route**

Create `src/app/api/client/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts`, identical shape swapping in `exportSuppressionListCsv` and the `suppression-list-${channelId}.csv` filename.

- [ ] **Step 3: Add the read-only summary to the client channel page**

In `src/app/client/campaigns/[id]/channels/[channelId]/page.tsx`, after the `{tab === "overview" && (...)}` block (currently ending around line 1717), add:

```tsx
      {(channel.targetAccountList !== null || channel.suppressionList !== null) && (
        <Card>
          <CardHeader>
            <CardTitle>Lists</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col">
            {channel.targetAccountList !== null &&
              row(
                "Target account list",
                `${channel.targetAccountList.rowCount} accounts`,
              )}
            {channel.suppressionList !== null &&
              row("Suppression list", `${channel.suppressionList.rowCount} entries`)}
            <div className="mt-3 flex gap-2">
              {channel.targetAccountList !== null && (
                <Button asChild size="sm" variant="outline">
                  <a href={channel.targetAccountList.downloadUrl}>Download target accounts</a>
                </Button>
              )}
              {channel.suppressionList !== null && (
                <Button asChild size="sm" variant="outline">
                  <a href={channel.suppressionList.downloadUrl}>Download suppression list</a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
```

This sits outside the `tab === "..."` conditionals — it's always visible once the campaign channel has a list, not gated to a specific tab (there is no client-side tab for it, per the spec). Add the `Button` import if not already present:
```ts
import { Button } from "@/components/ui/button";
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Verify in the browser**

As a client-portal user (or by pointing the dev server's client route at a campaign/channel with an attached list from earlier verification), open the client channel page and confirm the "Lists" card appears with the correct row counts and that both download links return the CSV.

- [ ] **Step 6: Run the full test suite one final time**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: everything green — this is the last task.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/client/campaigns/[id]/channels/[channelId]/target-accounts/export/route.ts" \
        "src/app/api/client/campaigns/[id]/channels/[channelId]/suppression-list/export/route.ts" \
        "src/app/client/campaigns/[id]/channels/[channelId]/page.tsx"
git commit -m "feat: client-facing target-account and suppression list download"
```
