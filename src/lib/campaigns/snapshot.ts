import type { PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";

export const SNAPSHOT_VERSION = 1;

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
  }>;
  targetAccountListIds: string[];
  suppressionListIds: string[];
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * FR-CS-1: the snapshot is the whole approved configuration, including the
 * frozen channel type definitions, so nothing edited later can change what a
 * client agreed to.
 */
export async function buildConfigSnapshot(
  db: PrismaClient,
  campaignId: string,
): Promise<CampaignConfigSnapshot> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      icpCriteria: true,
      leadFieldSpecs: true,
      channels: { include: { channelTypeVersion: { include: { channelType: true } } } },
    },
  });
  if (campaign === null) throw new NotFoundError("Campaign not found");

  const [talLinks, suppressionLinks] = await Promise.all([
    db.campaignTargetAccountList.findMany({ where: { campaignId }, select: { listId: true } }),
    db.campaignSuppressionList.findMany({ where: { campaignId }, select: { listId: true } }),
  ]);

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
    icpCriteria: campaign.icpCriteria.map((c) => ({
      dimension: c.dimension,
      operator: c.operator,
      values: c.valuesJson,
      isMandatory: c.isMandatory,
    })),
    leadFieldSpecs: campaign.leadFieldSpecs.map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      dataType: f.dataType,
      isRequired: f.isRequired,
      rejectIfMissing: f.rejectIfMissing,
      allowedValues: f.allowedValuesJson,
      validationPattern: f.validationPattern,
    })),
    channels: campaign.channels.map((ch) => ({
      campaignChannelId: ch.id,
      channelTypeVersionId: ch.channelTypeVersionId,
      channelTypeCode: ch.channelTypeVersion.channelType.code,
      channelTypeVersion: ch.channelTypeVersion.version,
      contractedQuantity: ch.contractedQuantity,
      // BigInt does not serialise to JSON; the minor-unit value is frozen as a string.
      clientUnitPriceMinor: ch.clientUnitPriceMinor.toString(),
      costBudgetMinor: ch.costBudgetMinor === null ? null : ch.costBudgetMinor.toString(),
      currency: ch.currency,
      startDate: isoDate(ch.startDate),
      endDate: isoDate(ch.endDate),
      definition: ch.channelTypeVersion.definitionJson,
    })),
    targetAccountListIds: talLinks.map((l) => l.listId),
    suppressionListIds: suppressionLinks.map((l) => l.listId),
  };
}
