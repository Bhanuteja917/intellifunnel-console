import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { decideChannelApproval, decideChannelTerms } from "@/lib/approvals/decisions";
import { getChannelApprovalStatus } from "@/lib/approvals/status";
import { ForbiddenError, ValidationError } from "@/lib/errors";

describe("decideChannelApproval", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("records a client approval and flips the derived status", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await decideChannelApproval(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    expect(await getChannelApprovalStatus(db, channel)).toBe("approved");
  });

  it("writes ICP and lead spec snapshots into the approval row", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    // Add an ICP criterion and lead field spec before deciding
    await db.icpCriterion.create({
      data: {
        campaignChannelId: fx.channelId,
        dimension: "country",
        operator: "in",
        valuesJson: ["US", "CA"],
        isMandatory: true,
      },
    });
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: fx.channelId,
        fieldKey: "jobTitle",
        label: "Job Title",
        dataType: "string",
        isRequired: true,
        rejectIfMissing: true,
      },
    });

    const approval = await decideChannelApproval(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    expect(approval.type).toBe("client");
    expect(Array.isArray(approval.icpSnapshotJson)).toBe(true);
    expect(Array.isArray(approval.leadSpecSnapshotJson)).toBe(true);

    const icpSnapshot = approval.icpSnapshotJson as Array<{ dimension: string }>;
    expect(icpSnapshot).toHaveLength(1);
    expect(icpSnapshot[0]!.dimension).toBe("country");

    const leadSpecSnapshot = approval.leadSpecSnapshotJson as Array<{ fieldKey: string }>;
    expect(leadSpecSnapshot).toHaveLength(1);
    expect(leadSpecSnapshot[0]!.fieldKey).toBe("jobTitle");
  });

  it("writes an audit row for the decision with ChannelApproval entity type", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const approval = await decideChannelApproval(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const audit = await db.auditLog.findFirst({
      where: { entityType: "ChannelApproval", entityId: approval.id },
    });
    expect(audit?.action).toBe("approved");
  });

  it("decideChannelTerms alias works identically", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const approval = await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    expect(approval.type).toBe("client");
    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    expect(await getChannelApprovalStatus(db, channel)).toBe("approved");
  });

  it("refuses a rejection with no comment", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      decideChannelApproval(db, fx.clientAdminActor, {
        campaignChannelId: fx.channelId,
        decision: "rejected",
        comments: "   ",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a CLIENT_VIEWER", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      decideChannelApproval(db, fx.clientViewerActor, {
        campaignChannelId: fx.channelId,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a client admin from another organisation", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    const otherOrg = await createOrganization(db, { isClient: true });
    const otherUser = await createUser(db, otherOrg.id, "CLIENT_ADMIN");
    const otherActor = await loadActor(db, otherUser.id);

    await expect(
      decideChannelApproval(db, otherActor, { campaignChannelId: fx.channelId, decision: "approved" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
