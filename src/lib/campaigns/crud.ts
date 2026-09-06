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
import { exponentFor, toMinorUnits } from "@/lib/money/currency";

/**
 * Accepts either the client or a transaction client, so a check can be made
 * twice: once as a cheap pre-flight and again inside the transaction that
 * mutates. Same shape as the `Db` unions in settings.ts, account-resolution.ts
 * and contact.ts.
 */
type Db = PrismaClient | Prisma.TransactionClient;

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

/**
 * A campaign can only belong to an organisation the actor may reach, that
 * still exists, and that is actually a client. Shared by createCampaign and
 * cloneCampaign, which can retarget a clone at a different organisation and
 * must apply the identical checks.
 */
export async function assertClientOrganization(
  db: Db,
  actor: Actor,
  organizationId: string,
): Promise<void> {
  assertOrganizationAccess(actor, organizationId);

  const client = await db.organization.findUnique({ where: { id: organizationId } });
  if (client === null || client.deletedAt !== null) throw new NotFoundError("Client organisation not found");
  if (!client.isClient) throw new ValidationError(`${client.name} is not a client organisation`);
}

export async function createCampaign(
  db: PrismaClient,
  actor: Actor,
  input: CreateCampaignInput,
): Promise<Campaign> {
  assertPermission(actor, "campaign:write");
  // Before the input checks below, so a caller who may not reach this
  // organisation is refused on that ground rather than learning anything about
  // the input it sent.
  await assertClientOrganization(db, actor, input.clientOrganizationId);

  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new ValidationError("Campaign end date precedes its start date");
  }

  // CUR-1/CUR-6: the currency has to be one the platform knows an exponent
  // for, or every minor-unit amount stored against this campaign is wrong.
  // exponentFor throws ValidationError for anything unsupported.
  exponentFor(input.currency);

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

/**
 * Call this twice for every config mutation: once before opening the
 * transaction (fast path, gives the caller a clean error) and again with `tx`
 * immediately before the write. Only the second call is load-bearing — without
 * it a client approval committing in the gap leaves a mutated configuration on
 * an already-scheduled campaign, which FR-CS-2 forbids.
 */
export async function assertDraftAndAccessible(
  db: Db,
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

  // This is a destructive replace, so the audit entry has to carry what was
  // destroyed (NFR-A-1). The rows are read inside the transaction, and are
  // shaped like `after` so the two are directly comparable.
  await withAudit<IcpCriterionInput[]>(
    db,
    actor,
    (before) => ({
      entityType: "Campaign",
      entityId: campaignId,
      action: "setIcpCriteria",
      before,
      after: criteria,
    }),
    async (tx) => {
      // Re-verify draft status inside the transaction: a client approval can
      // commit between the outer check and this write (FR-CS-2).
      await assertDraftAndAccessible(tx, actor, campaignId);

      const existing = await tx.icpCriterion.findMany({
        where: { campaignId },
        orderBy: { id: "asc" },
      });

      await tx.icpCriterion.deleteMany({ where: { campaignId } });
      for (const criterion of criteria) {
        await tx.icpCriterion.create({
          data: {
            campaignId,
            dimension: criterion.dimension,
            operator: criterion.operator,
            valuesJson: criterion.values as Prisma.InputJsonValue,
            isMandatory: criterion.isMandatory,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      return existing.map((row) => ({
        dimension: row.dimension,
        operator: row.operator,
        values: row.valuesJson as unknown[],
        isMandatory: row.isMandatory,
      }));
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

  // Destructive replace, so the audit entry carries what was destroyed
  // (NFR-A-1), read inside the transaction and shaped like `after`.
  await withAudit<LeadFieldSpecInput[]>(
    db,
    actor,
    (before) => ({
      entityType: "Campaign",
      entityId: campaignId,
      action: "setLeadFieldSpec",
      before,
      after: fields,
    }),
    async (tx) => {
      // Re-verify draft status inside the transaction (FR-CS-2).
      await assertDraftAndAccessible(tx, actor, campaignId);

      const existing = await tx.leadFieldSpec.findMany({
        where: { campaignId },
        orderBy: { fieldKey: "asc" },
      });

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
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      return existing.map((row) => ({
        fieldKey: row.fieldKey,
        label: row.label,
        dataType: row.dataType,
        isRequired: row.isRequired,
        rejectIfMissing: row.rejectIfMissing,
        allowedValues: (row.allowedValuesJson as unknown[] | null) ?? undefined,
        validationPattern: row.validationPattern ?? undefined,
      }));
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
  // CampaignChannel.contractedQuantity is an Int column: a fractional value
  // would otherwise reach tx.campaignChannel.create and throw an untyped
  // PrismaClientValidationError, which escapes toActionResult as a raw 500
  // instead of a message the caller can show.
  if (!Number.isInteger(input.contractedQuantity)) {
    throw new ValidationError("Contracted quantity must be a whole number");
  }
  // The channel's money is frozen into the campaign's config snapshot as minor
  // units with no currency conversion (FR-CS-1), and the client is billed in
  // one currency per campaign (CUR-2, FR-CM-7) — nothing in the spec makes a
  // channel in a different currency from its campaign meaningful.
  if (input.currency !== campaign.currency) {
    throw new ValidationError(
      `Channel currency ${input.currency} does not match the campaign's ${campaign.currency}`,
    );
  }
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
    async (tx) => {
      // Re-verify draft status inside the transaction (FR-CS-2).
      await assertDraftAndAccessible(tx, actor, campaignId);

      return tx.campaignChannel.create({
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
      });
    },
  );
}

/**
 * Soft-delete only, and only while still a draft. Anything past draft has
 * real approval/allocation activity — cancelling (draft/pending/scheduled ->
 * cancelled, see ALLOWED_TRANSITIONS) is the tool for that, not deletion.
 */
export async function deleteCampaign(db: PrismaClient, actor: Actor, campaignId: string): Promise<void> {
  assertPermission(actor, "campaign:write");

  const campaign = await assertDraftAndAccessible(db, actor, campaignId);

  await withAudit<Campaign>(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "delete", before: { status: campaign.status } },
    async (tx) => {
      // Re-verify inside the transaction: a client approval can commit
      // between the outer check and this write (FR-CS-2).
      await assertDraftAndAccessible(tx, actor, campaignId);
      return tx.campaign.update({ where: { id: campaignId }, data: { deletedAt: new Date(), updatedById: actor.userId } });
    },
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
