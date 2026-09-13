import { describe, expect, it } from "vitest";
import { cronMatchesInstant, isCsvRunDue } from "@/lib/delivery/cron";

describe("cronMatchesInstant", () => {
  it("matches a daily 6am IST schedule at 6:00am IST and not at 6:01am or 7am", () => {
    // 2026-01-05T00:30:00Z is 06:00 IST (UTC+5:30)
    expect(cronMatchesInstant("0 6 * * *", new Date("2026-01-05T00:30:00.000Z"), "Asia/Kolkata")).toBe(true);
    expect(cronMatchesInstant("0 6 * * *", new Date("2026-01-05T00:31:00.000Z"), "Asia/Kolkata")).toBe(false);
    expect(cronMatchesInstant("0 6 * * *", new Date("2026-01-05T01:30:00.000Z"), "Asia/Kolkata")).toBe(false);
  });

  it("matches a comma-list of hours", () => {
    expect(cronMatchesInstant("0 6,18 * * *", new Date("2026-01-05T12:30:00.000Z"), "Asia/Kolkata")).toBe(true); // 18:00 IST
    expect(cronMatchesInstant("0 6,18 * * *", new Date("2026-01-05T09:30:00.000Z"), "Asia/Kolkata")).toBe(false); // 15:00 IST
  });

  it("rejects a malformed expression", () => {
    expect(() => cronMatchesInstant("0 6 *", new Date(), "Asia/Kolkata")).toThrow();
  });
});

describe("isCsvRunDue", () => {
  const tz = "Asia/Kolkata";

  it("is due on first-ever check (no prior run)", () => {
    expect(isCsvRunDue("0 6 * * *", null, new Date("2026-01-05T00:30:00.000Z"), tz)).toBe(true);
  });

  it("is not due again within the same minute as the last run", () => {
    const now = new Date("2026-01-05T00:30:00.000Z");
    expect(isCsvRunDue("0 6 * * *", new Date("2026-01-05T00:30:00.000Z"), now, tz)).toBe(false);
  });

  it("is due again a day later at the scheduled minute", () => {
    const lastRunAt = new Date("2026-01-05T00:30:00.000Z"); // 6am IST day 1
    const now = new Date("2026-01-06T00:30:00.000Z"); // 6am IST day 2
    expect(isCsvRunDue("0 6 * * *", lastRunAt, now, tz)).toBe(true);
  });

  it("is not due at an off-schedule minute even with an old last run", () => {
    const lastRunAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-06T05:00:00.000Z"); // 10:30am IST — not 6am
    expect(isCsvRunDue("0 6 * * *", lastRunAt, now, tz)).toBe(false);
  });
});
