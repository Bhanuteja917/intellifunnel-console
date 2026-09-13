export type FieldMappingEntry = { source: string; target: string };

export type DeliverableLeadRecord = {
  contact: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    jobTitle: string | null;
  };
  account: {
    name: string;
    primaryDomain: string | null;
    industry: string | null;
    country: string | null;
  };
  lead: {
    id: string;
    acceptedAt: Date | null;
  };
  fieldValues: Record<string, string>;
};

// The fixed set of source paths every delivery config can map from, regardless
// of campaign. Campaign-specific qualification answers (LeadFieldSpec.fieldKey,
// stored flat on Lead.fieldValuesJson) are appended dynamically per campaign —
// see availableSourceFields.
const FIXED_SOURCE_PATHS = [
  "contact.email",
  "contact.firstName",
  "contact.lastName",
  "contact.phone",
  "contact.jobTitle",
  "account.name",
  "account.primaryDomain",
  "account.industry",
  "account.country",
  "lead.id",
  "lead.acceptedAt",
] as const;

/** Every source path a delivery config's field-mapping builder may offer for a given campaign. */
export function availableSourceFields(campaignFieldKeys: string[]): string[] {
  return [...FIXED_SOURCE_PATHS, ...campaignFieldKeys.map((key) => `field.${key}`)];
}

function getSourceValue(record: DeliverableLeadRecord, source: string): unknown {
  if (source.startsWith("field.")) {
    return record.fieldValues[source.slice("field.".length)] ?? null;
  }
  const [entity, key] = source.split(".");
  if (entity === "contact") return (record.contact as Record<string, unknown>)[key ?? ""] ?? null;
  if (entity === "account") return (record.account as Record<string, unknown>)[key ?? ""] ?? null;
  if (entity === "lead") return (record.lead as Record<string, unknown>)[key ?? ""] ?? null;
  return null;
}

/**
 * Projects a lead record onto the target keys a client's delivery destination
 * expects. An unrecognised or absent source maps to `null` rather than
 * throwing — a stale mapping (e.g. a removed LeadFieldSpec key) must not take
 * down an otherwise-successful delivery run.
 */
export function applyFieldMapping(
  mapping: FieldMappingEntry[],
  record: DeliverableLeadRecord,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const { source, target } of mapping) {
    result[target] = getSourceValue(record, source);
  }
  return result;
}
