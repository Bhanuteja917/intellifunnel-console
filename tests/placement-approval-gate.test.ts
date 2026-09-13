import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { decidePlacement } from "@/lib/approvals/decisions";
import { setPlacementStatus } from "@/lib/assets/placements";
import { ValidationError } from "@/lib/errors";

async function setup() {
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
      formSlug: `slug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  return { db, fx, placement };
}

describe("setPlacementStatus — client approval gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("refuses to activate a placement the client has not approved", async () => {
    const { db, fx, placement } = await setup();

    await expect(
      setPlacementStatus(db, fx.adminActor, { placementId: placement.id, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to activate a placement the client rejected", async () => {
    const { db, fx, placement } = await setup();
    await decidePlacement(db, fx.clientAdminActor, {
      assetPlacementId: placement.id,
      decision: "rejected",
      comments: "wrong landing page",
    });

    await expect(
      setPlacementStatus(db, fx.adminActor, { placementId: placement.id, status: "active" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("activates once the client approves", async () => {
    const { db, fx, placement } = await setup();
    await decidePlacement(db, fx.clientAdminActor, {
      assetPlacementId: placement.id,
      decision: "approved",
    });

    const updated = await setPlacementStatus(db, fx.adminActor, {
      placementId: placement.id,
      status: "active",
    });
    expect(updated.status).toBe("active");
  });

  it("refuses again once the approved URL changes", async () => {
    const { db, fx, placement } = await setup();
    await decidePlacement(db, fx.clientAdminActor, {
      assetPlacementId: placement.id,
      decision: "approved",
    });
    await db.assetPlacement.update({
      where: { id: placement.id },
      data: { landingPageUrl: "https://example.com/other", status: "draft" },
    });

    await expect(
      setPlacementStatus(db, fx.adminActor, { placementId: placement.id, status: "active" }),
    ).rejects.toThrow(/changed since the client approved/);
  });

  it("still allows pausing and archiving without any approval", async () => {
    const { db, fx, placement } = await setup();

    const paused = await setPlacementStatus(db, fx.adminActor, {
      placementId: placement.id,
      status: "paused",
    });
    expect(paused.status).toBe("paused");

    const archived = await setPlacementStatus(db, fx.adminActor, {
      placementId: placement.id,
      status: "archived",
    });
    expect(archived.status).toBe("archived");
  });
});
