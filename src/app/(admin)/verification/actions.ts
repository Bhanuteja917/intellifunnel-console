"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";

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
