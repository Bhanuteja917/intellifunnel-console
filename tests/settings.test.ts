import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings/settings";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

describe("platform settings", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("seeds every launch value from SRS §4.9", async () => {
    const db = testDb();
    await seedSettings(db);

    expect(await getSetting(db, "reportingCurrency")).toBe("INR");
    expect(await getSetting(db, "defaultVerificationSlaBusinessDays")).toBe(3);
    expect(await getSetting(db, "operatingTimezone")).toBe("Asia/Kolkata");
    expect(await getSetting(db, "workingDays")).toEqual(["MO", "TU", "WE", "TH", "FR"]);
    expect(await getSetting(db, "personalDataRetentionMonths")).toBe(12);
    expect(await getSetting(db, "invitationExpiryDays")).toBe(7);
  });

  it("throws rather than guessing when a setting is missing", async () => {
    await expect(getSetting(testDb(), "reportingCurrency")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a Super Admin change a setting and audits the change", async () => {
    const db = testDb();
    await seedSettings(db);
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "SUPER_ADMIN");
    const actor = await loadActor(db, user.id);

    await setSetting(db, actor, "invitationExpiryDays", 14);

    expect(await getSetting(db, "invitationExpiryDays")).toBe(14);
    const entry = await db.auditLog.findFirstOrThrow({ where: { entityType: "PlatformSetting" } });
    expect(entry.beforeJson).toEqual({ value: 7 });
    expect(entry.afterJson).toEqual({ value: 14 });
  });

  it("refuses a non-Super-Admin", async () => {
    const db = testDb();
    await seedSettings(db);
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "OPERATIONS");
    const actor = await loadActor(db, user.id);

    await expect(setSetting(db, actor, "invitationExpiryDays", 14)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
