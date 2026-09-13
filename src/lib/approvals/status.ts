import type {
  AssetPlacement,
  CampaignChannel,
  IcpCriterion,
  LeadFieldSpec,
  Prisma,
  PrismaClient,
} from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type ApprovalStatus = "pending" | "approved" | "changesRequested" | "reapprovalNeeded";

export type ChannelTermsSnapshot = {
  contractedQuantity: number;
  clientUnitPriceMinor: string;
  currency: string;
  startDate: string;
  endDate: string;
  channelTypeVersionId: string;
};

export type IcpSnapshot = Array<{
  dimension: string;
  operator: string;
  values: unknown;
  isMandatory: boolean;
}>;

export type LeadSpecSnapshot = Array<{
  fieldKey: string;
  label: string;
  dataType: string;
  isRequired: boolean;
  rejectIfMissing: boolean;
  allowedValues: unknown;
  validationPattern: string | null;
}>;

type ChannelTermsSubject = Pick<
  CampaignChannel,
  | "id"
  | "contractedQuantity"
  | "clientUnitPriceMinor"
  | "currency"
  | "startDate"
  | "endDate"
  | "channelTypeVersionId"
>;

export type PlacementSnapshot = {
  landingPageUrl: string;
  assetVersionId: string;
  formSlug: string;
  consentTextVersionId: string | null;
};

type PlacementSubject = Pick<
  AssetPlacement,
  "id" | "landingPageUrl" | "assetVersionId" | "formSlug" | "consentTextVersionId"
>;

/** `@db.Date` columns compare as calendar days, never as instants. */
const day = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * `clientUnitPriceMinor` is a BigInt column and `JSON.stringify` throws on
 * BigInt, so money travels through the snapshot as a decimal string.
 */
export function buildChannelTermsSnapshot(channel: ChannelTermsSubject): ChannelTermsSnapshot {
  return {
    contractedQuantity: channel.contractedQuantity,
    clientUnitPriceMinor: channel.clientUnitPriceMinor.toString(),
    currency: channel.currency,
    startDate: day(channel.startDate),
    endDate: day(channel.endDate),
    channelTypeVersionId: channel.channelTypeVersionId,
  };
}

export function buildPlacementSnapshot(placement: PlacementSubject): PlacementSnapshot {
  return {
    landingPageUrl: placement.landingPageUrl,
    assetVersionId: placement.assetVersionId,
    formSlug: placement.formSlug,
    consentTextVersionId: placement.consentTextVersionId,
  };
}

export function buildIcpSnapshot(criteria: IcpCriterion[]): IcpSnapshot {
  return criteria
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({
      dimension: c.dimension,
      operator: c.operator,
      values: c.valuesJson,
      isMandatory: c.isMandatory,
    }));
}

export function buildLeadSpecSnapshot(specs: LeadFieldSpec[]): LeadSpecSnapshot {
  return specs
    .slice()
    .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey))
    .map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      dataType: f.dataType,
      isRequired: f.isRequired,
      rejectIfMissing: f.rejectIfMissing,
      allowedValues: f.allowedValuesJson,
      validationPattern: f.validationPattern,
    }));
}

/**
 * Field-by-field, never `JSON.stringify` equality: the stored column is jsonb
 * and Postgres does not preserve key order, so two equal snapshots can
 * serialise to different strings.
 */
function termsSnapshotsMatch(stored: unknown, current: ChannelTermsSnapshot): boolean {
  if (stored === null || typeof stored !== "object") return false;
  const s = stored as Partial<ChannelTermsSnapshot>;
  return (
    s.contractedQuantity === current.contractedQuantity &&
    s.clientUnitPriceMinor === current.clientUnitPriceMinor &&
    s.currency === current.currency &&
    s.startDate === current.startDate &&
    s.endDate === current.endDate &&
    s.channelTypeVersionId === current.channelTypeVersionId
  );
}

function icpSnapshotsMatch(stored: unknown, current: IcpSnapshot): boolean {
  if (!Array.isArray(stored)) return false;
  if (stored.length !== current.length) return false;
  return stored.every((s, i) => {
    const c: IcpSnapshot[number] | undefined = current[i];
    if (c === undefined) return false;
    return (
      (s as Partial<IcpSnapshot[number]>).dimension === c.dimension &&
      (s as Partial<IcpSnapshot[number]>).operator === c.operator &&
      JSON.stringify((s as Partial<IcpSnapshot[number]>).values) === JSON.stringify(c.values) &&
      (s as Partial<IcpSnapshot[number]>).isMandatory === c.isMandatory
    );
  });
}

function leadSpecSnapshotsMatch(stored: unknown, current: LeadSpecSnapshot): boolean {
  if (!Array.isArray(stored)) return false;
  if (stored.length !== current.length) return false;
  return stored.every((s, i) => {
    const c: LeadSpecSnapshot[number] | undefined = current[i];
    if (c === undefined) return false;
    return (
      (s as Partial<LeadSpecSnapshot[number]>).fieldKey === c.fieldKey &&
      (s as Partial<LeadSpecSnapshot[number]>).label === c.label &&
      (s as Partial<LeadSpecSnapshot[number]>).dataType === c.dataType &&
      (s as Partial<LeadSpecSnapshot[number]>).isRequired === c.isRequired &&
      (s as Partial<LeadSpecSnapshot[number]>).rejectIfMissing === c.rejectIfMissing
    );
  });
}

/**
 * `reapprovalNeeded` behaves as not-approved wherever a gate is evaluated; it
 * is distinguished from `pending` only so the UI can say "changed since
 * approval" rather than implying the client never looked.
 */
function derive(
  latest: { decision: "approved" | "rejected" } | null,
  matches: boolean,
): ApprovalStatus {
  if (latest === null) return "pending";
  if (latest.decision === "rejected") return "changesRequested";
  return matches ? "approved" : "reapprovalNeeded";
}

export async function getChannelApprovalStatus(
  db: Db,
  channel: ChannelTermsSubject,
): Promise<ApprovalStatus> {
  const latest = await db.channelApproval.findFirst({
    where: { campaignChannelId: channel.id },
    orderBy: { decidedAt: "desc" },
    select: {
      decision: true,
      termsSnapshotJson: true,
      icpSnapshotJson: true,
      leadSpecSnapshotJson: true,
    },
  });
  if (latest === null) return derive(null, false);

  const termsMatch = termsSnapshotsMatch(latest.termsSnapshotJson, buildChannelTermsSnapshot(channel));
  if (!termsMatch) return derive(latest, false);

  // ICP staleness — null snapshot means approved before ICP was tracked; check current state
  const currentIcp = await db.icpCriterion.findMany({ where: { campaignChannelId: channel.id } });
  const currentIcpSnapshot = buildIcpSnapshot(currentIcp);
  if (latest.icpSnapshotJson !== null && !icpSnapshotsMatch(latest.icpSnapshotJson, currentIcpSnapshot)) {
    return derive(latest, false);
  }

  // Lead spec staleness
  const currentSpecs = await db.leadFieldSpec.findMany({ where: { campaignChannelId: channel.id } });
  const currentLeadSpecSnapshot = buildLeadSpecSnapshot(currentSpecs);
  if (
    latest.leadSpecSnapshotJson !== null &&
    !leadSpecSnapshotsMatch(latest.leadSpecSnapshotJson, currentLeadSpecSnapshot)
  ) {
    return derive(latest, false);
  }

  return derive(latest, true);
}

function placementSnapshotsMatch(stored: unknown, current: PlacementSnapshot): boolean {
  if (stored === null || typeof stored !== "object") return false;
  const s = stored as Partial<PlacementSnapshot>;
  return (
    s.landingPageUrl === current.landingPageUrl &&
    s.assetVersionId === current.assetVersionId &&
    s.formSlug === current.formSlug &&
    (s.consentTextVersionId ?? null) === current.consentTextVersionId
  );
}

export async function getPlacementApprovalStatus(
  db: Db,
  placement: PlacementSubject,
): Promise<ApprovalStatus> {
  const latest = await db.placementApproval.findFirst({
    where: { assetPlacementId: placement.id },
    orderBy: { decidedAt: "desc" },
    select: { decision: true, placementSnapshotJson: true },
  });
  if (latest === null) return derive(null, false);
  return derive(
    latest,
    placementSnapshotsMatch(latest.placementSnapshotJson, buildPlacementSnapshot(placement)),
  );
}
