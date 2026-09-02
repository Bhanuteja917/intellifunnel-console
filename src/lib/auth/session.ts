import { headers } from "next/headers";
import type { PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth/better-auth";
import { db as defaultDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { loadActor, type Actor } from "@/lib/auth/permissions";

export async function getCurrentActor(client: PrismaClient = defaultDb): Promise<Actor> {
  const session = await auth.api.getSession({ headers: await headers() });
  const authUserId = session?.user?.id;
  if (authUserId === undefined) throw new ForbiddenError("Not authenticated");

  const user = await client.user.findUnique({ where: { authUserId }, select: { id: true } });
  if (user === null) throw new ForbiddenError("No application user for this session");

  return loadActor(client, user.id);
}
