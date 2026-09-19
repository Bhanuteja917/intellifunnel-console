import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import {
  assertOrganizationAccess,
  assertPermission,
  hasPermission,
  loadActor,
} from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";

const actorOf = (roles: string[], orgId = "org-1", overrides = {}) => ({
  userId: "user-1",
  organizationId: orgId,
  portal: "admin" as const,
  roles: roles as never,
  isClient: false,
  isPartner: false,
  isInternal: true,
  ...overrides,
});

describe("permission matrix", () => {
  it("gives Super Admin every permission", () => {
    expect(hasPermission(actorOf(["SUPER_ADMIN"]), "channelType:publish")).toBe(true);
    expect(hasPermission(actorOf(["SUPER_ADMIN"]), "campaign:approveClient")).toBe(true);
  });

  it("lets a Campaign Manager write campaigns but not publish channel types", () => {
    const actor = actorOf(["CAMPAIGN_MANAGER"]);
    expect(hasPermission(actor, "campaign:write")).toBe(true);
    expect(hasPermission(actor, "channelType:publish")).toBe(false);
  });

  it("gives Client Viewer read only", () => {
    const actor = actorOf(["CLIENT_VIEWER"], "org-2", { portal: "client", isInternal: false, isClient: true });
    expect(hasPermission(actor, "campaign:read")).toBe(true);
    expect(hasPermission(actor, "campaign:write")).toBe(false);
    expect(hasPermission(actor, "campaign:approveClient")).toBe(false);
  });

  it("gives only Client Admin the client approval permission", () => {
    const admin = actorOf(["CLIENT_ADMIN"], "org-2", { portal: "client", isInternal: false, isClient: true });
    expect(hasPermission(admin, "campaign:approveClient")).toBe(true);
  });

  it("unions permissions across multiple roles", () => {
    const actor = actorOf(["QUALITY", "ACCOUNT_MANAGER"]);
    expect(hasPermission(actor, "lead:write")).toBe(true);
    expect(hasPermission(actor, "list:read")).toBe(true);
  });

  it("gives Operations both delivery permissions, Campaign Manager only delivery:read", () => {
    const ops = actorOf(["OPERATIONS"]);
    expect(hasPermission(ops, "delivery:read")).toBe(true);
    expect(hasPermission(ops, "delivery:write")).toBe(true);

    const manager = actorOf(["CAMPAIGN_MANAGER"]);
    expect(hasPermission(manager, "delivery:read")).toBe(true);
    expect(hasPermission(manager, "delivery:write")).toBe(false);

    const quality = actorOf(["QUALITY"]);
    expect(hasPermission(quality, "delivery:read")).toBe(false);
  });

  it("gives only Operations the compliance permissions", () => {
    expect(hasPermission(actorOf(["OPERATIONS"]), "compliance:write")).toBe(true);
    expect(hasPermission(actorOf(["CAMPAIGN_MANAGER"]), "compliance:write")).toBe(false);
    expect(hasPermission(actorOf(["FINANCE"]), "compliance:read")).toBe(false);
  });

  it("assertPermission throws ForbiddenError when denied", () => {
    expect(() => assertPermission(actorOf(["CLIENT_VIEWER"]), "campaign:write")).toThrow(ForbiddenError);
  });

  it("reserves organisation and channel type management to Super Admin", () => {
    const nonSuperAdminRoles = [
      "CAMPAIGN_MANAGER",
      "OPERATIONS",
      "QUALITY",
      "ACCOUNT_MANAGER",
      "FINANCE",
      "CLIENT_ADMIN",
      "CLIENT_VIEWER",
      "PARTNER_ADMIN",
      "PARTNER_OPERATOR",
    ];

    for (const role of nonSuperAdminRoles) {
      const actor = actorOf([role]);
      expect(hasPermission(actor, "organization:read")).toBe(false);
      expect(hasPermission(actor, "organization:write")).toBe(false);
      expect(hasPermission(actor, "channelType:read")).toBe(false);
    }

    const superAdmin = actorOf(["SUPER_ADMIN"]);
    expect(hasPermission(superAdmin, "organization:read")).toBe(true);
    expect(hasPermission(superAdmin, "organization:write")).toBe(true);
    expect(hasPermission(superAdmin, "channelType:read")).toBe(true);
  });
});

describe("organisation scoping (AUTH-9)", () => {
  it("allows an internal actor to reach any organisation", () => {
    expect(() => assertOrganizationAccess(actorOf(["OPERATIONS"]), "org-999")).not.toThrow();
  });

  it("blocks a client actor from another organisation", () => {
    const actor = actorOf(["CLIENT_ADMIN"], "org-2", { portal: "client", isInternal: false, isClient: true });
    expect(() => assertOrganizationAccess(actor, "org-3")).toThrow(ForbiddenError);
    expect(() => assertOrganizationAccess(actor, "org-2")).not.toThrow();
  });
});

describe("loadActor", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("builds an actor from the database record", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: false, isInternal: true });
    const user = await createUser(db, org.id, "OPERATIONS");

    const actor = await loadActor(db, user.id);

    expect(actor.organizationId).toBe(org.id);
    expect(actor.roles).toEqual(["OPERATIONS"]);
    expect(actor.portal).toBe("admin");
    expect(actor.isInternal).toBe(true);
  });

  it("refuses a suspended user", async () => {
    const db = testDb();
    const org = await createOrganization(db);
    const user = await createUser(db, org.id, "CLIENT_ADMIN");
    await db.user.update({ where: { id: user.id }, data: { status: "suspended" } });

    await expect(loadActor(db, user.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
