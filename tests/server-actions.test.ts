import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { toActionResult } from "@/lib/auth/require";
import { ForbiddenError, ValidationError } from "@/lib/errors";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("toActionResult", () => {
  it("wraps a success", async () => {
    expect(await toActionResult(async () => 42)).toEqual({ ok: true, data: 42 });
  });

  it("converts an ApplicationError into a serialisable failure", async () => {
    const result = await toActionResult(async () => {
      throw new ValidationError("Campaign code already exists: X");
    });
    expect(result).toEqual({
      ok: false, error: "Campaign code already exists: X", code: "VALIDATION_ERROR",
    });
  });

  it("converts a ForbiddenError without leaking internals", async () => {
    const result = await toActionResult(async () => {
      throw new ForbiddenError("Missing permission: campaign:write");
    });
    expect(result).toEqual({
      ok: false, error: "Missing permission: campaign:write", code: "FORBIDDEN",
    });
  });

  it("rethrows an unexpected error rather than swallowing it", async () => {
    await expect(
      toActionResult(async () => {
        throw new TypeError("undefined is not a function");
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("client stores (Zustand, not React Context)", () => {
  beforeEach(async () => {
    const { useCampaignFilters } = await import("@/lib/stores/campaign-filters");
    useCampaignFilters.getState().reset();
  });

  it("holds and resets the campaign filter state", async () => {
    const { useCampaignFilters } = await import("@/lib/stores/campaign-filters");

    useCampaignFilters.getState().setStatus("live");
    useCampaignFilters.getState().setQuery("acme");
    expect(useCampaignFilters.getState().status).toBe("live");
    expect(useCampaignFilters.getState().query).toBe("acme");

    useCampaignFilters.getState().reset();
    expect(useCampaignFilters.getState().status).toBe("all");
    expect(useCampaignFilters.getState().query).toBe("");
  });

  it("tracks the selected resolution queue entry", async () => {
    const { useResolutionQueue } = await import("@/lib/stores/resolution-queue");

    expect(useResolutionQueue.getState().selectedEntryId).toBeNull();
    useResolutionQueue.getState().select("entry-1");
    expect(useResolutionQueue.getState().selectedEntryId).toBe("entry-1");
    useResolutionQueue.getState().clear();
    expect(useResolutionQueue.getState().selectedEntryId).toBeNull();
  });
});

describe("invitation acceptance action", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedSettings(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
    vi.resetModules();
  });

  it("returns a failure result rather than throwing on a bad token", async () => {
    // acceptInvitation creates the Better Auth credential via `auth.$context`'s
    // `internalAdapter.createUser` + `linkAccount` (not `auth.api.signUpEmail`,
    // which is gated by `disableSignUp` — see the comment on `acceptInvitation`
    // in src/lib/invitations/invitations.ts and the equivalent mock in
    // tests/invitations.test.ts). This mock stands in for that shape.
    vi.doMock("@/lib/auth/better-auth", () => ({
      auth: {
        $context: Promise.resolve({
          password: {
            hash: async () => "hashed-password",
            config: { minPasswordLength: 8, maxPasswordLength: 128 },
          },
          internalAdapter: {
            createUser: async (user: { email: string }) => ({ id: "auth-x", ...user }),
            linkAccount: async () => undefined,
          },
        }),
      },
    }));
    vi.doMock("@/lib/db", () => ({ db: testDb() }));

    const { acceptInvitationAction } = await import("@/app/invite/[token]/actions");
    const result = await acceptInvitationAction({
      token: "not-a-real-token", name: "Jane", password: "correct horse battery staple",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("creates the user on a valid token", async () => {
    const db = testDb();
    vi.doMock("@/lib/auth/better-auth", () => ({
      auth: {
        $context: Promise.resolve({
          password: {
            hash: async () => "hashed-password",
            config: { minPasswordLength: 8, maxPasswordLength: 128 },
          },
          internalAdapter: {
            createUser: async (user: { email: string }) => ({ id: "auth-ok", ...user }),
            linkAccount: async () => undefined,
          },
        }),
      },
    }));
    vi.doMock("@/lib/db", () => ({ db }));

    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const inviter = await createUser(db, internal.id, "SUPER_ADMIN");
    const { loadActor } = await import("@/lib/auth/permissions");
    const { createInvitation } = await import("@/lib/invitations/invitations");
    const client = await createOrganization(db, { isClient: true });
    const { token } = await createInvitation(db, await loadActor(db, inviter.id), {
      email: "new@client.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });

    const { acceptInvitationAction } = await import("@/app/invite/[token]/actions");
    const result = await acceptInvitationAction({
      token, name: "New User", password: "correct horse battery staple",
    });

    expect(result.ok).toBe(true);
    expect(await db.user.count({ where: { email: "new@client.com" } })).toBe(1);
  });
});
