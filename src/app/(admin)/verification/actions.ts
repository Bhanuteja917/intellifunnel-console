"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { decideLeadVerification, type TeleVerificationInput } from "@/lib/leads/verification";

export async function assignLeadToSelfAction(leadId: string): Promise<ActionResult<{ assignedToUserId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPermission(actor, "lead:write");

    const lead = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { campaignChannel: { include: { campaign: true } } },
    });

    if (!actor.isInternal && lead.campaignChannel.campaign.clientOrganizationId !== actor.organizationId) {
      throw new ForbiddenError("Lead not accessible to this actor");
    }

    const updated = await db.lead.update({
      where: { id: leadId },
      data: { assignedToUserId: actor.userId, assignedAt: new Date() },
    });

    revalidatePath("/verification");
    return { assignedToUserId: updated.assignedToUserId! };
  });
}

export async function acceptLeadAction(
  leadId: string,
  tele?: TeleVerificationInput,
): Promise<ActionResult<{ leadId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const { lead } = await decideLeadVerification(db, actor, { leadId, decision: "accept", tele });

    revalidatePath("/verification");
    revalidatePath(`/campaigns/${lead.campaignChannel.campaign.id}/leads`);
    return { leadId: lead.id };
  });
}

export async function rejectLeadAction(
  leadId: string,
  rejectReasonCode: string,
  tele?: TeleVerificationInput,
): Promise<ActionResult<{ leadId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const { lead } = await decideLeadVerification(db, actor, {
      leadId,
      decision: "reject",
      rejectReasonCode,
      tele,
    });

    revalidatePath("/verification");
    revalidatePath(`/campaigns/${lead.campaignChannel.campaign.id}/leads`);
    return { leadId: lead.id };
  });
}
