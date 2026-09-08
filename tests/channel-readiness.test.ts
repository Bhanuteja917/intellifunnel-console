import { describe, expect, it } from "vitest";
import { computeChannelReadiness } from "@/lib/channels/readiness";

const base = {
  definition: { requiresAsset: true },
  termsStatus: "approved" as const,
  activePlacementCount: 1,
  allocationCount: 0,
  hasDeliveryConfig: false,
};

describe("computeChannelReadiness", () => {
  it("is ready with approved terms and a live placement, ignoring allocations and delivery", () => {
    const result = computeChannelReadiness(base);
    expect(result.ready).toBe(true);
    expect(result.requiredTotal).toBe(2);
    expect(result.requiredDone).toBe(2);
  });

  it("drops the placement step for a channel type that needs no asset", () => {
    const result = computeChannelReadiness({
      ...base,
      definition: { requiresAsset: false },
      activePlacementCount: 0,
    });
    expect(result.steps.map((s) => s.id)).toEqual(["terms", "allocations", "delivery"]);
    expect(result.requiredTotal).toBe(1);
    expect(result.ready).toBe(true);
  });

  it("is not ready while terms are unapproved", () => {
    for (const termsStatus of ["pending", "changesRequested", "reapprovalNeeded"] as const) {
      const result = computeChannelReadiness({ ...base, termsStatus });
      expect(result.ready, termsStatus).toBe(false);
    }
  });

  it("is not ready when an asset-bearing channel has no live placement", () => {
    expect(computeChannelReadiness({ ...base, activePlacementCount: 0 }).ready).toBe(false);
  });

  it("marks allocations and delivery optional and never counts them as required", () => {
    const result = computeChannelReadiness({ ...base, allocationCount: 3, hasDeliveryConfig: true });
    const optional = result.steps.filter((s) => !s.required).map((s) => s.id);
    expect(optional).toEqual(["allocations", "delivery"]);
    expect(result.requiredTotal).toBe(2);
  });

  it("attributes the terms step to the client and the rest to the agency", () => {
    const result = computeChannelReadiness({ ...base, termsStatus: "pending" });
    expect(result.steps.find((s) => s.id === "terms")?.owner).toBe("client");
    expect(result.steps.find((s) => s.id === "delivery")?.owner).toBe("agency");
  });

  it("marks a completed step's owner as done", () => {
    const result = computeChannelReadiness(base);
    expect(result.steps.find((s) => s.id === "terms")?.owner).toBe("done");
  });
});
