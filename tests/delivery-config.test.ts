import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { upsertDeliveryConfig, getDeliveryConfigForChannel, setDeliveryConfigStatus } from "@/lib/delivery/config";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function seedChannelAndOperator() {
  const db = testDb();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
  const operator = await createUser(db, internalOrg.id, "OPERATIONS");
  const quality = await createUser(db, internalOrg.id, "QUALITY");

  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
      producesLeads: true, requiresAsset: false, metricMode: "event",
      allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
    },
  });
  const channelTypeVersion = await db.channelTypeVersion.create({
    data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
  });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
      status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
      currency: "USD",
    },
  });
  const channel = await db.campaignChannel.create({
    data: {
      campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
      contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "live",
    },
  });

  return {
    db,
    channelId: channel.id,
    operatorActor: await loadActor(db, operator.id),
    qualityActor: await loadActor(db, quality.id),
  };
}

describe("delivery config", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
    await seedSettings(testDb());
  });

  it("creates a webhook config with url+secret, rejects delivery:read-only actors", async () => {
    const { db, channelId, operatorActor, qualityActor } = await seedChannelAndOperator();

    await expect(
      upsertDeliveryConfig(db, qualityActor, {
        campaignChannelId: channelId, method: "webhook",
        webhookUrl: "https://example.com/hook", webhookSecret: "shh",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).rejects.toThrow(ForbiddenError);

    const config = await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "webhook",
      webhookUrl: "https://example.com/hook", webhookSecret: "shh",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });
    expect(config.method).toBe("webhook");
    expect(config.status).toBe("active");
  });

  it("rejects a webhook config missing webhookUrl", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "webhook",
        webhookSecret: "shh",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a webhook config missing webhookSecret", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "webhook",
        webhookUrl: "https://example.com/hook",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a csv config missing the cron schedule", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "csv",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an empty field mapping", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "csv", csvScheduleCron: "0 6 * * *",
        fieldMapping: [],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("upserts in place — a second call updates the same config row, not a new one", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    const first = await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "csv", csvScheduleCron: "0 6 * * *",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });
    const second = await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "csv", csvScheduleCron: "0 18 * * *",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });
    expect(second.id).toBe(first.id);
    expect(second.csvScheduleCron).toBe("0 18 * * *");

    const count = await db.deliveryConfig.count({ where: { campaignChannelId: channelId } });
    expect(count).toBe(1);
  });

  it("updates a webhook config without re-supplying webhookSecret, preserving the original secret", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "webhook",
      webhookUrl: "https://example.com/hook", webhookSecret: "original-secret",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });

    // Second save omits webhookSecret (the form sends undefined when the
    // admin leaves the "leave blank to keep current" field blank) and only
    // changes webhookUrl — this must succeed, not throw.
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "webhook",
        webhookUrl: "https://example.com/hook-v2",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).resolves.not.toThrow();

    const row = await db.deliveryConfig.findUniqueOrThrow({ where: { campaignChannelId: channelId } });
    expect(row.webhookUrl).toBe("https://example.com/hook-v2");
    expect(row.webhookSecret).toBe("original-secret");
  });

  it("getDeliveryConfigForChannel returns null when none exists, pauses via setDeliveryConfigStatus", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    expect(await getDeliveryConfigForChannel(db, operatorActor, channelId)).toBeNull();

    await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "csv", csvScheduleCron: "0 6 * * *",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });
    const paused = await setDeliveryConfigStatus(db, operatorActor, channelId, "paused");
    expect(paused.status).toBe("paused");
  });

  it("rejects a csv cron expression with a step (e.g. */15 * * * *)", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "csv", csvScheduleCron: "*/15 * * * *",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a cron expression with the wrong field count", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "csv", csvScheduleCron: "0 6 * *",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("still accepts a well-formed cron expression (single hour or a comma-list of hours)", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor, {
        campaignChannelId: channelId, method: "csv", csvScheduleCron: "0 6 * * *",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).resolves.not.toThrow();

    const { channelId: channelId2, operatorActor: operatorActor2 } = await seedChannelAndOperator();
    await expect(
      upsertDeliveryConfig(db, operatorActor2, {
        campaignChannelId: channelId2, method: "csv", csvScheduleCron: "0 6,18 * * *",
        fieldMapping: [{ source: "contact.email", target: "Email" }],
      }),
    ).resolves.not.toThrow();
  });

  it("redacts webhookSecret in the AuditLog when creating a new webhook config", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    const config = await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "webhook",
      webhookUrl: "https://example.com/hook", webhookSecret: "top-secret-value",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });

    const entry = await db.auditLog.findFirst({
      where: { entityType: "DeliveryConfig", entityId: config.id },
      orderBy: { occurredAt: "desc" },
    });
    expect(entry).not.toBeNull();
    const afterJson = entry!.afterJson as Record<string, unknown>;
    expect(afterJson.webhookSecret).toBe("[redacted]");
    expect(JSON.stringify(afterJson)).not.toContain("top-secret-value");
  });

  it("redacts webhookSecret in the AuditLog when updating a config's url while leaving webhookSecret blank (preserve-existing-secret path)", async () => {
    const { db, channelId, operatorActor } = await seedChannelAndOperator();
    await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "webhook",
      webhookUrl: "https://example.com/hook", webhookSecret: "original-secret-value",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });

    const updated = await upsertDeliveryConfig(db, operatorActor, {
      campaignChannelId: channelId, method: "webhook",
      webhookUrl: "https://example.com/hook-v2",
      fieldMapping: [{ source: "contact.email", target: "Email" }],
    });

    const entry = await db.auditLog.findFirst({
      where: { entityType: "DeliveryConfig", entityId: updated.id },
      orderBy: { occurredAt: "desc" },
    });
    expect(entry).not.toBeNull();
    const afterJson = entry!.afterJson as Record<string, unknown>;
    expect(afterJson.webhookSecret).toBe("[redacted]");
    expect(JSON.stringify(afterJson)).not.toContain("original-secret-value");
  });
});
