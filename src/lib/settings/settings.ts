import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type WeekDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type SettingValues = {
  reportingCurrency: string;
  defaultVerificationSlaBusinessDays: number;
  operatingTimezone: string;
  workingDays: WeekDay[];
  workingHours: string;
  personalDataRetentionMonths: number;
  invitationExpiryDays: number;
};

export type SettingKey = keyof SettingValues;

export const SETTING_DEFAULTS: SettingValues = {
  reportingCurrency: "INR",
  defaultVerificationSlaBusinessDays: 3,
  operatingTimezone: "Asia/Kolkata",
  workingDays: ["MO", "TU", "WE", "TH", "FR"],
  workingHours: "09:00-18:00",
  personalDataRetentionMonths: 12,
  invitationExpiryDays: 7,
};

type Db = PrismaClient | Prisma.TransactionClient;

export async function getSetting<K extends SettingKey>(
  client: Db,
  key: K,
): Promise<SettingValues[K]> {
  const row = await client.platformSetting.findUnique({ where: { key } });
  if (row === null) {
    throw new NotFoundError(`Platform setting not configured: ${key}. Run the seed.`);
  }
  return row.valueJson as SettingValues[K];
}

export async function setSetting<K extends SettingKey>(
  db: PrismaClient,
  actor: Actor,
  key: K,
  value: SettingValues[K],
): Promise<void> {
  assertPermission(actor, "setting:write");
  if (!(key in SETTING_DEFAULTS)) throw new ValidationError(`Unknown setting: ${key}`);

  await withAudit<Awaited<ReturnType<typeof db.platformSetting.findUnique>>>(
    db,
    actor,
    (existing) => ({
      entityType: "PlatformSetting",
      entityId: key,
      action: existing === null ? "create" : "update",
      before: existing === null ? undefined : { value: existing.valueJson },
      after: { value },
    }),
    async (tx) => {
      // Read inside the transaction so the "before" snapshot used for the audit
      // entry is transactionally consistent with the write below (NFR-A-1),
      // rather than a snapshot taken before the transaction started.
      const existing = await tx.platformSetting.findUnique({ where: { key } });
      await tx.platformSetting.upsert({
        where: { key },
        update: { valueJson: value as Prisma.InputJsonValue, updatedById: actor.userId },
        create: { key, valueJson: value as Prisma.InputJsonValue, updatedById: actor.userId },
      });
      return existing;
    },
  );
}
