import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

export function testDb(): PrismaClient {
  client ??= new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  return client;
}

export async function resetDb(): Promise<void> {
  const prisma = testDb();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
