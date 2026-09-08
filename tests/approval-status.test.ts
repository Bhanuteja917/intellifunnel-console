import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import {
  buildChannelTermsSnapshot,
  getChannelTermsApprovalStatus,
  getPlacementApprovalStatus,
} from "@/lib/approvals/status";

describe("channel terms approval status", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("is pending when no decision exists", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("pending");
  });

  it("is approved when the latest decision approves the current terms", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel),
      },
    });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("approved");
  });

  it("is changesRequested when the latest decision rejects", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "rejected",
        decidedByUserId: fx.clientAdminActor.userId,
        comments: "price is wrong",
        termsSnapshotJson: buildChannelTermsSnapshot(channel),
      },
    });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("changesRequested");
  });

  it("needs re-approval once the terms change after an approval", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel),
      },
    });

    const edited = await db.campaignChannel.update({
      where: { id: channel.id },
      data: { contractedQuantity: 60 },
    });

    expect(await getChannelTermsApprovalStatus(db, edited)).toBe("reapprovalNeeded");
  });

  it("lets a newer decision supersede an older one", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    const snapshot = buildChannelTermsSnapshot(channel);

    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "rejected",
        decidedByUserId: fx.clientAdminActor.userId,
        comments: "not yet",
        termsSnapshotJson: snapshot,
        decidedAt: new Date("2026-01-01T10:00:00Z"),
      },
    });
    await db.channelTermsApproval.create({
      data: {
        campaignChannelId: channel.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: snapshot,
        decidedAt: new Date("2026-01-02T10:00:00Z"),
      },
    });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("approved");
  });
});

describe("placement approval status", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("is pending with no decision, approved after a matching one, stale after an edit", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const asset = await db.asset.create({
      data: {
        ownerOrganizationId: fx.clientOrgId,
        name: "A",
        type: "whitepaper",
        language: "en",
        status: "active",
      },
    });
    const assetVersion = await db.assetVersion.create({
      data: {
        assetId: asset.id,
        version: 1,
        fileName: "a.pdf",
        storageKey: "k",
        mimeType: "application/pdf",
        sizeBytes: 10,
      },
    });
    const placement = await db.assetPlacement.create({
      data: {
        campaignChannelId: fx.channelId,
        assetId: asset.id,
        assetVersionId: assetVersion.id,
        landingPageUrl: "https://example.com/lp",
        formSlug: `slug-${Date.now()}`,
      },
    });

    expect(await getPlacementApprovalStatus(db, placement)).toBe("pending");

    await db.placementApproval.create({
      data: {
        assetPlacementId: placement.id,
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        placementSnapshotJson: {
          landingPageUrl: placement.landingPageUrl,
          assetVersionId: placement.assetVersionId,
          formSlug: placement.formSlug,
          consentTextVersionId: placement.consentTextVersionId,
        },
      },
    });

    expect(await getPlacementApprovalStatus(db, placement)).toBe("approved");

    const moved = await db.assetPlacement.update({
      where: { id: placement.id },
      data: { landingPageUrl: "https://example.com/lp-v2" },
    });

    expect(await getPlacementApprovalStatus(db, moved)).toBe("reapprovalNeeded");
  });
});
