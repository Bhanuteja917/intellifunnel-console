import { describe, expect, it } from "vitest";
import { generateBuckets, validateBuckets } from "@/lib/channels/pacing-schedule";
import type { PacingBucket } from "@/lib/allocations/pacing";

describe("generateBuckets — month", () => {
  it("mid-month start, mid-month end spanning 3 months", () => {
    const channel = {
      startDate: new Date("2026-10-15T00:00:00.000Z"),
      endDate: new Date("2026-12-15T00:00:00.000Z"),
      contractedQuantity: 45,
    };
    const buckets = generateBuckets(channel, "month");

    expect(buckets).toHaveLength(3);
    // Oct 15–31 = 17 days, Nov 1–30 = 30 days, Dec 1–15 = 15 days = 62 total days
    // Quantities proportional by days; last bucket absorbs rounding
    expect(buckets[0]!.periodStart.toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(buckets[0]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(buckets[1]!.periodStart.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(buckets[1]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(buckets[2]!.periodStart.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(buckets[2]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-12-15");

    const total = buckets.reduce((s, b) => s + b.targetQuantity, 0);
    expect(total).toBe(45);
  });

  it("single-month flight produces one bucket", () => {
    const channel = {
      startDate: new Date("2026-11-10T00:00:00.000Z"),
      endDate: new Date("2026-11-25T00:00:00.000Z"),
      contractedQuantity: 30,
    };
    const buckets = generateBuckets(channel, "month");
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.periodStart.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(buckets[0]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-11-25");
    expect(buckets[0]!.targetQuantity).toBe(30);
  });

  it("full calendar months", () => {
    const channel = {
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-02-28T00:00:00.000Z"),
      contractedQuantity: 60,
    };
    const buckets = generateBuckets(channel, "month");
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.periodStart.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(buckets[0]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-01-31");
    expect(buckets[1]!.periodStart.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(buckets[1]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(buckets.reduce((s, b) => s + b.targetQuantity, 0)).toBe(60);
  });
});

describe("generateBuckets — week", () => {
  it("single-week flight produces one bucket", () => {
    // 2026-09-14 is a Monday; 2026-09-16 is a Wednesday
    const channel = {
      startDate: new Date("2026-09-14T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
      contractedQuantity: 10,
    };
    const buckets = generateBuckets(channel, "week");
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.periodStart.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(buckets[0]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-09-16");
    expect(buckets[0]!.targetQuantity).toBe(10);
  });

  it("flight spanning two ISO weeks", () => {
    // Wed Sep 16 to Thu Sep 24 2026 (crosses the Mon Sep 21 boundary)
    const channel = {
      startDate: new Date("2026-09-16T00:00:00.000Z"),
      endDate: new Date("2026-09-24T00:00:00.000Z"),
      contractedQuantity: 30,
    };
    const buckets = generateBuckets(channel, "week");
    expect(buckets).toHaveLength(2);
    // First bucket: Sep 16 (Wed) → Sep 20 (Sun)
    expect(buckets[0]!.periodStart.toISOString().slice(0, 10)).toBe("2026-09-16");
    expect(buckets[0]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-09-20");
    // Second bucket: Sep 21 (Mon) → Sep 24 (Thu, endDate)
    expect(buckets[1]!.periodStart.toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(buckets[1]!.periodEnd.toISOString().slice(0, 10)).toBe("2026-09-24");
    expect(buckets.reduce((s, b) => s + b.targetQuantity, 0)).toBe(30);
  });
});

describe("validateBuckets", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-01-31T00:00:00.000Z");
  const contractedQuantity = 100;

  it("returns null for a valid set of buckets", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-01-15T00:00:00.000Z"), targetQuantity: 50 },
      { periodStart: new Date("2026-01-16T00:00:00.000Z"), periodEnd: new Date("2026-01-31T00:00:00.000Z"), targetQuantity: 50 },
    ];
    expect(validateBuckets(buckets, contractedQuantity, start, end)).toBeNull();
  });

  it("fails when there is a gap between buckets", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-01-14T00:00:00.000Z"), targetQuantity: 50 },
      // Jan 15 is missing
      { periodStart: new Date("2026-01-16T00:00:00.000Z"), periodEnd: new Date("2026-01-31T00:00:00.000Z"), targetQuantity: 50 },
    ];
    expect(validateBuckets(buckets, contractedQuantity, start, end)).not.toBeNull();
  });

  it("fails when quantities don't sum to contractedQuantity", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-01-15T00:00:00.000Z"), targetQuantity: 40 },
      { periodStart: new Date("2026-01-16T00:00:00.000Z"), periodEnd: new Date("2026-01-31T00:00:00.000Z"), targetQuantity: 40 },
    ];
    expect(validateBuckets(buckets, contractedQuantity, start, end)).not.toBeNull();
  });

  it("fails when first bucket doesn't start on startDate", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-02T00:00:00.000Z"), periodEnd: new Date("2026-01-31T00:00:00.000Z"), targetQuantity: 100 },
    ];
    expect(validateBuckets(buckets, contractedQuantity, start, end)).not.toBeNull();
  });

  it("fails when last bucket doesn't end on endDate", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-01-30T00:00:00.000Z"), targetQuantity: 100 },
    ];
    expect(validateBuckets(buckets, contractedQuantity, start, end)).not.toBeNull();
  });

  it("fails on empty bucket list", () => {
    expect(validateBuckets([], contractedQuantity, start, end)).not.toBeNull();
  });

  it("allows zero targetQuantity on a bucket", () => {
    const buckets: PacingBucket[] = [
      { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-01-15T00:00:00.000Z"), targetQuantity: 0 },
      { periodStart: new Date("2026-01-16T00:00:00.000Z"), periodEnd: new Date("2026-01-31T00:00:00.000Z"), targetQuantity: 100 },
    ];
    expect(validateBuckets(buckets, contractedQuantity, start, end)).toBeNull();
  });
});
