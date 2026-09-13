import type { PrismaClient, Prisma } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type ChannelStepId = "placement" | "allocations";
export type StepOverride = "enabled" | "optional" | "skipped";
export type StepConfig = Partial<Record<ChannelStepId, StepOverride>>;

export type ChannelStep = {
  id: ChannelStepId;
  title: string;
  hint: string;
  cta: string;
  done: boolean;
  required: boolean;
};

export type ChannelReadiness = {
  steps: ChannelStep[];
  doneCount: number;
  totalCount: number;
};

export function computeChannelReadiness(input: {
  activePlacementCount: number;
  allocationCount: number;
  requiresAsset: boolean;
  stepConfig?: StepConfig;
}): ChannelReadiness {
  const { stepConfig = {} } = input;
  const steps: ChannelStep[] = [];

  if (input.requiresAsset && stepConfig.placement !== "skipped") {
    steps.push({
      id: "placement",
      title: "Add a placement",
      hint: "Asset version, landing page, form slug, consent text",
      cta: "Add placement",
      done: input.activePlacementCount > 0,
      required: stepConfig.placement === "enabled",
    });
  }

  if (stepConfig.allocations !== "skipped") {
    steps.push({
      id: "allocations",
      title: "Allocate partner quota",
      hint: "Leave unallocated to run this channel in-house",
      cta: "Allocate",
      done: input.allocationCount > 0,
      required: stepConfig.allocations === "enabled",
    });
  }

  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, totalCount: steps.length };
}

export async function loadChannelReadiness(db: Db, campaignChannelId: string): Promise<ChannelReadiness> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: campaignChannelId },
    include: { channelTypeVersion: { select: { definitionJson: true } } },
  });

  const [activePlacementCount, allocationCount] = await Promise.all([
    db.assetPlacement.count({ where: { campaignChannelId, status: "active" } }),
    db.partnerAllocation.count({ where: { campaignChannelId } }),
  ]);

  const def = (channel.channelTypeVersion.definitionJson ?? {}) as { requiresAsset?: boolean };
  const stepConfig = (channel.stepConfigJson ?? {}) as StepConfig;

  return computeChannelReadiness({
    activePlacementCount,
    allocationCount,
    requiresAsset: def.requiresAsset === true,
    stepConfig,
  });
}
