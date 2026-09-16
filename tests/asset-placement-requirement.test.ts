import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { submitChannelForApproval } from "@/lib/campaigns/state-machine";
import { seedChannelSetupSteps } from "@/lib/channels/setup-steps";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { ValidationError } from "@/lib/errors";

async function createAssetRequiringChannel(db: ReturnType<typeof testDb>, orgId: string, userId: string) {
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  const channelType = await db.channelType.create({
    data: {
      code: `CT_ASSET_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
      name: "Campaign with Asset Requirement",
      code: `CAM_ASSET_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      clientOrganizationId: orgId,
      status: "draft",
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      currency: "USD",
      createdById: userId,
      updatedById: userId,
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
      createdById: userId,
      updatedById: userId,
    },
  });
  await seedChannelSetupSteps(
    db,
    channel.id,
    version.definitionJson as unknown as ChannelTypeDefinition,
  );
  return { campaign, channel, version };
}

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

    const { channel } = await createAssetRequiringChannel(db, org.id, user.id);

    // Add ICP criterion and email spec so only the placement check fails
    await db.icpCriterion.create({
      data: {
        campaignChannelId: channel.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: channel.id,
        fieldKey: "email",
        label: "Email",
        dataType: "email",
        isRequired: true,
        rejectIfMissing: true,
      },
    });

    // Should reject because no active asset placement
    await expect(submitChannelForApproval(db, actor, channel.id)).rejects.toThrow(
      /Add a placement.*is not complete/,
    );
  });

  it("succeeds once the requiresAsset channel gets an active placement", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    const { channel } = await createAssetRequiringChannel(db, org.id, user.id);

    await db.icpCriterion.create({
      data: {
        campaignChannelId: channel.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: channel.id,
        fieldKey: "email",
        label: "Email",
        dataType: "email",
        isRequired: true,
        rejectIfMissing: true,
      },
    });

    // Confirm it still rejects before any placement exists.
    await expect(submitChannelForApproval(db, actor, channel.id)).rejects.toThrow(
      /Add a placement.*is not complete/,
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
    const result = await submitChannelForApproval(db, actor, channel.id);
    expect(result.status).toBe("pending");
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
    await seedChannelSetupSteps(db, channel.id, version.definitionJson as unknown as ChannelTypeDefinition);

    // Add ICP criterion and email spec on the channel
    await db.icpCriterion.create({
      data: {
        campaignChannelId: channel.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: channel.id,
        fieldKey: "email",
        label: "Email",
        dataType: "email",
        isRequired: true,
        rejectIfMissing: true,
      },
    });

    // Should succeed - channel doesn't require assets
    const result = await submitChannelForApproval(db, actor, channel.id);
    expect(result.status).toBe("pending");
  });

  it("still validates that a channel must have at least one ICP criterion", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

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
    await seedChannelSetupSteps(db, channel.id, version.definitionJson as unknown as ChannelTypeDefinition);

    // No ICP criteria on the channel — should fail
    await expect(submitChannelForApproval(db, actor, channel.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("still validates that a channel must have an email lead field spec", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: true });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT_TEST2_${Date.now()}`,
        name: "Test Channel 2",
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
          name: "Test Channel 2",
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
    const campaign = await db.campaign.create({
      data: {
        name: "Campaign without email spec",
        code: `CAM_NO_EMAIL_${Date.now()}`,
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
    await seedChannelSetupSteps(db, channel.id, version.definitionJson as unknown as ChannelTypeDefinition);

    // ICP criterion present but no email spec
    await db.icpCriterion.create({
      data: {
        campaignChannelId: channel.id,
        dimension: "industry",
        operator: "in",
        valuesJson: ["Technology"],
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Should fail because no email lead field spec
    await expect(submitChannelForApproval(db, actor, channel.id)).rejects.toBeInstanceOf(ValidationError);
  });
});
