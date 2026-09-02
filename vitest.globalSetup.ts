import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";

let container: StartedPostgreSqlContainer;

export async function setup() {
  // Must match the Neon project's Postgres major version, recorded in
  // docs/tooling.md during Task 1. A mismatch hides version-specific failures.
  container = await new PostgreSqlContainer(
    `postgres:${process.env.POSTGRES_MAJOR ?? "17"}-alpine`,
  ).start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}

export async function teardown() {
  await container?.stop();
}
