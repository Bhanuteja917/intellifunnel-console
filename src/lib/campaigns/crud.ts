import type {
  Campaign,
  CampaignChannel,
  IcpDimension,
  IcpOperator,
  LeadFieldDataType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { toMinorUnits } from "@/lib/money/currency";

export type CreateCampaignInput = {
  clientOrganizationId: string;
  name: string;
  code: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  defaultMaxLeadsPerAccount?: number;
  advisoryTalMatch?: boolean;
  advisoryIcpMatch?: boolean;
};

export async function createCampaign(
  db: PrismaClient,
  actor: Actor,
  input: CreateCampaignInput,
): Promise<Campaign> {
  assertPermission(actor, "campaign:write");
  assertOrganizationAccess(actor, input.clientOrganizationId);

  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new ValidationError("Campaign end date precedes its start date");
  }

  const client = await db.organization.findUnique({ where: { id: input.clientOrganizationId } });
  if (client === null || client.deletedAt !== null) throw new NotFoundError("Client organisation not found");
  if (!client.isClient) throw new ValidationError(`${client.name} is not a client organisation`);

  // Fast-path check for common case (optional optimization)
  const duplicate = await db.campaign.findUnique({ where: { code: input.code } });
  if (duplicate !== null) throw new ValidationError(`Campaign code already exists: ${input.code}`);

  return withAudit<Campaign>(
    db,
    actor,
    (created) => ({
      entityType: "Campaign", entityId: created.id, action: "create",
      after: { code: created.code, clientOrganizationId: created.clientOrganizationId },
    }),
    async (tx) => {
      // Re-verify inside transaction to close TOCTOU race (NFR-D-2)
      const existingDuplicate = await tx.campaign.findUnique({ where: { code: input.code } });
      if (existingDuplicate !== null) throw new ValidationError(`Campaign code already exists: ${input.code}`);

      const campaign = await tx.campaign.create({
        data: {
          clientOrganizationId: input.clientOrganizationId,
          name: input.name,
          code: input.code,
          startDate: input.startDate,
          endDate: input.endDate,
          currency: input.currency,
          defaultMaxLeadsPerAccount: input.defaultMaxLeadsPerAccount,
          advisoryTalMatch: input.advisoryTalMatch ?? false,
          advisoryIcpMatch: input.advisoryIcpMatch ?? false,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await tx.campaignStatusHistory.create({
        data: { campaignId: campaign.id, fromStatus: null, toStatus: "draft", changedByUserId: actor.userId },
      });
      return campaign;
    },
  );
}

export async function assertDraftAndAccessible(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<Campaign> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);
  if (campaign.status !== "draft") {
    // FR-CS-2: snapshot fields on a non-draft campaign change only through a
    // re-approval cycle, which Task 19 owns.
    throw new ValidationError(`Campaign is ${campaign.status}; configuration edits require a draft`);
  }
  return campaign;
}

export type IcpCriterionInput = {
  dimension: IcpDimension;
  operator: IcpOperator;
  values: unknown[];
  isMandatory: boolean;
};

export async function setIcpCriteria(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  criteria: IcpCriterionInput[],
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertDraftAndAccessible(db, actor, campaignId);

  await withAudit(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "setIcpCriteria", after: criteria },
    async (tx) => {
      await tx.icpCriterion.deleteMany({ where: { campaignId } });
      for (const criterion of criteria) {
        await tx.icpCriterion.create({
          data: {
            campaignId,
            dimension: criterion.dimension,
            operator: criterion.operator,
            valuesJson: criterion.values as Prisma.InputJsonValue,
            isMandatory: criterion.isMandatory,
          },
        });
      }
    },
  );
}

export type LeadFieldSpecInput = {
  fieldKey: string;
  label: string;
  dataType: LeadFieldDataType;
  isRequired: boolean;
  rejectIfMissing: boolean;
  allowedValues?: unknown[];
  validationPattern?: string;
};

export async function setLeadFieldSpec(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  fields: LeadFieldSpecInput[],
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertDraftAndAccessible(db, actor, campaignId);

  const keys = new Set(fields.map((f) => f.fieldKey));
  if (keys.size !== fields.length) throw new ValidationError("Duplicate fieldKey in lead field spec");

  await withAudit(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "setLeadFieldSpec", after: fields },
    async (tx) => {
      await tx.leadFieldSpec.deleteMany({ where: { campaignId } });
      for (const field of fields) {
        await tx.leadFieldSpec.create({
          data: {
            campaignId,
            fieldKey: field.fieldKey,
            label: field.label,
            dataType: field.dataType,
            isRequired: field.isRequired,
            rejectIfMissing: field.rejectIfMissing,
            allowedValuesJson: field.allowedValues as Prisma.InputJsonValue | undefined,
            validationPattern: field.validationPattern,
          },
        });
      }
    },
  );
}

export type CampaignChannelInput = {
  channelTypeVersionId: string;
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: Date;
  endDate: Date;
  qualificationFormId?: string;
};

export async function addCampaignChannel(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  input: CampaignChannelInput,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");
  const campaign = await assertDraftAndAccessible(db, actor, campaignId);

  if (input.contractedQuantity <= 0) throw new ValidationError("Contracted quantity must be positive");
  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new ValidationError("Channel end date precedes its start date");
  }
  if (
    input.startDate.getTime() < campaign.startDate.getTime() ||
    input.endDate.getTime() > campaign.endDate.getTime()
  ) {
    throw new ValidationError("Channel window must sit inside the campaign flight window");
  }

  const version = await db.channelTypeVersion.findUnique({ where: { id: input.channelTypeVersionId } });
  if (version === null) throw new NotFoundError("Channel type version not found");

  const clientUnitPriceMinor = toMinorUnits(input.clientUnitPrice, input.currency);
  const costBudgetMinor =
    input.costBudget === undefined ? null : toMinorUnits(input.costBudget, input.currency);

  return withAudit<CampaignChannel>(
    db,
    actor,
    (created) => ({
      entityType: "CampaignChannel", entityId: created.id, action: "create",
      after: { campaignId, contractedQuantity: input.contractedQuantity, currency: input.currency },
    }),
    (tx) =>
      tx.campaignChannel.create({
        data: {
          campaignId,
          channelTypeVersionId: input.channelTypeVersionId,
          contractedQuantity: input.contractedQuantity,
          clientUnitPriceMinor,
          costBudgetMinor,
          currency: input.currency,
          startDate: input.startDate,
          endDate: input.endDate,
          qualificationFormId: input.qualificationFormId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}

export async function getCampaignForActor(db: PrismaClient, actor: Actor, campaignId: string) {
  assertPermission(actor, "campaign:read");

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      icpCriteria: true,
      leadFieldSpecs: true,
      channels: { include: { channelTypeVersion: true } },
      approvals: { orderBy: { decidedAt: "desc" } },
    },
  });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");

  // AUTH-9: filtered at the query result, before anything is returned.
  assertOrganizationAccess(actor, campaign.clientOrganizationId);
  return campaign;
}
