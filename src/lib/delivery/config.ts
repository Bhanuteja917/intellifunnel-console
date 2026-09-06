import type { DeliveryConfig, DeliveryConfigStatus, DeliveryMethod, Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import type { FieldMappingEntry } from "@/lib/delivery/field-mapping";

export type DeliveryConfigInput = {
  campaignChannelId: string;
  method: DeliveryMethod;
  webhookUrl?: string;
  webhookSecret?: string;
  csvScheduleCron?: string;
  fieldMapping: FieldMappingEntry[];
};

function validate(input: DeliveryConfigInput): void {
  if (input.fieldMapping.length === 0) {
    throw new ValidationError("At least one field mapping is required");
  }
  if (input.method === "webhook") {
    if (!input.webhookUrl || input.webhookUrl.trim() === "") {
      throw new ValidationError("webhookUrl is required for a webhook delivery config");
    }
    if (!input.webhookSecret || input.webhookSecret.trim() === "") {
      throw new ValidationError("webhookSecret is required for a webhook delivery config");
    }
  } else {
    if (!input.csvScheduleCron || input.csvScheduleCron.trim() === "") {
      throw new ValidationError("csvScheduleCron is required for a csv delivery config");
    }
  }
}

/** Admin-authored config, one per CampaignChannel (unique constraint) — create-or-update in one call. */
export async function upsertDeliveryConfig(
  db: PrismaClient,
  actor: Actor,
  input: DeliveryConfigInput,
): Promise<DeliveryConfig> {
  assertPermission(actor, "delivery:write");
  validate(input);

  const data = {
    method: input.method,
    webhookUrl: input.method === "webhook" ? input.webhookUrl : null,
    webhookSecret: input.method === "webhook" ? input.webhookSecret : null,
    csvScheduleCron: input.method === "csv" ? input.csvScheduleCron : null,
    fieldMappingJson: input.fieldMapping as unknown as Prisma.InputJsonValue,
    updatedById: actor.userId,
  };

  return withAudit(
    db,
    actor,
    (result: DeliveryConfig) => {
      // Redact webhookSecret from audit log to prevent plaintext leakage
      const auditData = { ...data };
      if (auditData.webhookSecret !== null) {
        auditData.webhookSecret = "[redacted]" as never;
      }
      return { entityType: "DeliveryConfig", entityId: result.id, action: "upsert", after: auditData };
    },
    (tx) =>
      tx.deliveryConfig.upsert({
        where: { campaignChannelId: input.campaignChannelId },
        create: { campaignChannelId: input.campaignChannelId, createdById: actor.userId, ...data },
        update: data,
      }),
  );
}

export async function getDeliveryConfigForChannel(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<DeliveryConfig | null> {
  assertPermission(actor, "delivery:read");
  return db.deliveryConfig.findUnique({ where: { campaignChannelId } });
}

export async function setDeliveryConfigStatus(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  status: DeliveryConfigStatus,
): Promise<DeliveryConfig> {
  assertPermission(actor, "delivery:write");
  const existing = await db.deliveryConfig.findUnique({ where: { campaignChannelId } });
  if (existing === null) throw new NotFoundError("No delivery config on this channel");

  return withAudit(
    db,
    actor,
    { entityType: "DeliveryConfig", entityId: existing.id, action: "setStatus", before: { status: existing.status }, after: { status } },
    (tx) => tx.deliveryConfig.update({ where: { id: existing.id }, data: { status, updatedById: actor.userId } }),
  );
}
