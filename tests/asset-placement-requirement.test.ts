import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { submitForInternalApproval } from "@/lib/campaigns/state-machine";
import { ValidationError } from "@/lib/errors";

describe("Asset placement requirement in campaign approval", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("rejects campaign submission when requiresAsset channel has no active placement", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    // Create a channel type that requires assets
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT_ASSET_${Date.now()}`,
        name: "Email with Asset Requirement",
        funnelStageId: stage.id,
        producesLeads: true,
        requiresAsset: true,
        metricMode: "event",
        allowedMetricFieldsJson: [],
        pricingUnit: "CPL",
        requiresTeleVerification: false,
        verificationSlaBusinessDays: null,
        currentVersion: 1,
      },
    });

    const version = await db.channelTypeVersion.create({
      data: {
        channelTypeId: channelType.id,
        version: 1,
        definitionJson: {
          channelTypeId: channelType.id,
          code: channelType.code,
          name: "Email with Asset Requirement",
          funnelStageCode: "MOFU",
          producesLeads: true,
          requiresAsset: true,
          metricMode: "event",
          allowedMetricFields: [],
          pricingUnit: "CPL",
          requiresTeleVerification: false,
          verificationSlaBusinessDays: null,
          qualificationFormId: null,
          questions: [],
        },
        publishedById: "system",
      },
    });

    // Create campaign
    const campaign = await db.campaign.create({
      data: {
        name: "Campaign with Asset Requirement",
        code: `CAM_ASSET_${Date.now()}`,
        clientOrganizationId: org.id,
        status: "draft",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        currency: "USD",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Add channel (no active asset placement)
    await db.campaignChannel.create({
      data: {
        campaignId: campaign.id,
        channelTypeVersionId: version.id,
        contractedQuantity: 1000,
        clientUnitPriceMinor: 1000000n,
        currency: "USD",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        status: "draft",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Add ICP criterion
    await db.icpCriterion.create({
      data: {
        campaignId: campaign.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Should reject because no active asset placement
    await expect(submitForInternalApproval(db, actor, campaign.id)).rejects.toThrow(
      /Channel.*Email with Asset Requirement.*requires at least one active asset placement/,
    );
  });

  it("succeeds once the requiresAsset channel gets an active placement", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT_ASSET_OK_${Date.now()}`,
        name: "Email with Asset Requirement",
        funnelStageId: stage.id,
        producesLeads: true,
        requiresAsset: true,
        metricMode: "event",
        allowedMetricFieldsJson: [],
        pricingUnit: "CPL",
        requiresTeleVerification: false,
        verificationSlaBusinessDays: null,
        currentVersion: 1,
      },
    });

    const version = await db.channelTypeVersion.create({
      data: {
        channelTypeId: channelType.id,
        version: 1,
        definitionJson: {
          channelTypeId: channelType.id,
          code: channelType.code,
          name: "Email with Asset Requirement",
          funnelStageCode: "MOFU",
          producesLeads: true,
          requiresAsset: true,
          metricMode: "event",
          allowedMetricFields: [],
          pricingUnit: "CPL",
          requiresTeleVerification: false,
          verificationSlaBusinessDays: null,
          qualificationFormId: null,
          questions: [],
        },
        publishedById: "system",
      },
    });

    const campaign = await db.campaign.create({
      data: {
        name: "Campaign that gains a placement",
        code: `CAM_ASSET_OK_${Date.now()}`,
        clientOrganizationId: org.id,
        status: "draft",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        currency: "USD",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const channel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id,
        channelTypeVersionId: version.id,
        contractedQuantity: 1000,
        clientUnitPriceMinor: 1000000n,
        currency: "USD",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        status: "draft",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    await db.icpCriterion.create({
      data: {
        campaignId: campaign.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Confirm it still rejects before any placement exists.
    await expect(submitForInternalApproval(db, actor, campaign.id)).rejects.toThrow(
      /requires at least one active asset placement/,
    );

    const asset = await db.asset.create({
      data: {
        ownerOrganizationId: org.id,
        name: "Whitepaper",
        type: "whitepaper",
        language: "en",
        createdById: user.id,
      },
    });
    const assetVersion = await db.assetVersion.create({
      data: {
        assetId: asset.id,
        version: 1,
        storageKey: `assets/${asset.id}/1-whitepaper.pdf`,
        fileName: "whitepaper.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        uploadedById: user.id,
      },
    });
    await db.assetPlacement.create({
      data: {
        campaignChannelId: channel.id,
        assetId: asset.id,
        assetVersionId: assetVersion.id,
        landingPageUrl: "https://client.example.com/landing",
        formSlug: `form-${Date.now()}`,
        status: "active",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Now it should succeed with the active placement in place.
    const result = await submitForInternalApproval(db, actor, campaign.id);
    expect(result.status).toBe("pendingInternalApproval");
  });

  it("does not require assets for requiresAsset:false channels", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    // Create channel type that does NOT require assets
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT_NO_ASSET_${Date.now()}`,
        name: "SMS Channel",
        funnelStageId: stage.id,
        producesLeads: true,
        requiresAsset: false,
        metricMode: "event",
        allowedMetricFieldsJson: [],
        pricingUnit: "CPL",
        requiresTeleVerification: false,
        verificationSlaBusinessDays: null,
        currentVersion: 1,
      },
    });

    const version = await db.channelTypeVersion.create({
      data: {
        channelTypeId: channelType.id,
        version: 1,
        definitionJson: {
          channelTypeId: channelType.id,
          code: channelType.code,
          name: "SMS Channel",
          funnelStageCode: "MOFU",
          producesLeads: true,
          requiresAsset: false,
          metricMode: "event",
          allowedMetricFields: [],
          pricingUnit: "CPL",
          requiresTeleVerification: false,
          verificationSlaBusinessDays: null,
          qualificationFormId: null,
          questions: [],
        },
        publishedById: "system",
      },
    });

    // Create campaign
    const campaign = await db.campaign.create({
      data: {
        name: "Campaign without Asset Requirement",
        code: `CAM_NO_ASSET_${Date.now()}`,
        clientOrganizationId: org.id,
        status: "draft",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        currency: "USD",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Add channel (no placement at all)
    await db.campaignChannel.create({
      data: {
        campaignId: campaign.id,
        channelTypeVersionId: version.id,
        contractedQuantity: 1000,
        clientUnitPriceMinor: 1000000n,
        currency: "USD",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        status: "draft",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Add ICP criterion
    await db.icpCriterion.create({
      data: {
        campaignId: campaign.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Should succeed - channel doesn't require assets
    const result = await submitForInternalApproval(db, actor, campaign.id);
    expect(result.status).toBe("pendingInternalApproval");
  });

  it("still validates pre-existing checks (no channels)", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    // Create campaign with no channels
    const campaign = await db.campaign.create({
      data: {
        name: "Campaign with no channels",
        code: `CAM_NO_CHAN_${Date.now()}`,
        clientOrganizationId: org.id,
        status: "draft",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        currency: "USD",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Add ICP criterion
    await db.icpCriterion.create({
      data: {
        campaignId: campaign.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Should fail for missing channel
    await expect(submitForInternalApproval(db, actor, campaign.id)).rejects.toThrow(
      /at least one channel/,
    );
  });

  it("still validates pre-existing checks (no ICP criteria)", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    // Create channel type
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT_TEST_${Date.now()}`,
        name: "Test Channel",
        funnelStageId: stage.id,
        producesLeads: true,
        requiresAsset: false,
        metricMode: "event",
        allowedMetricFieldsJson: [],
        pricingUnit: "CPL",
        requiresTeleVerification: false,
        verificationSlaBusinessDays: null,
        currentVersion: 1,
      },
    });

    const version = await db.channelTypeVersion.create({
      data: {
        channelTypeId: channelType.id,
        version: 1,
        definitionJson: {
          channelTypeId: channelType.id,
          code: channelType.code,
          name: "Test Channel",
          funnelStageCode: "MOFU",
          producesLeads: true,
          requiresAsset: false,
          metricMode: "event",
          allowedMetricFields: [],
          pricingUnit: "CPL",
          requiresTeleVerification: false,
          verificationSlaBusinessDays: null,
          qualificationFormId: null,
          questions: [],
        },
        publishedById: "system",
      },
    });

    // Create campaign
    const campaign = await db.campaign.create({
      data: {
        name: "Campaign without ICP",
        code: `CAM_NO_ICP_${Date.now()}`,
        clientOrganizationId: org.id,
        status: "draft",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        currency: "USD",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Add channel (no ICP criteria)
    await db.campaignChannel.create({
      data: {
        campaignId: campaign.id,
        channelTypeVersionId: version.id,
        contractedQuantity: 1000,
        clientUnitPriceMinor: 1000000n,
        currency: "USD",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        status: "draft",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Should fail for missing ICP criteria
    await expect(submitForInternalApproval(db, actor, campaign.id)).rejects.toThrow(
      /ICP criterion/,
    );
  });
});
