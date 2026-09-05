"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The proxy guard turns an unauthenticated request into a redirect, but it
 * cannot help a request that is authenticated and simply not allowed: the
 * layout throws ForbiddenError for a non-partner actor, and the service layer
 * throws it for a partner actor without the right permission. Without a
 * boundary the reader gets a raw 500.
 *
 * The message itself is deliberately not shown: Next.js only hands a digest to
 * this component in production, and the underlying error may name internals.
 */
export default function PartnerError({ retry }: { error: Error; retry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>This page could not be loaded.</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        You may not have access to it. If you think this is wrong, contact your IntelliFunnelLabs account representative.
        <Button variant="outline" size="sm" onClick={() => retry()}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
