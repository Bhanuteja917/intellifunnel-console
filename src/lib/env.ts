/**
 * Configuration is entirely environment-variable driven (DEP-5), so a missing
 * variable is a deployment error and must announce itself as one instead of
 * surfacing later as an authentication failure, a connection error, or — worst
 * of all — silently wrong data.
 *
 * Required, checked here at the point of use:
 *   DATABASE_URL           the pooled connection (src/lib/db.ts)
 *   BETTER_AUTH_SECRET     session/token signing (src/lib/auth/better-auth.ts)
 *   APP_BASE_URL           absolute links in invitation and reset emails
 *   SUPPRESSION_HASH_SALT  salt for suppression value hashes; a fallback here
 *                          would write hashes that can never be matched again
 *
 * Deliberately not required:
 *   DIRECT_URL             migrations only, and prisma.config.ts already fails
 *                          loudly without it
 *   EMAIL_PROVIDER_URL, EMAIL_PROVIDER_API_KEY, EMAIL_FROM
 *                          absent or empty means "log instead of send", the
 *                          local development mode
 *   WORKER_INTERVAL_MS     defaulted by the worker
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. See docs/deployment.md for the full list.`,
    );
  }
  return value;
}
