import type {
  ChannelType,
  ChannelTypeVersion,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { NotFoundError } from "@/lib/errors";

export const SNAPSHOT_VERSION = 1;

/** Same shape as the `Db` unions in settings.ts and account-resolution.ts. */
type Db = PrismaClient | Prisma.TransactionClient;

export type CampaignConfigSnapshot = {
  snapshotVersion: number;
  campaignId: string;
  code: string;
  name: string;
  clientOrganizationId: string;
  startDate: string;
  endDate: string;
  currency: string;
  defaultMaxLeadsPerAccount: number | null;
  advisoryTalMatch: boolean;
  advisoryIcpMatch: boolean;
  icpCriteria: Array<{
    dimension: string;
    operator: string;
    values: unknown;
    isMandatory: boolean;
  }>;
  leadFieldSpecs: Array<{
    fieldKey: string;
    label: string;
    dataType: string;
    isRequired: boolean;
    rejectIfMissing: boolean;
    allowedValues: unknown;
    validationPattern: string | null;
  }>;
  channels: Array<{
    campaignChannelId: string;
    channelTypeVersionId: string;
    channelTypeCode: string;
    channelTypeVersion: number;
    contractedQuantity: number;
    clientUnitPriceMinor: string;
    costBudgetMinor: string | null;
    currency: string;
    startDate: string;
    endDate: string;
    definition: unknown;
    stepConfig: unknown;
  }>;
  targetAccountListIds: string[];
  suppressionListIds: string[];
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * FR-CS-1: the snapshot is the whole approved configuration, including the
 * frozen channel type definitions, so nothing edited later can change what a
 * client agreed to.
 *
 * Takes a transaction client so the approval that freezes it and the reads
 * that build it see the same database state: built outside the transaction,
 * a config write landing in the gap is invisible to the snapshot but visible
 * on the live campaign, which is exactly what the snapshot exists to prevent.
 */
export async function buildConfigSnapshot(
  db: Db,
  campaignId: string,
): Promise<CampaignConfigSnapshot> {
  // Every read below is awaited one at a time, and the relations are fetched
  // as separate queries rather than through `include`. Both are required by
  // the transaction client this now runs on: it holds a single connection, and
  // issuing two queries on it at once (which Prisma's own include fan-out and
  // any Promise.all would both do) makes pg warn today and will make it throw
  // from pg@9.
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null) throw new NotFoundError("Campaign not found");

  const icpCriteria = await db.icpCriterion.findMany({ where: { campaignId } });
  const leadFieldSpecs = await db.leadFieldSpec.findMany({ where: { campaignId } });

  const channelRows = await db.campaignChannel.findMany({ where: { campaignId } });
  const channels: Array<{
    channel: (typeof channelRows)[number];
    version: ChannelTypeVersion;
    channelType: ChannelType;
  }> = [];
  for (const channel of channelRows) {
    const version = await db.channelTypeVersion.findUniqueOrThrow({
      where: { id: channel.channelTypeVersionId },
    });
    const channelType = await db.channelType.findUniqueOrThrow({
      where: { id: version.channelTypeId },
    });
    channels.push({ channel, version, channelType });
  }

  const talLinks = await db.campaignTargetAccountList.findMany({
    where: { campaignId },
    select: { listId: true },
  });
  const suppressionLinks = await db.campaignSuppressionList.findMany({
    where: { campaignId },
    select: { listId: true },
  });

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    campaignId: campaign.id,
    code: campaign.code,
    name: campaign.name,
    clientOrganizationId: campaign.clientOrganizationId,
    startDate: isoDate(campaign.startDate),
    endDate: isoDate(campaign.endDate),
    currency: campaign.currency,
    defaultMaxLeadsPerAccount: campaign.defaultMaxLeadsPerAccount,
    advisoryTalMatch: campaign.advisoryTalMatch,
    advisoryIcpMatch: campaign.advisoryIcpMatch,
    icpCriteria: icpCriteria.map((c) => ({
      dimension: c.dimension,
      operator: c.operator,
      values: c.valuesJson,
      isMandatory: c.isMandatory,
    })),
    leadFieldSpecs: leadFieldSpecs.map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      dataType: f.dataType,
      isRequired: f.isRequired,
      rejectIfMissing: f.rejectIfMissing,
      allowedValues: f.allowedValuesJson,
      validationPattern: f.validationPattern,
    })),
    channels: channels.map(({ channel, version, channelType }) => ({
      campaignChannelId: channel.id,
      channelTypeVersionId: channel.channelTypeVersionId,
      channelTypeCode: channelType.code,
      channelTypeVersion: version.version,
      contractedQuantity: channel.contractedQuantity,
      // BigInt does not serialise to JSON; the minor-unit value is frozen as a string.
      clientUnitPriceMinor: channel.clientUnitPriceMinor.toString(),
      costBudgetMinor: channel.costBudgetMinor === null ? null : channel.costBudgetMinor.toString(),
      currency: channel.currency,
      startDate: isoDate(channel.startDate),
      endDate: isoDate(channel.endDate),
      definition: version.definitionJson,
      stepConfig: channel.stepConfigJson ?? null,
    })),
    targetAccountListIds: talLinks.map((l) => l.listId),
    suppressionListIds: suppressionLinks.map((l) => l.listId),
  };
}
