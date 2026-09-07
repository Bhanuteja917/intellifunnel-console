import type { Organization, PrismaClient } from "@prisma/client";
import { withAudit } from "@/lib/audit/audit";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";

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

export async function setOrganizationRetentionOverride(
  db: PrismaClient,
  actor: Actor,
  organizationId: string,
  months: number | null,
): Promise<Organization> {
  assertPermission(actor, "compliance:write");
  if (months !== null && months <= 0) {
    throw new ValidationError("Retention months must be a positive number, or null to clear the override");
  }

  return withAudit<Organization>(
    db,
    actor,
    (updated) => ({
      entityType: "Organization",
      entityId: organizationId,
      action: "update",
      after: { personalDataRetentionMonths: updated.personalDataRetentionMonths },
    }),
    async (tx) =>
      tx.organization.update({
        where: { id: organizationId },
        data: { personalDataRetentionMonths: months, updatedById: actor.userId },
      }),
  );
}
