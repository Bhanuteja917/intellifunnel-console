import type { Portal, PrismaClient } from "@prisma/client";

export const ROLE_DEFINITIONS: ReadonlyArray<{ code: string; name: string; portal: Portal }> = [
  { code: "SUPER_ADMIN", name: "Super Admin", portal: "admin" },
  { code: "CAMPAIGN_MANAGER", name: "Campaign Manager", portal: "admin" },
  { code: "OPERATIONS", name: "Operations", portal: "admin" },
  { code: "QUALITY", name: "Quality", portal: "admin" },
  { code: "ACCOUNT_MANAGER", name: "Account Manager", portal: "admin" },
  { code: "FINANCE", name: "Finance", portal: "admin" },
  { code: "CLIENT_ADMIN", name: "Client Admin", portal: "client" },
  { code: "CLIENT_VIEWER", name: "Client Viewer", portal: "client" },
  { code: "PARTNER_ADMIN", name: "Partner Admin", portal: "partner" },
  { code: "PARTNER_OPERATOR", name: "Partner Operator", portal: "partner" },
];

export async function seedRoles(db: PrismaClient): Promise<void> {
  for (const role of ROLE_DEFINITIONS) {
    await db.role.upsert({
      where: { code: role.code },
      update: { name: role.name, portal: role.portal },
      create: role,
    });
  }
}
