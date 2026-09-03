import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount } from "@/lib/identity/account-resolution";
import { createCampaign } from "@/lib/campaigns/crud";
import {
  attachTargetAccountList,
  importTargetAccountList,
  resolveAccountCap,
} from "@/lib/lists/target-accounts";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  return { db, ops, manager, client };
}

const CSV = [
  "Company,Website,Max Leads",
  "Acme Inc,https://www.acme.com,3",
  "Globex,globex.com,",
  "Unknown Co,not-a-domain,",
].join("\n");

const MAPPING = { Company: "rawName", Website: "rawDomain", "Max Leads": "maxLeadsPerAccountOverride" };

describe("target account list import", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("matches entries to existing accounts by normalised domain", async () => {
    const { db, ops, client } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Q4 TAL", content: CSV, mapping: MAPPING,
    });

    const entries = await db.targetAccountEntry.findMany({ where: { listId: result.listId } });
    const acmeEntry = entries.find((e) => e.rawName === "Acme Inc");
    expect(acmeEntry?.matchStatus).toBe("matched");
    expect(acmeEntry?.accountId).toBe(acme.id);
    expect(acmeEntry?.normalizedDomain).toBe("acme.com");
  });

  it("leaves unmatched entries unmatched rather than creating accounts", async () => {
    const { db, ops, client } = await setup();

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Q4 TAL", content: CSV, mapping: MAPPING,
    });

    const entries = await db.targetAccountEntry.findMany({ where: { listId: result.listId } });
    expect(entries.filter((e) => e.matchStatus === "unmatched")).toHaveLength(3);
    expect(await db.account.count()).toBe(0);
  });

  it("stores the per-entry cap override", async () => {
    const { db, ops, client } = await setup();

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Q4 TAL", content: CSV, mapping: MAPPING,
    });

    const entries = await db.targetAccountEntry.findMany({ where: { listId: result.listId } });
    expect(entries.find((e) => e.rawName === "Acme Inc")?.maxLeadsPerAccountOverride).toBe(3);
    expect(entries.find((e) => e.rawName === "Globex")?.maxLeadsPerAccountOverride).toBeNull();
  });

  it("reports a per-row error for a row with neither name nor domain", async () => {
    const { db, ops, client } = await setup();
    const content = "Company,Website\nAcme,acme.com\n,\n";

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content,
      mapping: { Company: "rawName", Website: "rawDomain" },
    });

    expect(result.rowsAccepted).toBe(1);
    expect(result.rowsFailed).toBe(1);
    expect(result.errors[0]?.rowNumber).toBe(2);
    expect(result.errors[0]?.message).toMatch(/name or domain/i);

    const persisted = await db.importError.findMany({ where: { batchId: result.batchId } });
    expect(persisted).toHaveLength(1);
  });

  it("records an ambiguous match without picking a candidate", async () => {
    const { db, ops, client } = await setup();
    await createAccount(db, ops, { name: "Acme", domain: "acme-one.com", country: "US" });
    await createAccount(db, ops, { name: "Acme", domain: "acme-two.com", country: "US" });
    const content = "Company,Country\nAcme,US\n";

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content,
      mapping: { Company: "rawName", Country: "country" },
    });

    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { listId: result.listId } });
    expect(entry.matchStatus).toBe("ambiguous");
    expect(entry.accountId).toBeNull();
    expect(entry.candidateAccountIdsJson).toHaveLength(2);
  });
});

describe("resolveAccountCap (PRD decisions 3 and 4)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("prefers the entry override over the campaign default", async () => {
    const { db, ops, manager, client } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CAP-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
      currency: "USD", defaultMaxLeadsPerAccount: 5,
    });
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
    });
    await attachTargetAccountList(db, manager, campaign.id, listId);

    expect(await resolveAccountCap(db, campaign.id, acme.id)).toBe(3);
  });

  it("falls back to the campaign default when there is no override", async () => {
    const { db, ops, manager, client } = await setup();
    const globex = await createAccount(db, ops, { name: "Globex", domain: "globex.com", country: "US" });
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CAP-2",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
      currency: "USD", defaultMaxLeadsPerAccount: 5,
    });
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
    });
    await attachTargetAccountList(db, manager, campaign.id, listId);

    expect(await resolveAccountCap(db, campaign.id, globex.id)).toBe(5);
  });

  it("returns null when neither an override nor a campaign default is set", async () => {
    const { db, ops, manager, client } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CAP-3",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    expect(await resolveAccountCap(db, campaign.id, acme.id)).toBeNull();
  });
});
