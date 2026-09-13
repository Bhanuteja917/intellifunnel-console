import { describe, expect, it } from "vitest";
import { computeRetentionDeadline } from "@/lib/compliance/retention";

describe("computeRetentionDeadline", () => {
  it("returns null for a contact with no leads", () => {
    expect(computeRetentionDeadline([])).toBeNull();
  });

  it("returns null when any lead has never been accepted", () => {
    expect(computeRetentionDeadline([{ acceptedAt: null, retentionMonths: 12 }])).toBeNull();
    expect(computeRetentionDeadline([
      { acceptedAt: new Date("2026-01-01"), retentionMonths: 12 },
      { acceptedAt: null, retentionMonths: 12 },
    ])).toBeNull();
  });

  it("adds retentionMonths to a single lead's acceptedAt", () => {
    const deadline = computeRetentionDeadline([{ acceptedAt: new Date("2025-01-15T00:00:00Z"), retentionMonths: 12 }]);
    expect(deadline?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("takes the max (latest) deadline across multiple leads under different retention windows", () => {
    const deadline = computeRetentionDeadline([
      { acceptedAt: new Date("2025-01-01T00:00:00Z"), retentionMonths: 12 }, // -> 2026-01-01
      { acceptedAt: new Date("2025-06-01T00:00:00Z"), retentionMonths: 24 }, // -> 2027-06-01, the later one
    ]);
    expect(deadline?.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });
});
