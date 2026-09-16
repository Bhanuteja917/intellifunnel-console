import { describe, expect, it } from "vitest";
import { STEP_CATALOG, catalogEntry, seedPlan } from "@/lib/channels/step-catalog";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

const definition = (overrides: Partial<ChannelTypeDefinition> = {}): ChannelTypeDefinition => ({
  channelTypeId: "ct1",
  code: "CT",
  name: "Test Channel",
  funnelStageCode: "MOFU",
  producesLeads: true,
  requiresAsset: true,
  metricMode: "none",
  allowedMetricFields: [],
  pricingUnit: "CPL",
  requiresTeleVerification: false,
  verificationSlaBusinessDays: null,
  qualificationFormId: null,
  questions: [],
  ...overrides,
});

const facts = {
  hasTerms: false,
  icpCount: 0,
  hasEmailSpec: false,
  activePlacementCount: 0,
  allocationCount: 0,
};

describe("STEP_CATALOG", () => {
  it("locks channelTerms and nothing else", () => {
    expect(STEP_CATALOG.filter((e) => e.locked).map((e) => e.key)).toEqual(["channelTerms"]);
  });

  it("marks the two deferred list steps unavailable", () => {
    expect(STEP_CATALOG.filter((e) => !e.available).map((e) => e.key)).toEqual([
      "targetAccountList",
      "suppressionList",
    ]);
  });

  it("gives every entry a unique key", () => {
    expect(new Set(STEP_CATALOG.map((e) => e.key)).size).toBe(STEP_CATALOG.length);
  });
});

describe("seedPlan", () => {
  it("seeds terms, icp, lead spec, placement and allocations for a lead channel with an asset", () => {
    expect(seedPlan(definition())).toEqual([
      { stepKey: "channelTerms", requirement: "required", sortOrder: 0 },
      { stepKey: "icp", requirement: "required", sortOrder: 1 },
      { stepKey: "leadSpec", requirement: "required", sortOrder: 2 },
      { stepKey: "placement", requirement: "required", sortOrder: 3 },
      { stepKey: "allocations", requirement: "optional", sortOrder: 4 },
    ]);
  });

  it("seeds no icp or lead spec for an impression-only channel", () => {
    const plan = seedPlan(definition({ producesLeads: false, requiresAsset: false }));
    expect(plan.map((s) => s.stepKey)).toEqual(["channelTerms", "allocations"]);
  });

  it("seeds no placement when the channel type needs no asset", () => {
    const plan = seedPlan(definition({ requiresAsset: false }));
    expect(plan.map((s) => s.stepKey)).not.toContain("placement");
  });

  it("never seeds a deferred step", () => {
    const plan = seedPlan(definition());
    expect(plan.map((s) => s.stepKey)).not.toContain("targetAccountList");
    expect(plan.map((s) => s.stepKey)).not.toContain("suppressionList");
  });
});

describe("applies", () => {
  it("offers icp on an impression-only channel but not leadSpec", () => {
    const def = definition({ producesLeads: false });
    expect(catalogEntry("icp")?.applies(def)).toBe(true);
    expect(catalogEntry("leadSpec")?.applies(def)).toBe(false);
  });

  it("offers placement only when the channel type needs an asset", () => {
    expect(catalogEntry("placement")?.applies(definition({ requiresAsset: false }))).toBe(false);
    expect(catalogEntry("placement")?.applies(definition())).toBe(true);
  });
});

describe("isDone", () => {
  it("completes channelTerms once the channel has quantity and a price", () => {
    expect(catalogEntry("channelTerms")?.isDone({ ...facts, hasTerms: true })).toBe(true);
    expect(catalogEntry("channelTerms")?.isDone(facts)).toBe(false);
  });

  it("completes icp on the first criterion", () => {
    expect(catalogEntry("icp")?.isDone({ ...facts, icpCount: 1 })).toBe(true);
  });

  it("completes leadSpec only when an email field exists", () => {
    expect(catalogEntry("leadSpec")?.isDone({ ...facts, hasEmailSpec: true })).toBe(true);
    expect(catalogEntry("leadSpec")?.isDone(facts)).toBe(false);
  });

  it("completes placement on the first active placement", () => {
    expect(catalogEntry("placement")?.isDone({ ...facts, activePlacementCount: 1 })).toBe(true);
  });

  it("completes allocations on the first allocation", () => {
    expect(catalogEntry("allocations")?.isDone({ ...facts, allocationCount: 1 })).toBe(true);
  });

  it("never completes a deferred step", () => {
    expect(catalogEntry("suppressionList")?.isDone({ ...facts, icpCount: 9 })).toBe(false);
  });
});

describe("href", () => {
  it("points placement at the placements tab, not the singular step key", () => {
    expect(catalogEntry("placement")?.href("cam1", "ch1")).toBe(
      "/campaigns/cam1/channels/ch1?tab=placements",
    );
  });

  it("points icp and lead spec at the terms tab where their editors live", () => {
    expect(catalogEntry("icp")?.href("cam1", "ch1")).toBe("/campaigns/cam1/channels/ch1?tab=terms");
    expect(catalogEntry("leadSpec")?.href("cam1", "ch1")).toBe(
      "/campaigns/cam1/channels/ch1?tab=terms",
    );
  });
});
