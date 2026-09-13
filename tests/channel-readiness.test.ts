import { describe, expect, it } from "vitest";
import { computeChannelReadiness } from "@/lib/channels/readiness";

const base = { activePlacementCount: 0, allocationCount: 0, requiresAsset: true };

describe("computeChannelReadiness — stepConfig overrides", () => {
  it("includes all steps with required=true by default when no stepConfig", () => {
    const result = computeChannelReadiness(base);
    expect(result.steps.map((s) => s.id)).toEqual(["placement", "allocations"]);
    expect(result.steps.find((s) => s.id === "placement")?.required).toBe(false); // placement default is not required
    expect(result.steps.find((s) => s.id === "allocations")?.required).toBe(false); // allocations default is not required
    expect(result.totalCount).toBe(2);
  });

  it("omits placement step when requiresAsset is false", () => {
    const result = computeChannelReadiness({ ...base, requiresAsset: false });
    expect(result.steps.map((s) => s.id)).toEqual(["allocations"]);
    expect(result.totalCount).toBe(1);
  });

  it("marks placement as required when stepConfig enables it", () => {
    const result = computeChannelReadiness({
      ...base,
      stepConfig: { placement: "enabled" },
    });
    const placementStep = result.steps.find((s) => s.id === "placement");
    expect(placementStep?.required).toBe(true);
  });

  it("marks allocations as optional when stepConfig says optional", () => {
    const result = computeChannelReadiness({
      ...base,
      stepConfig: { allocations: "optional" },
    });
    const allocStep = result.steps.find((s) => s.id === "allocations");
    expect(allocStep?.required).toBe(false);
  });

  it("omits placement step when stepConfig skips it", () => {
    const result = computeChannelReadiness({
      ...base,
      stepConfig: { placement: "skipped" },
    });
    expect(result.steps.map((s) => s.id)).not.toContain("placement");
    expect(result.totalCount).toBe(1);
  });

  it("omits both steps when both skipped", () => {
    const result = computeChannelReadiness({
      ...base,
      stepConfig: { placement: "skipped", allocations: "skipped" },
    });
    expect(result.steps).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.doneCount).toBe(0);
  });

  it("counts doneCount correctly with mixed config", () => {
    const result = computeChannelReadiness({
      activePlacementCount: 1,
      allocationCount: 0,
      requiresAsset: true,
      stepConfig: { placement: "enabled", allocations: "optional" },
    });
    expect(result.doneCount).toBe(1); // placement done
    expect(result.totalCount).toBe(2); // both shown
  });
});
