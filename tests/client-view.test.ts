import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { buildChannelTermsSnapshot } from "@/lib/approvals/status";
import {
  listClientApprovals,
  countPendingClientApprovals,
} from "@/lib/approvals/client-view";

describe("listClientApprovals", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("returns channel terms items as pending when no approval exists", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const items = await listClientApprovals(db, fx.clientAdminActor, { pendingOnly: false });
    const channelItem = items.find((i) => i.subjectId === fx.channelId && i.kind === "channelTerms");
    expect(channelItem).toBeDefined();
    expect(channelItem!.status).toBe("pending");
  });

  it("returns approved status after a matching channelApproval exists", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: [] as unknown as Prisma.InputJsonValue,
        leadSpecSnapshotJson: [] as unknown as Prisma.InputJsonValue,
      },
    });

    const items = await listClientApprovals(db, fx.clientAdminActor, { pendingOnly: false });
    const channelItem = items.find((i) => i.subjectId === fx.channelId && i.kind === "channelTerms");
    expect(channelItem!.status).toBe("approved");
  });

  it("filters to pending-only by default", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: [] as unknown as Prisma.InputJsonValue,
        leadSpecSnapshotJson: [] as unknown as Prisma.InputJsonValue,
      },
    });

    // With pendingOnly (default), approved channels should not appear
    const pendingItems = await listClientApprovals(db, fx.clientAdminActor);
    const channelItem = pendingItems.find((i) => i.subjectId === fx.channelId && i.kind === "channelTerms");
    expect(channelItem).toBeUndefined();
  });

  it("returns reapprovalNeeded when ICP changed after approval", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: [] as unknown as Prisma.InputJsonValue,
        leadSpecSnapshotJson: Prisma.DbNull,
      },
    });

    // Add ICP criterion after approval
    await db.icpCriterion.create({
      data: {
        campaignChannelId: channel.id,
        dimension: "country",
        operator: "in",
        valuesJson: ["US"],
        isMandatory: true,
      },
    });

    const items = await listClientApprovals(db, fx.clientAdminActor, { pendingOnly: false });
    const channelItem = items.find((i) => i.subjectId === fx.channelId && i.kind === "channelTerms");
    expect(channelItem!.status).toBe("reapprovalNeeded");
  });

  it("scopes results to the actor's own organisation", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    // The actor is a CLIENT_ADMIN for their org — admin actor is from an internal org
    // and has no client org channels, so their list should be empty
    const items = await listClientApprovals(db, fx.adminActor, { pendingOnly: false });
    expect(items).toHaveLength(0);
  });
});

describe("countPendingClientApprovals", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("counts pending items for the actor", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const count = await countPendingClientApprovals(db, fx.clientAdminActor);
    expect(count).toBeGreaterThanOrEqual(1); // at least the channel terms item
  });

  it("returns 0 when all items are approved", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: [] as unknown as Prisma.InputJsonValue,
        leadSpecSnapshotJson: [] as unknown as Prisma.InputJsonValue,
      },
    });

    const count = await countPendingClientApprovals(db, fx.clientAdminActor);
    expect(count).toBe(0);
  });
});
