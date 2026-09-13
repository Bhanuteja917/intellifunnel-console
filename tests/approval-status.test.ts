import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import {
  buildChannelTermsSnapshot,
  buildIcpSnapshot,
  buildLeadSpecSnapshot,
  getChannelApprovalStatus,
  getChannelTermsApprovalStatus,
} from "@/lib/approvals/status";

describe("channel approval status", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("is pending when no decision exists", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    expect(await getChannelApprovalStatus(db, channel)).toBe("pending");
  });

  it("getChannelTermsApprovalStatus alias works identically", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("pending");
  });

  it("is approved when the latest decision approves the current terms and ICP is empty", async () => {
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

    expect(await getChannelApprovalStatus(db, channel)).toBe("approved");
  });

  it("is changesRequested when the latest decision rejects", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "rejected",
        decidedByUserId: fx.clientAdminActor.userId,
        comments: "price is wrong",
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
      },
    });

    expect(await getChannelApprovalStatus(db, channel)).toBe("changesRequested");
  });

  it("needs re-approval once the terms change after an approval", async () => {
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

    const edited = await db.campaignChannel.update({
      where: { id: channel.id },
      data: { contractedQuantity: 60 },
    });

    expect(await getChannelApprovalStatus(db, edited)).toBe("reapprovalNeeded");
  });

  it("lets a newer decision supersede an older one", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    const snapshot = buildChannelTermsSnapshot(channel);

    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "rejected",
        decidedByUserId: fx.clientAdminActor.userId,
        comments: "not yet",
        termsSnapshotJson: snapshot as unknown as Prisma.InputJsonValue,
        decidedAt: new Date("2026-01-01T10:00:00Z"),
      },
    });
    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: snapshot as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: [] as unknown as Prisma.InputJsonValue,
        leadSpecSnapshotJson: [] as unknown as Prisma.InputJsonValue,
        decidedAt: new Date("2026-01-02T10:00:00Z"),
      },
    });

    expect(await getChannelApprovalStatus(db, channel)).toBe("approved");
  });

  it("is reapprovalNeeded when ICP criteria changed after approval", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    // Create approval with empty ICP snapshot
    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: [] as unknown as Prisma.InputJsonValue, // snapshot of empty ICP
        leadSpecSnapshotJson: null,
      },
    });

    // Now add an ICP criterion (changed after approval)
    await db.icpCriterion.create({
      data: {
        campaignChannelId: channel.id,
        dimension: "country",
        operator: "in",
        valuesJson: ["US"],
        isMandatory: true,
      },
    });

    expect(await getChannelApprovalStatus(db, channel)).toBe("reapprovalNeeded");
  });

  it("is reapprovalNeeded when lead spec changed after approval", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    // Create approval with empty lead spec snapshot
    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: null,
        leadSpecSnapshotJson: [] as unknown as Prisma.InputJsonValue,
      },
    });

    // Now add a lead field spec (changed after approval)
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: channel.id,
        fieldKey: "jobTitle",
        label: "Job Title",
        dataType: "string",
        isRequired: true,
        rejectIfMissing: true,
      },
    });

    expect(await getChannelApprovalStatus(db, channel)).toBe("reapprovalNeeded");
  });

  it("does not flag staleness when ICP snapshot is null (pre-ICP approval)", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

    // Old-style approval with no ICP snapshot at all
    await db.channelApproval.create({
      data: {
        campaignChannelId: channel.id,
        type: "client",
        decision: "approved",
        decidedByUserId: fx.clientAdminActor.userId,
        termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: null,
        leadSpecSnapshotJson: null,
      },
    });

    // Add ICP criteria — should NOT trigger staleness since snapshot was null
    await db.icpCriterion.create({
      data: {
        campaignChannelId: channel.id,
        dimension: "country",
        operator: "in",
        valuesJson: ["US"],
        isMandatory: true,
      },
    });

    // Still approved: null snapshot means ICP staleness is not tracked
    expect(await getChannelApprovalStatus(db, channel)).toBe("approved");
  });

  it("buildIcpSnapshot sorts by id and is deterministic", () => {
    const criteria = [
      { id: "z", campaignChannelId: "c1", dimension: "country" as const, operator: "in" as const, valuesJson: ["UK"], isMandatory: false, createdAt: new Date(), updatedAt: new Date(), createdById: null, updatedById: null },
      { id: "a", campaignChannelId: "c1", dimension: "industry" as const, operator: "in" as const, valuesJson: ["tech"], isMandatory: true, createdAt: new Date(), updatedAt: new Date(), createdById: null, updatedById: null },
    ];
    const snapshot = buildIcpSnapshot(criteria);
    expect(snapshot[0]!.dimension).toBe("industry"); // "a" sorts before "z"
    expect(snapshot[1]!.dimension).toBe("country");
  });

  it("buildLeadSpecSnapshot sorts by fieldKey", () => {
    const specs = [
      { id: "1", campaignChannelId: "c1", fieldKey: "zipCode", label: "Zip", dataType: "string" as const, isRequired: false, rejectIfMissing: false, allowedValuesJson: null, validationPattern: null, createdAt: new Date(), updatedAt: new Date(), createdById: null, updatedById: null },
      { id: "2", campaignChannelId: "c1", fieldKey: "email", label: "Email", dataType: "email" as const, isRequired: true, rejectIfMissing: true, allowedValuesJson: null, validationPattern: null, createdAt: new Date(), updatedAt: new Date(), createdById: null, updatedById: null },
    ];
    const snapshot = buildLeadSpecSnapshot(specs);
    expect(snapshot[0]!.fieldKey).toBe("email");
    expect(snapshot[1]!.fieldKey).toBe("zipCode");
  });
});

