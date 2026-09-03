import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. It talks to this app's own Better Auth
 * route handler (`src/app/api/auth/[...all]/route.ts`, mounted at the default
 * `/api/auth` base path on the same origin), which is what sets and refreshes
 * the session cookie — a server action cannot set that cookie on its own.
 *
 * Only sign-in and sign-out go through here. Every authorisation decision
 * still happens server-side in the service layer (AUTH-8, NFR-S-1); nothing
 * this client returns is ever trusted as a permission.
 */
export const authClient = createAuthClient();
