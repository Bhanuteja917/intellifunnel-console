import type {
  Lead,
  LeadLifecycleStatus,
  LeadVerificationStatus,
  PrismaClient,
  VerificationMethod,
  VerificationOutcome,
} from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { computeVerificationSla } from "@/lib/leads/sla";

export type TeleVerificationInput = {
  callSystem: string;
  callReferenceId: string;
  callOccurredAt?: Date;
  callDurationSeconds?: number;
  notes?: string;
  outcome: "pass" | "fail";
};

export type DecideLeadVerificationInput = {
  leadId: string;
  decision: "accept" | "reject";
  rejectReasonCode?: string;
  tele?: TeleVerificationInput;
};

export type DecideLeadVerificationResult = {
  lead: Lead & { campaignChannel: { campaign: { id: string } } };
};

// FR-VF-2: when a caller asks to "accept" a lead whose own tele-verification
// just failed, the reject reason must reflect a tele-verification failure,
// not an arbitrary caller-supplied code from an unrelated dimension (e.g. an
// ICP code). Only these two codes are ever valid for that specific override;
// anything else supplied by the caller is replaced with the default.
const TELE_FAIL_REJECT_REASON_CODES = new Set(["TELE_UNREACHABLE", "TELE_DENIED_INTEREST"]);
const DEFAULT_TELE_FAIL_REJECT_REASON_CODE = "TELE_UNREACHABLE";

type VerificationRecordInput = {
  method: VerificationMethod;
  outcome: VerificationOutcome;
  callSystem?: string;
  callReferenceId?: string;
  callOccurredAt?: Date;
  callDurationSeconds?: number;
  notes?: string;
};

function teleVerificationRecordInput(tele: TeleVerificationInput): VerificationRecordInput {
  return {
    method: "tele",
    outcome: tele.outcome === "pass" ? "pass" : "fail",
    callSystem: tele.callSystem,
    callReferenceId: tele.callReferenceId,
    callOccurredAt: tele.callOccurredAt,
    callDurationSeconds: tele.callDurationSeconds,
    notes: tele.notes,
  };
}

/**
 * FR-VF-2/FR-VF-3: the human accept/reject decision on a lead sitting in the
 * verification queue. This is the one place a `Lead` ever moves out of
 * `verificationStatus: "needsReview"` (or any other pending status) into a
 * terminal `passed`/`failed` + `accepted`/`rejected` state — intake
 * (`submitLeadFile`) deliberately never does this itself.
 *
 * Tele-verification override (the trickiest control flow here): a caller
 * asking to "accept" a lead on a channel that `requiresTeleVerification` is
 * only accepting *conditionally* — if the supplied `tele.outcome` is "fail",
 * the lead is rejected instead, never accepted. A failed tele-verification
 * always overrides the caller's requested decision.
 */
export async function decideLeadVerification(
  db: PrismaClient,
  actor: Actor,
  input: DecideLeadVerificationInput,
): Promise<DecideLeadVerificationResult> {
  assertPermission(actor, "lead:write");

  const lead = await db.lead.findUniqueOrThrow({
    where: { id: input.leadId },
    include: {
      campaignChannel: {
        include: { campaign: true, channelTypeVersion: { include: { channelType: true } } },
      },
    },
  });

  assertOrganizationAccess(actor, lead.campaignChannel.campaign.clientOrganizationId);

  const channelType = lead.campaignChannel.channelTypeVersion.channelType;

  let effectiveDecision: "accept" | "reject" = input.decision;
  let rejectReasonCode: string | null = input.rejectReasonCode ?? null;
  let verificationRecordInput: VerificationRecordInput;

  if (input.decision === "accept") {
    if (channelType.requiresTeleVerification) {
      if (input.tele === undefined) {
        throw new ValidationError(
          `Channel type "${channelType.code}" requires a completed tele-verification before a lead can be accepted.`,
        );
      }
      verificationRecordInput = teleVerificationRecordInput(input.tele);
      if (verificationRecordInput.outcome === "fail") {
        // Do not accept a lead whose own tele-verification just failed —
        // override the caller's requested "accept" with a rejection.
        effectiveDecision = "reject";
        if (rejectReasonCode === null || !TELE_FAIL_REJECT_REASON_CODES.has(rejectReasonCode)) {
          rejectReasonCode = DEFAULT_TELE_FAIL_REJECT_REASON_CODE;
        }
      }
    } else {
      verificationRecordInput = { method: "manual", outcome: "pass" };
    }
  } else {
    // Explicit reject: a reason is mandatory regardless of tele-verification
    // requirements — FR-VF-2 only requires proof of a completed
    // tele-verification before *acceptance*, not before a manual reject.
    if (rejectReasonCode === null) {
      throw new ValidationError("rejectReasonCode is required to reject a lead.");
    }
    verificationRecordInput = input.tele !== undefined
      ? teleVerificationRecordInput(input.tele)
      : { method: "manual", outcome: "fail" };
  }

  let rejectReasonId: string | null = null;
  if (effectiveDecision === "reject") {
    if (rejectReasonCode === null) {
      // Unreachable: the explicit-reject branch above already validated this,
      // and the accept -> tele-failure override always defaults a code.
      throw new ValidationError("rejectReasonCode is required to reject a lead.");
    }
    const rejectReason = await db.rejectReason.findUniqueOrThrow({ where: { code: rejectReasonCode } });
    rejectReasonId = rejectReason.id;
  }

  const now = new Date();
  const sla = await computeVerificationSla(db, {
    createdAt: lead.createdAt,
    asOf: now,
    channelTypeId: channelType.id,
  });

  const verificationStatusFrom = lead.verificationStatus;
  const lifecycleStatusFrom = lead.lifecycleStatus;
  const verificationStatusTo: LeadVerificationStatus = effectiveDecision === "accept" ? "passed" : "failed";
  const lifecycleStatusTo: LeadLifecycleStatus = effectiveDecision === "accept" ? "accepted" : "rejected";

  const updatedLead = await db.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id: input.leadId },
      data: {
        verificationStatus: verificationStatusTo,
        lifecycleStatus: lifecycleStatusTo,
        clientVisible: effectiveDecision === "accept",
        acceptedAt: effectiveDecision === "accept" ? now : undefined,
        rejectedAt: effectiveDecision === "reject" ? now : undefined,
        rejectReasonId: effectiveDecision === "reject" ? rejectReasonId : undefined,
        verificationElapsedMinutes: sla.elapsedMinutes,
        verificationElapsedBusinessMinutes: sla.elapsedBusinessMinutes,
        slaBreached: sla.breached,
      },
      include: { campaignChannel: { include: { campaign: true } } },
    });

    await tx.verificationRecord.create({
      data: {
        leadId: input.leadId,
        verifiedByUserId: actor.userId,
        ...verificationRecordInput,
      },
    });

    await tx.leadStatusHistory.create({
      data: {
        leadId: input.leadId,
        dimension: "verification",
        fromValue: verificationStatusFrom,
        toValue: verificationStatusTo,
        changedByUserId: actor.userId,
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        leadId: input.leadId,
        dimension: "lifecycle",
        fromValue: lifecycleStatusFrom,
        toValue: lifecycleStatusTo,
        changedByUserId: actor.userId,
      },
    });

    return updated;
  });

  return { lead: updatedLead };
}
