import type { PrismaClient } from "@prisma/client";

export const FUNNEL_STAGES = [
  { code: "PROGRAMMATIC", name: "Programmatic", sortOrder: 1 },
  { code: "TOFU", name: "Top of funnel", sortOrder: 2 },
  { code: "MOFU", name: "Middle of funnel", sortOrder: 3 },
  { code: "BOFU", name: "Bottom of funnel", sortOrder: 4 },
] as const;

export async function seedFunnelStages(db: PrismaClient): Promise<void> {
  for (const stage of FUNNEL_STAGES) {
    await db.funnelStage.upsert({
      where: { code: stage.code },
      update: { name: stage.name, sortOrder: stage.sortOrder },
      create: stage,
    });
  }
}
