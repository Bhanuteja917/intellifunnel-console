import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Session guard for the admin console and the partner/client portals. Without it, an
 * unauthenticated request to any guarded route reaches `getCurrentActor` and
 * throws `ForbiddenError("Not authenticated")` with no boundary to catch it —
 * an unhandled 500 instead of a sign-in prompt.
 *
 * This is a cookie-presence check only, deliberately: it is a redirect for
 * humans, never an authorisation decision. Every page and server action still
 * resolves the real session and re-checks permissions server-side (AUTH-8,
 * NFR-S-1), so a forged or expired cookie gets past this and is then rejected
 * by the service layer. Next.js calls this an "optimistic check" and
 * explicitly warns against using it as the authorisation solution.
 *
 * `proxy.ts`, not `middleware.ts`: Next.js 16 renamed the convention and
 * warns on every build that the old filename is deprecated
 * (node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 */
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request) !== null) return NextResponse.next();

  return NextResponse.redirect(new URL("/sign-in", request.nextUrl.origin));
}

export const config = {
  // The `(admin)` route group's own routes, plus the partner and client portals.
  // `/invite/[token]` and `/sign-in` are unauthenticated by design and must
  // stay out of this list.
  matcher: [
    "/campaigns",
    "/campaigns/:path*",
    "/channel-types",
    "/channel-types/:path*",
    "/organizations",
    "/organizations/:path*",
    "/resolution-queue",
    "/resolution-queue/:path*",
    "/verification",
    "/verification/:path*",
    "/assets",
    "/assets/:path*",
    "/consent-texts",
    "/consent-texts/:path*",
    "/partner",
    "/partner/:path*",
    "/client",
    "/client/:path*",
  ],
};
