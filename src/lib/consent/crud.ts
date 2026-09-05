import type { ConsentTextVersion, PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";

export type CreateConsentTextVersionInput = {
  name: string;
  body: string;
  language: string;
  effectiveFrom: Date;
};

export async function createConsentTextVersion(
  db: PrismaClient,
  actor: Actor,
  input: CreateConsentTextVersionInput,
): Promise<ConsentTextVersion> {
  assertPermission(actor, "asset:write");

  // Get the max version for this name, or 0 if none exist
  const existing = await db.consentTextVersion.findMany({
    where: { name: input.name },
    orderBy: { version: "desc" },
    take: 1,
  });

  const version = (existing[0]?.version ?? 0) + 1;

  return db.consentTextVersion.create({
    data: {
      name: input.name,
      body: input.body,
      language: input.language,
      effectiveFrom: input.effectiveFrom,
      version,
      createdById: actor.userId,
    },
  });
}

export async function listConsentTextVersions(
  db: PrismaClient,
  actor: Actor,
): Promise<ConsentTextVersion[]> {
  assertPermission(actor, "asset:read");

  return db.consentTextVersion.findMany({
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });
}
