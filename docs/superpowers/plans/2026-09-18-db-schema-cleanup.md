# DB Schema Cleanup Implementation Plan

**Goal:** Drop 7 unused/premature tables (`ExchangeRate`, `AccountMerge`, `AccountAlias`, `OrganizationDomain`, `Holiday`, `DoNotContact`, `PlatformSetting`) and the code paths that only exist for them, collapsing `PlatformSetting` into hardcoded constants.

**Architecture:** Schema-first — drop models/enums/relations, migrate, regenerate client, then work outward through each dead feature's lib code, consumers, and tests.

**Spec:** [docs/superpowers/specs/2026-09-18-db-schema-cleanup-design.md](../specs/2026-09-18-db-schema-cleanup-design.md)

## Global Constraints

- Compliance page keeps its retention-override and contact-erasure cards; only the DNC card goes. `compliance:read`/`compliance:write` permissions stay.
- Core account matching keeps domain + name/country tiers; only the alias tier and merge feature go.
- Migration via `prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` → manual migration folder → `prisma migrate deploy` (non-interactive environment).
- Full suite (`npx vitest run`) and `npx tsc --noEmit` must be clean before this is done.

---

### Task 1: Schema + migration

**Files:** `prisma/schema.prisma`, new `prisma/migrations/<ts>_drop_unused_tables/migration.sql`

- Delete models: `PlatformSetting`, `ExchangeRate`, `OrganizationDomain`, `Holiday`, `AccountAlias`, `DoNotContact`, `AccountMerge`.
- Delete enums: `RateSource`, `AliasType`, `DoNotContactType`.
- On `Organization`: remove `domains OrganizationDomain[]`.
- On `Account`: remove `mergedIntoId`, `mergedInto`/`mergeSources` self-relation, `aliases AccountAlias[]`, and the `@@index([mergedIntoId])`.
- Generate the diff SQL, place it in a new migration folder, run `prisma migrate deploy`, then `prisma generate`.
- Restart the dev server after (stale Prisma Client singleton issue from last time).

### Task 2: Settings → constants

**Files:** `src/lib/settings/settings.ts`, delete `prisma/seed/settings.ts`, `prisma/seed/index.ts`

- Rewrite `settings.ts` to the shape in the spec: `SettingValues` (drop `reportingCurrency`), `SETTINGS` constant, sync `getSetting(key)`, drop `setSetting` entirely.
- Remove `seedSettings` import/call from `prisma/seed/index.ts`.
- Delete `prisma/seed/settings.ts`.
- Update every `getSetting(db, "key")` call site to `getSetting("key")`:
  `compliance/page.tsx`, `campaigns/[id]/page.tsx`, `channels/[channelId]/page.tsx`, `sla.ts` (×2), `allocations/partner-view.ts`, `compliance/retention.ts`, `delivery/csv-runner.ts`, `approvals/client-view.ts`, `approvals/client-channel-view.ts`, `campaigns/state-machine.ts` (×2), `invitations/invitations.ts` (×2).
- Remove `"setting:write"` from `src/lib/auth/permissions.ts`.
- Remove `seedSettings(testDb())` from every test's `beforeEach`: `invitations.test.ts`, `lead-intake-caps.test.ts`, `delivery-runs.test.ts`, `partner-view-pacing.test.ts`, `delivery-webhook-trigger.test.ts`, `delivery-schema.test.ts`, `delivery-config.test.ts`, `server-actions.test.ts`, `campaign-approval.test.ts`, `leads-consent-intake.test.ts`, `lead-verification-counters.test.ts`, `client-channel-view.test.ts`, `delivery-csv-runner.test.ts`, `delivery-webhook-runner.test.ts`, `invitations.real-auth.test.ts`, `client-approvals-view.test.ts`, `lead-verification.test.ts`, `compliance-anonymize.test.ts` (drop `leads-dnc-intake.test.ts` and `settings.test.ts` here — they're deleted whole in Task 5/6).

### Task 3: Drop ExchangeRate feature

**Files:** delete `src/lib/money/exchange-rate.ts`, delete `tests/money.test.ts`

- Confirm no other importer of `exchange-rate.ts` (none found during discussion) before deleting.

### Task 4: Drop AccountMerge feature + simplify account matching

**Files:** delete `src/lib/identity/merge.ts`, delete `tests/account-merge.test.ts`, modify `src/lib/identity/account-resolution.ts`, modify `src/lib/auth/permissions.ts`, modify `tests/identity-resolution.test.ts`

- Delete `merge.ts` and its test.
- Remove `"account:merge"` from `permissions.ts`.
- In `account-resolution.ts`: change `LIVE` to `{ deletedAt: null }` (drop `mergedIntoId: null`); remove the alias-matching block (the `aliasValues`/`client.accountAlias.findMany` section) from `resolveAccount`; narrow `AccountMatch`'s `matchedOn` union to `"domain" | "nameCountry"`.
- In `identity-resolution.test.ts`: remove the one test case asserting `matchedOn: "alias"`; keep the domain and name+country cases.

### Task 5: Drop DoNotContact feature

**Files:** delete `src/lib/compliance/dnc.ts`, delete `src/app/(admin)/compliance/add-dnc-entry-dialog.tsx`, delete `src/app/(admin)/compliance/remove-dnc-entry-button.tsx`, modify `src/app/(admin)/compliance/page.tsx`, modify `src/app/(admin)/compliance/actions.ts`, modify `src/lib/leads/matching.ts`, modify `src/lib/leads/intake.ts`, delete `tests/compliance-dnc-crud.test.ts`, delete `tests/dnc-matching.test.ts`, delete `tests/leads-dnc-intake.test.ts`

- `matching.ts`: remove `checkDoNotContact` and the now-unused `DoNotContactType` import.
- `intake.ts`: remove the `checkDoNotContact` call, its `doNotContacted`/`"DO_NOT_CONTACT"` branch, and the `checkDoNotContact` import (keep `checkSuppression`/`matchesTal`/`matchesIcp`/`resolveLeadCap`).
- `compliance/actions.ts`: remove `createDoNotContactEntryAction`, `deleteDoNotContactEntryAction`, and the `dnc.ts`/`DoNotContactType` imports. Keep `setRetentionOverrideAction`, `eraseContactNowAction`.
- `compliance/page.tsx`: remove the "Do-not-contact list" `Card`, the `listDoNotContactEntries` call/import, `AddDncEntryDialog`/`RemoveDncEntryButton` imports, and `dncEntries`/`dncEntriesByOrg`/`orgNameById`. Keep the retention-override and contact-erasure cards and their data (`clientOrganizations`, `platformDefaultMonths`, `contact`).
- Delete the two component files and the three whole test files.

### Task 6: Drop OrganizationDomain + settings test cleanup

**Files:** modify `tests/schema-organisations.test.ts`, delete `tests/settings.test.ts`

- Remove the `"enforces a unique normalised organisation domain"` test case from `schema-organisations.test.ts`; keep the rest of the file.
- Delete `tests/settings.test.ts` (tests `setSetting`/table-backed behavior that no longer exists).

### Task 7: Simplify SLA holiday handling

**Files:** modify `src/lib/leads/sla.ts`

- Remove the `db.holiday.findMany` query and `holidayDayMs` set from `computeVerificationSla`; the elapsed-business-days loop keeps only the `workingDaySet.has(weekday)` check.
- Update the doc comment above `computeVerificationSla` to drop the holiday-calendar simplification note (no longer applicable).

### Task 8: Verify

- `npx tsc --noEmit` clean.
- `npx vitest run` — full suite green.
- `npx eslint src prisma tests --quiet` — no new failures (pre-existing `verification/page.tsx` failure from before this session is out of scope).
- Manually re-check `/compliance` in the browser: retention override + contact erasure still work, DNC card gone.
