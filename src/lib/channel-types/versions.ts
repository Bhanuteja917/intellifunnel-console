import type { ChannelTypeVersion, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type FrozenQuestion = {
  id: string;
  sortOrder: number;
  text: string;
  type: string;
  options: unknown;
  isRequired: boolean;
  isQualifying: boolean;
  acceptableAnswers: unknown;
};

export type ChannelTypeDefinition = {
  channelTypeId: string;
  code: string;
  name: string;
  funnelStageCode: string;
  producesLeads: boolean;
  requiresAsset: boolean;
  metricMode: string;
  allowedMetricFields: unknown;
  pricingUnit: string;
  requiresTeleVerification: boolean;
  verificationSlaBusinessDays: number | null;
  qualificationFormId: string | null;
  questions: FrozenQuestion[];
};

export async function buildDefinition(
  db: PrismaClient,
  channelTypeId: string,
): Promise<ChannelTypeDefinition> {
  const channelType = await db.channelType.findUnique({
    where: { id: channelTypeId },
    include: {
      funnelStage: true,
      defaultQualificationForm: { include: { questions: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (channelType === null) throw new NotFoundError("Channel type not found");

  return {
    channelTypeId: channelType.id,
    code: channelType.code,
    name: channelType.name,
    funnelStageCode: channelType.funnelStage.code,
    producesLeads: channelType.producesLeads,
    requiresAsset: channelType.requiresAsset,
    metricMode: channelType.metricMode,
    allowedMetricFields: channelType.allowedMetricFieldsJson,
    pricingUnit: channelType.pricingUnit,
    requiresTeleVerification: channelType.requiresTeleVerification,
    verificationSlaBusinessDays: channelType.verificationSlaBusinessDays,
    qualificationFormId: channelType.defaultQualificationFormId,
    questions: (channelType.defaultQualificationForm?.questions ?? []).map((q) => ({
      id: q.id,
      sortOrder: q.sortOrder,
      text: q.text,
      type: q.type,
      options: q.optionsJson,
      isRequired: q.isRequired,
      isQualifying: q.isQualifying,
      acceptableAnswers: q.acceptableAnswersJson,
    })),
  };
}

/**
 * FR-CT-2: publishing snapshots the whole definition. Campaigns bind to a
 * version row, so a later edit to the channel type cannot reach them.
 */
export async function publishChannelTypeVersion(
  db: PrismaClient,
  actor: Actor,
  channelTypeId: string,
): Promise<ChannelTypeVersion> {
  assertPermission(actor, "channelType:publish");

  const definition = await buildDefinition(db, channelTypeId);
  const channelType = await db.channelType.findUniqueOrThrow({ where: { id: channelTypeId } });
  const nextVersion = channelType.currentVersion + 1;

  return withAudit<ChannelTypeVersion>(
    db,
    actor,
    (created) => ({
      entityType: "ChannelTypeVersion",
      entityId: created.id,
      action: "publish",
      after: { channelTypeId, version: nextVersion },
    }),
    async (tx) => {
      const version = await tx.channelTypeVersion.create({
        data: {
          channelTypeId,
          version: nextVersion,
          definitionJson: definition as unknown as Prisma.InputJsonValue,
          publishedById: actor.userId,
        },
      });
      await tx.channelType.update({
        where: { id: channelTypeId },
        data: { currentVersion: nextVersion, updatedById: actor.userId },
      });
      return version;
    },
  );
}

export async function getPublishedVersion(
  db: PrismaClient,
  channelTypeId: string,
  version: number,
): Promise<ChannelTypeVersion> {
  const row = await db.channelTypeVersion.findUnique({
    where: { channelTypeId_version: { channelTypeId, version } },
  });
  if (row === null) throw new NotFoundError(`Channel type version ${version} not found`);
  return row;
}
