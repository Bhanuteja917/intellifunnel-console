"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalDecision } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { decidePlacement } from "@/lib/approvals/decisions";
import { decideChannelApproval } from "@/lib/campaigns/state-machine";

export async function decideChannelTermsAction(input: {
  campaignChannelId: string;
  campaignId: string; // only for revalidatePath
  decision: ApprovalDecision;
  comments?: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    // A Server Action is reachable by anyone who can send the POST, so the
    // portal and permission checks live here, not only in the page that
    // renders the button.
    assertPortal(actor, "client");
    await decideChannelApproval(db, actor, input.campaignChannelId, input.decision, input.comments);
    revalidatePath("/client/approvals");
    revalidatePath(`/client/campaigns/${input.campaignId}`);
    return null;
  });
}

export async function decidePlacementAction(input: {
  assetPlacementId: string;
  campaignId: string; // only for revalidatePath
  decision: ApprovalDecision;
  comments?: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    assertPortal(actor, "client");
    await decidePlacement(db, actor, {
      assetPlacementId: input.assetPlacementId,
      decision: input.decision,
      comments: input.comments,
    });
    revalidatePath("/client/approvals");
    revalidatePath(`/client/campaigns/${input.campaignId}`);
    return null;
  });
}
