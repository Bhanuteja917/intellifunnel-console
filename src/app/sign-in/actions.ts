"use server";

import type { Portal } from "@prisma/client";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";

/**
 * The sign-in form is entirely client-side (better-auth's authClient), so it
 * has no server-rendered awareness of which portal the signed-in user
 * belongs to at the point it needs to choose a redirect target. This is
 * called right after a successful client-side sign-in, once the session
 * cookie is already set, purely to read that one field back.
 */
export async function getPostSignInPortalAction(): Promise<ActionResult<{ portal: Portal }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    return { portal: actor.portal };
  });
}
