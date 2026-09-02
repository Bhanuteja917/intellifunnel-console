import type { PrismaClient } from "@prisma/client";
import { normalizeEmail } from "@/lib/normalise/email";

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

export async function createOrganization(
  db: PrismaClient,
  overrides: Partial<{
    name: string;
    isClient: boolean;
    isPartner: boolean;
    isInternal: boolean;
    defaultBillingCurrency: string;
    defaultPayoutCurrency: string;
  }> = {},
) {
  return db.organization.create({
    data: {
      name: overrides.name ?? `Org ${unique()}`,
      isClient: overrides.isClient ?? true,
      isPartner: overrides.isPartner ?? false,
      isInternal: overrides.isInternal ?? false,
      status: "active",
      country: "IN",
      defaultBillingCurrency: overrides.defaultBillingCurrency ?? "USD",
      defaultPayoutCurrency: overrides.defaultPayoutCurrency ?? "INR",
    },
  });
}

export async function createUser(
  db: PrismaClient,
  organizationId: string,
  roleCode: string,
  overrides: Partial<{ email: string; name: string }> = {},
) {
  const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
  return db.user.create({
    data: {
      email: normalizeEmail(overrides.email ?? `user-${unique()}@example.com`),
      name: overrides.name ?? "Test User",
      organizationId,
      status: "active",
      roles: { create: { roleId: role.id } },
    },
    include: { roles: { include: { role: true } } },
  });
}
