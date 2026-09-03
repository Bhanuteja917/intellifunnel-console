import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createChannelType, deactivateChannelType } from "@/lib/channel-types/crud";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function actorWithRole(role: string) {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, role);
  return loadActor(db, user.id);
}

describe("seed data (DEP-6)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("seeds the four funnel stages in order", async () => {
    const db = testDb();
    await seedFunnelStages(db);
    const stages = await db.funnelStage.findMany({ orderBy: { sortOrder: "asc" } });
    expect(stages.map((s) => s.code)).toEqual(["PROGRAMMATIC", "TOFU", "MOFU", "BOFU"]);
  });

  it("seeds base channel types bound to their stages", async () => {
    const db = testDb();
    await seedFunnelStages(db);
    await seedChannelTypes(db);

    const programmatic = await db.channelType.findUniqueOrThrow({
      where: { code: "PROGRAMMATIC_DISPLAY" }, include: { funnelStage: true },
    });
    expect(programmatic.producesLeads).toBe(false);
    expect(programmatic.requiresAsset).toBe(false);
    expect(programmatic.metricMode).toBe("aggregate");
    expect(programmatic.pricingUnit).toBe("CPM");
    expect(programmatic.funnelStage.code).toBe("PROGRAMMATIC");

    const contentSyndication = await db.channelType.findUniqueOrThrow({
      where: { code: "CONTENT_SYNDICATION" },
    });
    expect(contentSyndication.requiresAsset).toBe(true);
    expect(contentSyndication.metricMode).toBe("event");
    expect(contentSyndication.pricingUnit).toBe("CPL");
  });

  it("seeds a reject reason vocabulary marking which reasons are replaceable", async () => {
    const db = testDb();
    await seedRejectReasons(db);

    const total = await db.rejectReason.count();
    expect(total).toBeGreaterThanOrEqual(10);

    const duplicate = await db.rejectReason.findUniqueOrThrow({ where: { code: "DUPLICATE_IN_CAMPAIGN" } });
    expect(duplicate.isPartnerReplaceable).toBe(true);
    expect(duplicate.category).toBe("duplicate");

    const suppressed = await db.rejectReason.findUniqueOrThrow({ where: { code: "SUPPRESSED_ACCOUNT" } });
    expect(suppressed.isPartnerReplaceable).toBe(true);

    const consent = await db.rejectReason.findUniqueOrThrow({ where: { code: "CONSENT_MISSING" } });
    expect(consent.isPartnerReplaceable).toBe(false);
  });
});

describe("channel type CRUD (FR-CT-1, FR-CT-4)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("lets a Super Admin create a channel type with no deployment", async () => {
    const db = testDb();
    const actor = await actorWithRole("SUPER_ADMIN");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });

    const created = await createChannelType(db, actor, {
      code: "MQL_3Q_TELE",
      name: "MQL – 3 questions + tele-verification",
      funnelStageId: stage.id,
      producesLeads: true,
      requiresAsset: true,
      metricMode: "event",
      pricingUnit: "CPL",
      requiresTeleVerification: true,
      allowedMetricFields: [],
    });

    expect(created.code).toBe("MQL_3Q_TELE");
    expect(created.currentVersion).toBe(0);
    expect(created.isActive).toBe(true);
  });

  it("refuses a Campaign Manager", async () => {
    const db = testDb();
    const actor = await actorWithRole("CAMPAIGN_MANAGER");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });

    await expect(
      createChannelType(db, actor, {
        code: "X", name: "X", funnelStageId: stage.id, producesLeads: true,
        requiresAsset: false, metricMode: "event", pricingUnit: "CPL",
        requiresTeleVerification: false, allowedMetricFields: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a duplicate code", async () => {
    const db = testDb();
    const actor = await actorWithRole("SUPER_ADMIN");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const input = {
      code: "DUP", name: "Dup", funnelStageId: stage.id, producesLeads: true,
      requiresAsset: false, metricMode: "event" as const, pricingUnit: "CPL" as const,
      requiresTeleVerification: false, allowedMetricFields: [],
    };
    await createChannelType(db, actor, input);

    await expect(createChannelType(db, actor, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it("deactivates rather than deletes (FR-CT-4)", async () => {
    const db = testDb();
    const actor = await actorWithRole("SUPER_ADMIN");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "TOFU" } });
    const created = await createChannelType(db, actor, {
      code: "TEMP", name: "Temp", funnelStageId: stage.id, producesLeads: true,
      requiresAsset: false, metricMode: "event", pricingUnit: "CPL",
      requiresTeleVerification: false, allowedMetricFields: [],
    });

    const deactivated = await deactivateChannelType(db, actor, created.id);

    expect(deactivated.isActive).toBe(false);
    expect(await db.channelType.count({ where: { id: created.id } })).toBe(1);
  });
});
