import { describe, expect, it } from "vitest";
import { campaignChannelOrgScopeClause, campaignOrgScopeClause, type Actor } from "@/lib/auth/permissions";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "u1",
    organizationId: "org1",
    portal: "admin",
    roles: [],
    isClient: false,
    isPartner: false,
    isInternal: false,
    ...overrides,
  };
}

describe("campaignChannelOrgScopeClause", () => {
  it("returns {} for an internal actor", () => {
    expect(campaignChannelOrgScopeClause(actor({ isInternal: true }))).toEqual({});
  });

  it("scopes to the actor's organisation otherwise", () => {
    expect(campaignChannelOrgScopeClause(actor({ organizationId: "org1" }))).toEqual({
      campaign: { clientOrganizationId: "org1" },
    });
  });
});

describe("campaignOrgScopeClause", () => {
  it("returns {} for an internal actor", () => {
    expect(campaignOrgScopeClause(actor({ isInternal: true }))).toEqual({});
  });

  it("scopes to the actor's organisation otherwise", () => {
    expect(campaignOrgScopeClause(actor({ organizationId: "org1" }))).toEqual({ clientOrganizationId: "org1" });
  });
});
