import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/auth/permissions";

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
};

type Tx = Prisma.TransactionClient;

const toJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

export async function writeAudit(
  client: PrismaClient | Tx,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: actor.userId,
      actorOrganizationId: actor.organizationId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: toJson(entry.before),
      afterJson: toJson(entry.after),
      ipAddress: entry.ipAddress,
    },
  });
}

/**
 * NFR-A-1: the mutation and its audit entry commit together or not at all.
 * `entry.entityId` may be empty when the id is only known inside `fn`; pass a
 * function for `entry` in that case.
 */
export async function withAudit<T>(
  db: PrismaClient,
  actor: Actor,
  entry: AuditEntry | ((result: T) => AuditEntry),
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const result = await fn(tx);
    const resolved = typeof entry === "function" ? entry(result) : entry;
    await writeAudit(tx, actor, resolved);
    return result;
  });
}
