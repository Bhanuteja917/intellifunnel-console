import type { AllocationStatus, PartnerAllocation, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { toMinorUnits } from "@/lib/money/currency";

export type CreateAllocationInput = {
  campaignChannelId: string;
  partnerOrganizationId: string;
  allocatedQuantity: number;
  payoutRate: string; // decimal string, converted via toMinorUnits
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
  revealClientIdentity: boolean;
};

function assertQuantityAndWindow(allocatedQuantity: number, startDate: Date, endDate: Date): void {
  if (allocatedQuantity <= 0) throw new ValidationError("Allocated quantity must be positive");
  // PartnerAllocation.allocatedQuantity is an Int column: a fractional value
  // would otherwise reach the create/update call and throw an untyped
  // PrismaClientValidationError, which escapes toActionResult as a raw 500
  // instead of a message the caller can show (same rationale as
  // addCampaignChannel's contractedQuantity check).
  if (!Number.isInteger(allocatedQuantity)) {
    throw new ValidationError("Allocated quantity must be a whole number");
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new ValidationError("Allocation end date precedes its start date");
  }
}

export async function createAllocation(
  db: PrismaClient,
  actor: Actor,
  input: CreateAllocationInput,
): Promise<PartnerAllocation> {
  assertPermission(actor, "allocation:write");

  const channel = await db.campaignChannel.findUnique({ where: { id: input.campaignChannelId } });
  if (channel === null) throw new NotFoundError("Campaign channel not found");

  const partnerOrganization = await db.organization.findUnique({ where: { id: input.partnerOrganizationId } });
  // A soft-deleted org is treated as not found, matching assertClientOrganization
  // (src/lib/campaigns/crud.ts) and assertRoleFitsOrganization
  // (src/lib/invitations/invitations.ts).
  if (partnerOrganization === null || partnerOrganization.deletedAt !== null) {
    throw new NotFoundError("Organisation not found");
  }
  if (!partnerOrganization.isPartner) {
    throw new ValidationError("Organisation is not a partner organisation");
  }

  const existingActive = await db.partnerAllocation.findFirst({
    where: { campaignChannelId: input.campaignChannelId, partnerOrganizationId: input.partnerOrganizationId, status: { not: "ended" } },
  });
  if (existingActive !== null) {
    throw new ValidationError(
      "This partner already has an active allocation on this channel — end it before creating a new one.",
    );
  }

  assertQuantityAndWindow(input.allocatedQuantity, input.startDate, input.endDate);
  const payoutRateMinor = toMinorUnits(input.payoutRate, input.payoutCurrency);

  // PRD audit requirement: every change touching quota, money, status, or
  // configuration is logged (NFR-A-1). payoutRateMinor is a BigInt, which
  // does not serialise to JSON (see snapshot.ts's identical handling of
  // clientUnitPriceMinor) — stringified before it goes into the audit payload.
  return withAudit<PartnerAllocation>(
    db,
    actor,
    (created) => ({
      entityType: "PartnerAllocation",
      entityId: created.id,
      action: "create",
      after: {
        campaignChannelId: input.campaignChannelId,
        partnerOrganizationId: input.partnerOrganizationId,
        allocatedQuantity: input.allocatedQuantity,
        payoutRateMinor: payoutRateMinor.toString(),
        payoutCurrency: input.payoutCurrency,
        startDate: input.startDate,
        endDate: input.endDate,
        revealClientIdentity: input.revealClientIdentity,
      },
    }),
    (tx) =>
      tx.partnerAllocation.create({
        data: {
          campaignChannelId: input.campaignChannelId,
          partnerOrganizationId: input.partnerOrganizationId,
          allocatedQuantity: input.allocatedQuantity,
          payoutRateMinor,
          payoutCurrency: input.payoutCurrency,
          startDate: input.startDate,
          endDate: input.endDate,
          revealClientIdentity: input.revealClientIdentity,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}

export type UpdateAllocationInput = {
  allocationId: string;
  allocatedQuantity: number;
  payoutRate: string;
  payoutCurrency: string;
  startDate: Date;
  endDate: Date;
  revealClientIdentity: boolean;
};

export async function updateAllocation(
  db: PrismaClient,
  actor: Actor,
  input: UpdateAllocationInput,
): Promise<PartnerAllocation> {
  assertPermission(actor, "allocation:write");

  const existing = await db.partnerAllocation.findUnique({ where: { id: input.allocationId } });
  if (existing === null) throw new NotFoundError("Allocation not found");

  assertQuantityAndWindow(input.allocatedQuantity, input.startDate, input.endDate);
  const payoutRateMinor = toMinorUnits(input.payoutRate, input.payoutCurrency);

  // campaignChannelId/partnerOrganizationId are fixed at creation —
  // reallocating to a different partner or channel is a new allocation, not
  // an edit. status is likewise untouched here; it's managed separately via
  // setAllocationStatus.
  //
  // The id is already known, so entry is a fixed object rather than a
  // function (matching updateChannelType's precedent), and `before` is the
  // row already fetched above rather than re-read inside the transaction.
  // payoutRateMinor is BigInt and does not serialise to JSON, so both the
  // before and after snapshots stringify it.
  return withAudit<PartnerAllocation>(
    db,
    actor,
    {
      entityType: "PartnerAllocation",
      entityId: input.allocationId,
      action: "update",
      before: {
        allocatedQuantity: existing.allocatedQuantity,
        payoutRateMinor: existing.payoutRateMinor.toString(),
        payoutCurrency: existing.payoutCurrency,
        startDate: existing.startDate,
        endDate: existing.endDate,
        revealClientIdentity: existing.revealClientIdentity,
      },
      after: {
        allocatedQuantity: input.allocatedQuantity,
        payoutRateMinor: payoutRateMinor.toString(),
        payoutCurrency: input.payoutCurrency,
        startDate: input.startDate,
        endDate: input.endDate,
        revealClientIdentity: input.revealClientIdentity,
      },
    },
    (tx) =>
      tx.partnerAllocation.update({
        where: { id: input.allocationId },
        data: {
          allocatedQuantity: input.allocatedQuantity,
          payoutRateMinor,
          payoutCurrency: input.payoutCurrency,
          startDate: input.startDate,
          endDate: input.endDate,
          revealClientIdentity: input.revealClientIdentity,
          updatedById: actor.userId,
        },
      }),
  );
}

export type SetAllocationStatusInput = {
  allocationId: string;
  status: AllocationStatus;
};

export async function setAllocationStatus(
  db: PrismaClient,
  actor: Actor,
  input: SetAllocationStatusInput,
): Promise<PartnerAllocation> {
  assertPermission(actor, "allocation:write");

  const existing = await db.partnerAllocation.findUnique({ where: { id: input.allocationId } });
  if (existing === null) throw new NotFoundError("Allocation not found");

  // AllocationStatus transitions are unrestricted (draft/active/paused/ended,
  // any -> any) — the PRD doesn't specify a constrained flow here, matching
  // setPlacementStatus's precedent. setPlacementStatus itself has no audit
  // precedent to follow, so this instead matches deactivateChannelType's
  // status-only-change shape (before/after each holding just the one field).
  return withAudit<PartnerAllocation>(
    db,
    actor,
    {
      entityType: "PartnerAllocation",
      entityId: input.allocationId,
      action: "update",
      before: { status: existing.status },
      after: { status: input.status },
    },
    (tx) =>
      tx.partnerAllocation.update({
        where: { id: input.allocationId },
        data: { status: input.status, updatedById: actor.userId },
      }),
  );
}
