import type { Organization, PrismaClient } from "@prisma/client";
import { withAudit } from "@/lib/audit/audit";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type CreateOrganizationInput = {
  name: string;
  legalName?: string;
  isClient: boolean;
  isPartner: boolean;
  isInternal: boolean;
  country?: string;
  defaultBillingCurrency?: string;
  defaultPayoutCurrency?: string;
};

export async function createOrganization(
  db: PrismaClient,
  actor: Actor,
  input: CreateOrganizationInput,
): Promise<Organization> {
  assertPermission(actor, "organization:write");

  if (input.name.trim() === "") {
    throw new ValidationError("Organisation name is required");
  }
  if (!input.isClient && !input.isPartner && !input.isInternal) {
    throw new ValidationError("Select at least one organisation type (client, partner, or internal)");
  }

  return withAudit<Organization>(
    db,
    actor,
    (created) => ({
      entityType: "Organization",
      entityId: created.id,
      action: "create",
      after: { name: created.name, isClient: created.isClient, isPartner: created.isPartner, isInternal: created.isInternal },
    }),
    async (tx) =>
      tx.organization.create({
        data: {
          name: input.name,
          legalName: input.legalName,
          isClient: input.isClient,
          isPartner: input.isPartner,
          isInternal: input.isInternal,
          country: input.country,
          defaultBillingCurrency: input.defaultBillingCurrency,
          defaultPayoutCurrency: input.defaultPayoutCurrency,
          createdById: actor.userId,
        },
      }),
  );
}

const ACTIVE_CAMPAIGN_STATUSES = ["live", "paused", "scheduled"] as const;

export async function archiveOrganization(
  db: PrismaClient,
  actor: Actor,
  organizationId: string,
): Promise<Organization> {
  assertPermission(actor, "organization:write");

  const activeCampaigns = await db.campaign.count({
    where: { clientOrganizationId: organizationId, status: { in: [...ACTIVE_CAMPAIGN_STATUSES] } },
  });
  if (activeCampaigns > 0) {
    throw new ValidationError("Cannot archive an organisation with live, paused, or scheduled campaigns");
  }

  return withAudit<Organization>(
    db,
    actor,
    { entityType: "Organization", entityId: organizationId, action: "archive" },
    async (tx) =>
      tx.organization.update({
        where: { id: organizationId },
        data: { status: "archived", updatedById: actor.userId },
      }),
  );
}

export async function unarchiveOrganization(
  db: PrismaClient,
  actor: Actor,
  organizationId: string,
): Promise<void> {
  assertPermission(actor, "organization:write");
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org || org.deletedAt !== null) throw new NotFoundError("Organisation not found");
  if (org.status !== "archived") throw new Error("Organisation is not archived");
  await db.organization.update({
    where: { id: organizationId },
    data: { status: "active", updatedById: actor.userId },
  });
}
