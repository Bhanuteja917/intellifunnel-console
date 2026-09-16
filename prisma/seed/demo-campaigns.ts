import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizeEmail } from "@/lib/normalise/email";

/**
 * Resets all campaign data and rebuilds four campaigns — one per status that
 * matters for manual QA (draft, pending, scheduled, live) — so the app always
 * has a known-good dataset to click through. Only the live campaign gets a
 * channel populated with an ICP, lead field spec, and lead data, since that's
 * the only status where leads are reachable in either portal.
 *
 * Safe to re-run: it wipes prior campaigns/leads/accounts/contacts first.
 */

const CLIENT_ORG_NAME = "Acme Corp";
const ADMIN_EMAIL = "admin@intellifunnel.io";
const CHANNEL_TYPE_CODE = "MQL";

const LEADS = [
  { first: "Priya", last: "Sharma", company: "Nimbus Cloud", domain: "nimbuscloud.io", title: "VP of Marketing", fn: "marketing", country: "United States", industry: "Software" },
  { first: "Daniel", last: "Cohen", company: "Brightline SaaS", domain: "brightlinesaas.com", title: "Marketing Manager", fn: "marketing", country: "United States", industry: "SaaS" },
  { first: "Ava", last: "Thompson", company: "Fieldstone Analytics", domain: "fieldstoneanalytics.com", title: "Director of Demand Gen", fn: "marketing", country: "Canada", industry: "Software" },
  { first: "Marcus", last: "Lee", company: "Orbital Systems", domain: "orbitalsystems.co", title: "VP of Sales", fn: "sales", country: "United States", industry: "SaaS" },
  { first: "Sofia", last: "Ruiz", company: "Harbor Point Tech", domain: "harborpointtech.com", title: "Head of Growth", fn: "marketing", country: "United States", industry: "Software" },
  { first: "James", last: "Okafor", company: "Vector & Vine", domain: "vectorandvine.com", title: "Account Executive", fn: "sales", country: "United Kingdom", industry: "SaaS" },
  { first: "Lena", last: "Muller", company: "Quiet Harbor Labs", domain: "quietharborlabs.com", title: "Marketing Manager", fn: "marketing", country: "Germany", industry: "Software" },
  { first: "Ethan", last: "Wallace", company: "Redshift Ventures", domain: "redshiftventures.io", title: "CTO", fn: "engineering", country: "United States", industry: "SaaS" },
];

async function resetCampaignData(db: PrismaClient): Promise<void> {
  await db.deliveryRunLead.deleteMany({});
  await db.deliveryRun.deleteMany({});
  await db.deliveryConfig.deleteMany({});
  await db.verificationRecord.deleteMany({});
  await db.leadConsent.deleteMany({});
  await db.leadStatusHistory.deleteMany({});
  await db.lead.deleteMany({});
  await db.leadSubmissionError.deleteMany({});
  await db.leadSubmission.deleteMany({});
  await db.engagementEvent.deleteMany({});
  await db.placementApproval.deleteMany({});
  await db.assetPlacement.deleteMany({});
  await db.channelPacingBucket.deleteMany({});
  await db.partnerAllocation.deleteMany({});
  await db.channelApproval.deleteMany({});
  await db.channelTermsApproval.deleteMany({});
  await db.icpCriterion.deleteMany({});
  await db.leadFieldSpec.deleteMany({});
  await db.campaignChannel.deleteMany({});
  await db.campaignTargetAccountList.deleteMany({});
  await db.campaignSuppressionList.deleteMany({});
  await db.campaignStatusHistory.deleteMany({});
  await db.campaign.deleteMany({});
  await db.contact.deleteMany({});
  await db.account.deleteMany({});
}

async function ensureClientOrg(db: PrismaClient) {
  const existing = await db.organization.findFirst({ where: { isClient: true } });
  if (existing !== null) return existing;
  return db.organization.create({
    data: { name: CLIENT_ORG_NAME, isClient: true, defaultBillingCurrency: "USD" },
  });
}

async function ensurePublishedChannelTypeVersion(db: PrismaClient, adminUserId: string | undefined) {
  const channelType = await db.channelType.findUniqueOrThrow({ where: { code: CHANNEL_TYPE_CODE } });
  const existing = await db.channelTypeVersion.findFirst({
    where: { channelTypeId: channelType.id },
    orderBy: { version: "desc" },
  });
  if (existing !== null) return existing;

  const funnelStage = await db.funnelStage.findUniqueOrThrow({ where: { id: channelType.funnelStageId } });
  const version = await db.channelTypeVersion.create({
    data: {
      channelTypeId: channelType.id,
      version: 1,
      publishedById: adminUserId ?? "seed-script",
      definitionJson: {
        channelTypeId: channelType.id,
        code: channelType.code,
        name: channelType.name,
        funnelStageCode: funnelStage.code,
        producesLeads: channelType.producesLeads,
        requiresAsset: channelType.requiresAsset,
        metricMode: channelType.metricMode,
        allowedMetricFields: channelType.allowedMetricFieldsJson,
        pricingUnit: channelType.pricingUnit,
        requiresTeleVerification: channelType.requiresTeleVerification,
        verificationSlaBusinessDays: channelType.verificationSlaBusinessDays,
        qualificationFormId: channelType.defaultQualificationFormId,
        questions: [],
      },
    },
  });
  await db.channelType.update({ where: { id: channelType.id }, data: { currentVersion: 1 } });
  return version;
}

export async function seedDemoCampaigns(db: PrismaClient): Promise<void> {
  await resetCampaignData(db);

  const clientOrg = await ensureClientOrg(db);
  const adminUser = await db.user.findUniqueOrThrow({
    where: { email: ADMIN_EMAIL },
  });
  const createdById = adminUser.id;

  const channelTypeVersion = await ensurePublishedChannelTypeVersion(db, createdById);

  type Plan = {
    code: string;
    name: string;
    campaignStatus: "draft" | "pending" | "scheduled" | "live";
    channelStatus: "draft" | "pending" | "scheduled" | "live";
    startDate: string;
    endDate: string;
  };

  const plans: Plan[] = [
    { code: "ACME-DRAFT-01", name: "Acme Draft Campaign", campaignStatus: "draft", channelStatus: "draft", startDate: "2026-11-01", endDate: "2026-12-31" },
    { code: "ACME-PENDING-01", name: "Acme Pending Campaign", campaignStatus: "pending", channelStatus: "pending", startDate: "2026-10-15", endDate: "2026-12-15" },
    { code: "ACME-SCHEDULED-01", name: "Acme Scheduled Campaign", campaignStatus: "scheduled", channelStatus: "scheduled", startDate: "2026-10-01", endDate: "2026-12-01" },
    { code: "ACME-LIVE-01", name: "Acme Live Campaign", campaignStatus: "live", channelStatus: "live", startDate: "2026-09-01", endDate: "2026-12-31" },
  ];

  for (const plan of plans) {
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: clientOrg.id,
        name: plan.name,
        code: plan.code,
        status: plan.campaignStatus,
        startDate: new Date(plan.startDate),
        endDate: new Date(plan.endDate),
        currency: "USD",
        createdById,
        updatedById: createdById,
      },
    });
    await db.campaignStatusHistory.create({
      data: { campaignId: campaign.id, fromStatus: null, toStatus: plan.campaignStatus, changedByUserId: createdById, reason: "seeded" },
    });

    const channel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id,
        channelTypeVersionId: channelTypeVersion.id,
        contractedQuantity: 50,
        clientUnitPriceMinor: 15000n,
        currency: "USD",
        startDate: new Date(plan.startDate),
        endDate: new Date(plan.endDate),
        status: plan.channelStatus,
        createdById,
        updatedById: createdById,
      },
    });

    if (plan.campaignStatus !== "live") continue;

    await db.icpCriterion.createMany({
      data: [
        { campaignChannelId: channel.id, dimension: "industry", operator: "in", valuesJson: ["Software", "SaaS"], isMandatory: true, createdById, updatedById: createdById },
        { campaignChannelId: channel.id, dimension: "employeeRange", operator: "in", valuesJson: ["51-200", "201-500"], isMandatory: false, createdById, updatedById: createdById },
        { campaignChannelId: channel.id, dimension: "country", operator: "in", valuesJson: ["United States", "Canada", "United Kingdom", "Germany"], isMandatory: true, createdById, updatedById: createdById },
      ],
    });

    await db.leadFieldSpec.createMany({
      data: [
        { campaignChannelId: channel.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true, createdById, updatedById: createdById },
        { campaignChannelId: channel.id, fieldKey: "firstName", label: "First Name", dataType: "string", isRequired: true, rejectIfMissing: true, createdById, updatedById: createdById },
        { campaignChannelId: channel.id, fieldKey: "lastName", label: "Last Name", dataType: "string", isRequired: true, rejectIfMissing: true, createdById, updatedById: createdById },
        { campaignChannelId: channel.id, fieldKey: "companyName", label: "Company Name", dataType: "string", isRequired: true, rejectIfMissing: true, createdById, updatedById: createdById },
        { campaignChannelId: channel.id, fieldKey: "jobTitle", label: "Job Title", dataType: "string", isRequired: false, rejectIfMissing: false, createdById, updatedById: createdById },
      ],
    });

    const submission = await db.leadSubmission.create({
      data: {
        campaignChannelId: channel.id,
        sourceType: "internal",
        submittedById: createdById,
        mappingJson: { email: "email", firstName: "firstName", lastName: "lastName", companyName: "companyName", jobTitle: "jobTitle" },
        rowsTotal: LEADS.length,
        rowsAccepted: LEADS.length,
        status: "completed",
      },
    });

    for (const lead of LEADS) {
      const normalizedName = normalizeCompanyName(lead.company);
      const email = normalizeEmail(`${lead.first}.${lead.last}@${lead.domain}`.toLowerCase());

      const account = await db.account.create({
        data: {
          name: lead.company,
          normalizedName,
          primaryDomain: lead.domain,
          country: lead.country,
          industry: lead.industry,
          employeeRange: "51-200",
          createdById,
          updatedById: createdById,
        },
      });
      const contact = await db.contact.create({
        data: {
          accountId: account.id,
          email,
          emailNormalized: email,
          firstName: lead.first,
          lastName: lead.last,
          jobTitle: lead.title,
          jobFunction: lead.fn,
          country: lead.country,
          createdById,
          updatedById: createdById,
        },
      });
      await db.lead.create({
        data: {
          campaignChannelId: channel.id,
          submissionId: submission.id,
          contactId: contact.id,
          accountId: account.id,
          sourceType: "internal",
          verificationStatus: "passed",
          lifecycleStatus: "accepted",
          clientVisible: true,
          fieldValuesJson: {
            email,
            firstName: lead.first,
            lastName: lead.last,
            companyName: lead.company,
            jobTitle: lead.title,
          },
          acceptedAt: new Date(),
        },
      });
    }

    await db.campaignChannel.update({
      where: { id: channel.id },
      data: { reservedCount: LEADS.length, deliveredCount: LEADS.length },
    });
  }
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter });
  try {
    await seedDemoCampaigns(db);
    console.log("demo campaigns seeded");
  } finally {
    await db.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
