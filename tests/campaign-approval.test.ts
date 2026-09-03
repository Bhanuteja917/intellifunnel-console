import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import { setSetting } from "@/lib/settings/settings";
import { addCampaignChannel, createCampaign, setIcpCriteria } from "@/lib/campaigns/crud";
import {
  activateDueCampaigns,
  completeFinishedCampaigns,
  decideClientApproval,
  decideInternalApproval,
  submitForInternalApproval,
  transitionCampaign,
} from "@/lib/campaigns/state-machine";
import { ForbiddenError, InvalidStateTransitionError, ValidationError } from "@/lib/errors";

async function scenario(code: string) {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const admin = await loadActor(db, (await createUser(db, internal.id, "SUPER_ADMIN")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const clientAdmin = await loadActor(db, (await createUser(db, client.id, "CLIENT_ADMIN")).id);
  const clientViewer = await loadActor(db, (await createUser(db, client.id, "CLIENT_VIEWER")).id);

  const channelType = await db.channelType.findUniqueOrThrow({ where: { code: "CONTENT_SYNDICATION" } });
  const version = await publishChannelTypeVersion(db, admin, channelType.id);

  const campaign = await createCampaign(db, manager, {
    clientOrganizationId: client.id, name: "Campaign", code,
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
    currency: "USD", defaultMaxLeadsPerAccount: 5,
  });
  await setIcpCriteria(db, manager, campaign.id, [
    { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
  ]);
  await addCampaignChannel(db, manager, campaign.id, {
    channelTypeVersionId: version.id, contractedQuantity: 500,
    clientUnitPrice: "42.50", currency: "USD",
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
  });

  return { db, admin, manager, client, clientAdmin, clientViewer, campaign, version };
}

describe("approval workflow (E6, FR-CS-1)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("walks draft → internal → client → scheduled", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-1");

    const submitted = await submitForInternalApproval(db, manager, campaign.id);
    expect(submitted.status).toBe("pendingInternalApproval");

    const internallyApproved = await decideInternalApproval(db, manager, campaign.id, "approved");
    expect(internallyApproved.status).toBe("pendingClientApproval");

    const scheduled = await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    expect(scheduled.status).toBe("scheduled");
  });

  it("writes an immutable snapshot on client approval", async () => {
    const { db, manager, clientAdmin, campaign, version } = await scenario("FLOW-2");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    const scheduled = await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    const approval = await db.campaignApproval.findFirstOrThrow({
      where: { campaignId: campaign.id, type: "client" },
    });
    expect(approval.decidedByUserId).toBe(clientAdmin.userId);
    expect(approval.snapshotVersion).toBe(1);
    expect(scheduled.approvedSnapshotId).toBe(approval.id);

    const snapshot = approval.configSnapshotJson as {
      icpCriteria: unknown[];
      channels: Array<{ channelTypeVersionId: string; contractedQuantity: number; clientUnitPriceMinor: string }>;
      defaultMaxLeadsPerAccount: number | null;
    };
    expect(snapshot.icpCriteria).toHaveLength(1);
    expect(snapshot.channels[0]?.channelTypeVersionId).toBe(version.id);
    expect(snapshot.channels[0]?.contractedQuantity).toBe(500);
    expect(snapshot.channels[0]?.clientUnitPriceMinor).toBe("4250");
    expect(snapshot.defaultMaxLeadsPerAccount).toBe(5);
  });

  it("returns the campaign to draft on rejection, keeping the comments", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-3");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    const rejected = await decideClientApproval(db, clientAdmin, campaign.id, "rejected", "Price is wrong");

    expect(rejected.status).toBe("draft");
    const approval = await db.campaignApproval.findFirstOrThrow({
      where: { campaignId: campaign.id, type: "client", decision: "rejected" },
    });
    expect(approval.comments).toBe("Price is wrong");
    expect(approval.configSnapshotJson).toBeNull();
  });

  it("refuses a Client Viewer's approval", async () => {
    const { db, manager, clientViewer, campaign } = await scenario("FLOW-4");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    await expect(decideClientApproval(db, clientViewer, campaign.id, "approved"))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses another client's admin", async () => {
    const { db, manager, campaign } = await scenario("FLOW-5");
    const otherOrg = await createOrganization(testDb(), { isClient: true });
    const outsider = await loadActor(testDb(), (await createUser(testDb(), otherOrg.id, "CLIENT_ADMIN")).id);
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    await expect(decideClientApproval(db, outsider, campaign.id, "approved"))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to submit a campaign with no channels", async () => {
    const { db, manager, client } = await scenario("FLOW-6");
    const empty = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "Empty", code: "EMPTY-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    await expect(submitForInternalApproval(db, manager, empty.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an illegal transition", async () => {
    const { db, manager, campaign } = await scenario("FLOW-7");

    await expect(transitionCampaign(db, manager, campaign.id, "live"))
      .rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("records every transition in the status history", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-8");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    const history = await db.campaignStatusHistory.findMany({
      where: { campaignId: campaign.id }, orderBy: { changedAt: "asc" },
    });
    expect(history.map((h) => h.toStatus)).toEqual([
      "draft", "pendingInternalApproval", "pendingClientApproval", "scheduled",
    ]);
  });

  it("allows cancellation from any pre-live state", async () => {
    const { db, manager, campaign } = await scenario("FLOW-9");
    await submitForInternalApproval(db, manager, campaign.id);

    const cancelled = await transitionCampaign(db, manager, campaign.id, "cancelled", "Client withdrew");
    expect(cancelled.status).toBe("cancelled");
  });

  it("refuses cancellation once live", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-10");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    await transitionCampaign(db, manager, campaign.id, "live");

    await expect(transitionCampaign(db, manager, campaign.id, "cancelled"))
      .rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("pauses and resumes a live campaign", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-11");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    await transitionCampaign(db, manager, campaign.id, "live");

    expect((await transitionCampaign(db, manager, campaign.id, "paused")).status).toBe("paused");
    expect((await transitionCampaign(db, manager, campaign.id, "live")).status).toBe("live");
  });

  it("refuses transitionCampaign on draft -> pendingInternalApproval (gated transition)", async () => {
    const { db, manager, campaign } = await scenario("GATE-1");

    await expect(transitionCampaign(db, manager, campaign.id, "pendingInternalApproval"))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses transitionCampaign on pendingClientApproval -> scheduled (gated transition)", async () => {
    const { db, manager, campaign } = await scenario("GATE-2");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    await expect(transitionCampaign(db, manager, campaign.id, "scheduled"))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

/**
 * The scheduled transitions run against the calendar of the platform's
 * operating timezone (`operatingTimezone`, Asia/Kolkata = UTC+05:30), not UTC,
 * because that is the calendar the `@db.Date` flight dates were written
 * against. Every instant below is therefore chosen relative to a real
 * Asia/Kolkata day boundary — 18:30 UTC — rather than to UTC midnight, which
 * is a time the worker's `new Date()` would essentially never produce and
 * which hid the bug these tests are here to catch.
 */
describe("scheduled transitions", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedSettings(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("activates a scheduled campaign at the operating timezone's day boundary", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("SCHED-1");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    // 2026-09-30T18:29Z is still 2026-09-30 in Asia/Kolkata (23:59 IST).
    expect(await activateDueCampaigns(db, new Date("2026-09-30T18:29:00.000Z"))).toBe(0);
    // 2026-09-30T18:30Z is 2026-10-01 00:00 IST — the flight's first day.
    expect(await activateDueCampaigns(db, new Date("2026-09-30T18:30:00.000Z"))).toBe(1);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("live");
  });

  it("completes a live campaign once the flight end date passes (FR-CS-3)", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("SCHED-2");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    await activateDueCampaigns(db, new Date("2026-10-01T06:00:00.000Z"));

    // Still 2026-12-31 in Asia/Kolkata: the last day of the flight is not over.
    expect(await completeFinishedCampaigns(db, new Date("2026-12-31T18:29:00.000Z"))).toBe(0);
    // 2027-01-01 00:00 IST: the flight's last day has passed.
    expect(await completeFinishedCampaigns(db, new Date("2026-12-31T18:30:00.000Z"))).toBe(1);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("completed");
  });

  it("does not complete a campaign that is still live in the operating timezone", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("SCHED-3");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    await activateDueCampaigns(db, new Date("2026-10-01T06:00:00.000Z"));

    // The endDate column holds 2026-12-31T00:00:00Z, so a UTC comparison
    // ("endDate < now") completes the campaign from 2026-12-31T00:00:01Z —
    // 05:30 IST on its own final day, ~18.5 hours of the contracted flight
    // still to run. In the operating timezone it is 2026-12-31 all day, so
    // nothing is due.
    expect(await completeFinishedCampaigns(db, new Date("2026-12-31T00:00:01.000Z"))).toBe(0);
    expect(await completeFinishedCampaigns(db, new Date("2026-12-31T12:00:00.000Z"))).toBe(0);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("live");
  });

  it("reads the day boundary from the operatingTimezone setting, not a hardcoded zone", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("SCHED-4");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    const admin = await loadActor(db, (await createUser(
      db,
      (await db.organization.findFirstOrThrow({ where: { isInternal: true } })).id,
      "SUPER_ADMIN",
    )).id);
    await setSetting(db, admin, "operatingTimezone", "Pacific/Kiritimati"); // UTC+14

    // 2026-09-30T10:30Z is already 2026-10-01 in UTC+14, so the flight has
    // started there while it has not in Asia/Kolkata or UTC.
    expect(await activateDueCampaigns(db, new Date("2026-09-30T10:30:00.000Z"))).toBe(1);
  });
});
