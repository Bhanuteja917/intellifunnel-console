import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import { addCampaignChannel, createCampaign, setIcpCriteria, setLeadFieldSpec } from "@/lib/campaigns/crud";
import {
  activateDueChannels,
  completeFinishedChannels,
  decideChannelApproval,
  deriveCampaignStatus,
  submitChannelForApproval,
  transitionCampaign,
} from "@/lib/campaigns/state-machine";
import { ForbiddenError, InvalidStateTransitionError, ValidationError } from "@/lib/errors";

/**
 * Set up a campaign with one channel, plus three actors. The channel has:
 *   - an ICP criterion (needed to submit for approval)
 *   - an email lead field spec (needed to submit for approval)
 *   - an active asset placement (CONTENT_SYNDICATION requiresAsset=true)
 */
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
    currency: "USD",
  });
  const channel = await addCampaignChannel(db, manager, campaign.id, {
    channelTypeVersionId: version.id, contractedQuantity: 500,
    clientUnitPrice: "42.50", currency: "USD",
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
  });

  // Satisfy the three readiness gates: ICP, email lead spec, active asset placement
  await setIcpCriteria(db, manager, channel.id, [
    { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
  ]);
  await setLeadFieldSpec(db, manager, channel.id, [
    { fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
  ]);

  const asset = await db.asset.create({
    data: { ownerOrganizationId: client.id, name: "Whitepaper", type: "whitepaper", language: "en" },
  });
  const assetVersion = await db.assetVersion.create({
    data: {
      assetId: asset.id, version: 1, storageKey: `assets/${asset.id}/1-whitepaper.pdf`,
      fileName: "whitepaper.pdf", mimeType: "application/pdf", sizeBytes: 1024,
    },
  });
  await db.assetPlacement.create({
    data: {
      campaignChannelId: channel.id, assetId: asset.id, assetVersionId: assetVersion.id,
      landingPageUrl: "https://client.example.com/landing", formSlug: `form-${code}`,
      status: "active",
    },
  });

  return { db, admin, manager, client, clientAdmin, clientViewer, campaign, channel, version };
}

// ────────────────────────────────────────────────────────────
// Pure function tests
// ────────────────────────────────────────────────────────────

describe("deriveCampaignStatus", () => {
  it("returns draft when any channel is draft", () => {
    expect(deriveCampaignStatus(["pending", "draft"])).toBe("draft");
  });

  it("returns live when any channel is live (no draft/pending present)", () => {
    expect(deriveCampaignStatus(["live", "scheduled"])).toBe("live");
  });

  it("live + draft → draft (draft takes highest priority)", () => {
    expect(deriveCampaignStatus(["live", "draft"])).toBe("draft");
  });

  it("returns pending when all submitted and any pending", () => {
    expect(deriveCampaignStatus(["pending", "scheduled"])).toBe("pending");
  });

  it("returns scheduled when all channels are scheduled", () => {
    expect(deriveCampaignStatus(["scheduled", "scheduled"])).toBe("scheduled");
  });

  it("returns paused when all channels are paused", () => {
    expect(deriveCampaignStatus(["paused", "paused"])).toBe("paused");
  });

  it("returns completed when all channels are completed or cancelled", () => {
    expect(deriveCampaignStatus(["completed", "cancelled"])).toBe("completed");
  });

  it("returns draft for empty channel list", () => {
    expect(deriveCampaignStatus([])).toBe("draft");
  });
});

// ────────────────────────────────────────────────────────────
// Channel approval workflow
// ────────────────────────────────────────────────────────────

describe("channel approval workflow", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("walks channel draft → pending → scheduled", async () => {
    const { db, manager, clientAdmin, campaign, channel } = await scenario("FLOW-1");

    const submitted = await submitChannelForApproval(db, manager, channel.id);
    expect(submitted.status).toBe("pending");

    // Campaign should derive to pending (has one pending channel)
    const campaignAfterSubmit = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(campaignAfterSubmit.status).toBe("pending");

    const approved = await decideChannelApproval(db, clientAdmin, channel.id, "approved");
    // Channel start date 2026-10-01 is in the future relative to test execution, so → scheduled
    expect(approved.status).toBe("scheduled");

    // Campaign should derive to scheduled
    const campaignAfterApproval = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(campaignAfterApproval.status).toBe("scheduled");
  });

  it("writes a ChannelApproval row with all three snapshots on approval", async () => {
    const { db, manager, clientAdmin, channel, version } = await scenario("FLOW-2");
    await submitChannelForApproval(db, manager, channel.id);

    await decideChannelApproval(db, clientAdmin, channel.id, "approved");

    const approval = await db.channelApproval.findFirstOrThrow({
      where: { campaignChannelId: channel.id, decision: "approved" },
    });
    expect(approval.decidedByUserId).toBe(clientAdmin.userId);

    const terms = approval.termsSnapshotJson as { channelTypeVersionId: string; contractedQuantity: number; clientUnitPriceMinor: string };
    expect(terms.channelTypeVersionId).toBe(version.id);
    expect(terms.contractedQuantity).toBe(500);
    expect(terms.clientUnitPriceMinor).toBe("4250");

    const icp = approval.icpSnapshotJson as Array<{ dimension: string }>;
    expect(Array.isArray(icp)).toBe(true);
    expect(icp).toHaveLength(1);

    const spec = approval.leadSpecSnapshotJson as Array<{ fieldKey: string }>;
    expect(Array.isArray(spec)).toBe(true);
    expect(spec).toHaveLength(1);
    expect(spec[0]?.fieldKey).toBe("email");
  });

  it("returns the channel to draft on rejection, keeping the comments", async () => {
    const { db, manager, clientAdmin, channel } = await scenario("FLOW-3");
    await submitChannelForApproval(db, manager, channel.id);

    const rejected = await decideChannelApproval(db, clientAdmin, channel.id, "rejected", "Price is wrong");

    expect(rejected.status).toBe("draft");
    const approval = await db.channelApproval.findFirstOrThrow({
      where: { campaignChannelId: channel.id, decision: "rejected" },
    });
    expect(approval.comments).toBe("Price is wrong");
  });

  it("refuses a Client Viewer's approval", async () => {
    const { db, manager, clientViewer, channel } = await scenario("FLOW-4");
    await submitChannelForApproval(db, manager, channel.id);

    await expect(decideChannelApproval(db, clientViewer, channel.id, "approved"))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses another client's admin", async () => {
    const { db, manager, channel } = await scenario("FLOW-5");
    const otherOrg = await createOrganization(testDb(), { isClient: true });
    const outsider = await loadActor(testDb(), (await createUser(testDb(), otherOrg.id, "CLIENT_ADMIN")).id);
    await submitChannelForApproval(db, manager, channel.id);

    await expect(decideChannelApproval(db, outsider, channel.id, "approved"))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to submit a channel without ICP criteria", async () => {
    const { db, manager, client, version } = await scenario("FLOW-6");
    // Create a campaign + channel with no ICP/spec/asset
    const bare = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "Bare", code: "BARE-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const bareChannel = await addCampaignChannel(db, manager, bare.id, {
      channelTypeVersionId: version.id, contractedQuantity: 10,
      clientUnitPrice: "10.00", currency: "USD",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
    });

    await expect(submitChannelForApproval(db, manager, bareChannel.id))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an illegal campaign-level transition", async () => {
    const { db, manager, campaign } = await scenario("FLOW-7");

    await expect(transitionCampaign(db, manager, campaign.id, "live"))
      .rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("records channel transitions in campaign status history", async () => {
    const { db, manager, clientAdmin, campaign, channel } = await scenario("FLOW-8");
    await submitChannelForApproval(db, manager, channel.id);
    await decideChannelApproval(db, clientAdmin, channel.id, "approved");

    const history = await db.campaignStatusHistory.findMany({
      where: { campaignId: campaign.id }, orderBy: { changedAt: "asc" },
    });
    const statuses = history.map((h) => h.toStatus);
    // draft (create) → pending (channel submit) → scheduled (channel approved)
    expect(statuses).toContain("draft");
    expect(statuses).toContain("pending");
    expect(statuses).toContain("scheduled");
  });

  it("allows cancellation from pending state", async () => {
    const { db, manager, campaign, channel } = await scenario("FLOW-9");
    await submitChannelForApproval(db, manager, channel.id);

    const cancelled = await transitionCampaign(db, manager, campaign.id, "cancelled", "Client withdrew");
    expect(cancelled.status).toBe("cancelled");
  });

  it("refuses cancellation once campaign is live", async () => {
    const { db, manager, campaign } = await scenario("FLOW-10");
    // Manually set campaign to live for this test
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "live" } });

    await expect(transitionCampaign(db, manager, campaign.id, "cancelled"))
      .rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("pauses and resumes a live campaign", async () => {
    const { db, manager, campaign } = await scenario("FLOW-11");
    // Manually set campaign to live
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "live" } });

    expect((await transitionCampaign(db, manager, campaign.id, "paused")).status).toBe("paused");
    expect((await transitionCampaign(db, manager, campaign.id, "live")).status).toBe("live");
  });
});

// ────────────────────────────────────────────────────────────
// Scheduled channel transitions (cron)
// ────────────────────────────────────────────────────────────

/**
 * The scheduled transitions run against the calendar of the platform's
 * operating timezone (`operatingTimezone`, Asia/Kolkata = UTC+05:30), not UTC,
 * because that is the calendar the `@db.Date` flight dates were written
 * against. Every instant below is therefore chosen relative to a real
 * Asia/Kolkata day boundary — 18:30 UTC — rather than to UTC midnight.
 */
describe("scheduled channel transitions", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("activates a scheduled channel at the operating timezone's day boundary", async () => {
    const { db, manager, clientAdmin, campaign, channel } = await scenario("SCHED-1");
    await submitChannelForApproval(db, manager, channel.id);
    await decideChannelApproval(db, clientAdmin, channel.id, "approved");
    // After approval the channel should be scheduled (start 2026-10-01 is future)
    const ch = await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(ch.status).toBe("scheduled");

    // 2026-09-30T18:29Z is still 2026-09-30 in Asia/Kolkata (23:59 IST).
    expect(await activateDueChannels(db, new Date("2026-09-30T18:29:00.000Z"))).toBe(0);
    // 2026-09-30T18:30Z is 2026-10-01 00:00 IST — the flight's first day.
    expect(await activateDueChannels(db, new Date("2026-09-30T18:30:00.000Z"))).toBe(1);
    expect((await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe("live");
    // Campaign should also be live now
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("live");
  });

  it("completes a live channel once the flight end date passes (FR-CS-3)", async () => {
    const { db, manager, clientAdmin, campaign, channel } = await scenario("SCHED-2");
    await submitChannelForApproval(db, manager, channel.id);
    await decideChannelApproval(db, clientAdmin, channel.id, "approved");
    await activateDueChannels(db, new Date("2026-10-01T06:00:00.000Z"));

    // Still 2026-12-31 in Asia/Kolkata: the last day of the flight is not over.
    expect(await completeFinishedChannels(db, new Date("2026-12-31T18:29:00.000Z"))).toBe(0);
    // 2027-01-01 00:00 IST: the flight's last day has passed.
    expect(await completeFinishedChannels(db, new Date("2026-12-31T18:30:00.000Z"))).toBe(1);
    expect((await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe("completed");
    // Campaign should also be completed
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("completed");
  });

  it("does not complete a channel that is still live in the operating timezone", async () => {
    const { db, manager, clientAdmin, channel } = await scenario("SCHED-3");
    await submitChannelForApproval(db, manager, channel.id);
    await decideChannelApproval(db, clientAdmin, channel.id, "approved");
    await activateDueChannels(db, new Date("2026-10-01T06:00:00.000Z"));

    // endDate is 2026-12-31; in UTC that's 2026-12-31T00:00:00Z.
    // In Asia/Kolkata it's 2026-12-31 05:30 IST, so 2026-12-31 is still ongoing.
    expect(await completeFinishedChannels(db, new Date("2026-12-31T00:00:01.000Z"))).toBe(0);
    expect(await completeFinishedChannels(db, new Date("2026-12-31T12:00:00.000Z"))).toBe(0);
    expect((await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe("live");
  });
});
