import type { AssetPlacement, CampaignChannel, Prisma, PrismaClient } from "@prisma/client";

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

export type PlacementSnapshot = {
  landingPageUrl: string;
  assetVersionId: string;
  formSlug: string;
  consentTextVersionId: string | null;
};

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

export async function getChannelTermsApprovalStatus(
  db: Db,
  channel: ChannelTermsSubject,
): Promise<ApprovalStatus> {
  const latest = await db.channelTermsApproval.findFirst({
    where: { campaignChannelId: channel.id },
    orderBy: { decidedAt: "desc" },
    select: { decision: true, termsSnapshotJson: true },
  });
  if (latest === null) return derive(null, false);
  return derive(
    latest,
    termsSnapshotsMatch(latest.termsSnapshotJson, buildChannelTermsSnapshot(channel)),
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
