import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { setOrganizationRetentionOverride } from "@/lib/organizations/crud";

describe("setOrganizationRetentionOverride", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("sets and clears (null) a per-client override", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });

    const updated = await setOrganizationRetentionOverride(db, ops, client.id, 24);
    expect(updated.personalDataRetentionMonths).toBe(24);

    const cleared = await setOrganizationRetentionOverride(db, ops, client.id, null);
    expect(cleared.personalDataRetentionMonths).toBeNull();
  });

  it("rejects a non-positive months value", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
    const client = await createOrganization(db, { isClient: true });

    await expect(setOrganizationRetentionOverride(db, ops, client.id, 0)).rejects.toThrow(ValidationError);
    await expect(setOrganizationRetentionOverride(db, ops, client.id, -3)).rejects.toThrow(ValidationError);
  });

  it("rejects a non-Operations actor", async () => {
    const db = testDb();
    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
    const client = await createOrganization(db, { isClient: true });

    await expect(setOrganizationRetentionOverride(db, manager, client.id, 12)).rejects.toThrow(ForbiddenError);
  });
});
