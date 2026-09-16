import type { ChannelSetupStepKey, ChannelSetupRequirement } from "@prisma/client";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

export type { ChannelSetupStepKey, ChannelSetupRequirement };

export type ChannelFacts = {
  hasTerms: boolean;
  icpCount: number;
  hasEmailSpec: boolean;
  activePlacementCount: number;
  allocationCount: number;
};

export type CatalogEntry = {
  key: ChannelSetupStepKey;
  title: string;
  hint: string;
  cta: string;
  href: (campaignId: string, channelId: string) => string;
  locked: boolean;
  available: boolean;
  applies: (def: ChannelTypeDefinition) => boolean;
  seedDefault: (def: ChannelTypeDefinition) => ChannelSetupRequirement | null;
  isDone: (facts: ChannelFacts) => boolean;
};

const tab = (name: string) => (campaignId: string, channelId: string) =>
  `/campaigns/${campaignId}/channels/${channelId}?tab=${name}`;

export const STEP_CATALOG: readonly CatalogEntry[] = [
  {
    key: "channelTerms",
    title: "Set channel terms",
    hint: "Contracted quantity, unit price, flight window",
    cta: "Edit terms",
    href: tab("terms"),
    locked: true,
    available: true,
    applies: () => true,
    seedDefault: () => "required",
    isDone: (f) => f.hasTerms,
  },
  {
    key: "icp",
    title: "Define the ICP",
    hint: "Criteria a lead's account must match",
    cta: "Edit ICP",
    href: tab("terms"),
    locked: false,
    available: true,
    applies: () => true,
    seedDefault: (def) => (def.producesLeads ? "required" : null),
    isDone: (f) => f.icpCount > 0,
  },
  {
    key: "leadSpec",
    title: "Define the lead spec",
    hint: "Fields every delivered lead must carry, including email",
    cta: "Edit lead spec",
    href: tab("terms"),
    locked: false,
    available: true,
    applies: (def) => def.producesLeads,
    seedDefault: (def) => (def.producesLeads ? "required" : null),
    isDone: (f) => f.hasEmailSpec,
  },
  {
    key: "placement",
    title: "Add a placement",
    hint: "Asset version, landing page, form slug, consent text",
    cta: "Add placement",
    href: tab("placements"),
    locked: false,
    available: true,
    applies: (def) => def.requiresAsset,
    seedDefault: (def) => (def.requiresAsset ? "required" : null),
    isDone: (f) => f.activePlacementCount > 0,
  },
  {
    key: "allocations",
    title: "Allocate partner quota",
    hint: "Leave unallocated to run this channel in-house",
    cta: "Allocate",
    href: tab("allocations"),
    locked: false,
    available: true,
    applies: () => true,
    seedDefault: () => "optional",
    isDone: (f) => f.allocationCount > 0,
  },
  {
    key: "targetAccountList",
    title: "Attach a target account list",
    hint: "Accounts this channel may deliver against",
    cta: "Attach list",
    href: tab("terms"),
    locked: false,
    available: false,
    applies: () => true,
    seedDefault: () => null,
    isDone: () => false,
  },
  {
    key: "suppressionList",
    title: "Attach a suppression list",
    hint: "Accounts, domains and contacts this channel must never deliver",
    cta: "Attach list",
    href: tab("terms"),
    locked: false,
    available: false,
    applies: () => true,
    seedDefault: () => null,
    isDone: () => false,
  },
];

export function catalogEntry(key: ChannelSetupStepKey): CatalogEntry | undefined {
  return STEP_CATALOG.find((e) => e.key === key);
}

export type SeededStep = {
  stepKey: ChannelSetupStepKey;
  requirement: ChannelSetupRequirement;
  sortOrder: number;
};

export function seedPlan(def: ChannelTypeDefinition): SeededStep[] {
  return STEP_CATALOG.flatMap((entry, index) => {
    if (!entry.available || !entry.applies(def)) return [];
    const requirement = entry.seedDefault(def);
    if (requirement === null) return [];
    return [{ stepKey: entry.key, requirement, sortOrder: index }];
  });
}
