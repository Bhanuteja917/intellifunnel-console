# Tech Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the known debt items recorded against E5 (asset library), E7 (partner allocation), E8/E9 (lead intake/verification) and one repo-wide bug, before starting E12 (pacing/quota).

**Architecture:** Eleven independent, sequentially-ordered tasks. Tasks 1-3 are isolated bug/test fixes. Tasks 4-6 touch the verification queue and review page (org-scoping, assignee check, pagination) — ordered so each can be tested against the state the previous task left. Tasks 7-8 add FR-VF-1's partner/age filtering (schema migration, then the queue UI that depends on it). Task 9 closes the asset-approval gate. Task 10 lazy-loads the S3 SDK. Task 11 fixes the two parked E7 findings.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + Postgres, vitest, TypeScript.

**Spec:** No single spec doc — this plan implements the debt list from `MEMORY.md`'s `project_epic_status` snapshot (2026-09-06) plus `TODO.md`, cross-checked against current code by a research pass (see task bodies for exact file:line evidence). `srs.md:363` (FR-VF-1) is quoted directly in Tasks 7-8.

## Global Constraints

- Every new/changed service function that isn't a pure helper takes `db: PrismaClient` and `actor: Actor` as its first two parameters, matching every existing function in `src/lib/leads/`, `src/lib/assets/`.
- Org-scoping predicates always merge into one object per Prisma relation key — never two separate spreads writing the same key (see `verification/page.tsx:32-37`'s own comment on why).
- Server actions return `ActionResult<T>` via `toActionResult`, never throw across the server/client boundary.
- New Prisma migrations via `npm run db:migrate -- --name <name>` (never hand-written migration.sql unless the tool can't express it).
- New tests follow the DB-fixture style (`resetDb()` + `testDb()` + `tests/helpers/factories.ts`) for anything touching Prisma; plain `describe`/`it.each` for pure functions (see `tests/normalise.test.ts`).

---

### Task 1: Fix `getCurrentActor` swallowing a stale/malformed session cookie

**Files:**
- Modify: `src/lib/auth/session.ts`
- Test: `tests/auth-session.test.ts`

**Interfaces:**
- Consumes: `ForbiddenError` from `src/lib/errors.ts` (already imported).
- Produces: no signature change — `getCurrentActor` still returns `Promise<Actor>` and still rejects with `ForbiddenError` for "not authenticated"; this task only makes a *second* failure mode (a decode/parse throw from `auth.api.getSession`) join that same, already-relied-upon contract instead of propagating as a raw, unhandled error.

Current code (`src/lib/auth/session.ts`, full file):
```ts
import { headers } from "next/headers";
import type { PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth/better-auth";
import { db as defaultDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { loadActor, type Actor } from "@/lib/auth/permissions";

export async function getCurrentActor(client: PrismaClient = defaultDb): Promise<Actor> {
  const session = await auth.api.getSession({ headers: await headers() });
  const authUserId = session?.user?.id;
  if (authUserId === undefined) throw new ForbiddenError("Not authenticated");

  const user = await client.user.findUnique({ where: { authUserId }, select: { id: true } });
  if (user === null) throw new ForbiddenError("No application user for this session");

  return loadActor(client, user.id);
}
```
`auth.api.getSession` returning `null`/no user is already handled (line with `authUserId === undefined`) and is locked in by an existing test (`tests/auth-session.test.ts:39-43`, "throws when there is no session"). The gap is narrower: a cookie `better-auth` can't decode at all (stale value from a rotated secret, truncated cookie) makes `auth.api.getSession` itself *throw*, before it ever returns — that throw is not a `ForbiddenError`, so it isn't caught by `error.tsx`'s expected boundary the same way, and isn't converted by `toActionResult` (which only normalizes `ApplicationError` instances, per `src/lib/auth/require.ts:18-27`).

- [ ] **Step 1: Write the failing test**

Add to `tests/auth-session.test.ts`, inside the existing `describe("getCurrentActor", ...)` block, after the "throws when there is no session" test:

```ts
  it("converts a session-decode failure into ForbiddenError instead of propagating it raw", async () => {
    getSession.mockRejectedValue(new Error("Invalid Base64 character: ."));
    const { getCurrentActor } = await import("@/lib/auth/session");
    await expect(getCurrentActor(testDb())).rejects.toBeInstanceOf(ForbiddenError);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth-session.test.ts`
Expected: FAIL — the rejection is a plain `Error`, not `ForbiddenError`, so `rejects.toBeInstanceOf(ForbiddenError)` fails.

- [ ] **Step 3: Wrap only the `getSession` call**

Edit `src/lib/auth/session.ts`:

```ts
export async function getCurrentActor(client: PrismaClient = defaultDb): Promise<Actor> {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch {
    // A cookie better-auth can't decode (stale value from a rotated secret,
    // a truncated cookie) throws here instead of returning null. Treat it
    // exactly like "no session" — both mean the browser has no usable
    // credential — rather than letting a decode error propagate raw past
    // the ForbiddenError contract every caller (error.tsx, toActionResult)
    // already relies on.
    throw new ForbiddenError("Not authenticated");
  }
  const authUserId = session?.user?.id;
  if (authUserId === undefined) throw new ForbiddenError("Not authenticated");

  const user = await client.user.findUnique({ where: { authUserId }, select: { id: true } });
  if (user === null) throw new ForbiddenError("No application user for this session");

  return loadActor(client, user.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/auth-session.test.ts`
Expected: PASS (all 4 tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.ts tests/auth-session.test.ts
git commit -m "fix(auth): normalize a session-decode failure into ForbiddenError"
```

---

### Task 2: Add vitest coverage for `validateFieldValues`

**Files:**
- Create: `tests/field-validation.test.ts`

**Interfaces:**
- Consumes: `validateFieldValues(specs: LeadFieldSpecRow[], rawRow: Record<string, string>): FieldValidationResult` from `src/lib/leads/field-validation.ts:31` (pure function, no DB).

- [ ] **Step 1: Write the tests**

```ts
import { describe, expect, it } from "vitest";
import { validateFieldValues, type LeadFieldSpecRow } from "@/lib/leads/field-validation";

function spec(overrides: Partial<LeadFieldSpecRow> & { fieldKey: string }): LeadFieldSpecRow {
  return {
    dataType: "string",
    isRequired: false,
    rejectIfMissing: false,
    ...overrides,
  };
}

describe("validateFieldValues", () => {
  it("passes through a valid string field", () => {
    const { values, errors } = validateFieldValues([spec({ fieldKey: "companyName" })], { companyName: "Acme" });
    expect(values).toEqual({ companyName: "Acme" });
    expect(errors).toEqual([]);
  });

  it("flags a missing required+rejectIfMissing field", () => {
    const { errors } = validateFieldValues(
      [spec({ fieldKey: "email", isRequired: true, rejectIfMissing: true })],
      {},
    );
    expect(errors).toEqual([
      { field: "email", rawValue: null, rejectReasonCode: "MISSING_REQUIRED_FIELD", message: "email is required" },
    ]);
  });

  it("does not flag a missing field that isn't rejectIfMissing", () => {
    const { values, errors } = validateFieldValues(
      [spec({ fieldKey: "phone", isRequired: true, rejectIfMissing: false })],
      {},
    );
    expect(values).toEqual({});
    expect(errors).toEqual([]);
  });

  it("normalizes a valid email and rejects a malformed one", () => {
    const ok = validateFieldValues([spec({ fieldKey: "email", dataType: "email" })], { email: " Jane@Acme.COM " });
    expect(ok.values).toEqual({ email: "jane@acme.com" });

    const bad = validateFieldValues([spec({ fieldKey: "email", dataType: "email" })], { email: "not-an-email" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_EMAIL_FORMAT");
  });

  it("rejects a generic/personal email domain", () => {
    const { errors } = validateFieldValues([spec({ fieldKey: "email", dataType: "email" })], { email: "jane@gmail.com" });
    expect(errors[0]?.rejectReasonCode).toBe("GENERIC_EMAIL_DOMAIN");
  });

  it("rejects an invalid phone number", () => {
    const { errors } = validateFieldValues([spec({ fieldKey: "phone", dataType: "phone" })], { phone: "not a phone" });
    expect(errors[0]?.rejectReasonCode).toBe("INVALID_PHONE_FORMAT");
  });

  it("parses a number field and rejects a non-numeric value", () => {
    const ok = validateFieldValues([spec({ fieldKey: "headcount", dataType: "number" })], { headcount: "42" });
    expect(ok.values).toEqual({ headcount: 42 });

    const bad = validateFieldValues([spec({ fieldKey: "headcount", dataType: "number" })], { headcount: "abc" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("parses a boolean field case-insensitively", () => {
    const { values } = validateFieldValues([spec({ fieldKey: "optedIn", dataType: "boolean" })], { optedIn: "YES" });
    expect(values).toEqual({ optedIn: true });
  });

  it("rejects an invalid boolean value", () => {
    const { errors } = validateFieldValues([spec({ fieldKey: "optedIn", dataType: "boolean" })], { optedIn: "maybe" });
    expect(errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("parses a date field and rejects an unparseable one", () => {
    const ok = validateFieldValues([spec({ fieldKey: "eventDate", dataType: "date" })], { eventDate: "2026-01-15" });
    expect(typeof ok.values.eventDate).toBe("string");

    const bad = validateFieldValues([spec({ fieldKey: "eventDate", dataType: "date" })], { eventDate: "not a date" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("accepts a valid URL and rejects a malformed one", () => {
    const ok = validateFieldValues([spec({ fieldKey: "site", dataType: "url" })], { site: "https://acme.com" });
    expect(ok.values).toEqual({ site: "https://acme.com" });

    const bad = validateFieldValues([spec({ fieldKey: "site", dataType: "url" })], { site: "not a url" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("rejects a value not in allowedValues (case-insensitive)", () => {
    const ok = validateFieldValues(
      [spec({ fieldKey: "tier", allowedValues: ["Gold", "Silver"] })],
      { tier: "gold" },
    );
    expect(ok.values).toEqual({ tier: "gold" });

    const bad = validateFieldValues(
      [spec({ fieldKey: "tier", allowedValues: ["Gold", "Silver"] })],
      { tier: "Bronze" },
    );
    expect(bad.errors[0]?.rejectReasonCode).toBe("VALUE_NOT_ALLOWED");
  });

  it("rejects a value that fails validationPattern", () => {
    const bad = validateFieldValues(
      [spec({ fieldKey: "zip", validationPattern: "^\\d{5}$" })],
      { zip: "abc" },
    );
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("treats a malformed validationPattern as a format failure, not a crash", () => {
    const { errors } = validateFieldValues(
      [spec({ fieldKey: "zip", validationPattern: "(unterminated" })],
      { zip: "12345" },
    );
    expect(errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("validates every spec independently across a row", () => {
    const { values, errors } = validateFieldValues(
      [spec({ fieldKey: "email", dataType: "email" }), spec({ fieldKey: "companyName" })],
      { email: "bad-email", companyName: "Acme" },
    );
    expect(errors).toHaveLength(1);
    expect(values).toEqual({ companyName: "Acme" });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- tests/field-validation.test.ts`
Expected: PASS (16 tests). This is new coverage, not a fix, so no red-first step applies beyond confirming the file runs.

- [ ] **Step 3: Commit**

```bash
git add tests/field-validation.test.ts
git commit -m "test(leads): add coverage for validateFieldValues"
```

---

### Task 3: Add vitest coverage for `matchesIcp`

**Files:**
- Create: `tests/icp-matching.test.ts`

**Interfaces:**
- Consumes: `matchesIcp(db, campaignId: string, account, contact): Promise<IcpMatchResult>` from `src/lib/leads/matching.ts:134`; `IcpMatchResult = { mandatoryFailed: boolean; failedDimensions: string[] }`. Needs `IcpCriterion` rows in the DB (`dimension`, `operator`, `valuesJson`, `isMandatory`, `campaignId`) and a `Campaign` + `Organization` to hang them off, via the existing factories (`createOrganization`, `createUser`) plus a raw `db.campaign.create`/`db.icpCriterion.create` (no factory exists yet for either, per `tests/helpers/factories.ts`'s current contents — checked in Task 2/3's research pass).

- [ ] **Step 1: Write the tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { matchesIcp } from "@/lib/leads/matching";

async function opsActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "OPERATIONS");
  return loadActor(db, user.id);
}

async function createCampaignWithCriteria(
  criteria: { dimension: string; operator: string; valuesJson: unknown; isMandatory: boolean }[],
) {
  const db = testDb();
  const actor = await opsActor();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id,
      name: "ICP Test Campaign",
      status: "draft",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });
  await db.icpCriterion.createMany({
    data: criteria.map((c) => ({ campaignId: campaign.id, ...c })),
  });
  return campaign.id;
}

const NO_ACCOUNT = { industry: null, employeeRange: null, revenueRange: null, country: null };
const NO_CONTACT = { jobFunction: null, seniority: null, jobTitle: null };

describe("matchesIcp", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("passes with zero criteria configured", async () => {
    const campaignId = await createCampaignWithCriteria([]);
    const result = await matchesIcp(testDb(), campaignId, NO_ACCOUNT, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("fails a mandatory 'in' criterion the account doesn't match", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "industry", operator: "in", valuesJson: ["SaaS"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, industry: "Manufacturing" }, NO_CONTACT);
    expect(result.mandatoryFailed).toBe(true);
    expect(result.failedDimensions).toEqual(["industry"]);
  });

  it("passes a mandatory 'in' criterion the account matches, case-insensitively", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "industry", operator: "in", valuesJson: ["SaaS"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, industry: "saas" }, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("records a non-mandatory failure without setting mandatoryFailed", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "country", operator: "in", valuesJson: ["US"], isMandatory: false },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, country: "IN" }, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: ["country"] });
  });

  it("skips a criterion when the account/contact field is null", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "jobTitle", operator: "contains", valuesJson: ["VP"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, NO_ACCOUNT, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("always skips region and custom dimensions", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "region", operator: "in", valuesJson: ["APAC"], isMandatory: true },
      { dimension: "custom", operator: "in", valuesJson: ["x"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, NO_ACCOUNT, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("evaluates 'between' on a numeric-parseable bucketed value", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "employeeRange", operator: "between", valuesJson: ["50", "200"], isMandatory: true },
    ]);
    const inRange = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, employeeRange: "100" }, NO_CONTACT);
    expect(inRange.mandatoryFailed).toBe(false);

    const outOfRange = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, employeeRange: "500" }, NO_CONTACT);
    expect(outOfRange.mandatoryFailed).toBe(true);
  });

  it("skips 'between' when the stored value isn't a parseable number", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "employeeRange", operator: "between", valuesJson: ["50", "200"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, employeeRange: "50-200" }, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("collects multiple failed dimensions and sets mandatoryFailed if any is mandatory", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "industry", operator: "in", valuesJson: ["SaaS"], isMandatory: false },
      { dimension: "seniority", operator: "in", valuesJson: ["VP"], isMandatory: true },
    ]);
    const result = await matchesIcp(
      testDb(),
      campaignId,
      { ...NO_ACCOUNT, industry: "Retail" },
      { ...NO_CONTACT, seniority: "Manager" },
    );
    expect(result.mandatoryFailed).toBe(true);
    expect(result.failedDimensions.sort()).toEqual(["industry", "seniority"].sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- tests/icp-matching.test.ts`
Expected: PASS (9 tests). If `db.campaign.create` rejects on a missing required field, read the `Campaign` model in `prisma/schema.prisma` (around line 595) and add whatever field this plan's snippet omitted — the model has fields beyond what's shown above (e.g. required date fields), so adjust the fixture to match the actual schema before treating this as a real failure.

- [ ] **Step 3: Commit**

```bash
git add tests/icp-matching.test.ts
git commit -m "test(leads): add coverage for matchesIcp"
```

---

### Task 4: Extract shared org-scope helpers, remove 4-way duplication

**Files:**
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/app/(admin)/verification/actions.ts`
- Modify: `src/app/(admin)/verification/page.tsx`
- Modify: `src/app/(admin)/verification/[leadId]/page.tsx`
- Test: `tests/org-scope.test.ts` (new)

**Interfaces:**
- Produces: `campaignChannelOrgScopeClause(actor: Actor): {} | { campaign: { clientOrganizationId: string } }` and `campaignOrgScopeClause(actor: Actor): {} | { clientOrganizationId: string }`, both exported from `src/lib/auth/permissions.ts`. `{}` for `actor.isInternal`; the org-scoped clause otherwise.
- Consumes: existing `assertOrganizationAccess(actor, organizationId)` (`src/lib/auth/permissions.ts:99`, unchanged) — reused as-is in `assignLeadToSelfAction` rather than duplicating its inline throw.

- [ ] **Step 1: Add the two helpers to `permissions.ts`**

Insert directly after `assertOrganizationAccess` (`src/lib/auth/permissions.ts:104`):

```ts
/**
 * Org-scope where-clause for a query reached *through* a CampaignChannel
 * (Lead, LeadSubmission, ...). `{}` for an internal actor; otherwise
 * `{ campaign: { clientOrganizationId } }`, meant to be merged into (or
 * nested one level under a `campaignChannel:` key of) the caller's own
 * where-clause — never spread alongside another top-level write to the same
 * key (see verification/page.tsx's own comment on why that silently drops
 * the scope).
 */
export function campaignChannelOrgScopeClause(
  actor: Actor,
): Record<string, never> | { campaign: { clientOrganizationId: string } } {
  return actor.isInternal ? {} : { campaign: { clientOrganizationId: actor.organizationId } };
}

/** Org-scope where-clause for a direct Campaign query. `{}` for an internal actor. */
export function campaignOrgScopeClause(
  actor: Actor,
): Record<string, never> | { clientOrganizationId: string } {
  return actor.isInternal ? {} : { clientOrganizationId: actor.organizationId };
}
```

- [ ] **Step 2: Write a test for the helpers**

Create `tests/org-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { campaignChannelOrgScopeClause, campaignOrgScopeClause, type Actor } from "@/lib/auth/permissions";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "u1",
    organizationId: "org1",
    portal: "admin",
    roles: [],
    isClient: false,
    isPartner: false,
    isInternal: false,
    ...overrides,
  };
}

describe("campaignChannelOrgScopeClause", () => {
  it("returns {} for an internal actor", () => {
    expect(campaignChannelOrgScopeClause(actor({ isInternal: true }))).toEqual({});
  });

  it("scopes to the actor's organisation otherwise", () => {
    expect(campaignChannelOrgScopeClause(actor({ organizationId: "org1" }))).toEqual({
      campaign: { clientOrganizationId: "org1" },
    });
  });
});

describe("campaignOrgScopeClause", () => {
  it("returns {} for an internal actor", () => {
    expect(campaignOrgScopeClause(actor({ isInternal: true }))).toEqual({});
  });

  it("scopes to the actor's organisation otherwise", () => {
    expect(campaignOrgScopeClause(actor({ organizationId: "org1" }))).toEqual({ clientOrganizationId: "org1" });
  });
});
```

Run: `npm test -- tests/org-scope.test.ts` — expect PASS. (`Portal` is a Prisma enum imported by `permissions.ts`; check its value set in `prisma/schema.prisma` if `"admin"` isn't a valid member and substitute a real one — the test only needs *a* valid `Portal` value, not that specific string.)

- [ ] **Step 3: Replace occurrence (a) — `assignLeadToSelfAction`**

Edit `src/app/(admin)/verification/actions.ts`, replacing lines 20-22:

```ts
    if (!actor.isInternal && lead.campaignChannel.campaign.clientOrganizationId !== actor.organizationId) {
      throw new ForbiddenError("Lead not accessible to this actor");
    }
```

with:

```ts
    assertOrganizationAccess(actor, lead.campaignChannel.campaign.clientOrganizationId);
```

Update the top-of-file imports: replace

```ts
import { assertPermission } from "@/lib/auth/permissions";
import { ForbiddenError, ValidationError } from "@/lib/errors";
```

with

```ts
import { assertOrganizationAccess, assertPermission } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
```

(`ForbiddenError` had exactly one use in this file — the inline check just removed — so drop the now-unused import rather than leave it dangling.)

- [ ] **Step 4: Replace occurrences (b) and (c) — `verification/page.tsx`**

Replace lines 32-41:

```ts
  // Both the org-scoping clause and the campaignId clause target the same
  // top-level `campaignChannel` key in the Prisma `where`. They must be
  // merged into ONE object here — two separate top-level spreads that both
  // write `campaignChannel` would have the second silently clobber the
  // first (shallow spread), dropping the org check entirely whenever a
  // campaignId was also present.
  const campaignChannelFilter = {
    ...(actor.isInternal ? {} : { campaign: { clientOrganizationId: actor.organizationId } }),
    ...(campaignId ? { campaignId } : {}),
  };
```

with:

```ts
  // Both the org-scoping clause and the campaignId clause target the same
  // top-level `campaignChannel` key in the Prisma `where`. They must be
  // merged into ONE object here — two separate top-level spreads that both
  // write `campaignChannel` would have the second silently clobber the
  // first (shallow spread), dropping the org check entirely whenever a
  // campaignId was also present.
  const campaignChannelFilter = {
    ...campaignChannelOrgScopeClause(actor),
    ...(campaignId ? { campaignId } : {}),
  };
```

Replace lines 60-64:

```ts
  const campaignsWithNeedsReview = await db.campaign.findMany({
    where: {
      ...(actor.isInternal ? {} : { clientOrganizationId: actor.organizationId }),
      channels: { some: { leads: { some: { verificationStatus: "needsReview" } } } },
    },
```

with:

```ts
  const campaignsWithNeedsReview = await db.campaign.findMany({
    where: {
      ...campaignOrgScopeClause(actor),
      channels: { some: { leads: { some: { verificationStatus: "needsReview" } } } },
    },
```

Add the import (`src/app/(admin)/verification/page.tsx:5`, alongside the existing `assertPermission` import):

```ts
import { assertPermission, campaignChannelOrgScopeClause, campaignOrgScopeClause } from "@/lib/auth/permissions";
```

- [ ] **Step 5: Replace occurrence (d) — `verification/[leadId]/page.tsx`**

Replace lines 31-41:

```ts
  // Org-scoping is folded straight into the lookup query (rather than
  // fetched-then-checked with assertOrganizationAccess) so that "not found"
  // and "not this actor's organisation" collapse into the same 404 — no
  // separate ForbiddenError path to handle on a page component.
  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      ...(actor.isInternal
        ? {}
        : { campaignChannel: { campaign: { clientOrganizationId: actor.organizationId } } }),
    },
```

with:

```ts
  // Org-scoping is folded straight into the lookup query (rather than
  // fetched-then-checked with assertOrganizationAccess) so that "not found"
  // and "not this actor's organisation" collapse into the same 404 — no
  // separate ForbiddenError path to handle on a page component.
  const channelScope = campaignChannelOrgScopeClause(actor);
  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      ...(Object.keys(channelScope).length > 0 ? { campaignChannel: channelScope } : {}),
    },
```

Add the import (`src/app/(admin)/verification/[leadId]/page.tsx:6`):

```ts
import { assertPermission, campaignChannelOrgScopeClause } from "@/lib/auth/permissions";
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions. There's no existing test file exercising these three page/action files directly, so passing here means "nothing else broke" — manually re-verify org-scoping behaviour by hand per this plan's UI-testing convention: sign in as a `CLIENT_VIEWER`/similar non-internal actor with `lead:read`, hit `/verification`, confirm only that org's leads show, then hit `/verification/<some-other-org's-lead-id>` directly and confirm a 404.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/permissions.ts src/app/\(admin\)/verification/actions.ts src/app/\(admin\)/verification/page.tsx "src/app/(admin)/verification/[leadId]/page.tsx" tests/org-scope.test.ts
git commit -m "refactor(verification): extract shared org-scope where-clause helpers"
```

---

### Task 5: `decideLeadVerification` must not let another reviewer's claimed lead be decided

**Files:**
- Modify: `src/lib/leads/verification.ts`
- Test: `tests/lead-verification.test.ts` (new — no test file for this function exists yet)

**Interfaces:**
- Consumes: `Lead.assignedToUserId: String?` (`prisma/schema.prisma:1010`, already selected via the existing `findUniqueOrThrow` in this function — no query change needed).
- Rule (per your decision): reject only if the lead is assigned to a *different* user. Unassigned (`assignedToUserId === null`) or self-assigned both remain decidable — this matches the queue UI's existing behaviour (`verification/page.tsx:160-167` renders the claim button for an unassigned lead and a "Review" link only for the actor who claimed it, but never blocks an unclaimed lead from being decided directly).

- [ ] **Step 1: Write the failing tests**

Create `tests/lead-verification.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { normalizeEmail } from "@/lib/normalise/email";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { decideLeadVerification } from "@/lib/leads/verification";

async function setupNeedsReviewLead() {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const reviewer = await createUser(db, internalOrg.id, "QUALITY");
  const otherReviewer = await createUser(db, internalOrg.id, "QUALITY");

  const channelType = await db.channelType.create({
    data: { code: `CT-${Date.now()}`, name: "Test Channel", requiresTeleVerification: false },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, isPublished: true },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id,
      name: "Test Campaign",
      status: "active",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
    },
  });
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10,
      clientUnitPriceMinor: 1000n,
      currency: "USD",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      status: "active",
    },
  });
  const account = await db.account.create({ data: { name: "Acme", ownerOrganizationId: internalOrg.id } });
  const contact = await db.contact.create({
    data: { accountId: account.id, email: normalizeEmail(`lead-${Date.now()}@example.com`) },
  });
  const submission = await db.leadSubmission.create({
    data: { campaignChannelId: campaignChannel.id, sourceType: "internal", submittedById: reviewer.id, mappingJson: {} },
  });
  const lead = await db.lead.create({
    data: {
      campaignChannelId: campaignChannel.id,
      submissionId: submission.id,
      contactId: contact.id,
      accountId: account.id,
      sourceType: "internal",
      verificationStatus: "needsReview",
      fieldValuesJson: {},
    },
  });

  return { db, lead, reviewerActor: await loadActor(db, reviewer.id), otherReviewerActor: await loadActor(db, otherReviewer.id) };
}

describe("decideLeadVerification — assignee check", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("allows deciding an unassigned lead", async () => {
    const { db, lead, reviewerActor } = await setupNeedsReviewLead();
    const result = await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });
    expect(result.effectiveDecision).toBe("accept");
  });

  it("allows the assignee to decide their own claimed lead", async () => {
    const { db, lead, reviewerActor } = await setupNeedsReviewLead();
    await db.lead.update({ where: { id: lead.id }, data: { assignedToUserId: reviewerActor.userId, assignedAt: new Date() } });
    const result = await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });
    expect(result.effectiveDecision).toBe("accept");
  });

  it("rejects deciding a lead claimed by a different reviewer", async () => {
    const { db, lead, reviewerActor, otherReviewerActor } = await setupNeedsReviewLead();
    await db.lead.update({ where: { id: lead.id }, data: { assignedToUserId: otherReviewerActor.userId, assignedAt: new Date() } });
    await expect(
      decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run tests to verify the third one fails**

Run: `npm test -- tests/lead-verification.test.ts`
Expected: FAIL on "rejects deciding a lead claimed by a different reviewer" — the function currently has no assignee check, so it resolves instead of rejecting. If any fixture setup step fails (a required field this plan's snippet omitted), fix the fixture against the real schema before treating this as the target failure — the target failure is specifically the missing rejection, not a setup error.

- [ ] **Step 3: Add the check**

Edit `src/lib/leads/verification.ts`, immediately after line 98 (`assertOrganizationAccess(actor, lead.campaignChannel.campaign.clientOrganizationId);`):

```ts
  assertOrganizationAccess(actor, lead.campaignChannel.campaign.clientOrganizationId);

  // A lead claimed via assignLeadToSelfAction (verification/actions.ts) may
  // only be decided by whoever claimed it — an unassigned lead is still
  // decidable by anyone with lead:write (matching the queue UI, which never
  // blocks a direct decide on an unclaimed lead).
  if (lead.assignedToUserId !== null && lead.assignedToUserId !== actor.userId) {
    throw new ForbiddenError("This lead is assigned to another reviewer");
  }
```

Update the import at the top of the file (line 10):

```ts
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { ForbiddenError, ValidationError } from "@/lib/errors";
```

(`ForbiddenError` moves from unused to used; add it to the existing `@/lib/errors` import next to `ValidationError`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lead-verification.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leads/verification.ts tests/lead-verification.test.ts
git commit -m "fix(leads): decideLeadVerification rejects a lead claimed by another reviewer"
```

---

### Task 6: Cursor pagination for the verification queue

**Files:**
- Modify: `src/app/(admin)/verification/page.tsx`

**Interfaces:**
- No exported function signature changes — this is a page-component-internal change to the `db.lead.findMany` call and its rendering.

- [ ] **Step 1: Add a stable-order cursor query**

Replace lines 23-55 of `src/app/(admin)/verification/page.tsx` (the function signature through the `leads` query) with:

```ts
const PAGE_SIZE = 50;

export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string; cursor?: string }>;
}) {
  const { campaignId, cursor } = await searchParams;
  const actor = await requireActor();
  assertPermission(actor, "lead:read");

  // Both the org-scoping clause and the campaignId clause target the same
  // top-level `campaignChannel` key in the Prisma `where`. They must be
  // merged into ONE object here — two separate top-level spreads that both
  // write `campaignChannel` would have the second silently clobber the
  // first (shallow spread), dropping the org check entirely whenever a
  // campaignId was also present.
  const campaignChannelFilter = {
    ...campaignChannelOrgScopeClause(actor),
    ...(campaignId ? { campaignId } : {}),
  };

  // Fetch one row past the page size to know whether a next page exists,
  // without a separate count query. `createdAt` alone isn't a unique sort
  // key (ties on the same millisecond), so `id` breaks ties — required for
  // cursor pagination to never skip or repeat a row across pages.
  const leadsPlusOne = await db.lead.findMany({
    where: {
      verificationStatus: "needsReview",
      ...(Object.keys(campaignChannelFilter).length > 0 ? { campaignChannel: campaignChannelFilter } : {}),
    },
    include: {
      account: true,
      contact: true,
      campaignChannel: { include: { campaign: true, channelTypeVersion: { include: { channelType: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // oldest first — the queue's whole point is age-ordering
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = leadsPlusOne.length > PAGE_SIZE;
  const leads = hasMore ? leadsPlusOne.slice(0, PAGE_SIZE) : leadsPlusOne;
  const nextCursor = hasMore ? leads[leads.length - 1]!.id : null;
```

- [ ] **Step 2: Add the "Load more" link**

In the JSX, immediately after the closing `</Table>` (currently line 172, inside the `{rows.length === 0 ? ... : (...)}` else-branch, right before its own closing `)}`), add a sibling element outside that conditional (i.e. after the whole `{rows.length === 0 ? (...) : (...)}` block, still inside `<CardContent>`):

```tsx
        {nextCursor !== null && (
          <Link
            href={
              (`/verification?${new URLSearchParams({
                ...(campaignId ? { campaignId } : {}),
                cursor: nextCursor,
              }).toString()}`) as Route
            }
            className="self-center text-sm underline underline-offset-4"
          >
            Load more
          </Link>
        )}
```

`Link` and `Route` are already imported (`verification/page.tsx:1-2`); no new imports needed.

- [ ] **Step 3: Manually verify**

Run the dev server, seed or upload more than 50 `needsReview` leads for one campaign channel (or lower `PAGE_SIZE` to `2` temporarily while testing, then revert), hit `/verification`, confirm exactly `PAGE_SIZE` rows render and a "Load more" link appears; click it and confirm the next page shows different leads with no duplicates or gaps; confirm the link disappears on the last page.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/verification/page.tsx
git commit -m "perf(verification): cursor-paginate the queue instead of a fixed take:50"
```

---

### Task 7: FR-VF-1 — add partner attribution to lead submissions

`srs.md:363`: *"Leads with outcome `NeedsReview` enter a work queue with assignment, filtering by campaign, partner and age."* Campaign filtering and age-ordering already exist; nothing currently records *which partner* a submission came from, so a partner filter has nothing to filter on. This task adds that attribution; Task 8 adds the queue filter that reads it.

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/leads/intake.ts`
- Modify: `src/app/(admin)/campaigns/[id]/leads/actions.ts`
- Modify: `src/app/(admin)/campaigns/[id]/leads/upload/page.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/leads/upload/upload-form.tsx`
- Test: `tests/lead-intake-partner.test.ts` (new)

**Interfaces:**
- Produces: `LeadSubmission.partnerOrganizationId: String?` (new column + relation). `SubmitLeadFileInput` gains `partnerOrganizationId?: string`.
- Consumes: existing `PartnerAllocation` model (`prisma/schema.prisma:695-716`) to validate the supplied partner org is actually allocated to the chosen `CampaignChannel`.

- [ ] **Step 1: Add the schema field**

Edit `prisma/schema.prisma` — `LeadSubmission` model (currently lines 958-978):

```prisma
model LeadSubmission {
  id                    String         @id @default(cuid())
  campaignChannelId     String
  sourceType            LeadSourceType
  submittedById         String
  partnerOrganizationId String?
  fileKey               String?
  mappingJson           Json
  rowsTotal             Int            @default(0)
  rowsAccepted          Int            @default(0)
  rowsFailed            Int            @default(0)
  status                ImportStatus   @default(pending)
  submittedAt           DateTime       @default(now())
  createdAt             DateTime       @default(now())
  updatedAt             DateTime       @updatedAt

  campaignChannel     CampaignChannel       @relation(fields: [campaignChannelId], references: [id])
  partnerOrganization Organization?         @relation(fields: [partnerOrganizationId], references: [id])
  leads               Lead[]
  errors              LeadSubmissionError[]

  @@index([campaignChannelId, status])
  @@index([partnerOrganizationId])
}
```

And add the reverse relation to `Organization` (currently lines 69-97), inserting `leadSubmissions` alongside the other relation arrays:

```prisma
  domains         OrganizationDomain[]
  users           User[]
  invitations     Invitation[]
  campaigns       Campaign[]
  assets          Asset[]
  allocations     PartnerAllocation[]
  leadSubmissions LeadSubmission[]
```

- [ ] **Step 2: Generate and run the migration**

Run: `npm run db:migrate -- --name add_partner_organization_to_lead_submission`
Expected: a new `prisma/migrations/<timestamp>_add_partner_organization_to_lead_submission/migration.sql` is created and applied — a nullable column + FK + index, no data migration needed since every existing row gets `NULL`.

- [ ] **Step 3: Write the failing test**

Create `tests/lead-intake-partner.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { submitLeadFile } from "@/lib/leads/intake";

async function setupChannel() {
  const db = testDb();
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
  const opsUser = await createUser(db, internalOrg.id, "OPERATIONS");
  const actor = await loadActor(db, opsUser.id);

  const channelType = await db.channelType.create({
    data: { code: `CT-${Date.now()}`, name: "Test Channel", requiresTeleVerification: false },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, isPublished: true },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id,
      name: "Test Campaign",
      status: "active",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
    },
  });
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10,
      clientUnitPriceMinor: 1000n,
      currency: "USD",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      status: "active",
    },
  });
  await db.leadFieldSpec.create({
    data: { campaignId: campaign.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
  });

  return { db, actor, campaignChannel, partnerOrg };
}

describe("submitLeadFile — partner attribution", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("rejects a partnerOrganizationId with no allocation on this channel", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    await expect(
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id,
        sourceType: "partner",
        partnerOrganizationId: partnerOrg.id,
        content: "email\njane@example.com",
        mapping: { email: "email" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects sourceType partner with no partnerOrganizationId", async () => {
    const { db, actor, campaignChannel } = await setupChannel();
    await expect(
      submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id,
        sourceType: "partner",
        content: "email\njane@example.com",
        mapping: { email: "email" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("stores partnerOrganizationId when the partner is allocated to this channel", async () => {
    const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
    await db.partnerAllocation.create({
      data: {
        campaignChannelId: campaignChannel.id,
        partnerOrganizationId: partnerOrg.id,
        allocatedQuantity: 10,
        payoutRateMinor: 100n,
        payoutCurrency: "USD",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
    });

    const result = await submitLeadFile(db, actor, {
      campaignChannelId: campaignChannel.id,
      sourceType: "partner",
      partnerOrganizationId: partnerOrg.id,
      content: "email\njane@example.com",
      mapping: { email: "email" },
    });

    const submission = await db.leadSubmission.findUniqueOrThrow({ where: { id: result.submissionId } });
    expect(submission.partnerOrganizationId).toBe(partnerOrg.id);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- tests/lead-intake-partner.test.ts`
Expected: FAIL — `SubmitLeadFileInput` has no `partnerOrganizationId` field yet (TypeScript will actually refuse to compile the test's extra property under `strict`/excess-property checks — that compile error *is* the expected red state here, equivalent to a runtime failure for this step).

- [ ] **Step 5: Wire `partnerOrganizationId` through `submitLeadFile`**

Edit `src/lib/leads/intake.ts`. Add to `SubmitLeadFileInput` (line 11-16):

```ts
export type SubmitLeadFileInput = {
  campaignChannelId: string;
  sourceType: "internal" | "partner" | "form"; // "form" accepted by the type but this plan's UI (Task 5) never sends it — file upload only
  partnerOrganizationId?: string;
  content: string;
  mapping: Record<string, string>; // CSV header -> LeadFieldSpec.fieldKey
};
```

Insert validation right after the existing `assertOrganizationAccess` call (line 84), before `const campaign = campaignChannel.campaign;`:

```ts
  assertOrganizationAccess(actor, campaignChannel.campaign.clientOrganizationId);

  // FR-VF-1: partner attribution on the submission, so the verification
  // queue can filter by partner. A "partner" submission must name a partner
  // that's actually allocated to this channel; an "internal" submission
  // must not claim one at all.
  if (input.sourceType === "partner") {
    if (input.partnerOrganizationId === undefined) {
      throw new ValidationError("partnerOrganizationId is required when sourceType is \"partner\"");
    }
    const allocation = await db.partnerAllocation.findFirst({
      where: { campaignChannelId: input.campaignChannelId, partnerOrganizationId: input.partnerOrganizationId },
    });
    if (allocation === null) {
      throw new ValidationError("This partner has no allocation on the selected channel");
    }
  } else if (input.partnerOrganizationId !== undefined) {
    throw new ValidationError("partnerOrganizationId can only be set when sourceType is \"partner\"");
  }

  const campaign = campaignChannel.campaign;
```

Update the `db.leadSubmission.create` call (line 117-126) to persist it:

```ts
  const submission = await db.leadSubmission.create({
    data: {
      campaignChannelId: input.campaignChannelId,
      sourceType: input.sourceType,
      submittedById: actor.userId,
      partnerOrganizationId: input.partnerOrganizationId,
      mappingJson: input.mapping,
      rowsTotal: parsed.rows.length,
      status: "processing",
    },
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/lead-intake-partner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Wire the server action and upload UI**

Edit `src/app/(admin)/campaigns/[id]/leads/actions.ts`:

```ts
export async function submitLeadFileAction(input: {
  campaignChannelId: string;
  campaignId: string; // only for revalidatePath — not passed into submitLeadFile
  sourceType: "internal" | "partner";
  partnerOrganizationId?: string;
  content: string;
  mapping: Record<string, string>;
}): Promise<ActionResult<{ submissionId: string; rowsTotal: number; rowsAccepted: number; rowsFailed: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await submitLeadFile(db, actor, {
      campaignChannelId: input.campaignChannelId,
      sourceType: input.sourceType,
      partnerOrganizationId: input.partnerOrganizationId,
      content: input.content,
      mapping: input.mapping,
    });
    revalidatePath(`/campaigns/${input.campaignId}/leads`);
    return result;
  });
}
```

Edit `src/app/(admin)/campaigns/[id]/leads/upload/page.tsx` — add a per-channel partner list next to the existing `channels` mapping (after line 29's `const channels = ...` block):

```ts
  const allocations = await db.partnerAllocation.findMany({
    where: { campaignChannelId: { in: campaign.channels.map((c) => c.id) } },
    include: { partnerOrganization: { select: { id: true, name: true } } },
  });
  const partnersByChannelId: Record<string, { id: string; name: string }[]> = {};
  for (const allocation of allocations) {
    (partnersByChannelId[allocation.campaignChannelId] ??= []).push({
      id: allocation.partnerOrganizationId,
      name: allocation.partnerOrganization.name,
    });
  }
```

Pass it down (line 79):

```tsx
<UploadForm campaignId={campaign.id} channels={channels} leadFieldKeys={leadFieldKeys} partnersByChannelId={partnersByChannelId} />
```

Edit `src/app/(admin)/campaigns/[id]/leads/upload/upload-form.tsx`:

```ts
type Props = {
  campaignId: string;
  channels: Channel[];
  leadFieldKeys: LeadFieldKey[];
  partnersByChannelId: Record<string, { id: string; name: string }[]>;
};

// ...

export function UploadForm({ campaignId, channels, leadFieldKeys, partnersByChannelId }: Props) {
  // ...
  const [partnerOrganizationId, setPartnerOrganizationId] = useState("");
  const availablePartners = partnersByChannelId[campaignChannelId] ?? [];

  // ...

  const canSubmit =
    campaignChannelId !== "" &&
    content !== null &&
    (sourceType !== "partner" || partnerOrganizationId !== "") &&
    leadFieldKeys
      .filter((f) => f.isRequired)
      .every((f) => headerByFieldKey[f.fieldKey] !== undefined && headerByFieldKey[f.fieldKey] !== UNMAPPED);

  function submit() {
    if (content === null) return;
    startTransition(async () => {
      const result = await submitLeadFileAction({
        campaignChannelId,
        campaignId,
        sourceType,
        partnerOrganizationId: sourceType === "partner" ? partnerOrganizationId : undefined,
        content,
        mapping,
      });
      // ... unchanged
```

Add the partner `<Select>` in the JSX, right after the existing "Source" `Field` (after its closing `</Field>`, still inside the same `grid grid-cols-2 gap-4` div — change that div to `grid-cols-3` to fit the third field, or wrap to a new row; simplest is a new row below the grid):

```tsx
            {sourceType === "partner" && (
              <div className="mt-4">
                <Field>
                  <FieldLabel htmlFor="upload-partner">Partner *</FieldLabel>
                  <Select value={partnerOrganizationId} onValueChange={setPartnerOrganizationId}>
                    <SelectTrigger id="upload-partner" className="w-full">
                      <SelectValue placeholder="Select partner..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availablePartners.map((partner) => (
                          <SelectItem key={partner.id} value={partner.id}>
                            {partner.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {availablePartners.length === 0 && (
                    <p className="text-sm text-muted-foreground">No partner is allocated to this channel yet.</p>
                  )}
                </Field>
              </div>
            )}
```

- [ ] **Step 8: Manually verify**

Run the dev server. On a channel with no `PartnerAllocation`, select source "partner" and confirm the form shows "No partner is allocated..." and the submit button stays disabled. On a channel with one, select it, upload a small CSV, and confirm the submission succeeds; then check the DB (`select "partnerOrganizationId" from "LeadSubmission" order by "createdAt" desc limit 1;`) shows the selected partner's id.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/leads/intake.ts "src/app/(admin)/campaigns/[id]/leads/actions.ts" "src/app/(admin)/campaigns/[id]/leads/upload/page.tsx" "src/app/(admin)/campaigns/[id]/leads/upload/upload-form.tsx" tests/lead-intake-partner.test.ts
git commit -m "feat(leads): record which partner a lead submission came from (FR-VF-1)"
```

---

### Task 8: FR-VF-1 — partner and age-threshold filters on the verification queue

**Files:**
- Modify: `src/app/(admin)/verification/page.tsx`

**Interfaces:**
- Consumes: `LeadSubmission.partnerOrganizationId` (Task 7) via `Lead.submission` (the relation named `submission` on `Lead`, per `prisma/schema.prisma`'s `Lead` model).

- [ ] **Step 1: Extend the search params and build the extra filters**

Building on Task 6's version of this file, change the `searchParams` type and destructure:

```ts
export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string; cursor?: string; partnerOrganizationId?: string; minAgeDays?: string }>;
}) {
  const { campaignId, cursor, partnerOrganizationId, minAgeDays } = await searchParams;
  const actor = await requireActor();
  assertPermission(actor, "lead:read");

  const parsedMinAgeDays = minAgeDays !== undefined && minAgeDays !== "" ? Number(minAgeDays) : undefined;
  const ageCutoff =
    parsedMinAgeDays !== undefined && Number.isFinite(parsedMinAgeDays) && parsedMinAgeDays > 0
      ? new Date(Date.now() - parsedMinAgeDays * 24 * 60 * 60 * 1000)
      : undefined;
```

Update the `db.lead.findMany` where-clause (Task 6's version) to add the two new predicates:

```ts
  const leadsPlusOne = await db.lead.findMany({
    where: {
      verificationStatus: "needsReview",
      ...(Object.keys(campaignChannelFilter).length > 0 ? { campaignChannel: campaignChannelFilter } : {}),
      ...(partnerOrganizationId ? { submission: { partnerOrganizationId } } : {}),
      ...(ageCutoff ? { createdAt: { lte: ageCutoff } } : {}),
    },
    include: {
      account: true,
      contact: true,
      campaignChannel: { include: { campaign: true, channelTypeVersion: { include: { channelType: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
```

- [ ] **Step 2: Fetch the partner filter's option list**

Add next to the existing `campaignsWithNeedsReview` query:

```ts
  const partnersWithNeedsReview = await db.organization.findMany({
    where: {
      isPartner: true,
      leadSubmissions: { some: { leads: { some: { verificationStatus: "needsReview" } } } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
```

- [ ] **Step 3: Extend the filter form**

Edit the `<form>` (Task 6's version, originally lines 101-124) to add the two fields and carry the new params. Since this is a GET form, each field just needs a `name` matching the search param and a `defaultValue`:

```tsx
        <form className="flex flex-wrap items-end gap-2" action="/verification">
          <div className="flex flex-col gap-1">
            <label htmlFor="campaignId" className="text-sm text-muted-foreground">
              Campaign
            </label>
            <select
              id="campaignId"
              name="campaignId"
              defaultValue={campaignId ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">All campaigns</option>
              {campaignsWithNeedsReview.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="partnerOrganizationId" className="text-sm text-muted-foreground">
              Partner
            </label>
            <select
              id="partnerOrganizationId"
              name="partnerOrganizationId"
              defaultValue={partnerOrganizationId ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">All partners</option>
              {partnersWithNeedsReview.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="minAgeDays" className="text-sm text-muted-foreground">
              Older than (days)
            </label>
            <input
              id="minAgeDays"
              name="minAgeDays"
              type="number"
              min={0}
              defaultValue={minAgeDays ?? ""}
              className="h-9 w-24 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md border border-input px-3 text-sm hover:bg-muted"
          >
            Filter
          </button>
        </form>
```

(A GET form reload drops `cursor` automatically since it's not one of the form's fields — same behaviour Task 6's link-based pagination expects: changing any filter restarts at the first page.)

- [ ] **Step 4: Manually verify**

Seed leads from two different partners (via Task 7's upload flow) plus some old-enough leads (or lower the age via direct DB update for a quick check: `update "Lead" set "createdAt" = now() - interval '10 days' where id = '...';`). On `/verification`, filter by partner and confirm only that partner's leads show; filter by "Older than (days)" = 5 and confirm only leads older than 5 days show; combine both filters with the campaign filter and confirm all three narrow together (not clobber each other, matching this file's existing "must merge into ONE object" convention).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/verification/page.tsx
git commit -m "feat(verification): add partner and age-threshold filters (FR-VF-1)"
```

---

### Task 9: Enforce the asset-approval gate at placement time

**Files:**
- Modify: `src/lib/assets/placements.ts`
- Test: `tests/asset-placements.test.ts` (new)

**Interfaces:**
- Consumes: `Asset.status: AssetStatus` (`"draft" | "active" | "archived"`, `prisma/schema.prisma:1100-1118`).
- No signature change to `createAssetPlacement`/`setPlacementStatus` — both already take `(db, actor, input)`; this task only adds a check inside each.

- [ ] **Step 1: Write the failing tests**

Create `tests/asset-placements.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { createAssetPlacement, setPlacementStatus } from "@/lib/assets/placements";

async function setupChannelAndAsset(assetStatus: "draft" | "active" | "archived") {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
  const actor = await loadActor(db, user.id);

  const channelType = await db.channelType.create({
    data: { code: `CT-${Date.now()}`, name: "Test Channel", requiresTeleVerification: false },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, isPublished: true },
  });
  const campaign = await db.campaign.create({
    data: { clientOrganizationId: org.id, name: "Test Campaign", status: "active", advisoryIcpMatch: false, advisoryTalMatch: false },
  });
  const campaignChannel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id,
      channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10,
      clientUnitPriceMinor: 1000n,
      currency: "USD",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      status: "active",
    },
  });
  const asset = await db.asset.create({
    data: { ownerOrganizationId: org.id, name: "Test Asset", type: "landingPage", language: "en", status: assetStatus },
  });
  const assetVersion = await db.assetVersion.create({
    data: { assetId: asset.id, version: 1, fileName: "test.html", fileKey: "test-key", mimeType: "text/html", sizeBytes: 100 },
  });

  return { db, actor, campaignChannel, asset, assetVersion };
}

describe("createAssetPlacement — asset status gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("rejects placing a draft asset", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("draft");
    await expect(
      createAssetPlacement(db, actor, {
        campaignChannelId: campaignChannel.id,
        assetId: asset.id,
        assetVersionId: assetVersion.id,
        landingPageUrl: "https://example.com",
        formSlug: `slug-${Date.now()}`,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects placing an archived asset", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("archived");
    await expect(
      createAssetPlacement(db, actor, {
        campaignChannelId: campaignChannel.id,
        assetId: asset.id,
        assetVersionId: assetVersion.id,
        landingPageUrl: "https://example.com",
        formSlug: `slug-${Date.now()}`,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows placing an active asset", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("active");
    const placement = await createAssetPlacement(db, actor, {
      campaignChannelId: campaignChannel.id,
      assetId: asset.id,
      assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com",
      formSlug: `slug-${Date.now()}`,
    });
    expect(placement.assetId).toBe(asset.id);
  });
});

describe("setPlacementStatus — asset status gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("rejects activating a placement whose asset is no longer active", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("active");
    const placement = await createAssetPlacement(db, actor, {
      campaignChannelId: campaignChannel.id,
      assetId: asset.id,
      assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com",
      formSlug: `slug-${Date.now()}`,
    });
    await db.asset.update({ where: { id: asset.id }, data: { status: "archived" } });

    await expect(
      setPlacementStatus(db, actor, { placementId: placement.id, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows pausing regardless of the asset's current status", async () => {
    const { db, actor, campaignChannel, asset, assetVersion } = await setupChannelAndAsset("active");
    const placement = await createAssetPlacement(db, actor, {
      campaignChannelId: campaignChannel.id,
      assetId: asset.id,
      assetVersionId: assetVersion.id,
      landingPageUrl: "https://example.com",
      formSlug: `slug-${Date.now()}`,
    });
    await db.asset.update({ where: { id: asset.id }, data: { status: "archived" } });

    const paused = await setPlacementStatus(db, actor, { placementId: placement.id, status: "paused" });
    expect(paused.status).toBe("paused");
  });
});
```

If `AssetType`'s actual enum values (`prisma/schema.prisma`) don't include `"landingPage"`, or `AssetVersion`'s required fields differ from the fixture above, adjust the fixture to match the real schema before treating a setup error as a real test failure.

- [ ] **Step 2: Run tests to verify the gate tests fail**

Run: `npm test -- tests/asset-placements.test.ts`
Expected: FAIL on "rejects placing a draft asset", "rejects placing an archived asset", and "rejects activating a placement whose asset is no longer active" — neither function currently checks `Asset.status` at all.

- [ ] **Step 3: Add the gate to `createAssetPlacement`**

Edit `src/lib/assets/placements.ts`, replacing lines 22-29:

```ts
  const assetVersion = await db.assetVersion.findUnique({ where: { id: input.assetVersionId } });
  if (assetVersion === null) throw new NotFoundError("Asset version not found");
  if (assetVersion.assetId !== input.assetId) {
    throw new ValidationError("The selected version does not belong to the selected asset");
  }
```

with:

```ts
  const assetVersion = await db.assetVersion.findUnique({ where: { id: input.assetVersionId } });
  if (assetVersion === null) throw new NotFoundError("Asset version not found");
  if (assetVersion.assetId !== input.assetId) {
    throw new ValidationError("The selected version does not belong to the selected asset");
  }

  const asset = await db.asset.findUniqueOrThrow({ where: { id: input.assetId } });
  if (asset.status !== "active") {
    throw new ValidationError(`Cannot place asset "${asset.name}" while it is ${asset.status} — it must be active`);
  }
```

- [ ] **Step 4: Add the gate to `setPlacementStatus`**

Replace the function body (lines 55-76):

```ts
export async function setPlacementStatus(
  db: PrismaClient,
  actor: Actor,
  input: SetPlacementStatusInput,
): Promise<AssetPlacement> {
  assertPermission(actor, "asset:write");

  const existing = await db.assetPlacement.findUnique({ where: { id: input.placementId } });
  if (existing === null) throw new NotFoundError("Placement not found");

  // AssetPlacementStatus transitions are unrestricted (draft/active/paused/
  // archived, any -> any) — the PRD doesn't specify a constrained flow here.
  return db.assetPlacement.update({
    where: { id: input.placementId },
    data: { status: input.status, updatedById: actor.userId },
  });
}
```

with:

```ts
export async function setPlacementStatus(
  db: PrismaClient,
  actor: Actor,
  input: SetPlacementStatusInput,
): Promise<AssetPlacement> {
  assertPermission(actor, "asset:write");

  const existing = await db.assetPlacement.findUnique({ where: { id: input.placementId } });
  if (existing === null) throw new NotFoundError("Placement not found");

  // Moving a placement TO "active" requires its asset to itself be active —
  // an operator can flip an Asset back to draft/archived after a placement
  // using it was already approved, and this is the one point that catches
  // it. Moving to any other status (paused/archived/back to draft) doesn't
  // put the asset in front of a lead, so it's unrestricted either way.
  if (input.status === "active") {
    const asset = await db.asset.findUniqueOrThrow({ where: { id: existing.assetId } });
    if (asset.status !== "active") {
      throw new ValidationError(`Cannot activate this placement — its asset "${asset.name}" is ${asset.status}, not active`);
    }
  }

  return db.assetPlacement.update({
    where: { id: input.placementId },
    data: { status: input.status, updatedById: actor.userId },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/asset-placements.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/lib/assets/placements.ts tests/asset-placements.test.ts
git commit -m "fix(assets): enforce active-asset gate at placement create/activate time"
```

---

### Task 10: Lazy-load the S3 SDK so local dev never bundles it

**Files:**
- Modify: `src/lib/storage/index.ts`
- Modify: `src/app/api/assets/[versionId]/download/route.ts`
- Modify: `src/app/(admin)/assets/actions.ts`

**Interfaces:**
- `getStorageAdapter()` becomes `async` (`Promise<StorageAdapter>` instead of `StorageAdapter`) — both call sites already run inside an `async` function, per this plan's research pass, so this is a compatible change.
- `delete()` stays on `StorageAdapter` and both adapters unchanged (per your decision — it's a symmetric interface method, not harmful dead code, even with zero current callers).

- [ ] **Step 1: Make the S3 import lazy**

Edit `src/lib/storage/index.ts`:

```ts
import { requireEnv } from "@/lib/env";
import { createLocalStorageAdapter } from "./local-adapter";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

async function createAdapter(): Promise<StorageAdapter> {
  if (process.env.STORAGE_DRIVER === "s3") {
    // Dynamic import so local dev (STORAGE_DRIVER unset) never pulls in
    // @aws-sdk/client-s3 / @aws-sdk/s3-request-presigner at module-load time.
    const { createS3StorageAdapter } = await import("./s3-adapter");
    return createS3StorageAdapter({
      bucket: requireEnv("S3_BUCKET"),
      region: requireEnv("S3_REGION"),
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    });
  }
  // Anything else, including unset, is the local-disk adapter — the intended
  // default for local development.
  return createLocalStorageAdapter();
}

let instance: StorageAdapter | undefined;

/** Returns the process-wide storage adapter, constructing it on first use. */
export async function getStorageAdapter(): Promise<StorageAdapter> {
  if (!instance) {
    instance = await createAdapter();
  }
  return instance;
}
```

- [ ] **Step 2: Update both callers to await it**

Edit `src/app/api/assets/[versionId]/download/route.ts:40` — change:

```ts
    const storage = getStorageAdapter();
```

to:

```ts
    const storage = await getStorageAdapter();
```

Edit `src/app/(admin)/assets/actions.ts:42` — change:

```ts
    const assetVersion = await uploadAssetVersion(db, actor, getStorageAdapter(), {
```

to:

```ts
    const assetVersion = await uploadAssetVersion(db, actor, await getStorageAdapter(), {
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no new errors — confirms no other caller of `getStorageAdapter()` was missed (both known call sites are the ones just edited).

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 4: Manually verify**

With `STORAGE_DRIVER` unset (local dev default), upload an asset version and download it through the existing UI — confirm both still work with the local adapter. Confirm `@aws-sdk/client-s3` doesn't appear in `next build`'s output for any route that doesn't use S3 (a rough check: `grep -r "client-s3" .next/server` before vs. after this change on a build with `STORAGE_DRIVER` unset — expect it gone or confined to a separate chunk after).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/index.ts "src/app/api/assets/[versionId]/download/route.ts" "src/app/(admin)/assets/actions.ts"
git commit -m "perf(storage): lazy-load the S3 adapter so local dev doesn't bundle it"
```

---

### Task 11: Fix the two parked E7 findings

**Files:**
- Modify: `src/app/partner/page.tsx`
- Modify: `src/app/partner/layout.tsx`

**Interfaces:** none — comment/catch-clause changes only, no signature changes.

- [ ] **Step 1: Fix the stale comment in `partner/page.tsx`**

The comment claims the layout gates access, which `layout.tsx`'s own doc comment explicitly says isn't true (a layout-level check doesn't stop the segment below it from rendering). Replace the full file:

```tsx
import { redirect } from "next/navigation";

// Real portal gating happens in allocations/page.tsx (assertPortal, per the
// doc comment on assertPortal in src/lib/auth/permissions.ts) — this page is
// just a fixed redirect to the one page the portal currently has.
export default function PartnerIndexPage() {
  redirect("/partner/allocations");
}
```

- [ ] **Step 2: Narrow the bare `catch {}` in `partner/layout.tsx`**

The catch is intentional (documented workaround for a real Next.js layout/page error-boundary race — do not remove it), but it currently swallows any thrown value, not just the `ForbiddenError` it's meant to catch. `assertPortal` (`src/lib/auth/permissions.ts:124-128`) only ever throws `ForbiddenError`, so narrowing to that and re-throwing anything else surfaces a genuine bug (e.g. a DB failure) instead of silently falling through to `{children}`.

Replace lines 35-39:

```tsx
  try {
    assertPortal(actor, "partner");
  } catch {
    return <>{children}</>;
  }
```

with:

```tsx
  try {
    assertPortal(actor, "partner");
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    return <>{children}</>;
  }
```

Add the import (top of `src/app/partner/layout.tsx`):

```tsx
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
```

- [ ] **Step 3: Manually verify**

Run the dev server. Sign in as a non-partner actor (e.g. a `CLIENT_VIEWER`) and hit `/partner` — confirm it still redirects/renders the portal's `error.tsx` the same way it did before this change (the fall-through-to-`{children}` behaviour for the expected `ForbiddenError` case is unchanged). There's no easy way to manually trigger a non-`ForbiddenError` throw inside `assertPortal` today (it only ever throws that one type), so this step is a regression check on the happy/expected-forbidden paths, not new coverage of the re-throw branch.

- [ ] **Step 4: Commit**

```bash
git add src/app/partner/page.tsx src/app/partner/layout.tsx
git commit -m "fix(partner): correct stale gating comment, narrow the layout's catch to ForbiddenError"
```

---

## Self-Review Notes

- **Spec coverage:** all 9 debt items from the research pass are covered — items 1 (Task 1), 2 (Tasks 2-3), 3 (Task 4), 4 (Task 6), 5 (Task 5), 6 (Tasks 7-8), 7 (Task 9), 8 (Task 10), 9 (Task 11).
- **Type consistency:** `campaignChannelOrgScopeClause`/`campaignOrgScopeClause` (Task 4) are defined once and reused with identical names/signatures in Tasks 6 and 8, which both edit the same file Task 4 touched — Task 6 and 8's snippets assume Task 4 already landed (both show the helper being called, not redefined).
- **Sequencing:** Tasks 4, 6, 8 all touch `verification/page.tsx` and must land in order (4 → 6 → 8) since each step's "current code" snippet assumes the previous task's edit already happened. Tasks 1-3, 5, 7, 9, 10, 11 have no ordering dependency on each other and could run in parallel if using subagent-driven-development, but 7 must precede 8.
