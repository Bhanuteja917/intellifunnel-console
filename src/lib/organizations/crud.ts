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
