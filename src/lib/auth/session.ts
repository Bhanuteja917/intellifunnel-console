import { headers } from "next/headers";
import type { PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth/better-auth";
import { db as defaultDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { loadActor, type Actor } from "@/lib/auth/permissions";

export async function getCurrentActor(client: PrismaClient = defaultDb): Promise<Actor> {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch {
    // A cookie better-auth can't decode (stale value from a rotated secret,
    // a truncated cookie) throws here instead of returning null. Treat it
    // exactly like "no session" — both mean the browser has no usable
    // credential — rather than letting a decode error propagate raw past
    // the ForbiddenError contract every caller (error.tsx, toActionResult)
    // already relies on.
    throw new ForbiddenError("Not authenticated");
  }
  const authUserId = session?.user?.id;
  if (authUserId === undefined) throw new ForbiddenError("Not authenticated");

  const user = await client.user.findUnique({ where: { authUserId }, select: { id: true } });
  if (user === null) throw new ForbiddenError("No application user for this session");

  return loadActor(client, user.id);
}
