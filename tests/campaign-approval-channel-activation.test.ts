import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { decideChannelTerms } from "@/lib/approvals/decisions";
import { decideClientApproval } from "@/lib/campaigns/state-machine";

describe("decideClientApproval — channel activation", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("activates ready channels and leaves unready ones in draft", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db, {
      campaignStatus: "pendingClientApproval",
      requiresAsset: false,
    });

    // A second channel on the same campaign, deliberately left unapproved.
    const unready = await db.campaignChannel.create({
      data: {
        campaignId: fx.campaignId,
        channelTypeVersionId: fx.channelTypeVersionId,
        contractedQuantity: 10,
        clientUnitPriceMinor: 1000n,
        currency: "USD",
        startDate: new Date("2026-02-01"),
        endDate: new Date("2026-03-31"),
        status: "draft",
      },
    });

    await decideChannelTerms(db, fx.clientAdminActor, {
      campaignChannelId: fx.channelId,
      decision: "approved",
    });

    await decideClientApproval(db, fx.clientAdminActor, fx.campaignId, "approved");

    const ready = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });
    const stillDraft = await db.campaignChannel.findUniqueOrThrow({ where: { id: unready.id } });

    expect(ready.status).toBe("active");
    expect(stillDraft.status).toBe("draft");
  });
});
