import type { Prisma, PrismaClient } from "@prisma/client";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { getChannelTermsApprovalStatus, type ApprovalStatus } from "@/lib/approvals/status";

type Db = PrismaClient | Prisma.TransactionClient;

export type StepOwner = "client" | "agency" | "done";
export type ChannelStepId = "terms" | "placement" | "allocations" | "delivery";
export type ChannelTab = "terms" | "placements" | "allocations" | "delivery";

export type ChannelStep = {
  id: ChannelStepId;
  title: string;
  hint: string;
  cta: string;
  tab: ChannelTab;
  required: boolean;
  done: boolean;
  owner: StepOwner;
};

export type ChannelReadiness = {
  steps: ChannelStep[];
  ready: boolean;
  requiredDone: number;
  requiredTotal: number;
};

export type ReadinessInput = {
  definition: Partial<ChannelTypeDefinition>;
  termsStatus: ApprovalStatus;
  activePlacementCount: number;
  allocationCount: number;
  hasDeliveryConfig: boolean;
};

/**
 * The single source of truth for "is this channel set up". Every surface that
 * renders or gates on setup state calls this — the admin checklist, the channel
 * activation guard, the campaign channels table, and the client portal's
 * checklist mirror — so they cannot disagree with each other.
 *
 * Pure, so the whole matrix is unit-testable; callers do their own counting.
 */
export function computeChannelReadiness(input: ReadinessInput): ChannelReadiness {
  const termsDone = input.termsStatus === "approved";
  const placementDone = input.activePlacementCount > 0;
  const allocationsDone = input.allocationCount > 0;

  const steps: ChannelStep[] = [
    {
      id: "terms",
      title: "Channel terms",
      hint: "Volume, unit price and flight window, approved by the client",
      cta: "Review",
      tab: "terms",
      required: true,
      done: termsDone,
      owner: termsDone ? "done" : "client",
    },
  ];

  // requiresAsset is the frozen channel-type flag: a channel type with no
  // asset has no collection point to configure, so the step does not exist for
  // it rather than sitting permanently incomplete.
  if (input.definition.requiresAsset === true) {
    steps.push({
      id: "placement",
      title: "Add a placement",
      hint: "Asset version, landing page, form slug, consent text",
      cta: "Add",
      tab: "placements",
      required: true,
      done: placementDone,
      owner: placementDone ? "done" : "agency",
    });
  }

  // Neither of these blocks a channel: a campaign can be run in-house with no
  // partner allocation at all, and delivery can be configured at any point,
  // including after the channel is already collecting leads.
  steps.push(
    {
      id: "allocations",
      title: "Allocate partner quota",
      hint: "Optional — leave the quota unallocated to run this channel in-house",
      cta: "Allocate",
      tab: "allocations",
      required: false,
      done: allocationsDone,
      owner: allocationsDone ? "done" : "agency",
    },
    {
      id: "delivery",
      title: "Configure delivery",
      hint: "Optional — can be configured at any time, including after launch",
      cta: "Configure",
      tab: "delivery",
      required: false,
      done: input.hasDeliveryConfig,
      owner: input.hasDeliveryConfig ? "done" : "agency",
    },
  );

  const required = steps.filter((s) => s.required);
  const requiredDone = required.filter((s) => s.done).length;

  return {
    steps,
    ready: requiredDone === required.length,
    requiredDone,
    requiredTotal: required.length,
  };
}

/**
 * Convenience loader for callers that hold a channel id. Runs no permission
 * check of its own — every caller has already asserted access to the campaign
 * the channel belongs to. Queries are sequential so this is safe to call with
 * an interactive transaction client.
 */
export async function loadChannelReadiness(
  db: Db,
  campaignChannelId: string,
): Promise<ChannelReadiness> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: campaignChannelId },
    include: { channelTypeVersion: { select: { definitionJson: true } } },
  });

  const termsStatus = await getChannelTermsApprovalStatus(db, channel);
  const activePlacementCount = await db.assetPlacement.count({
    where: { campaignChannelId, status: "active" },
  });
  const allocationCount = await db.partnerAllocation.count({ where: { campaignChannelId } });
  const deliveryConfig = await db.deliveryConfig.findUnique({
    where: { campaignChannelId },
    select: { id: true },
  });

  return computeChannelReadiness({
    definition: (channel.channelTypeVersion.definitionJson ?? {}) as Partial<ChannelTypeDefinition>,
    termsStatus,
    activePlacementCount,
    allocationCount,
    hasDeliveryConfig: deliveryConfig !== null,
  });
}
