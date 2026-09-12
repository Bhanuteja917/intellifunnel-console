# Channel Pacing Schedule — Design Spec

**Date:** 2026-09-12  
**Status:** Draft — awaiting user review

---

## Problem

Channel pacing is currently a read-only linear computation: `expectedToDate` divides `contractedQuantity` evenly across the flight window day-by-day. There is no way to express a non-linear delivery agreement — e.g. "15 leads in October, 15 in November, 15 in December." Operators have no tool to set or edit the delivery cadence agreed with the client.

---

## Goal

Allow operators to set a custom pacing schedule per channel, expressed as monthly or weekly buckets with explicit quantity targets. The pacing computation uses this schedule when present, falling back to linear when absent. The schedule must remain editable after the flight starts.

---

## Out of scope

- Partner-level custom pacing (each allocation continues to use linear)
- Automatic bucket rebalancing when `contractedQuantity` changes after a schedule exists (operator must update manually)
- Calendar-aware business-day weighting within buckets

---

## Data model

### New table: `ChannelPacingBucket`

```prisma
model ChannelPacingBucket {
  id                String          @id @default(cuid())
  campaignChannelId String
  periodStart       DateTime        @db.Date
  periodEnd         DateTime        @db.Date   // inclusive
  targetQuantity    Int
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel   CampaignChannel @relation(fields: [campaignChannelId], references: [id])

  @@index([campaignChannelId])
}
```

No `granularity` column — granularity is a UI concept used at schedule-creation time to auto-generate buckets. The stored rows are just date-ranged quantities; the UI infers granularity from the bucket spans when displaying.

### Relation on `CampaignChannel`

```prisma
pacingBuckets ChannelPacingBucket[]
```

### Constraints (enforced in lib, not DB)

1. All buckets for a channel must be non-overlapping and contiguous, spanning exactly `startDate`–`endDate`.
2. Bucket `targetQuantity` values must be ≥ 0 and sum to `contractedQuantity`.
3. A channel may have zero buckets (linear fallback) or a full set — partial schedules are not stored.

---

## Lib changes

### `src/lib/allocations/pacing.ts`

Add `expectedToDateWithSchedule`:

```ts
export type PacingBucket = { periodStart: Date; periodEnd: Date; targetQuantity: number };

export function expectedToDateWithSchedule(
  buckets: PacingBucket[],
  asOf: Date,
  timeZone: string,
): number {
  // Sum completed buckets + pro-rate the in-progress bucket.
  // A bucket is "completed" when asOf is past periodEnd.
  // The in-progress bucket is pro-rated by (daysElapsed / bucketDays).
  // Future buckets contribute 0.
}
```

`expectedToDate` (linear) remains unchanged — still used for partner allocations and when no buckets exist.

### `src/lib/channels/pacing-schedule.ts` (new file)

```ts
// generateBuckets(channel, granularity: "week" | "month") → PacingBucket[]
//   Auto-splits the flight window into calendar-aligned periods.
//   For "month": Jan 15 – Mar 10 → [Jan 15–31, Feb 1–28, Mar 1–10].
//   For "week": ISO Mon–Sun boundaries, clipped to flight window edges.
//   Quantities distributed proportionally by days, rounded to integers,
//   with any rounding remainder absorbed into the last bucket.

// validateBuckets(buckets, contractedQuantity, startDate, endDate) → string | null
//   Returns error string if invalid, null if valid.
//   Checks: non-overlapping, contiguous, covers full flight window, sum === contractedQuantity.

// saveSchedule(db, actor, channelId, buckets) → Promise<void>
//   Transaction: delete existing buckets, insert new set.
//   Calls validateBuckets before write; throws if invalid.

// deleteSchedule(db, actor, channelId) → Promise<void>
//   Deletes all buckets — reverts to linear.
```

---

## UI changes

### Pacing tab (`page.tsx` — `PacingTab` function)

**State A — no custom schedule (linear fallback):**

- Existing channel pacing card unchanged (Delivered, Expected, pace badge).
- "Set custom pacing" button in card header (only when `canWriteCampaign`).
- Clicking reveals the inline editor section (no dialog, no navigation).

**Inline editor:**

```
Granularity  [Month]  [Week]
──────────────────────────────────────────
Period              Target leads
Oct 2026            [ 15 ]
Nov 2026            [ 15 ]
Dec 1–15 2026       [ 15 ]
──────────────────────────────────────────
Total  45 / 45 contracted  ✓
──────────────────────────────────────────
[Cancel]            [Save schedule]
```

- Granularity toggle re-generates rows client-side, quantities reset proportionally.
- Each row: a read-only period label + a number `<Input>`.
- Live total shown; "Save schedule" disabled when total ≠ `contractedQuantity`.
- On save: calls `saveChannelPacingScheduleAction`, refreshes page.

**State B — custom schedule present:**

- Channel pacing card header shows "Custom schedule" label.
- Card body: table of buckets — period, target, delivered so far, pace badge per bucket.
- "Edit schedule" button re-opens the inline editor pre-filled.
- "Remove schedule" button (destructive, requires confirmation) → `deleteChannelPacingScheduleAction`.

**Updated `expectedToDate` call in `PacingTab`:**

Fetch `pacingBuckets` for the channel. If `buckets.length > 0`, use `expectedToDateWithSchedule`; else use `expectedToDate`. The pace badge and "Expected to date" figure both update accordingly.

---

## Server actions

New file: `src/app/(admin)/campaigns/[id]/channels/[channelId]/pacing/actions.ts`

```ts
saveChannelPacingScheduleAction(channelId: string, buckets: PacingBucket[])
deleteChannelPacingScheduleAction(channelId: string)
```

Both:
- Require `campaign:write` permission.
- Verify the channel belongs to a campaign the actor can access.
- Call lib functions; return `ActionResult`.

---

## Migration

Single migration: `add_channel_pacing_bucket_table`

No backfill — absence of rows = linear behaviour, correct for all existing channels.

---

## Validation edge cases

| Case | Behaviour |
|------|-----------|
| Flight window = one calendar period | One bucket; quantity must equal `contractedQuantity` |
| `contractedQuantity` changed after schedule created | Schedule rows remain; UI shows "Total X ≠ contracted Y" warning banner; operator must fix before saving |
| `targetQuantity` = 0 on a bucket | Allowed ("dark" period with no expected delivery) |
| Save with total ≠ `contractedQuantity` | Server action rejects; client toast shows error |
| Granularity toggle with partial data entered | Quantities reset — editor warns before toggling |

---

## What is NOT changing

- Partner allocation pacing — remains linear.
- `expectedToDate` signature — unchanged.
- Campaign page per-channel pace badges — continue using linear `expectedToDate` (follow-up once model is stable).
- Client portal — no pacing schedule surface for clients in this iteration.
