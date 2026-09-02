import type { Prisma, PrismaClient } from "@prisma/client";
import { SETTING_DEFAULTS } from "@/lib/settings/settings";

export async function seedSettings(db: PrismaClient): Promise<void> {
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await db.platformSetting.upsert({
      where: { key },
      update: {}, // never overwrite an operator's change
      create: { key, valueJson: value as Prisma.InputJsonValue },
    });
  }
}
