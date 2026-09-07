import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { createOrganization } from "./helpers/factories";
import { checkDoNotContact } from "@/lib/leads/matching";
import { hashSuppressionValue } from "@/lib/lists/suppression";

describe("checkDoNotContact", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("matches a DNC'd email", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    await db.doNotContact.create({
      data: {
        type: "email", value: "blocked@acme.com", valueHash: hashSuppressionValue("blocked@acme.com"),
        clientOrganizationId: client.id,
      },
    });
    expect(await checkDoNotContact(db, client.id, { email: "Blocked@Acme.com" })).toBe(true);
    expect(await checkDoNotContact(db, client.id, { email: "someone-else@acme.com" })).toBe(false);
  });

  it("matches on derived domain", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    await db.doNotContact.create({
      data: { type: "domain", value: "blocked.com", valueHash: hashSuppressionValue("blocked.com"), clientOrganizationId: client.id },
    });
    expect(await checkDoNotContact(db, client.id, { email: "anyone@blocked.com" })).toBe(true);
  });

  it("matches a normalized phone", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    await db.doNotContact.create({
      data: { type: "phone", value: "+15551234567", valueHash: hashSuppressionValue("+15551234567"), clientOrganizationId: client.id },
    });
    expect(await checkDoNotContact(db, client.id, { phone: "(555) 123-4567" })).toBe(true);
  });

  it("is scoped to the client organisation — a match on a different client's list doesn't count", async () => {
    const db = testDb();
    const clientA = await createOrganization(db, { isClient: true });
    const clientB = await createOrganization(db, { isClient: true });
    await db.doNotContact.create({
      data: { type: "email", value: "x@y.com", valueHash: hashSuppressionValue("x@y.com"), clientOrganizationId: clientA.id },
    });
    expect(await checkDoNotContact(db, clientB.id, { email: "x@y.com" })).toBe(false);
  });

  it("returns false with no candidate fields", async () => {
    const db = testDb();
    const client = await createOrganization(db, { isClient: true });
    expect(await checkDoNotContact(db, client.id, {})).toBe(false);
  });
});
