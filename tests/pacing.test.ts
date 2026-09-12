import { describe, expect, it } from "vitest";
import { expectedToDate, expectedToDateWithSchedule, paceSignal } from "@/lib/allocations/pacing";
import type { PacingBucket } from "@/lib/allocations/pacing";

const TZ = "Asia/Kolkata";

describe("expectedToDate", () => {
  it("expects the full cap on a single-day window, on that day", () => {
    const day = new Date("2026-03-05T10:00:00.000Z"); // well inside the IST calendar day
    expect(expectedToDate(100, day, day, day, TZ)).toBe(100);
  });

  it("expects 0 before the window starts", () => {
    const start = new Date("2026-03-05T00:00:00.000Z");
    const end = new Date("2026-03-14T00:00:00.000Z");
    const before = new Date("2026-03-01T00:00:00.000Z");
    expect(expectedToDate(100, start, end, before, TZ)).toBe(0);
  });

  it("expects the full cap once the window has ended", () => {
    const start = new Date("2026-03-05T00:00:00.000Z");
    const end = new Date("2026-03-14T00:00:00.000Z");
    const after = new Date("2026-04-01T00:00:00.000Z");
    expect(expectedToDate(100, start, end, after, TZ)).toBe(100);
  });

  it("pro-rates linearly across a 10-day window", () => {
    const start = new Date("2026-03-05T00:00:00.000Z");
    const end = new Date("2026-03-14T00:00:00.000Z"); // 10 calendar days inclusive
    const asOf = new Date("2026-03-09T12:00:00.000Z"); // day 5 of 10
    expect(expectedToDate(100, start, end, asOf, TZ)).toBe(50);
  });
});

describe("paceSignal", () => {
  it("is behind when delivered is under expected", () => {
    expect(paceSignal(10, 20)).toBe("behind");
  });
  it("is ahead when delivered is over expected", () => {
    expect(paceSignal(30, 20)).toBe("ahead");
  });
  it("is onPace when delivered equals expected", () => {
    expect(paceSignal(20, 20)).toBe("onPace");
  });
});

describe("expectedToDateWithSchedule", () => {
  const TZ = "Asia/Kolkata";

  it("contributes full targetQuantity for a completed bucket", () => {
    const bucket: PacingBucket = {
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-01-31T00:00:00.000Z"),
      targetQuantity: 100,
    };
    // asOf = after bucket ends
    const asOf = new Date("2026-02-15T00:00:00.000Z");
    expect(expectedToDateWithSchedule([bucket], asOf, TZ)).toBe(100);
  });

  it("contributes 0 for a future bucket", () => {
    const bucket: PacingBucket = {
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-03-31T00:00:00.000Z"),
      targetQuantity: 50,
    };
    // asOf = before bucket starts
    const asOf = new Date("2026-02-01T00:00:00.000Z");
    expect(expectedToDateWithSchedule([bucket], asOf, TZ)).toBe(0);
  });

  it("pro-rates an in-progress bucket", () => {
    // 10-day bucket (Jan 1–10, inclusive), 100 leads
    const bucket: PacingBucket = {
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-01-10T00:00:00.000Z"),
      targetQuantity: 100,
    };
    // 5 days into the 10-day window
    const asOf = new Date("2026-01-05T10:00:00.000Z"); // IST calendar day 5
    const result = expectedToDateWithSchedule([bucket], asOf, TZ);
    expect(result).toBe(50);
  });

  it("sums completed + in-progress + skips future with multiple buckets", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-01-31T00:00:00.000Z"), targetQuantity: 100 }, // completed
      { periodStart: new Date("2026-02-01T00:00:00.000Z"), periodEnd: new Date("2026-02-10T00:00:00.000Z"), targetQuantity: 100 }, // in-progress: 10-day window, 5 days in
      { periodStart: new Date("2026-03-01T00:00:00.000Z"), periodEnd: new Date("2026-03-31T00:00:00.000Z"), targetQuantity: 50 },  // future
    ];
    const asOf = new Date("2026-02-05T10:00:00.000Z"); // IST: Feb 5
    const result = expectedToDateWithSchedule(buckets, asOf, TZ);
    // completed: 100, in-progress: 50 (5 of 10 days), future: 0
    expect(result).toBe(150);
  });

  it("handles a single-day window (start === end)", () => {
    // Bucket dates are UTC-midnight (as stored in DB); asOf is an instant during that IST calendar day
    const dayMidnight = new Date("2026-03-05T00:00:00.000Z");
    const asOf = new Date("2026-03-05T10:00:00.000Z"); // IST calendar day 5 March
    const bucket: PacingBucket = { periodStart: dayMidnight, periodEnd: dayMidnight, targetQuantity: 80 };
    expect(expectedToDateWithSchedule([bucket], asOf, TZ)).toBe(80);
  });

  it("returns 0 for all-zero targetQuantity buckets", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-01-31T00:00:00.000Z"), targetQuantity: 0 },
      { periodStart: new Date("2026-02-01T00:00:00.000Z"), periodEnd: new Date("2026-02-28T00:00:00.000Z"), targetQuantity: 0 },
    ];
    const asOf = new Date("2026-02-15T00:00:00.000Z");
    expect(expectedToDateWithSchedule(buckets, asOf, TZ)).toBe(0);
  });

  it("returns 0 when asOf is before the earliest bucket", () => {
    const bucket: PacingBucket = {
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-30T00:00:00.000Z"),
      targetQuantity: 200,
    };
    const asOf = new Date("2026-01-01T00:00:00.000Z");
    expect(expectedToDateWithSchedule([bucket], asOf, TZ)).toBe(0);
  });
});
