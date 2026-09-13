import type { PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import {
  getChannelApprovalStatus,
  type ApprovalStatus,
} from "@/lib/approvals/status";
import { computeChannelReadiness, type ChannelReadiness } from "@/lib/channels/readiness";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { fromMinorUnits } from "@/lib/money/currency";

export type ClientApprovalItem = {
  kind: "channelTerms";
  subjectId: string;
  campaignId: string;
  campaignName: string;
  campaignCode: string;
  channelLabel: string;
  status: ApprovalStatus;
  summary: { label: string; value: string }[];
  lastComments: string | null;
  lastDecidedAt: Date | null;
};

export type ClientCampaignRow = {
  campaignId: string;
  name: string;
  code: string;
  status: string;
  startDate: Date;
  endDate: Date;
  contractedQuantity: number;
  deliveredCount: number;
  needsYouCount: number;
};

export type ClientCampaignChannel = {
  channelId: string;
  label: string;
  contractedQuantity: number;
  unitPrice: string;
  currency: string;
  startDate: Date;
  endDate: Date;
  deliveredCount: number;
  termsStatus: ApprovalStatus;
  readiness: ChannelReadiness;
};

export type ClientCampaignDetail = {
  campaignId: string;
  name: string;
  code: string;
  status: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  channels: ClientCampaignChannel[];
};

/** Everything that is not `approved` is still the client's to act on. */
const PENDING: ApprovalStatus[] = ["pending", "changesRequested", "reapprovalNeeded"];

const day = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * AUTH-10: a distinct read model, not admin-response field-filtering. Org
 * scoping is unconditional — `clientOrganizationId: actor.organizationId`
 * always applies, with no `isInternal` bypass — and the shared
 * `campaignChannelOrgScopeClause` helper is deliberately NOT used here: it
 * resolves to `{}` (no filter at all) for an internal actor, which would
 * return every organisation's approvals. Partner identity, payout rates and
 * cost budgets are structurally absent from the `select`s below rather than
 * omitted from the output type after the fact.
 */
export async function listClientApprovals(
  db: PrismaClient,
  actor: Actor,
  filter: { campaignId?: string; pendingOnly?: boolean } = {},
): Promise<ClientApprovalItem[]> {
  assertPermission(actor, "campaign:read");

  const channels = await db.campaignChannel.findMany({
    where: {
      campaign: {
        clientOrganizationId: actor.organizationId,
        deletedAt: null,
        ...(filter.campaignId === undefined ? {} : { id: filter.campaignId }),
      },
    },
    select: {
      id: true,
      contractedQuantity: true,
      clientUnitPriceMinor: true,
      currency: true,
      startDate: true,
      endDate: true,
      channelTypeVersionId: true,
      campaign: { select: { id: true, name: true, code: true } },
      channelTypeVersion: { select: { definitionJson: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const items: ClientApprovalItem[] = [];

  for (const channel of channels) {
    const definition = (channel.channelTypeVersion.definitionJson ??
      {}) as Partial<ChannelTypeDefinition>;
    const channelLabel = definition.name ?? definition.code ?? "Channel";

    const termsStatus = await getChannelApprovalStatus(db, channel);
    const lastTerms = await db.channelApproval.findFirst({
      where: { campaignChannelId: channel.id },
      orderBy: { decidedAt: "desc" },
      select: { comments: true, decidedAt: true },
    });

    items.push({
      kind: "channelTerms",
      subjectId: channel.id,
      campaignId: channel.campaign.id,
      campaignName: channel.campaign.name,
      campaignCode: channel.campaign.code,
      channelLabel,
      status: termsStatus,
      summary: [
        { label: "Volume", value: `${channel.contractedQuantity} leads` },
        {
          label: "Unit price",
          value: `${channel.currency} ${fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)}`,
        },
        { label: "Window", value: `${day(channel.startDate)} – ${day(channel.endDate)}` },
      ],
      lastComments: lastTerms?.comments ?? null,
      lastDecidedAt: lastTerms?.decidedAt ?? null,
    });
  }

  return filter.pendingOnly === false ? items : items.filter((i) => PENDING.includes(i.status));
}

export async function countPendingClientApprovals(db: PrismaClient, actor: Actor): Promise<number> {
  const items = await listClientApprovals(db, actor, { pendingOnly: true });
  return items.length;
}

export async function getClientCampaigns(
  db: PrismaClient,
  actor: Actor,
): Promise<ClientCampaignRow[]> {
  assertPermission(actor, "campaign:read");

  const campaigns = await db.campaign.findMany({
    where: { clientOrganizationId: actor.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      startDate: true,
      endDate: true,
      channels: { select: { contractedQuantity: true, deliveredCount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const pending = await listClientApprovals(db, actor, { pendingOnly: true });

  return campaigns.map((campaign) => ({
    campaignId: campaign.id,
    name: campaign.name,
    code: campaign.code,
    status: campaign.status,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    contractedQuantity: campaign.channels.reduce((sum, c) => sum + c.contractedQuantity, 0),
    deliveredCount: campaign.channels.reduce((sum, c) => sum + c.deliveredCount, 0),
    needsYouCount: pending.filter((p) => p.campaignId === campaign.id).length,
  }));
}

export async function getClientCampaignDetail(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<ClientCampaignDetail> {
  assertPermission(actor, "campaign:read");

  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, clientOrganizationId: actor.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      startDate: true,
      endDate: true,
      currency: true,
      channels: {
        select: {
          id: true,
          contractedQuantity: true,
          clientUnitPriceMinor: true,
          currency: true,
          startDate: true,
          endDate: true,
          deliveredCount: true,
          channelTypeVersionId: true,
          channelTypeVersion: { select: { definitionJson: true } },
          assets: {
            select: { id: true, status: true },
            orderBy: { createdAt: "desc" },
          },
          _count: { select: { allocations: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (campaign === null) throw new NotFoundError("Campaign not found");

  const channels: ClientCampaignChannel[] = [];

  for (const channel of campaign.channels) {
    const definition = (channel.channelTypeVersion.definitionJson ??
      {}) as Partial<ChannelTypeDefinition>;
    const termsStatus = await getChannelApprovalStatus(db, channel);

    channels.push({
      channelId: channel.id,
      label: definition.name ?? definition.code ?? "Channel",
      contractedQuantity: channel.contractedQuantity,
      unitPrice: fromMinorUnits(channel.clientUnitPriceMinor, channel.currency),
      currency: channel.currency,
      startDate: channel.startDate,
      endDate: channel.endDate,
      deliveredCount: channel.deliveredCount,
      termsStatus,
      readiness: computeChannelReadiness({
        activePlacementCount: channel.assets.filter((a) => a.status === "active").length,
        allocationCount: channel._count.allocations,
        requiresAsset: (definition as { requiresAsset?: boolean }).requiresAsset === true,
      }),
    });
  }

  return {
    campaignId: campaign.id,
    name: campaign.name,
    code: campaign.code,
    status: campaign.status,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    currency: campaign.currency,
    channels,
  };
}
