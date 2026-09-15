import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture, type ChannelFixture } from "./helpers/channel-factory";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";
import { getClientLeadBreakdown } from "@/lib/leads/client-view";

let leadCounter = 0;

async function createLead(
  db: PrismaClient,
  fx: ChannelFixture,
  overrides: { jobTitle?: string | null; jobFunction?: string | null; country?: string | null; clientVisible?: boolean } = {},
) {
  leadCounter += 1;
  const account = await db.account.create({
    data: { name: `Acme ${leadCounter}`, normalizedName: normalizeCompanyName(`Acme ${leadCounter}`) },
  });
  const email = normalizeEmail(`lead-${leadCounter}-${Date.now()}@example.com`);
  const contact = await db.contact.create({
    data: {
      accountId: account.id,
      email,
      emailNormalized: email,
      jobTitle: overrides.jobTitle,
      jobFunction: overrides.jobFunction,
      country: overrides.country,
    },
  });
  const submitter = await db.user.create({
    data: {
      email: normalizeEmail(`u-${leadCounter}-${Date.now()}@example.com`),
      name: "U",
      organizationId: fx.clientOrgId,
      status: "active",
    },
  });
  const submission = await db.leadSubmission.create({
    data: {
      campaignChannelId: fx.channelId,
      sourceType: "internal",
      submittedById: submitter.id,
      mappingJson: {},
    },
  });
  return db.lead.create({
    data: {
      campaignChannelId: fx.channelId,
      submissionId: submission.id,
      contactId: contact.id,
      accountId: account.id,
      sourceType: "internal",
      fieldValuesJson: {},
      acceptedAt: new Date(),
      clientVisible: overrides.clientVisible ?? true,
    },
  });
}

describe("getClientLeadBreakdown", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("groups client-visible leads by job title, job function, and geography", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await createLead(db, fx, { jobTitle: "VP Marketing", jobFunction: "Marketing", country: "US" });
    await createLead(db, fx, { jobTitle: "VP Marketing", jobFunction: "Marketing", country: "US" });
    await createLead(db, fx, { jobTitle: "CTO", jobFunction: "Engineering", country: "CA" });

    const breakdown = await getClientLeadBreakdown(db, fx.clientAdminActor, fx.campaignId);

    expect(breakdown.totalCount).toBe(3);
    expect(breakdown.byJobTitle).toContainEqual({ label: "VP Marketing", count: 2 });
    expect(breakdown.byJobTitle).toContainEqual({ label: "CTO", count: 1 });
    expect(breakdown.byJobFunction).toContainEqual({ label: "Marketing", count: 2 });
    expect(breakdown.byGeography).toContainEqual({ label: "US", count: 2 });
    expect(breakdown.byGeography).toContainEqual({ label: "CA", count: 1 });
  });

  it("excludes leads that are not client-visible", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await createLead(db, fx, { jobTitle: "CTO", clientVisible: false });

    const breakdown = await getClientLeadBreakdown(db, fx.clientAdminActor, fx.campaignId);

    expect(breakdown.totalCount).toBe(0);
    expect(breakdown.byJobTitle).toHaveLength(0);
  });

  it("buckets missing job title as Unknown", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await createLead(db, fx, { jobTitle: null });

    const breakdown = await getClientLeadBreakdown(db, fx.clientAdminActor, fx.campaignId);

    expect(breakdown.byJobTitle).toContainEqual({ label: "Unknown", count: 1 });
  });

  it("collapses long tails beyond the top 8 values into Other", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    for (let i = 0; i < 10; i += 1) {
      await createLead(db, fx, { jobTitle: `Title ${i}` });
    }

    const breakdown = await getClientLeadBreakdown(db, fx.clientAdminActor, fx.campaignId);

    expect(breakdown.byJobTitle).toHaveLength(9);
    const other = breakdown.byJobTitle.find((b) => b.label === "Other");
    expect(other?.count).toBe(2);
  });

  it("never leaks another organisation's leads for a matching campaignId", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await createLead(db, fx, { jobTitle: "CTO" });

    const otherFx = await createChannelFixture(db);
    const breakdown = await getClientLeadBreakdown(db, otherFx.clientAdminActor, fx.campaignId);

    expect(breakdown.totalCount).toBe(0);
  });
});
