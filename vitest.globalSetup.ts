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

  // src/lib/env.ts requires these rather than substituting a fallback, so the
  // suite has to supply them the same way a deployment does. The salt in
  // particular must be a real value: hashSuppressionValue would otherwise have
  // to invent one, and hashes written under an invented salt can never be
  // matched again.
  process.env.APP_BASE_URL ??= "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-not-used-outside-the-test-suite";
  process.env.SUPPRESSION_HASH_SALT ??= "test-suppression-salt";
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}

export async function teardown() {
  await container?.stop();
}
