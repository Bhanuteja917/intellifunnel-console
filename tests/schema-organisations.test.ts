import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";

describe("organisation schema", () => {
  beforeEach(resetDb);

  it("supports an organisation that is both client and partner", async () => {
    const db = testDb();
    const org = await db.organization.create({
      data: {
        name: "Acme",
        isClient: true,
        isPartner: true,
        isInternal: false,
        status: "active",
        country: "IN",
        defaultBillingCurrency: "USD",
        defaultPayoutCurrency: "INR",
        payoutTrigger: "monthlyArrears",
      },
    });
    expect(org.isClient && org.isPartner).toBe(true);
  });

  it("enforces a unique normalised organisation domain", async () => {
    const db = testDb();
    const org = await db.organization.create({
      data: { name: "Acme", isClient: true, status: "active" },
    });
    await db.organizationDomain.create({ data: { organizationId: org.id, domain: "acme.com" } });
    await expect(
      db.organizationDomain.create({ data: { organizationId: org.id, domain: "acme.com" } }),
    ).rejects.toThrow();
  });

  it("enforces a unique normalised user email", async () => {
    const db = testDb();
    const org = await db.organization.create({
      data: { name: "Acme", isClient: true, status: "active" },
    });
    await db.user.create({
      data: { email: "jane@acme.com", name: "Jane", organizationId: org.id, status: "active" },
    });
    await expect(
      db.user.create({
        data: { email: "jane@acme.com", name: "Jane Two", organizationId: org.id, status: "active" },
      }),
    ).rejects.toThrow();
  });

  it("seeds all ten roles across three portals", async () => {
    const db = testDb();
    await seedRoles(db);
    expect(await db.role.count()).toBe(10);
    expect(await db.role.count({ where: { portal: "admin" } })).toBe(6);
    expect(await db.role.count({ where: { portal: "client" } })).toBe(2);
    expect(await db.role.count({ where: { portal: "partner" } })).toBe(2);
  });

  it("is idempotent when the role seed runs twice", async () => {
    const db = testDb();
    await seedRoles(db);
    await seedRoles(db);
    expect(await db.role.count()).toBe(10);
  });
});
