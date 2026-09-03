"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { createInvitation, resendInvitation, revokeInvitation } from "@/lib/invitations/invitations";
import type { RoleCode } from "@/lib/auth/permissions";

export async function inviteUserAction(input: {
  email: string;
  organizationId: string;
  roleCode: RoleCode;
}): Promise<ActionResult<{ invitationId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const { invitation } = await createInvitation(db, actor, input);
    revalidatePath(`/organizations/${input.organizationId}`);
    // The raw token is emailed, never returned to the caller.
    return { invitationId: invitation.id };
  });
}

export async function resendInvitationAction(invitationId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await resendInvitation(db, actor, invitationId);
    revalidatePath("/organizations");
    return null;
  });
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await revokeInvitation(db, actor, invitationId);
    revalidatePath("/organizations");
    return null;
  });
}
