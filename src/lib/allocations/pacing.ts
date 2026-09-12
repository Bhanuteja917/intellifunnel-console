import { operatingDayStart } from "@/lib/time/operating-day";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PacingBucket = { periodStart: Date; periodEnd: Date; targetQuantity: number };

/**
 * Linear pro-ration of `cap` across the flight window, both endpoints
 * inclusive: a 1-day window (startDate === endDate) has totalDays === 1,
 * and on that day elapsedDays === 1 (100% expected). Clamped to
 * [0, totalDays] so a date outside the window still returns a sane 0% or
 * 100% instead of a negative or >100% figure.
 *
 * Day boundaries use `operatingDayStart` (the same helper the codebase
 * already uses to compare `@db.Date` flight-window columns against "now"
 * in the operating timezone) — not `sla.ts`'s business-day/holiday
 * skipping, which doesn't apply here: a flight window's pacing expectation
 * doesn't pause for a weekend the way a verification SLA clock does.
 */
export function expectedToDate(cap: number, startDate: Date, endDate: Date, asOf: Date, timeZone: string): number {
  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
  const today = operatingDayStart(asOf, timeZone);
  const rawElapsedDays = Math.round((today.getTime() - startDate.getTime()) / DAY_MS) + 1;
  const elapsedDays = Math.min(Math.max(rawElapsedDays, 0), totalDays);
  return cap * (elapsedDays / totalDays);
}

export function expectedToDateWithSchedule(
  buckets: PacingBucket[],
  asOf: Date,
  timeZone: string,
): number {
  // Defensive sort by periodStart (callers should pass sorted, but don't assume)
  const sortedBuckets = [...buckets].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());

  const today = operatingDayStart(asOf, timeZone);

  let total = 0;

  for (const bucket of sortedBuckets) {
    if (today > bucket.periodEnd) {
      // Completed: contribute full targetQuantity
      total += bucket.targetQuantity;
    } else if (today >= bucket.periodStart && today <= bucket.periodEnd) {
      // In-progress: pro-rate using expectedToDate
      total += expectedToDate(bucket.targetQuantity, bucket.periodStart, bucket.periodEnd, asOf, timeZone);
    }
    // else: future bucket, contribute 0
  }

  return total;
}

export type PaceSignal = "behind" | "onPace" | "ahead";

export function paceSignal(delivered: number, expected: number): PaceSignal {
  if (delivered < expected) return "behind";
  if (delivered > expected) return "ahead";
  return "onPace";
}
