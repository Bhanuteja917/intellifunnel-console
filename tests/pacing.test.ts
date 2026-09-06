import { describe, expect, it } from "vitest";
import { expectedToDate, paceSignal } from "@/lib/allocations/pacing";

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
