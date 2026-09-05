import type {
  Lead,
  LeadLifecycleStatus,
  LeadVerificationStatus,
  PrismaClient,
  VerificationMethod,
  VerificationOutcome,
} from "@prisma/client";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { computeVerificationSla, resolveAllowedBusinessDays } from "@/lib/leads/sla";

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
  // What actually happened, which is not always `input.decision` — a failed
  // tele-verification turns a requested "accept" into a rejection, and the UI
  // must report the outcome it got, not the button that was pressed.
  effectiveDecision: "accept" | "reject";
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
 * terminal `passed`/`failed` + `accepted`/`rejected` state. Intake
 * (`submitLeadFile`) only ever auto-accepts its own `passed` rows; anything
 * it parks at `needsReview` can move only through here.
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

  // A lead claimed via assignLeadToSelfAction (verification/actions.ts) may
  // only be decided by whoever claimed it — an unassigned lead is still
  // decidable by anyone with lead:write (matching the queue UI, which never
  // blocks a direct decide on an unclaimed lead).
  if (lead.assignedToUserId !== null && lead.assignedToUserId !== actor.userId) {
    throw new ForbiddenError("This lead is assigned to another reviewer");
  }

  // A lead can only ever be decided once — `needsReview` (or any other
  // pending status) is the only state this function may act on. Without
  // this guard, a double-submit / retried request / stale tab would append
  // two more `LeadStatusHistory` rows, create a second `VerificationRecord`,
  // and silently overwrite the SLA snapshot that's meant to be written
  // exactly once at decision time.
  if (lead.verificationStatus !== "needsReview") {
    throw new ValidationError("This lead has already been decided and cannot be re-verified.");
  }

  const channelType = lead.campaignChannel.channelTypeVersion.channelType;
  // Read the frozen version snapshot, not the live row — a later edit to the
  // channel type must not change the gate for an already-bound campaign. An
  // old snapshot predating this field falls back to the live row.
  const definition = lead.campaignChannel.channelTypeVersion.definitionJson as Partial<ChannelTypeDefinition> | null;
  const requiresTeleVerification = definition?.requiresTeleVerification ?? channelType.requiresTeleVerification;

  let effectiveDecision: "accept" | "reject" = input.decision;
  let rejectReasonCode: string | null = input.rejectReasonCode ?? null;
  let verificationRecordInput: VerificationRecordInput;

  if (input.decision === "accept") {
    if (requiresTeleVerification) {
      if (
        input.tele === undefined ||
        input.tele.callSystem.trim().length === 0 ||
        input.tele.callReferenceId.trim().length === 0
      ) {
        throw new ValidationError(
          `Channel type "${channelType.code}" requires a completed tele-verification (with a populated callSystem and callReferenceId) before a lead can be accepted.`,
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
    allowedBusinessDays: await resolveAllowedBusinessDays(db, lead.campaignChannel.channelTypeVersion),
  });

  const verificationStatusFrom = lead.verificationStatus;
  const lifecycleStatusFrom = lead.lifecycleStatus;
  const verificationStatusTo: LeadVerificationStatus = effectiveDecision === "accept" ? "passed" : "failed";
  const lifecycleStatusTo: LeadLifecycleStatus = effectiveDecision === "accept" ? "accepted" : "rejected";

  const updatedLead = await db.$transaction(async (tx) => {
    // Conditional update, not a plain update: the read-based guard above can
    // be passed by two concurrent callers before either commits, so the
    // `needsReview` predicate has to be part of the write itself.
    const { count } = await tx.lead.updateMany({
      where: { id: input.leadId, verificationStatus: "needsReview" },
      data: {
        verificationStatus: verificationStatusTo,
        lifecycleStatus: lifecycleStatusTo,
        clientVisible: effectiveDecision === "accept",
        acceptedAt: effectiveDecision === "accept" ? now : null,
        rejectedAt: effectiveDecision === "reject" ? now : null,
        rejectReasonId: effectiveDecision === "reject" ? rejectReasonId : null,
        verificationElapsedMinutes: sla.elapsedMinutes,
        verificationElapsedBusinessMinutes: sla.elapsedBusinessMinutes,
        slaBreached: sla.breached,
      },
    });
    if (count === 0) {
      throw new ValidationError("This lead has already been decided and cannot be re-verified.");
    }

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

    // `updateMany` returns only a count, so re-read the row this transaction
    // just wrote to keep the existing return value intact.
    return tx.lead.findUniqueOrThrow({
      where: { id: input.leadId },
      include: { campaignChannel: { include: { campaign: true } } },
    });
  });

  return { lead: updatedLead, effectiveDecision };
}
