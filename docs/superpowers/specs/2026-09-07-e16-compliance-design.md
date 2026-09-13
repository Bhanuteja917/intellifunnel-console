# Design: PRD Epic E16 — Compliance and data governance

**Spec:** `prd.md` §E16 (P0)

## Context

E16 is the last unbuilt P0 epic. Two of its PRD bullets are already fully satisfied by earlier work and need no changes:

- "Working calendar and holiday table driving business-day SLA calculation" — `Holiday` model + `src/lib/leads/sla.ts` already compute `verificationElapsedBusinessMinutes`/`slaBreached` on `Lead` (landed in E9).
- Platform-wide retention default — `personalDataRetentionMonths: 12` already exists as a live, audited platform setting (`src/lib/settings/settings.ts`).

Everything else in the epic is either a hardcoded stub or entirely missing:

- `checkDoNotContact()` (`src/lib/leads/matching.ts:13`) is `return false` — a deliberate, marked no-op deferred from E9's intake pipeline.
- `DoNotContact` model exists in the schema but has **zero references anywhere in `src/`** — no enforcement, and no admin UI to even create an entry.
- `Contact.anonymisedAt` exists on the schema but is never read or written.
- No per-client retention override — only the platform-wide default.
- No consent artifact tying a specific lead to the opt-in text/timestamp/IP/URL it was captured under.
- No anonymization job, no erasure-request handling.

**Scoping constraint found during brainstorming:** there is no public lead-capture web form yet. Every real `Lead` today arrives via CSV upload (`submitLeadFile`, `src/lib/leads/intake.ts`) — internal or partner sourced. `ConsentTextVersion`/`formSlug` exist only for admin campaign config and reporting joins, never a live page a person submits through. This means "IP address" and "source URL" have no natural live capture point today; the design below treats them as optional CSV-supplied metadata rather than something the app captures live.

**Explicitly deferred, not part of this plan:**

- The public lead-capture form endpoint itself (real E8/E9 form-channel work) — out of scope for a compliance epic; consent capture here is CSV-metadata-only until that endpoint exists.
- Call-recording retention configuration — `VerificationRecord.callRecordingKey` is marked "reserved, unused in v1"; no recordings are ever written, so a retention period for them would be a config value with nothing to act on. Revisit when recording storage ships.
- A formal `ErasureRequest` tracking record — erasure here is a single internal admin action (immediate, audited via the existing audit log), not a queued/SLA-tracked request type.
- E14 payout computation, E13 metrics ingestion — unaffected by this plan.

## Data model

```prisma
model Organization {
  // ...unchanged fields...
  personalDataRetentionMonths Int? // null = inherit platform default (SETTING_DEFAULTS.personalDataRetentionMonths)
}

model LeadConsent {
  id                   String   @id @default(cuid())
  leadId               String   @unique
  consentTextVersionId String?
  acceptedAt           DateTime
  ipAddress            String?
  sourceUrl            String?
  createdAt            DateTime @default(now())

  lead               Lead                @relation(fields: [leadId], references: [id])
  consentTextVersion ConsentTextVersion? @relation(fields: [consentTextVersionId], references: [id])
}
```

`Lead` gains a back-relation (`consent LeadConsent?`); `ConsentTextVersion` gains `leadConsents LeadConsent[]`. One `LeadConsent` per `Lead`, created once at intake, never updated — a satellite table matching how `VerificationRecord`/`LeadStatusHistory` already sit off `Lead` rather than growing that model directly.

No new model for DNC or retention config — `DoNotContact` already has the right shape (`clientOrganizationId`, `type`, `value`, `valueHash`, `expiresAt`), it just needs callers. `personalDataRetentionMonths` on `Organization` follows the exact pattern `defaultBillingCurrency`/`payoutTrigger` already use for per-org configuration.

New permissions: `"compliance:read"`, `"compliance:write"` added to the `Permission` union, granted to `OPERATIONS` only (alongside its existing `allocation:*`/`delivery:*` PII-adjacent grants) — DNC list edits, retention overrides, and erasure are all gated behind these two, kept off `CAMPAIGN_MANAGER`/`ACCOUNT_MANAGER` given the PII sensitivity.

## DNC enforcement at intake

`checkDoNotContact` becomes a real DB-backed check, replacing the stub:

```ts
// src/lib/leads/matching.ts
export async function checkDoNotContact(
  db: PrismaClient,
  clientOrganizationId: string,
  candidate: { email?: string; domain?: string; phone?: string },
): Promise<boolean> {
  const conditions: { type: DoNotContactType; valueHash: string }[] = [];
  if (candidate.email !== undefined) {
    conditions.push({ type: "email", valueHash: hashSuppressionValue(normalizeEmail(candidate.email)) });
    const domain = emailDomain(candidate.email);
    if (domain !== null) conditions.push({ type: "domain", valueHash: hashSuppressionValue(domain) });
  }
  if (candidate.domain !== undefined) {
    const domain = normalizeDomain(candidate.domain);
    if (domain !== null) conditions.push({ type: "domain", valueHash: hashSuppressionValue(domain) });
  }
  if (candidate.phone !== undefined) {
    const phone = normalizePhone(candidate.phone);
    if (phone !== null) conditions.push({ type: "phone", valueHash: hashSuppressionValue(phone) });
  }
  if (conditions.length === 0) return false;

  const hit = await db.doNotContact.findFirst({
    where: { clientOrganizationId, OR: conditions },
    select: { id: true },
  });
  return hit !== null;
}
```

Reuses `hashSuppressionValue` (`src/lib/lists/suppression.ts`, HMAC-SHA256 with `SUPPRESSION_HASH_SALT`) rather than introducing a second hashing secret — the field is already literally named `valueHash` to match this convention. Reuses the same `normalizeEmail`/`emailDomain`/`normalizeDomain`/`normalizePhone` helpers `isSuppressed` and `field-validation.ts` already use, so a DNC entry matches on exactly the same normalized values suppression and field validation do.

Call site in `intake.ts` changes from the no-op call to a real, awaited one, at the existing call site (mirrors `checkSuppression`'s neighboring call, same `campaign.clientOrganizationId` already in scope there):

```ts
const doNotContact = await checkDoNotContact(db, campaign.clientOrganizationId, { email, domain: companyDomain });
if (doNotContact) {
  outcome = "failed";
  rejectReasonCode = "DO_NOT_CONTACT";
}
```

`DO_NOT_CONTACT` (`category: "suppression"`, `isPartnerReplaceable: true`) is already seeded in `prisma/seed/reject-reasons.ts:27` — seeded but unused until now, the exact same "seeded ahead of its enforcement" precedent `ALLOCATION_CAP_EXCEEDED` set before E12. No new reject reason to add. No phone field is collected by intake's current `LeadFieldSpec` set in practice, but the check supports it for when one is.

Two other reject reasons are also already seeded but stay unused after this plan: `CONSENT_MISSING`/`CONSENT_INVALID` (`category: "consent"`). Activating those would mean rejecting a row for missing/invalid consent evidence — not done here, since this plan makes consent metadata optional (no live form guarantees its presence yet, see Context above). Left as a follow-up for whenever the public form endpoint exists and consent evidence becomes mandatory.

## Consent capture at intake

`SubmitLeadFileInput` gains an optional field, independent of the existing `mapping` (which is strictly CSV-header → configured `LeadFieldSpec.fieldKey` — consent metadata isn't campaign-specific business data, so it doesn't go through that system, the same way `partnerOrganizationId` is already a top-level param rather than a mapped field):

```ts
export type SubmitLeadFileInput = {
  // ...unchanged fields...
  consentMapping?: {
    formSlug?: string;   // CSV header name — resolves to AssetPlacement.consentTextVersionId
    timestamp?: string;  // CSV header name
    ip?: string;
    sourceUrl?: string;
  };
};
```

A campaign channel can have multiple `AssetPlacement`s (one per asset, `formSlug` unique per placement), so there is no single "the channel's placement" to default to — a row needs its own `formSlug` to resolve a specific one. This mirrors `engagement-import.ts`'s existing formSlug→placement resolution exactly: before the row loop, collect every distinct `rawRow[consentMapping.formSlug]` value across the file into a `Set`, resolve them in one batched `db.assetPlacement.findMany({ where: { formSlug: { in: [...slugs] } }, select: { id: true, formSlug: true, consentTextVersionId: true } })`, and build a `Map<formSlug, consentTextVersionId>` the row loop consults — avoiding an N+1, same reasoning as that module's own comment on why it batches.

For each row that becomes a `Lead`, a `LeadConsent` is created in the same transaction:

- `consentTextVersionId`: looked up via the row's `consentMapping.formSlug` value against the batched map above; `null` if no `formSlug` supplied, or the slug doesn't match any known placement (unlike `engagement-import.ts`, an unknown slug here is not a row error — consent capture is best-effort metadata, not a required linkage).
- `acceptedAt`: `rawRow[consentMapping.timestamp]` parsed as a date if supplied and valid, otherwise `submission.submittedAt`.
- `ipAddress` / `sourceUrl`: `rawRow[consentMapping.ip]` / `rawRow[consentMapping.sourceUrl]` if supplied, otherwise `null`.

No row is ever rejected for missing or unresolvable consent metadata — every field is best-effort, given no live form exists yet to guarantee their presence or correctness.

## Retention and anonymization

`src/lib/compliance/retention.ts`:

```ts
export async function anonymizeExpiredContacts(db: PrismaClient, now: Date): Promise<number>
```

For each `Contact` with `anonymisedAt IS NULL`:

1. Load every `Lead` for that contact, joined to its campaign channel's campaign `clientOrganizationId` and `Organization.personalDataRetentionMonths`.
2. A contact with **no leads**, or **any lead not yet `acceptedAt`-set** (still open/pending, or rejected without ever being accepted), is skipped entirely — retention only starts counting from acceptance, matching the PRD's own "12 months from acceptance" wording. This is a deliberate consequence of that wording, not a bug: a contact every one of whose leads was rejected has no retention clock under this epic and is never anonymized by this job. Flagged below as a follow-up, since it means purely-rejected PII currently has no expiry.
3. Otherwise, per lead compute `acceptedAt + (organization.personalDataRetentionMonths ?? platformDefault) months`; the contact's overall deadline is the **maximum** (latest) of these across all its leads — the most conservative client's window governs, since anonymizing early would destroy data a different client's still-open retention window still protects.
4. If `now` is past that deadline: null out `Contact.email` (replaced with a stable non-colliding placeholder to satisfy the `emailNormalized` unique constraint, e.g. `` `anonymized-${contact.id}@erased.invalid` ``), `firstName`, `lastName`, `phone`, `jobTitle`, `seniority`, `jobFunction`, `country`, `linkedinUrl`; set `anonymisedAt = now`.

`Account`, `Lead`, `LeadStatusHistory`, `VerificationRecord`, `DeliveryRun*`, `LeadConsent`, and financial fields are never touched — delivery counts, financial history, and the consent trail all survive anonymization untouched, per the PRD's explicit requirement.

Wired into the existing worker tick (`src/worker/index.ts`, alongside `fireDueWebhookRuns`/`generateDueCsvRuns`) — no new scheduling infrastructure. The `anonymisedAt IS NULL` filter makes every run idempotent: a contact already anonymized is never re-selected, so running every 60-second tick (same interval as the rest of the worker) costs nothing extra on repeat runs.

## Erasure (early anonymization)

Same scrub logic as above, factored into a shared `scrubContactPii` helper called by both the batch job and:

```ts
// src/lib/compliance/retention.ts
export async function eraseContactNow(db: PrismaClient, actor: Actor, contactId: string): Promise<void>
```

Skips the deadline check entirely — runs immediately regardless of any lead's acceptance date — gated by `compliance:write`, wrapped in the existing `withAudit` pattern so the manual override is on the record (before/after snapshot of the scrubbed fields, actor, timestamp — same shape every other audited mutation in this codebase already uses).

## Admin UI

One new page, `src/app/(admin)/compliance/page.tsx`, gated by `compliance:read`/`compliance:write` (no admin surface for any of this exists today — not even a way to create a `DoNotContact` row). Three sections on one page rather than three separate routes, since each is a small, related, low-traffic operation:

1. **Do-not-contact list** — table of existing entries (client org, type, value, reason, expiry) with an add-entry form (`type`, `value`, `clientOrganizationId`, optional `reason`/`expiresAt`) and a delete action per row. Backed by new `src/lib/compliance/dnc.ts`: `listDoNotContactEntries`, `createDoNotContactEntry` (hashes and normalizes `value` the same way `checkDoNotContact` does, so what's stored matches what's checked), `deleteDoNotContactEntry` — all `compliance:write`-gated, audited.
2. **Per-client retention override** — table of client organizations with an editable `personalDataRetentionMonths` field (blank = inherits the platform default, shown alongside it for context). New `setOrganizationRetentionOverride(db, actor, orgId, months: number | null)` added to `src/lib/organizations/crud.ts` (natural home given it edits an `Organization` field), gated by `compliance:write`, audited.
3. **Contact erasure** — a search-by-email box (`Contact.emailNormalized`) showing the matched contact's `anonymisedAt` status (or "not anonymized") and an "Erase personal data now" button calling `eraseContactNow` when unset.

## Testing

New vitest coverage (`tests/*.test.ts`, matching this codebase's existing convention):

- `checkDoNotContact`: match on email, match on derived domain, match on phone, no match, no-op with no candidate fields.
- Intake integration: a DNC-hit row still creates a `Lead` with `verificationStatus: "failed"` and reason `DO_NOT_CONTACT` (same as any other business-rule reject, e.g. a suppression hit — only structural failures like a missing email skip `Lead` creation entirely) and claims no allocation/channel capacity; a non-hit row is unaffected by the new check.
- `LeadConsent` creation: with a full `consentMapping` supplied, with none supplied (falls back to `submittedAt`, nulls for ip/url), with and without a configured `ConsentTextVersion` on the placement.
- Retention deadline math: platform default vs. per-client override, a contact whose only lead is still open (never selected), a contact with two leads under two different clients with different retention months (deadline is the max of the two).
- `anonymizeExpiredContacts`: scrubs an eligible contact's PII fields exactly, leaves `Account`/`Lead`/`LeadStatusHistory`/`VerificationRecord`/`LeadConsent` byte-for-byte unchanged, is a no-op on a second run (idempotency).
- `eraseContactNow`: scrubs immediately regardless of lead acceptance dates, writes an audit entry with the expected before/after shape.
- Admin compliance page (DNC add/delete, retention override save, erasure search+action) spot-checked live against the dev DB, per this project's established UI-testing convention.

## Open questions / follow-ups for later epics

- Once a public lead-capture form exists, `LeadConsent.ipAddress`/`sourceUrl` should start being captured live from the request instead of relying on optional CSV columns — no schema rework anticipated, just a second, richer call site for the same model.
- Call-recording retention: revisit once `VerificationRecord.callRecordingKey` is actually written to by a real call-recording integration.
- A formal `ErasureRequest` record (with SLA tracking) if erasure volume or regulatory reporting ever needs more than the audit log provides.
- Retention for contacts whose leads were all rejected and never accepted — currently no clock starts for them at all (see the Retention section above). Revisit if this needs its own policy (e.g. N months from last rejection).
