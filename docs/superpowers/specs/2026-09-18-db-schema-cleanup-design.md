# DB Schema Cleanup Design

**Date:** 2026-09-18
**Status:** Approved for implementation

## Goal

Remove tables and code paths that are either dead (no live caller) or premature
for this stage (a feature built ahead of need). Reduce 61 tables down to 54 by
dropping 7 models, and collapse `PlatformSetting` from a DB-backed KV store to
hardcoded constants since nothing edits it at runtime today.

## Non-Goals

- The `List`/`ListEntry`/`ChannelList` (target-account/suppression lists) merge
  done earlier this session is untouched — out of scope here.
- Compliance page keeps its retention-override and contact-erasure cards.
  Only the do-not-contact card goes.
- Core account matching (domain, then name+country) stays. Only the
  alias-matching tier and the merge feature go.

## Tables Dropped (7)

| Table | Why |
|---|---|
| `ExchangeRate` | Zero callers outside its own lib file (`money/exchange-rate.ts`). Multi-currency conversion was never wired into any feature. |
| `AccountMerge` | `identity/merge.ts` (`mergeAccounts`/`unmergeAccounts`) has zero callers in app routes/actions — no admin UI ever wired to it. |
| `OrganizationDomain` | Only referenced in its own migration SQL and one schema test. No feature reads or writes it. |
| `Holiday` | Live (feeds SLA business-day calc in `sla.ts`), but a premature refinement — dropping it just means every weekday counts as a business day, no holiday exclusion. Table itself is empty; feature can come back when actually needed. |
| `AccountAlias` | Live only as the 3rd fallback tier in `resolveAccount` (domain → name+country → **alias**). Its only writer was `merge.ts`, which is being deleted — so once merge goes, nothing ever populates it. Dropping the alias tier leaves domain + name+country matching intact. |
| `DoNotContact` | Live — wired into lead intake (`checkDoNotContact` in `matching.ts`, called from `intake.ts`) as a reject gate alongside suppression/TAL/ICP. Explicitly descoped: not required at this stage. Whole feature (table, lib, admin CRUD, intake gate) removed together rather than leaving an admin card that manages a list nothing enforces. |
| `PlatformSetting` | `setSetting` (the write path) has zero callers anywhere — no admin UI edits any of these 6 keys. They're seeded once and only ever read, i.e. functioning as DB-stored constants today. Collapse to real code constants; drop the table, the read/write round-trip, and the seed step. |

Dropping these also removes 3 enums that exist only to type them:
`RateSource` (ExchangeRate only), `AliasType` (AccountAlias only),
`DoNotContactType` (DoNotContact only).

## Follow-on Field/Relation Cleanup

- `Account.mergedIntoId` (+ self-relation `mergedInto`/`mergeSources`) — only
  meaningful to the merge feature. Once merge is gone, nothing ever sets it;
  it would sit permanently null. Dropped along with the merge feature rather
  than left as a dead column.
- `Account.aliases AccountAlias[]` relation — dropped with `AccountAlias`.
- `Organization.domains OrganizationDomain[]` relation — dropped with
  `OrganizationDomain`.
- `account-resolution.ts`'s `LIVE` filter (`{ deletedAt: null, mergedIntoId: null }`)
  simplifies to `{ deletedAt: null }`.
- `AccountMatch.matchedOn` narrows from `"domain" | "nameCountry" | "alias"`
  to `"domain" | "nameCountry"`.

## Settings: DB Table → Code Constants

`src/lib/settings/settings.ts` currently backs `getSetting`/`setSetting` with
`PlatformSetting`. New shape:

```ts
export type WeekDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type SettingValues = {
  defaultVerificationSlaBusinessDays: number;
  operatingTimezone: string;
  workingDays: WeekDay[];
  personalDataRetentionMonths: number;
  invitationExpiryDays: number;
};

export const SETTINGS: SettingValues = {
  defaultVerificationSlaBusinessDays: 3,
  operatingTimezone: "Asia/Kolkata",
  workingDays: ["MO", "TU", "WE", "TH", "FR"],
  personalDataRetentionMonths: 12,
  invitationExpiryDays: 7,
};

export function getSetting<K extends keyof SettingValues>(key: K): SettingValues[K] {
  return SETTINGS[key];
}
```

`reportingCurrency` drops with `ExchangeRate` (it had no other reader).
`setSetting` and the `"setting:write"` permission drop — nothing ever called
it. Every `await getSetting(db, "key")` call site becomes `getSetting("key")`
(no `db` argument, no await needed, though leaving a no-op `await` in front
of a non-Promise is harmless and keeps the diff smaller where convenient).

If runtime-editable settings are wanted later, `PlatformSetting` and
`setSetting` can be reintroduced — nothing else depends on the table
shape today.

## SLA Calc Simplification

`computeVerificationSla` in `sla.ts` drops the `db.holiday.findMany` query and
the `holidayDayMs` exclusion from its business-day loop. Every day that falls
on a `workingDays` weekday now counts as elapsed, full stop. Doc comment
updated to drop the holiday-calendar caveat (moot once the table's gone).

## Do-Not-Contact Removal

Removed together, in one pass:
- `src/lib/compliance/dnc.ts` (CRUD) — deleted
- `src/lib/leads/matching.ts`'s `checkDoNotContact` — deleted
- `src/lib/leads/intake.ts` — drop the `checkDoNotContact` call and the
  `"DO_NOT_CONTACT"` reject-reason branch in the per-row pipeline
- `compliance/page.tsx` — drop the "Do-not-contact list" card, its
  `listDoNotContactEntries` call, and the now-unused import
- `compliance/actions.ts` — drop `createDoNotContactEntryAction`/
  `deleteDoNotContactEntryAction`
- `compliance/add-dnc-entry-dialog.tsx`, `compliance/remove-dnc-entry-button.tsx` — deleted
- `"compliance:read"`/`"compliance:write"` permissions **stay** — the
  retention-override and contact-erasure cards on the same page still use
  them.

## Migration

Same non-interactive workaround as the earlier list-merge migration:
`prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script`
→ write into a manually-created `prisma/migrations/<timestamp>_<name>/`
folder → `prisma migrate deploy`. Drop-and-recreate is fine: every dropped
table is either empty or its data has no reader that survives this change.

## Test Fallout

- Delete: `tests/money.test.ts`, `tests/account-merge.test.ts`,
  `tests/compliance-dnc-crud.test.ts`, `tests/dnc-matching.test.ts`,
  `tests/leads-dnc-intake.test.ts`, `tests/settings.test.ts` (whole files —
  each is scoped entirely to a feature being removed).
- Trim: `tests/schema-organisations.test.ts` (drop the one
  `organizationDomain` uniqueness test, keep the rest of the file),
  `tests/identity-resolution.test.ts` (drop the one alias-tier match case,
  keep domain/name+country cases).
- Mechanical: every test file calling `seedSettings(testDb())` in
  `beforeEach` drops that call (no table to seed against anymore) — about
  19 files, one line each, per the `seedSettings` caller list gathered
  during discussion.
