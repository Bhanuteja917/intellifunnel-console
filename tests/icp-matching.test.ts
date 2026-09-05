import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { matchesIcp } from "@/lib/leads/matching";

let campaignCounter = 0;

async function opsActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "OPERATIONS");
  return loadActor(db, user.id);
}

async function createCampaignWithCriteria(
  criteria: { dimension: string; operator: string; valuesJson: unknown; isMandatory: boolean }[],
) {
  const db = testDb();
  const actor = await opsActor();
  const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
  const campaign = await db.campaign.create({
    data: {
      clientOrganizationId: clientOrg.id,
      name: "ICP Test Campaign",
      code: `ICP-TEST-${campaignCounter++}`,
      status: "draft",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
      advisoryIcpMatch: false,
      advisoryTalMatch: false,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });
  await db.icpCriterion.createMany({
    data: criteria.map((c) => ({ campaignId: campaign.id, ...c })),
  });
  return campaign.id;
}

const NO_ACCOUNT = { industry: null, employeeRange: null, revenueRange: null, country: null };
const NO_CONTACT = { jobFunction: null, seniority: null, jobTitle: null };

describe("matchesIcp", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("passes with zero criteria configured", async () => {
    const campaignId = await createCampaignWithCriteria([]);
    const result = await matchesIcp(testDb(), campaignId, NO_ACCOUNT, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("fails a mandatory 'in' criterion the account doesn't match", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "industry", operator: "in", valuesJson: ["SaaS"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, industry: "Manufacturing" }, NO_CONTACT);
    expect(result.mandatoryFailed).toBe(true);
    expect(result.failedDimensions).toEqual(["industry"]);
  });

  it("passes a mandatory 'in' criterion the account matches, case-insensitively", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "industry", operator: "in", valuesJson: ["SaaS"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, industry: "saas" }, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("records a non-mandatory failure without setting mandatoryFailed", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "country", operator: "in", valuesJson: ["US"], isMandatory: false },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, country: "IN" }, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: ["country"] });
  });

  it("skips a criterion when the account/contact field is null", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "jobTitle", operator: "contains", valuesJson: ["VP"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, NO_ACCOUNT, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("always skips region and custom dimensions", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "region", operator: "in", valuesJson: ["APAC"], isMandatory: true },
      { dimension: "custom", operator: "in", valuesJson: ["x"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, NO_ACCOUNT, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("evaluates 'between' on a numeric-parseable bucketed value", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "employeeRange", operator: "between", valuesJson: ["50", "200"], isMandatory: true },
    ]);
    const inRange = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, employeeRange: "100" }, NO_CONTACT);
    expect(inRange.mandatoryFailed).toBe(false);

    const outOfRange = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, employeeRange: "500" }, NO_CONTACT);
    expect(outOfRange.mandatoryFailed).toBe(true);
  });

  it("skips 'between' when the stored value isn't a parseable number", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "employeeRange", operator: "between", valuesJson: ["50", "200"], isMandatory: true },
    ]);
    const result = await matchesIcp(testDb(), campaignId, { ...NO_ACCOUNT, employeeRange: "50-200" }, NO_CONTACT);
    expect(result).toEqual({ mandatoryFailed: false, failedDimensions: [] });
  });

  it("collects multiple failed dimensions and sets mandatoryFailed if any is mandatory", async () => {
    const campaignId = await createCampaignWithCriteria([
      { dimension: "industry", operator: "in", valuesJson: ["SaaS"], isMandatory: false },
      { dimension: "seniority", operator: "in", valuesJson: ["VP"], isMandatory: true },
    ]);
    const result = await matchesIcp(
      testDb(),
      campaignId,
      { ...NO_ACCOUNT, industry: "Retail" },
      { ...NO_CONTACT, seniority: "Manager" },
    );
    expect(result.mandatoryFailed).toBe(true);
    expect(result.failedDimensions.sort()).toEqual(["industry", "seniority"].sort());
  });
});
