"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { assertOrganizationAccess, assertPermission } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { decideLeadVerification, type TeleVerificationInput } from "@/lib/leads/verification";

export async function assignLeadToSelfAction(leadId: string): Promise<ActionResult<{ assignedToUserId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPermission(actor, "lead:write");

    const lead = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { campaignChannel: { include: { campaign: true } } },
    });

    assertOrganizationAccess(actor, lead.campaignChannel.campaign.clientOrganizationId);

    if (lead.verificationStatus !== "needsReview") {
      throw new ValidationError("This lead is no longer awaiting verification.");
    }
    if (lead.assignedToUserId !== null && lead.assignedToUserId !== actor.userId) {
      throw new ValidationError("This lead is already claimed by another reviewer.");
    }

    // Conditional update: the checks above are read-then-write, so the same
    // predicates have to gate the write itself or two reviewers clicking at
    // once can both pass them and the later one silently steals the claim.
    const { count } = await db.lead.updateMany({
      where: {
        id: leadId,
        verificationStatus: "needsReview",
        OR: [{ assignedToUserId: null }, { assignedToUserId: actor.userId }],
      },
      data: { assignedToUserId: actor.userId, assignedAt: new Date() },
    });
    if (count === 0) {
      throw new ValidationError("This lead is already claimed by another reviewer.");
    }

    revalidatePath("/verification");
    return { assignedToUserId: actor.userId };
  });
}

// `decision` is the decision actually taken, which a failed tele-verification
// can flip from the requested "accept" to "reject" — the caller must report
// that, not the button it pressed.
export async function acceptLeadAction(
  leadId: string,
  tele?: TeleVerificationInput,
): Promise<ActionResult<{ leadId: string; decision: "accept" | "reject" }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const { lead, effectiveDecision } = await decideLeadVerification(db, actor, {
      leadId,
      decision: "accept",
      tele,
    });

    revalidatePath("/verification");
    revalidatePath(`/campaigns/${lead.campaignChannel.campaign.id}/leads`);
    return { leadId: lead.id, decision: effectiveDecision };
  });
}

export async function rejectLeadAction(
  leadId: string,
  rejectReasonCode: string,
  tele?: TeleVerificationInput,
): Promise<ActionResult<{ leadId: string; decision: "accept" | "reject" }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const { lead, effectiveDecision } = await decideLeadVerification(db, actor, {
      leadId,
      decision: "reject",
      rejectReasonCode,
      tele,
    });

    revalidatePath("/verification");
    revalidatePath(`/campaigns/${lead.campaignChannel.campaign.id}/leads`);
    return { leadId: lead.id, decision: effectiveDecision };
  });
}
