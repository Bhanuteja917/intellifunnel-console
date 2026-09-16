import type {
  ChannelSetupRequirement,
  ChannelSetupStepKey,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { STEP_CATALOG, catalogEntry, seedPlan } from "@/lib/channels/step-catalog";

type Db = PrismaClient | Prisma.TransactionClient;

export type StepOverride = {
  stepKey: ChannelSetupStepKey;
  requirement: ChannelSetupRequirement;
};

function sortOrderOf(stepKey: ChannelSetupStepKey): number {
  return STEP_CATALOG.findIndex((e) => e.key === stepKey);
}

function assertSelectable(stepKey: ChannelSetupStepKey, def: ChannelTypeDefinition): void {
  const entry = catalogEntry(stepKey);
  if (entry === undefined) throw new ValidationError(`Unknown setup step "${stepKey}"`);
  if (!entry.available) {
    throw new ValidationError(`Setup step "${entry.title}" is not available yet`);
  }
  if (!entry.applies(def)) {
    throw new ValidationError(`Setup step "${entry.title}" does not apply to this channel type`);
  }
}

/**
 * An explicit override list replaces the default plan rather than merging into
 * it, so the creation form can drop a step by omitting it. Locked steps survive
 * either way.
 */
export async function seedChannelSetupSteps(
  tx: Db,
  campaignChannelId: string,
  def: ChannelTypeDefinition,
  overrides?: StepOverride[],
): Promise<void> {
  let plan = seedPlan(def);

  if (overrides !== undefined) {
    for (const override of overrides) assertSelectable(override.stepKey, def);

    const locked = STEP_CATALOG.filter((e) => e.locked).map((e) => ({
      stepKey: e.key,
      requirement: "required" as const,
      sortOrder: sortOrderOf(e.key),
    }));
    const chosen = overrides.map((o) => ({
      stepKey: o.stepKey,
      requirement: o.requirement,
      sortOrder: sortOrderOf(o.stepKey),
    }));
    const byKey = new Map([...locked, ...chosen].map((s) => [s.stepKey, s]));
    plan = [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  await tx.channelSetupStep.createMany({
    data: plan.map((s) => ({ campaignChannelId, ...s })),
  });
}

export async function copyChannelSetupSteps(
  tx: Db,
  fromChannelId: string,
  toChannelId: string,
  actorUserId: string,
): Promise<void> {
  const source = await tx.channelSetupStep.findMany({
    where: { campaignChannelId: fromChannelId },
  });
  await tx.channelSetupStep.createMany({
    data: source.map((s) => ({
      campaignChannelId: toChannelId,
      stepKey: s.stepKey,
      requirement: s.requirement,
      sortOrder: s.sortOrder,
      createdById: actorUserId,
      updatedById: actorUserId,
    })),
  });
}

async function loadDraftChannel(db: PrismaClient, actor: Actor, channelId: string) {
  assertPermission(actor, "campaign:write");

  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: { campaign: true, channelTypeVersion: true },
  });
  if (channel === null || channel.campaign.deletedAt !== null) {
    throw new NotFoundError("Channel not found");
  }
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  if (channel.status !== "draft") {
    throw new ValidationError(
      `Channel is ${channel.status}; the setup checklist can only be edited while it is a draft`,
    );
  }
  return {
    channel,
    definition: channel.channelTypeVersion.definitionJson as unknown as ChannelTypeDefinition,
  };
}

export async function addChannelSetupStep(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
  stepKey: ChannelSetupStepKey,
): Promise<void> {
  const { definition } = await loadDraftChannel(db, actor, channelId);
  assertSelectable(stepKey, definition);

  const existing = await db.channelSetupStep.findFirst({
    where: { campaignChannelId: channelId, stepKey },
  });
  if (existing !== null) {
    throw new ValidationError(`Setup step "${catalogEntry(stepKey)?.title}" is already on this channel`);
  }

  await db.$transaction(async (tx) => {
    const created = await tx.channelSetupStep.create({
      data: {
        campaignChannelId: channelId,
        stepKey,
        requirement: "required",
        sortOrder: sortOrderOf(stepKey),
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      entityType: "ChannelSetupStep",
      entityId: created.id,
      action: "create",
      after: { campaignChannelId: channelId, stepKey, requirement: "required" },
    });
  });
}

export async function removeChannelSetupStep(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
  stepKey: ChannelSetupStepKey,
): Promise<void> {
  await loadDraftChannel(db, actor, channelId);

  const entry = catalogEntry(stepKey);
  if (entry === undefined) throw new ValidationError(`Unknown setup step "${stepKey}"`);
  if (entry.locked) throw new ValidationError(`Setup step "${entry.title}" cannot be removed`);

  const existing = await db.channelSetupStep.findFirst({
    where: { campaignChannelId: channelId, stepKey },
  });
  if (existing === null) {
    throw new ValidationError(`Setup step "${entry.title}" is not on this channel`);
  }

  await db.$transaction(async (tx) => {
    await tx.channelSetupStep.delete({ where: { id: existing.id } });
    await writeAudit(tx, actor, {
      entityType: "ChannelSetupStep",
      entityId: existing.id,
      action: "delete",
      before: { campaignChannelId: channelId, stepKey, requirement: existing.requirement },
    });
  });
}

export async function setChannelStepRequirement(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
  stepKey: ChannelSetupStepKey,
  requirement: ChannelSetupRequirement,
): Promise<void> {
  await loadDraftChannel(db, actor, channelId);

  const entry = catalogEntry(stepKey);
  if (entry === undefined) throw new ValidationError(`Unknown setup step "${stepKey}"`);
  if (entry.locked && requirement !== "required") {
    throw new ValidationError(`Setup step "${entry.title}" is always required`);
  }

  const existing = await db.channelSetupStep.findFirst({
    where: { campaignChannelId: channelId, stepKey },
  });
  if (existing === null) {
    throw new ValidationError(`Setup step "${entry.title}" is not on this channel`);
  }

  await db.$transaction(async (tx) => {
    await tx.channelSetupStep.update({
      where: { id: existing.id },
      data: { requirement, updatedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      entityType: "ChannelSetupStep",
      entityId: existing.id,
      action: "update",
      before: { requirement: existing.requirement },
      after: { requirement },
    });
  });
}
