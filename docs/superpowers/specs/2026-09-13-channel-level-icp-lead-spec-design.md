# Channel-Level ICP & Lead Spec

**Date:** 2026-09-13  
**Status:** Approved for implementation  
**Scope:** `intellifunnel-console` Prisma schema + application logic

---

## Problem

ICP (`IcpCriterion`) and Lead Spec (`LeadFieldSpec`) are currently owned by `Campaign`. This conflates targeting/qualification config with the billing/reporting container. Different channels within a campaign need independent ICP and lead field definitions — a LinkedIn channel targets VP Engineering; a content syndication channel targets a broader tech audience.

---

## Decision

Move ICP and Lead Spec ownership to `CampaignChannel`. Campaign becomes a pure billing and reporting container. IIF defines ICP + Lead Spec per channel; client approves at channel level. Client self-service ICP editing is out of scope for initial launch — added post-launch.

---

## Data Model Changes

### `IcpCriterion`

**Remove:**
- `campaignId String`
- `campaign Campaign`
- `@@index([campaignId])`

**Add:**
- `campaignChannelId String`
- `campaignChannel CampaignChannel`
- `@@index([campaignChannelId])`

### `LeadFieldSpec`

**Remove:**
- `campaignId String`
- `campaign Campaign`
- `@@unique([campaignId, fieldKey])`

**Add:**
- `campaignChannelId String`
- `campaignChannel CampaignChannel`
- `@@unique([campaignChannelId, fieldKey])`

### `Campaign`

**Remove:**
- `icpCriteria IcpCriterion[]`
- `leadFieldSpecs LeadFieldSpec[]`
- `approvals CampaignApproval[]`
- `advisoryIcpMatch Boolean`
- `advisoryTalMatch Boolean`
- `defaultMaxLeadsPerAccount Int?` → moved to `CampaignChannel`

**`status` field stays** as a DB column (required for indexes). Updated by application logic, not a DB trigger.

### `CampaignChannel`

**Add:**
- `icpCriteria IcpCriterion[]`
- `leadFieldSpecs LeadFieldSpec[]`
- `advisoryIcpMatch Boolean @default(false)`
- `advisoryTalMatch Boolean @default(false)`
- `defaultMaxLeadsPerAccount Int?`

**Flight dates** (`startDate`, `endDate`) already exist on `CampaignChannel`. UI defaults them from the parent campaign's dates on channel creation.

### `CampaignApproval` — Removed

Table dropped. Both internal and client approvals move to channel level via `ChannelApproval`.

### `ChannelTermsApproval` → `ChannelApproval`

Renamed and extended. Retains append-only design: latest row by `decidedAt` is the current decision; a change-of-mind writes a new row. Snapshot fields ensure an approval predating an edit correctly reads as stale.

**Add:**
- `type ApprovalType` — kept for schema compatibility; only `client` used (internal approval removed)
- `icpSnapshotJson Json?` — ICP state frozen at decision time
- `leadSpecSnapshotJson Json?` — lead spec state frozen at decision time

**Keep:**
- `termsSnapshotJson Json`
- `decision ApprovalDecision`
- `decidedByUserId String`
- `decidedAt DateTime`
- `comments String?`

**Index:** `@@index([campaignChannelId, type, decidedAt])`

---

## Status Lifecycle

Both `CampaignStatus` and `CampaignChannelStatus` use the same unified enum:

```
draft → pending → scheduled → live → paused / completed / cancelled
```

| Status | Meaning |
|--------|---------|
| `draft` | Being built; ICP/lead spec not yet submitted |
| `pending` | Submitted; awaiting client approval |
| `scheduled` | Client approved; start date in future |
| `live` | Start date reached; delivering leads |
| `paused` | Temporarily halted |
| `completed` | End date reached or manually closed |
| `cancelled` | Abandoned |

### Campaign Status Derivation (application logic)

Campaign status is computed from its channels and written to the DB whenever any channel status changes:

| Condition | Campaign Status |
|-----------|----------------|
| Any channel is `draft` | `draft` |
| All channels submitted, any still `pending` | `pending` |
| All channels `scheduled` | `scheduled` |
| Any channel `live` | `live` |
| All channels `paused` | `paused` |
| All channels `completed` or `cancelled` | `completed` |

---

## Approval Flow

**Per channel, single-stage (client approval only):**

1. IIF defines ICP + Lead Spec + Terms for a `CampaignChannel`
2. IIF submits to client → channel status → `pending`
3. Client reviews ICP + lead spec + terms in client portal
4. Client approves → `ChannelApproval` row with `decision=approved`, all three snapshots frozen → channel status → `scheduled` (if start date future) or `live`
5. If client rejects → `ChannelApproval` row with `decision=rejected` → channel status → `draft` → IIF revises and resubmits
6. Campaign status auto-updates after each channel status transition

**Approval snapshot integrity:** if ICP, lead spec, or terms are edited after a client approval, the snapshot comparison marks that approval stale — same mechanism as existing `ChannelTermsApproval`.

---

## Migration Plan

Pre-production data only. Single Prisma migration file.

1. **Add `campaignChannelId` to `IcpCriterion` and `LeadFieldSpec`** (nullable initially)
2. **Backfill:** for each `IcpCriterion` / `LeadFieldSpec` row, find all `CampaignChannel` rows for that campaign and duplicate the record once per channel with `campaignChannelId` set
3. **Make `campaignChannelId` non-nullable**, drop `campaignId` column from both models
4. **Copy advisory flags + `defaultMaxLeadsPerAccount`** from each `Campaign` to its `CampaignChannel` rows
5. **Drop `CampaignApproval`** table — pre-prod data, no value in preserving
6. **Rename `ChannelTermsApproval` → `ChannelApproval`**, add `type`, `icpSnapshotJson`, `leadSpecSnapshotJson` columns (existing rows: `type=client`, snapshot columns null)
7. **Unify status enums:** replace `CampaignChannelStatus {draft, active, paused, completed}` with the 7-value enum above; migrate existing `active` → `live`; drop `pendingInternalApproval` from `CampaignStatus`; rename `pendingClientApproval` → `pending`
8. **Remove advisory columns** from `Campaign` model

Rollback: restore dev DB snapshot (pre-prod, no production risk).

---

## Out of Scope (Post-Launch)

- Client self-service ICP / Lead Spec definition
- Per-channel ICP inheritance / override from a campaign template
- ICP diff view between channel approval rounds

---

## Open Questions

None — all design decisions resolved in brainstorming session.
