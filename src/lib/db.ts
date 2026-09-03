import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { requireEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // Fails here rather than as an opaque SASL error on the first query.
  const adapter = new PrismaPg({ connectionString: requireEnv("DATABASE_URL") });
  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
