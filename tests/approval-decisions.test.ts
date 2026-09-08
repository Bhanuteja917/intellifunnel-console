import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { decideChannelTerms } from "@/lib/approvals/decisions";
import { getChannelTermsApprovalStatus } from "@/lib/approvals/status";
import { ForbiddenError, ValidationError } from "@/lib/errors";

describe("decideChannelTerms", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("records a client approval and flips the derived status", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    expect(await getChannelTermsApprovalStatus(db, channel)).toBe("approved");
  });

  it("writes an audit row for the decision", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    const approval = await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    const audit = await db.auditLog.findFirst({
      where: { entityType: "ChannelTermsApproval", entityId: approval.id },
    });
    expect(audit?.action).toBe("approved");
  });

  it("refuses a rejection with no comment", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);

    await expect(
      decideChannelTerms(db, fx.clientAdminActor, {
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
      decideChannelTerms(db, fx.clientViewerActor, {
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
      decideChannelTerms(db, otherActor, { campaignChannelId: fx.channelId, decision: "approved" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
