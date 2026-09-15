import type { Campaign, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { assertClientOrganization } from "@/lib/campaigns/crud";

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
    include: {
      channels: {
        include: { icpCriteria: true, leadFieldSpecs: true },
      },
    },
  });
  if (source === null || source.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, source.clientOrganizationId);

  // The clone can be retargeted at another organisation, which then has to
  // pass exactly the checks createCampaign applies: reachable by this actor,
  // not soft-deleted, and actually a client.
  const targetClientId = overrides.clientOrganizationId ?? source.clientOrganizationId;
  await assertClientOrganization(db, actor, targetClientId);

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
          clonedFromCampaignId: source.id,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });

      for (const channel of source.channels) {
        // Channel windows are clamped into the clone's flight window; a copied
        // window from last quarter would fail addCampaignChannel's own check.
        const channelStart = channel.startDate < startDate ? startDate : channel.startDate;
        const channelEnd = channel.endDate > endDate ? endDate : channel.endDate;

        const clonedChannel = await tx.campaignChannel.create({
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
            advisoryIcpMatch: channel.advisoryIcpMatch,
            advisoryTalMatch: channel.advisoryTalMatch,
            defaultMaxLeadsPerAccount: channel.defaultMaxLeadsPerAccount,
            status: "draft",
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });

        for (const criterion of channel.icpCriteria) {
          await tx.icpCriterion.create({
            data: {
              campaignChannelId: clonedChannel.id,
              dimension: criterion.dimension,
              operator: criterion.operator,
              valuesJson: criterion.valuesJson ?? {},
              isMandatory: criterion.isMandatory,
              createdById: actor.userId,
              updatedById: actor.userId,
            },
          });
        }

        for (const field of channel.leadFieldSpecs) {
          await tx.leadFieldSpec.create({
            data: {
              campaignChannelId: clonedChannel.id,
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
