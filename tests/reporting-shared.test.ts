import { describe, expect, it } from "vitest";
import { defaultDateRange, parseDateRangeParams } from "@/lib/reporting/shared";

describe("defaultDateRange", () => {
  it("returns a rolling 30-day window ending at the given instant", () => {
    const now = new Date("2026-09-06T12:00:00.000Z");
    const range = defaultDateRange(now);
    expect(range.to).toEqual(now);
    expect(range.from).toEqual(new Date("2026-08-07T12:00:00.000Z"));
  });

  it("defaults to the current instant when no argument is given", () => {
    const before = Date.now();
    const range = defaultDateRange();
    const after = Date.now();
    expect(range.to.getTime()).toBeGreaterThanOrEqual(before);
    expect(range.to.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("parseDateRangeParams", () => {
  const fallback = defaultDateRange(new Date("2026-09-06T12:00:00.000Z"));

  it("widens a bare `to` date to the end of that day so the day is included", () => {
    const range = parseDateRangeParams({ from: "2026-08-01", to: "2026-09-06" }, fallback);
    expect(range.to).toEqual(new Date("2026-09-06T23:59:59.999Z"));
    // A lead created at any instant on the end day is inside `lte: range.to`.
    expect(new Date("2026-09-06T18:30:00.000Z").getTime()).toBeLessThanOrEqual(range.to.getTime());
  });

  it("parses `from` as start-of-day, unchanged", () => {
    const range = parseDateRangeParams({ from: "2026-08-01", to: "2026-09-06" }, fallback);
    expect(range.from).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("falls back to the default range for a malformed date on either end", () => {
    const range = parseDateRangeParams({ from: "not-a-date", to: "2026-13-45" }, fallback);
    expect(range.from).toEqual(fallback.from);
    expect(range.to).toEqual(fallback.to);
  });

  it("falls back to the default range when a param is absent", () => {
    const range = parseDateRangeParams({}, fallback);
    expect(range).toEqual(fallback);
  });

  it("honours a full ISO timestamp on `to` without widening it", () => {
    const range = parseDateRangeParams({ to: "2026-09-06T08:00:00.000Z" }, fallback);
    expect(range.to).toEqual(new Date("2026-09-06T08:00:00.000Z"));
  });
});
