import type { MetricMode, PricingUnit, PrismaClient } from "@prisma/client";

type Seed = {
  code: string;
  name: string;
  stageCode: string;
  producesLeads: boolean;
  requiresAsset: boolean;
  metricMode: MetricMode;
  pricingUnit: PricingUnit;
  requiresTeleVerification: boolean;
  allowedMetricFields: string[];
};

export const BASE_CHANNEL_TYPES: readonly Seed[] = [
  {
    code: "PROGRAMMATIC_DISPLAY", name: "Programmatic display", stageCode: "PROGRAMMATIC",
    producesLeads: false, requiresAsset: false, metricMode: "aggregate", pricingUnit: "CPM",
    requiresTeleVerification: false, allowedMetricFields: ["impressions", "clicks", "spend"],
  },
  {
    code: "CONTENT_SYNDICATION", name: "Content syndication", stageCode: "TOFU",
    producesLeads: true, requiresAsset: true, metricMode: "event", pricingUnit: "CPL",
    requiresTeleVerification: false, allowedMetricFields: [],
  },
  {
    code: "MQL", name: "Marketing qualified lead", stageCode: "MOFU",
    producesLeads: true, requiresAsset: true, metricMode: "event", pricingUnit: "CPL",
    requiresTeleVerification: false, allowedMetricFields: [],
  },
  {
    code: "HQL_TELE", name: "Highly qualified lead with tele-verification", stageCode: "MOFU",
    producesLeads: true, requiresAsset: true, metricMode: "event", pricingUnit: "CPL",
    requiresTeleVerification: true, allowedMetricFields: [],
  },
  {
    code: "APPOINTMENT_GENERATION", name: "Appointment generation", stageCode: "BOFU",
    producesLeads: true, requiresAsset: false, metricMode: "event", pricingUnit: "CPA",
    requiresTeleVerification: true, allowedMetricFields: [],
  },
];

export async function seedChannelTypes(db: PrismaClient): Promise<void> {
  for (const seed of BASE_CHANNEL_TYPES) {
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: seed.stageCode } });
    await db.channelType.upsert({
      where: { code: seed.code },
      update: {},
      create: {
        code: seed.code,
        name: seed.name,
        funnelStageId: stage.id,
        producesLeads: seed.producesLeads,
        requiresAsset: seed.requiresAsset,
        metricMode: seed.metricMode,
        pricingUnit: seed.pricingUnit,
        requiresTeleVerification: seed.requiresTeleVerification,
        allowedMetricFieldsJson: seed.allowedMetricFields,
      },
    });
  }
}
