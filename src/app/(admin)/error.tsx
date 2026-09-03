"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The proxy guard turns an unauthenticated request into a redirect, but it
 * cannot help a request that is authenticated and simply not allowed: the
 * service layer throws ForbiddenError from inside the page, and without a
 * boundary the reader gets a raw 500. Every admin route is reachable from the
 * sidebar by every signed-in user, so this is an ordinary outcome, not a bug.
 *
 * The message itself is deliberately not shown: Next.js only hands a digest to
 * this component in production, and the underlying error may name internals.
 */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>This page could not be loaded.</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        You may not have access to it. If you think you should, ask an
        administrator to check your role.
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
