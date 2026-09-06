import { describe, expect, it } from "vitest";
import { defaultDateRange } from "@/lib/reporting/shared";

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
