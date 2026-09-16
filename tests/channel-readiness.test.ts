import { describe, expect, it } from "vitest";
import { computeChannelReadiness } from "@/lib/channels/readiness";
import type { ChannelFacts } from "@/lib/channels/step-catalog";

const ids = { campaignId: "cam1", channelId: "ch1" };

const facts = (overrides: Partial<ChannelFacts> = {}): ChannelFacts => ({
  hasTerms: true,
  icpCount: 0,
  hasEmailSpec: false,
  activePlacementCount: 0,
  ...overrides,
});

const row = (stepKey: string, requirement: "required" | "optional", sortOrder: number) =>
  ({ stepKey, requirement, sortOrder }) as never;

describe("computeChannelReadiness", () => {
  it("returns an empty checklist when the channel has no rows", () => {
    const result = computeChannelReadiness([], facts(), ids);
    expect(result.steps).toEqual([]);
    expect(result.requiredTotalCount).toBe(0);
    expect(result.requiredDoneCount).toBe(0);
  });

  it("orders steps by sortOrder, not insertion order", () => {
    const result = computeChannelReadiness(
      [row("placement", "required", 3), row("channelTerms", "required", 0)],
      facts(),
      ids,
    );
    expect(result.steps.map((s) => s.key)).toEqual(["channelTerms", "placement"]);
  });

  it("resolves done from the facts bag", () => {
    const result = computeChannelReadiness(
      [row("icp", "required", 1)],
      facts({ icpCount: 2 }),
      ids,
    );
    expect(result.steps[0]?.done).toBe(true);
  });

  it("counts only required steps in the progress counters", () => {
    const result = computeChannelReadiness(
      [row("channelTerms", "required", 0), row("placement", "optional", 3)],
      facts({ hasTerms: true }),
      ids,
    );
    expect(result.requiredTotalCount).toBe(1);
    expect(result.requiredDoneCount).toBe(1);
  });

  it("carries locked through from the catalog", () => {
    const result = computeChannelReadiness([row("channelTerms", "required", 0)], facts(), ids);
    expect(result.steps[0]?.locked).toBe(true);
  });

  it("builds a working href for each step", () => {
    const result = computeChannelReadiness([row("placement", "required", 3)], facts(), ids);
    expect(result.steps[0]?.href).toBe("/campaigns/cam1/channels/ch1?tab=placements");
  });

  it("ignores a row whose key has no catalog entry", () => {
    const result = computeChannelReadiness(
      [row("channelTerms", "required", 0), row("retiredStep", "required", 9)],
      facts(),
      ids,
    );
    expect(result.steps.map((s) => s.key)).toEqual(["channelTerms"]);
  });
});
