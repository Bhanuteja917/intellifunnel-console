import type { PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import { getChannelApprovalStatus, type ApprovalStatus } from "@/lib/approvals/status";
import {
  formatIcpRow,
  formatLeadFieldRow,
  type IcpSummaryRow,
  type LeadFieldSummaryRow,
} from "@/lib/approvals/client-view";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { fromMinorUnits } from "@/lib/money/currency";
import { getSetting } from "@/lib/settings/settings";
import { expectedToDate, expectedToDateWithSchedule, paceSignal, type PaceSignal } from "@/lib/allocations/pacing";

export type ChannelDecision = {
  decision: "approved" | "rejected";
  decidedByName: string;
  decidedAt: Date;
  comments: string | null;
};

export type ChannelPacingBucketRow = { periodStart: Date; periodEnd: Date; targetQuantity: number };

export type ChannelDeliveryConfig = {
  method: "webhook" | "csv";
  status: string;
  webhookUrl: string | null;
  csvScheduleCron: string | null;
  fieldMapping: unknown;
} | null;

export type ChannelDeliveryRun = {
  id: string;
  method: "webhook" | "csv";
  status: string;
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type ClientChannelDetail = {
  channelId: string;
  campaignId: string;
  campaignName: string;
  campaignCode: string;
  label: string;
  status: string;
  contractedQuantity: number;
  reservedCount: number;
  deliveredCount: number;
  unitPrice: string;
  currency: string;
  startDate: Date;
  endDate: Date;
  termsStatus: ApprovalStatus;
  icp: IcpSummaryRow[];
  leadFields: LeadFieldSummaryRow[];
  decisions: ChannelDecision[];
  pacingBuckets: ChannelPacingBucketRow[];
  expectedToDate: number;
  pace: PaceSignal;
  timeZone: string;
  deliveryConfig: ChannelDeliveryConfig;
  deliveryRuns: ChannelDeliveryRun[];
  targetAccountList: { rowCount: number; downloadUrl: string } | null;
  suppressionList: { rowCount: number; downloadUrl: string } | null;
};

/**
 * AUTH-10: a distinct read model, not admin-response field-filtering — same
 * pattern as client-view.ts. `getDeliveryConfigForChannel` and
 * `listDeliveryRunsForChannel` gate on `delivery:read`, which client roles
 * don't hold, so this queries the delivery tables directly rather than
 * reusing those internal-only helpers. `webhookSecret` is never selected —
 * not redacted after the fact, structurally absent from the query. Partner
 * allocations are out of scope entirely: no partner identity, payout, or
 * per-partner pacing here.
 */
export async function getClientChannelDetail(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  channelId: string,
): Promise<ClientChannelDetail> {
  assertPermission(actor, "campaign:read");

  const channel = await db.campaignChannel.findFirst({
    where: {
      id: channelId,
      campaignId,
      campaign: { clientOrganizationId: actor.organizationId, deletedAt: null, status: { not: "draft" } },
    },
    select: {
      id: true,
      status: true,
      contractedQuantity: true,
      reservedCount: true,
      deliveredCount: true,
      clientUnitPriceMinor: true,
      currency: true,
      startDate: true,
      endDate: true,
      channelTypeVersionId: true,
      channelTypeVersion: { select: { definitionJson: true } },
      campaign: { select: { id: true, name: true, code: true } },
      icpCriteria: { select: { dimension: true, operator: true, valuesJson: true, isMandatory: true } },
      leadFieldSpecs: {
        select: {
          fieldKey: true,
          label: true,
          dataType: true,
          isRequired: true,
          allowedValuesJson: true,
          validationPattern: true,
        },
      },
    },
  });
  if (channel === null) throw new NotFoundError("Channel not found");

  const definition = (channel.channelTypeVersion.definitionJson ?? {}) as Partial<ChannelTypeDefinition>;
  const termsStatus = await getChannelApprovalStatus(db, channel);

  const decisionRows = await db.channelApproval.findMany({
    where: { campaignChannelId: channel.id },
    orderBy: { decidedAt: "desc" },
    select: { decision: true, decidedAt: true, decidedByUserId: true, comments: true },
  });
  const deciders = await db.user.findMany({
    where: { id: { in: decisionRows.map((d) => d.decidedByUserId) } },
    select: { id: true, name: true, email: true },
  });
  const deciderById = new Map(deciders.map((u) => [u.id, u.name ?? u.email]));
  const decisions: ChannelDecision[] = decisionRows.map((d) => ({
    decision: d.decision,
    decidedByName: deciderById.get(d.decidedByUserId) ?? "—",
    decidedAt: d.decidedAt,
    comments: d.comments,
  }));

  const [talLink, suppressionLink, talStep, suppressionStep] = await Promise.all([
    db.channelTargetAccountList.findFirst({ where: { campaignChannelId: channel.id }, select: { listId: true } }),
    db.channelSuppressionList.findFirst({ where: { campaignChannelId: channel.id }, select: { listId: true } }),
    db.channelSetupStep.findFirst({ where: { campaignChannelId: channel.id, stepKey: "targetAccountList" }, select: { id: true } }),
    db.channelSetupStep.findFirst({ where: { campaignChannelId: channel.id, stepKey: "suppressionList" }, select: { id: true } }),
  ]);
  const [targetAccountCount, suppressionCount] = await Promise.all([
    talLink === null ? Promise.resolve(0) : db.targetAccountEntry.count({ where: { listId: talLink.listId } }),
    suppressionLink === null ? Promise.resolve(0) : db.suppressionEntry.count({ where: { listId: suppressionLink.listId } }),
  ]);

  const pacingBuckets = await db.channelPacingBucket.findMany({
    where: { campaignChannelId: channel.id },
    orderBy: { periodStart: "asc" },
    select: { periodStart: true, periodEnd: true, targetQuantity: true },
  });
  const timeZone = await getSetting(db, "operatingTimezone");
  const now = new Date();
  const expected =
    pacingBuckets.length > 0
      ? expectedToDateWithSchedule(pacingBuckets, now, timeZone)
      : expectedToDate(channel.contractedQuantity, channel.startDate, channel.endDate, now, timeZone);

  const deliveryConfigRow = await db.deliveryConfig.findUnique({
    where: { campaignChannelId: channel.id },
    select: { method: true, status: true, webhookUrl: true, csvScheduleCron: true, fieldMappingJson: true },
  });
  const deliveryRunRows = await db.deliveryRun.findMany({
    where: { campaignChannelId: channel.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      method: true,
      status: true,
      attemptCount: true,
      lastError: true,
      createdAt: true,
      completedAt: true,
    },
  });

  return {
    channelId: channel.id,
    campaignId: channel.campaign.id,
    campaignName: channel.campaign.name,
    campaignCode: channel.campaign.code,
    label: definition.name ?? definition.code ?? "Channel",
    status: channel.status,
    contractedQuantity: channel.contractedQuantity,
    reservedCount: channel.reservedCount,
    deliveredCount: channel.deliveredCount,
    unitPrice: fromMinorUnits(channel.clientUnitPriceMinor, channel.currency),
    currency: channel.currency,
    startDate: channel.startDate,
    endDate: channel.endDate,
    termsStatus,
    icp: channel.icpCriteria.map(formatIcpRow),
    leadFields: channel.leadFieldSpecs.map(formatLeadFieldRow),
    decisions,
    pacingBuckets,
    expectedToDate: expected,
    pace: paceSignal(channel.deliveredCount, expected),
    timeZone,
    deliveryConfig:
      deliveryConfigRow === null
        ? null
        : {
            method: deliveryConfigRow.method,
            status: deliveryConfigRow.status,
            webhookUrl: deliveryConfigRow.webhookUrl,
            csvScheduleCron: deliveryConfigRow.csvScheduleCron,
            fieldMapping: deliveryConfigRow.fieldMappingJson,
          },
    deliveryRuns: deliveryRunRows,
    targetAccountList:
      talLink === null || talStep === null
        ? null
        : { rowCount: targetAccountCount, downloadUrl: `/api/client/campaigns/${campaignId}/channels/${channelId}/target-accounts/export` },
    suppressionList:
      suppressionLink === null || suppressionStep === null
        ? null
        : { rowCount: suppressionCount, downloadUrl: `/api/client/campaigns/${campaignId}/channels/${channelId}/suppression-list/export` },
  };
}
