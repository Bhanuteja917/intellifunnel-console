import type { Campaign, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type CloneOverrides = {
  code: string;
  name?: string;
  startDate?: Date;
  endDate?: Date;
  clientOrganizationId?: string;
};

/**
 * Copies configuration only. Approvals, snapshots, status history, allocations
 * and delivery belong to the source campaign and are never carried across.
 */
export async function cloneCampaign(
  db: PrismaClient,
  actor: Actor,
  sourceCampaignId: string,
  overrides: CloneOverrides,
): Promise<Campaign> {
  assertPermission(actor, "campaign:clone");

  const source = await db.campaign.findUnique({
    where: { id: sourceCampaignId },
    include: { icpCriteria: true, leadFieldSpecs: true, channels: true },
  });
  if (source === null || source.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, source.clientOrganizationId);

  const targetClientId = overrides.clientOrganizationId ?? source.clientOrganizationId;
  assertOrganizationAccess(actor, targetClientId);

  const duplicate = await db.campaign.findUnique({ where: { code: overrides.code } });
  if (duplicate !== null) throw new ValidationError(`Campaign code already exists: ${overrides.code}`);

  const startDate = overrides.startDate ?? source.startDate;
  const endDate = overrides.endDate ?? source.endDate;
  if (endDate.getTime() < startDate.getTime()) {
    throw new ValidationError("Clone end date precedes its start date");
  }

  const [talLinks, suppressionLinks] = await Promise.all([
    db.campaignTargetAccountList.findMany({ where: { campaignId: sourceCampaignId }, select: { listId: true } }),
    db.campaignSuppressionList.findMany({ where: { campaignId: sourceCampaignId }, select: { listId: true } }),
  ]);

  return withAudit<Campaign>(
    db,
    actor,
    (clone) => ({
      entityType: "Campaign", entityId: clone.id, action: "clone",
      after: { clonedFromCampaignId: sourceCampaignId, code: clone.code },
    }),
    async (tx) => {
      // Re-check for duplicate code inside the transaction to prevent TOCTOU race
      const dup = await tx.campaign.findUnique({ where: { code: overrides.code } });
      if (dup !== null) throw new ValidationError(`Campaign code already exists: ${overrides.code}`);

      const clone = await tx.campaign.create({
        data: {
          clientOrganizationId: targetClientId,
          name: overrides.name ?? `${source.name} (copy)`,
          code: overrides.code,
          startDate,
          endDate,
          currency: source.currency,
          defaultMaxLeadsPerAccount: source.defaultMaxLeadsPerAccount,
          advisoryTalMatch: source.advisoryTalMatch,
          advisoryIcpMatch: source.advisoryIcpMatch,
          clonedFromCampaignId: source.id,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });

      for (const criterion of source.icpCriteria) {
        await tx.icpCriterion.create({
          data: {
            campaignId: clone.id,
            dimension: criterion.dimension,
            operator: criterion.operator,
            valuesJson: criterion.valuesJson ?? {},
            isMandatory: criterion.isMandatory,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      for (const field of source.leadFieldSpecs) {
        await tx.leadFieldSpec.create({
          data: {
            campaignId: clone.id,
            fieldKey: field.fieldKey,
            label: field.label,
            dataType: field.dataType,
            isRequired: field.isRequired,
            rejectIfMissing: field.rejectIfMissing,
            allowedValuesJson: field.allowedValuesJson ?? undefined,
            validationPattern: field.validationPattern,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      for (const channel of source.channels) {
        // Channel windows are clamped into the clone's flight window; a copied
        // window from last quarter would fail addCampaignChannel's own check.
        const channelStart = channel.startDate < startDate ? startDate : channel.startDate;
        const channelEnd = channel.endDate > endDate ? endDate : channel.endDate;

        await tx.campaignChannel.create({
          data: {
            campaignId: clone.id,
            channelTypeVersionId: channel.channelTypeVersionId,
            contractedQuantity: channel.contractedQuantity,
            clientUnitPriceMinor: channel.clientUnitPriceMinor,
            costBudgetMinor: channel.costBudgetMinor,
            currency: channel.currency,
            startDate: channelStart > channelEnd ? startDate : channelStart,
            endDate: channelStart > channelEnd ? endDate : channelEnd,
            qualificationFormId: channel.qualificationFormId,
            status: "draft",
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      for (const link of talLinks) {
        await tx.campaignTargetAccountList.create({
          data: {
            campaignId: clone.id,
            listId: link.listId,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }
      for (const link of suppressionLinks) {
        await tx.campaignSuppressionList.create({
          data: {
            campaignId: clone.id,
            listId: link.listId,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      await tx.campaignStatusHistory.create({
        data: { campaignId: clone.id, fromStatus: null, toStatus: "draft", changedByUserId: actor.userId },
      });

      return clone;
    },
  );
}
