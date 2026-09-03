import type { ChannelType, MetricMode, PricingUnit, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type ChannelTypeInput = {
  code: string;
  name: string;
  funnelStageId: string;
  producesLeads: boolean;
  requiresAsset: boolean;
  metricMode: MetricMode;
  pricingUnit: PricingUnit;
  requiresTeleVerification: boolean;
  allowedMetricFields: string[];
  defaultQualificationFormId?: string;
  verificationSlaBusinessDays?: number;
};

export async function createChannelType(
  db: PrismaClient,
  actor: Actor,
  input: ChannelTypeInput,
): Promise<ChannelType> {
  assertPermission(actor, "channelType:write");

  const existing = await db.channelType.findUnique({ where: { code: input.code } });
  if (existing !== null) throw new ValidationError(`Channel type code already exists: ${input.code}`);

  const stage = await db.funnelStage.findUnique({ where: { id: input.funnelStageId } });
  if (stage === null) throw new NotFoundError("Funnel stage not found");

  if (input.metricMode === "aggregate" && input.allowedMetricFields.length === 0) {
    throw new ValidationError("An aggregate channel type must declare its metric fields");
  }

  return withAudit<ChannelType>(
    db,
    actor,
    (created) => ({
      entityType: "ChannelType", entityId: created.id, action: "create", after: input,
    }),
    (tx) =>
      tx.channelType.create({
        data: {
          code: input.code,
          name: input.name,
          funnelStageId: input.funnelStageId,
          producesLeads: input.producesLeads,
          requiresAsset: input.requiresAsset,
          metricMode: input.metricMode,
          pricingUnit: input.pricingUnit,
          requiresTeleVerification: input.requiresTeleVerification,
          allowedMetricFieldsJson: input.allowedMetricFields,
          defaultQualificationFormId: input.defaultQualificationFormId,
          verificationSlaBusinessDays: input.verificationSlaBusinessDays,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}

export async function updateChannelType(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: Partial<Omit<ChannelTypeInput, "code">>,
): Promise<ChannelType> {
  assertPermission(actor, "channelType:write");

  const before = await db.channelType.findUnique({ where: { id } });
  if (before === null) throw new NotFoundError("Channel type not found");

  return withAudit<ChannelType>(
    db,
    actor,
    { entityType: "ChannelType", entityId: id, action: "update", before, after: input },
    (tx) =>
      tx.channelType.update({
        where: { id },
        data: {
          name: input.name,
          funnelStageId: input.funnelStageId,
          producesLeads: input.producesLeads,
          requiresAsset: input.requiresAsset,
          metricMode: input.metricMode,
          pricingUnit: input.pricingUnit,
          requiresTeleVerification: input.requiresTeleVerification,
          allowedMetricFieldsJson: input.allowedMetricFields,
          defaultQualificationFormId: input.defaultQualificationFormId,
          verificationSlaBusinessDays: input.verificationSlaBusinessDays,
          updatedById: actor.userId,
        },
      }),
  );
}

/** FR-CT-4: a channel type is never deleted, only deactivated. */
export async function deactivateChannelType(
  db: PrismaClient,
  actor: Actor,
  id: string,
): Promise<ChannelType> {
  assertPermission(actor, "channelType:write");

  const before = await db.channelType.findUnique({ where: { id } });
  if (before === null) throw new NotFoundError("Channel type not found");

  return withAudit<ChannelType>(
    db,
    actor,
    { entityType: "ChannelType", entityId: id, action: "deactivate", before: { isActive: before.isActive }, after: { isActive: false } },
    (tx) => tx.channelType.update({ where: { id }, data: { isActive: false, updatedById: actor.userId } }),
  );
}
