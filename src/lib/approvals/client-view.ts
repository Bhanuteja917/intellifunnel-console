import type { PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import {
  getChannelApprovalStatus,
  getPlacementApprovalStatus,
  type ApprovalStatus,
} from "@/lib/approvals/status";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { fromMinorUnits } from "@/lib/money/currency";
import { getSetting } from "@/lib/settings/settings";
import { expectedToDate, paceSignal, type PaceSignal } from "@/lib/allocations/pacing";

/** Who needs to act next; `null` once a decision is settled (`approved`). */
export type ApprovalOwner = "you" | "agency" | null;

function ownerFor(status: ApprovalStatus): ApprovalOwner {
  if (status === "changesRequested") return "agency";
  if (status === "pending" || status === "reapprovalNeeded") return "you";
  return null;
}

export type IcpSummaryRow = { label: string; value: string };
export type LeadFieldSummaryRow = { label: string; detail: string };

const ICP_DIMENSION_LABELS: Record<string, string> = {
  industry: "Industry",
  employeeRange: "Employee range",
  revenueRange: "Revenue range",
  country: "Country",
  region: "Region",
  jobFunction: "Job function",
  seniority: "Seniority",
  jobTitle: "Job title",
  custom: "Custom",
};

function icpOperatorPhrase(operator: string): string {
  if (operator === "notIn") return "excludes";
  if (operator === "between") return "greater than";
  if (operator === "contains") return "contains";
  return "includes";
}

export function formatIcpRow(criterion: {
  dimension: string;
  operator: string;
  valuesJson: unknown;
  isMandatory: boolean;
}): IcpSummaryRow {
  const values = Array.isArray(criterion.valuesJson)
    ? criterion.valuesJson.map(String).join(", ")
    : String(criterion.valuesJson);
  const label = ICP_DIMENSION_LABELS[criterion.dimension] ?? criterion.dimension;
  return {
    label: criterion.isMandatory ? label : `${label} (nice to have)`,
    value: `${icpOperatorPhrase(criterion.operator)}: ${values}`,
  };
}

export function formatLeadFieldRow(field: {
  fieldKey: string;
  label: string;
  dataType: string;
  isRequired: boolean;
  allowedValuesJson: unknown;
  validationPattern: string | null;
}): LeadFieldSummaryRow {
  const parts = [field.isRequired ? "required" : "optional", field.dataType];
  if (Array.isArray(field.allowedValuesJson)) {
    parts.push(`one of: ${field.allowedValuesJson.map(String).join(", ")}`);
  }
  if (field.validationPattern !== null) parts.push(`pattern: ${field.validationPattern}`);
  return { label: field.label || field.fieldKey, detail: parts.join(" · ") };
}

type ClientApprovalItemBase = {
  subjectId: string;
  campaignId: string;
  campaignName: string;
  campaignCode: string;
  channelId: string;
  channelLabel: string;
  title: string;
  status: ApprovalStatus;
  owner: ApprovalOwner;
  summary: { label: string; value: string }[];
  lastComments: string | null;
  lastDecidedAt: Date | null;
};

export type ClientApprovalItem =
  | (ClientApprovalItemBase & {
      kind: "channelTerms";
      icp: IcpSummaryRow[];
      leadFields: LeadFieldSummaryRow[];
    })
  | (ClientApprovalItemBase & {
      kind: "placement";
      consentText: { name: string; version: number; body: string } | null;
    });

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
  icp: IcpSummaryRow[];
  leadFields: LeadFieldSummaryRow[];
  pace: PaceSignal;
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
        status: { not: "draft" },
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
    orderBy: { createdAt: "asc" },
  });

  const items: ClientApprovalItem[] = [];

  for (const channel of channels) {
    const definition = (channel.channelTypeVersion.definitionJson ??
      {}) as Partial<ChannelTypeDefinition>;
    const channelLabel = definition.name ?? definition.code ?? "Channel";
    const campaignRef = {
      campaignId: channel.campaign.id,
      campaignName: channel.campaign.name,
      campaignCode: channel.campaign.code,
      channelId: channel.id,
      channelLabel,
    };

    const termsStatus = await getChannelApprovalStatus(db, channel);
    const lastTerms = await db.channelApproval.findFirst({
      where: { campaignChannelId: channel.id },
      orderBy: { decidedAt: "desc" },
      select: { comments: true, decidedAt: true },
    });

    items.push({
      kind: "channelTerms",
      subjectId: channel.id,
      ...campaignRef,
      title: "Channel terms",
      status: termsStatus,
      owner: ownerFor(termsStatus),
      summary: [
        { label: "Volume", value: `${channel.contractedQuantity} leads` },
        {
          label: "Unit price",
          value: `${channel.currency} ${fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)}`,
        },
        { label: "Window", value: `${day(channel.startDate)} – ${day(channel.endDate)}` },
      ],
      icp: channel.icpCriteria.map(formatIcpRow),
      leadFields: channel.leadFieldSpecs.map(formatLeadFieldRow),
      lastComments: lastTerms?.comments ?? null,
      lastDecidedAt: lastTerms?.decidedAt ?? null,
    });

    if (definition.requiresAsset !== true) continue;

    const placements = await db.assetPlacement.findMany({
      where: { campaignChannelId: channel.id },
      select: {
        id: true,
        landingPageUrl: true,
        assetVersionId: true,
        formSlug: true,
        consentTextVersionId: true,
        asset: { select: { name: true } },
        assetVersion: { select: { version: true } },
        consentTextVersion: { select: { name: true, version: true, body: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const placement of placements) {
      const placementStatus = await getPlacementApprovalStatus(db, placement);
      const lastPlacement = await db.placementApproval.findFirst({
        where: { assetPlacementId: placement.id },
        orderBy: { decidedAt: "desc" },
        select: { comments: true, decidedAt: true },
      });

      items.push({
        kind: "placement",
        subjectId: placement.id,
        ...campaignRef,
        title: `Placement — ${placement.asset.name}`,
        status: placementStatus,
        owner: ownerFor(placementStatus),
        summary: [
          { label: "Asset", value: `${placement.asset.name} v${placement.assetVersion.version}` },
          { label: "Landing page", value: placement.landingPageUrl },
          { label: "Form slug", value: placement.formSlug },
        ],
        consentText: placement.consentTextVersion,
        lastComments: lastPlacement?.comments ?? null,
        lastDecidedAt: lastPlacement?.decidedAt ?? null,
      });
    }
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
    where: {
      clientOrganizationId: actor.organizationId,
      deletedAt: null,
      status: { not: "draft" },
    },
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
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (campaign === null) throw new NotFoundError("Campaign not found");

  const timeZone = await getSetting(db, "operatingTimezone");
  const now = new Date();
  const channels: ClientCampaignChannel[] = [];

  for (const channel of campaign.channels) {
    const definition = (channel.channelTypeVersion.definitionJson ??
      {}) as Partial<ChannelTypeDefinition>;
    const termsStatus = await getChannelApprovalStatus(db, channel);
    const expected = expectedToDate(channel.contractedQuantity, channel.startDate, channel.endDate, now, timeZone);

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
      icp: channel.icpCriteria.map(formatIcpRow),
      leadFields: channel.leadFieldSpecs.map(formatLeadFieldRow),
      pace: paceSignal(channel.deliveredCount, expected),
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
