# TODO

## Bugs

- **Malformed/stale session cookie crashes instead of redirecting to sign-in.**
  `getCurrentActor` (`src/lib/auth/session.ts:9`) calls `auth.api.getSession`
  directly. If the browser holds a cookie Better Auth can't decode (stale
  value from a rotated `BETTER_AUTH_SECRET`, truncated cookie, etc.), it
  throws a raw error ("Invalid Base64 character: .") instead of returning
  `null`. `proxy.ts` only checks cookie *presence*, not validity, so the
  request gets past the guard and then hits this uncaught throw. Fix: wrap
  the `getSession` call in a try/catch and treat a decode failure the same as
  "not authenticated".
