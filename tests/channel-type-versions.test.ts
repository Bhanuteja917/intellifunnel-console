import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createChannelType, updateChannelType } from "@/lib/channel-types/crud";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import { ForbiddenError } from "@/lib/errors";

async function superAdmin() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

async function newChannelType(actor: Awaited<ReturnType<typeof superAdmin>>) {
  const db = testDb();
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  return createChannelType(db, actor, {
    code: `CT_${Math.random().toString(36).slice(2, 8)}`,
    name: "Test channel type",
    funnelStageId: stage.id,
    producesLeads: true,
    requiresAsset: true,
    metricMode: "event",
    pricingUnit: "CPL",
    requiresTeleVerification: false,
    allowedMetricFields: [],
  });
}

describe("channel type versioning (FR-CT-2)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("publishes version 1 with a full frozen definition", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);

    const version = await publishChannelTypeVersion(db, actor, channelType.id);

    expect(version.version).toBe(1);
    const definition = version.definitionJson as Record<string, unknown>;
    expect(definition.code).toBe(channelType.code);
    expect(definition.pricingUnit).toBe("CPL");
    expect(definition.requiresAsset).toBe(true);
    expect(definition.questions).toEqual([]);
  });

  it("increments the version and leaves earlier versions untouched", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    const v1 = await publishChannelTypeVersion(db, actor, channelType.id);

    await updateChannelType(db, actor, channelType.id, { requiresTeleVerification: true });
    const v2 = await publishChannelTypeVersion(db, actor, channelType.id);

    expect(v2.version).toBe(2);
    const frozenV1 = await db.channelTypeVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect((frozenV1.definitionJson as Record<string, unknown>).requiresTeleVerification).toBe(false);
    expect((v2.definitionJson as Record<string, unknown>).requiresTeleVerification).toBe(true);
  });

  it("updates currentVersion on the channel type", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    await publishChannelTypeVersion(db, actor, channelType.id);
    await publishChannelTypeVersion(db, actor, channelType.id);

    const reloaded = await db.channelType.findUniqueOrThrow({ where: { id: channelType.id } });
    expect(reloaded.currentVersion).toBe(2);
  });

  it("freezes the qualification questions into the definition", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    const form = await db.qualificationForm.create({ data: { name: "Three questions" } });
    await db.qualificationQuestion.create({
      data: {
        formId: form.id, sortOrder: 1, text: "What is your budget?", type: "single",
        optionsJson: ["<10k", "10-50k", ">50k"], isQualifying: true,
        acceptableAnswersJson: ["10-50k", ">50k"],
      },
    });
    await updateChannelType(db, actor, channelType.id, { defaultQualificationFormId: form.id });

    const version = await publishChannelTypeVersion(db, actor, channelType.id);

    const questions = (version.definitionJson as { questions: Array<Record<string, unknown>> }).questions;
    expect(questions).toHaveLength(1);
    expect(questions[0]?.text).toBe("What is your budget?");
    expect(questions[0]?.acceptableAnswers).toEqual(["10-50k", ">50k"]);
  });

  it("requires channelType:publish", async () => {
    const db = testDb();
    const admin = await superAdmin();
    const channelType = await newChannelType(admin);
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const manager = await loadActor(db, user.id);

    await expect(publishChannelTypeVersion(db, manager, channelType.id))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("audits the publish", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    await publishChannelTypeVersion(db, actor, channelType.id);

    const entry = await db.auditLog.findFirstOrThrow({
      where: { entityType: "ChannelTypeVersion", action: "publish" },
    });
    expect(entry.actorUserId).toBe(actor.userId);
  });
});
