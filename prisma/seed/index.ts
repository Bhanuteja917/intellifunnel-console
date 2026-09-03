import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { seedRoles } from "./roles";
import { seedSettings } from "./settings";
import { seedFunnelStages } from "./funnel-stages";
import { seedChannelTypes } from "./channel-types";
import { seedRejectReasons } from "./reject-reasons";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main(): Promise<void> {
  await seedRoles(db);
  await seedSettings(db);
  await seedFunnelStages(db);
  await seedChannelTypes(db);
  await seedRejectReasons(db);
  console.log("seed complete");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
