import type {
  ChannelSetupRequirement,
  ChannelSetupStepKey,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { catalogEntry, type ChannelFacts } from "@/lib/channels/step-catalog";

type Db = PrismaClient | Prisma.TransactionClient;

export type ChannelStep = {
  key: ChannelSetupStepKey;
  title: string;
  hint: string;
  cta: string;
  href: string;
  requirement: ChannelSetupRequirement;
  locked: boolean;
  done: boolean;
};

export type ChannelReadiness = {
  steps: ChannelStep[];
  requiredDoneCount: number;
  requiredTotalCount: number;
};

type StepRow = {
  stepKey: ChannelSetupStepKey;
  requirement: ChannelSetupRequirement;
  sortOrder: number;
};

export function computeChannelReadiness(
  rows: StepRow[],
  facts: ChannelFacts,
  ids: { campaignId: string; channelId: string },
): ChannelReadiness {
  const steps = rows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((row): ChannelStep[] => {
      const entry = catalogEntry(row.stepKey);
      // A row whose catalog entry was retired must not break the page render.
      if (entry === undefined) return [];
      return [{
        key: entry.key,
        title: entry.title,
        hint: entry.hint,
        cta: entry.cta,
        href: entry.href(ids.campaignId, ids.channelId),
        requirement: row.requirement,
        locked: entry.locked,
        done: entry.isDone(facts),
      }];
    });

  const required = steps.filter((s) => s.requirement === "required");
  return {
    steps,
    requiredDoneCount: required.filter((s) => s.done).length,
    requiredTotalCount: required.length,
  };
}

export async function loadChannelFacts(db: Db, campaignChannelId: string): Promise<ChannelFacts> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: campaignChannelId },
    select: { contractedQuantity: true, clientUnitPriceMinor: true },
  });

  const [icpCount, emailSpec, activePlacementCount] = await Promise.all([
    db.icpCriterion.count({ where: { campaignChannelId } }),
    db.leadFieldSpec.findFirst({ where: { campaignChannelId, fieldKey: "email" }, select: { id: true } }),
    db.assetPlacement.count({ where: { campaignChannelId, status: "active" } }),
  ]);

  return {
    hasTerms: channel.contractedQuantity > 0 && channel.clientUnitPriceMinor > 0n,
    icpCount,
    hasEmailSpec: emailSpec !== null,
    activePlacementCount,
  };
}

export async function loadChannelReadiness(
  db: Db,
  campaignChannelId: string,
): Promise<ChannelReadiness> {
  const [channel, rows, facts] = await Promise.all([
    db.campaignChannel.findUniqueOrThrow({
      where: { id: campaignChannelId },
      select: { campaignId: true },
    }),
    db.channelSetupStep.findMany({
      where: { campaignChannelId },
      select: { stepKey: true, requirement: true, sortOrder: true },
    }),
    loadChannelFacts(db, campaignChannelId),
  ]);

  return computeChannelReadiness(rows, facts, {
    campaignId: channel.campaignId,
    channelId: campaignChannelId,
  });
}
