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

/**
 * `webhookSecret` is required on first creation of a webhook config, but must
 * be omittable on later edits — the form labels it "leave blank to keep
 * current" and sends `undefined` when the admin isn't rotating it. So the
 * requirement is: a secret must exist somewhere, either freshly supplied or
 * already on the row from a prior save.
 */
function validate(input: DeliveryConfigInput, existing: DeliveryConfig | null): void {
  if (input.fieldMapping.length === 0) {
    throw new ValidationError("At least one field mapping is required");
  }
  if (input.method === "webhook") {
    if (!input.webhookUrl || input.webhookUrl.trim() === "") {
      throw new ValidationError("webhookUrl is required for a webhook delivery config");
    }
    const providedSecret = input.webhookSecret !== undefined && input.webhookSecret.trim() !== "";
    const hasExistingSecret = existing !== null && existing.webhookSecret !== null;
    if (!providedSecret && !hasExistingSecret) {
      throw new ValidationError("webhookSecret is required for a webhook delivery config");
    }
  } else {
    if (!input.csvScheduleCron || input.csvScheduleCron.trim() === "") {
      throw new ValidationError("csvScheduleCron is required for a csv delivery config");
    }
    validateCronShape(input.csvScheduleCron);
  }
}

// Only "*" and comma-separated lists of digits per field — no ranges ("-"), steps ("/"), or
// named values (letters). A field that doesn't match this never matches anything in
// cron.ts's fieldMatches (it Number()s each token, yielding NaN), so a malformed cron would
// otherwise be silently accepted here and then silently never fire, forever.
const CRON_FIELD_PATTERN = /^(\*|\d+(,\d+)*)$/;

function validateCronShape(cron: string): void {
  const fields = cron.trim().split(/\s+/);
  const isWellFormed = fields.length === 5 && fields.every((field) => CRON_FIELD_PATTERN.test(field));
  if (!isWellFormed) {
    throw new ValidationError(
      `Invalid cron expression "${cron}" — only "*" and comma-separated lists of numbers are supported per field (5 fields required, e.g. "0 6 * * *")`,
    );
  }
}

/** New secret if the caller supplied one (rotation), else whatever secret was already on the row (or null, for a fresh csv-only row). */
function resolveWebhookSecret(input: DeliveryConfigInput, existing: DeliveryConfig | null): string | null {
  const trimmed = input.webhookSecret?.trim();
  if (trimmed !== undefined && trimmed !== "") return trimmed;
  return existing?.webhookSecret ?? null;
}

/** Admin-authored config, one per CampaignChannel (unique constraint) — create-or-update in one call. */
export async function upsertDeliveryConfig(
  db: PrismaClient,
  actor: Actor,
  input: DeliveryConfigInput,
): Promise<DeliveryConfig> {
  assertPermission(actor, "delivery:write");
  const existing = await db.deliveryConfig.findUnique({ where: { campaignChannelId: input.campaignChannelId } });
  validate(input, existing);

  const data = {
    method: input.method,
    webhookUrl: input.method === "webhook" ? input.webhookUrl : null,
    webhookSecret: input.method === "webhook" ? resolveWebhookSecret(input, existing) : null,
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
