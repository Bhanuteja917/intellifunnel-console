"use server";

import { db } from "@/lib/db";
import { toActionResult, type ActionResult } from "@/lib/auth/require";
import { acceptInvitation } from "@/lib/invitations/invitations";

/** Unauthenticated by design: the token in the URL is the credential (AUTH-3). */
export async function acceptInvitationAction(input: {
  token: string;
  name: string;
  password: string;
}): Promise<ActionResult<{ userId: string }>> {
  return toActionResult(() => acceptInvitation(db, input));
}
