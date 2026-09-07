import type { DoNotContact, DoNotContactType, PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { hashSuppressionValue } from "@/lib/lists/suppression";
import { normalizeDomain } from "@/lib/normalise/domain";
import { normalizeEmail } from "@/lib/normalise/email";
import { normalizePhone } from "@/lib/normalise/phone";

export async function listDoNotContactEntries(
  db: PrismaClient,
  actor: Actor,
  clientOrganizationId: string,
): Promise<DoNotContact[]> {
  assertPermission(actor, "compliance:read");
  return db.doNotContact.findMany({ where: { clientOrganizationId }, orderBy: { addedAt: "desc" } });
}

function normalizeDncValue(type: DoNotContactType, rawValue: string): string {
  if (type === "email") return normalizeEmail(rawValue);
  if (type === "domain") {
    const domain = normalizeDomain(rawValue);
    if (domain === null) throw new ValidationError(`Not a valid domain: ${rawValue}`);
    return domain;
  }
  const phone = normalizePhone(rawValue);
  if (phone === null) throw new ValidationError(`Not a valid phone number: ${rawValue}`);
  return phone;
}

export async function createDoNotContactEntry(
  db: PrismaClient,
  actor: Actor,
  input: { clientOrganizationId: string; type: DoNotContactType; rawValue: string; reason?: string; expiresAt?: Date },
): Promise<DoNotContact> {
  assertPermission(actor, "compliance:write");
  const value = normalizeDncValue(input.type, input.rawValue);

  return withAudit<DoNotContact>(
    db,
    actor,
    (created) => ({
      entityType: "DoNotContact",
      entityId: created.id,
      action: "create",
      after: { clientOrganizationId: created.clientOrganizationId, type: created.type, value: created.value },
    }),
    async (tx) =>
      tx.doNotContact.create({
        data: {
          clientOrganizationId: input.clientOrganizationId,
          type: input.type,
          value,
          valueHash: hashSuppressionValue(value),
          reason: input.reason,
          expiresAt: input.expiresAt,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}

export async function deleteDoNotContactEntry(db: PrismaClient, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, "compliance:write");

  await withAudit(
    db,
    actor,
    (before: DoNotContact) => ({
      entityType: "DoNotContact",
      entityId: id,
      action: "delete",
      before: { clientOrganizationId: before.clientOrganizationId, type: before.type, value: before.value },
    }),
    async (tx) => {
      const existing = await tx.doNotContact.findUnique({ where: { id } });
      if (existing === null) throw new NotFoundError(`DoNotContact entry not found: ${id}`);
      await tx.doNotContact.delete({ where: { id } });
      return existing;
    },
  );
}
