"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * `error.tsx` wraps the pages and nested layouts below it, but never the
 * `layout.tsx` beside it in the same segment. `(admin)/error.tsx` therefore
 * cannot catch what `(admin)/layout.tsx` itself throws — and that layout does
 * throw for ordinary reasons: requireActor() raises ForbiddenError when the
 * session has no app user, or the user or organisation is inactive or has no
 * role. This boundary sits one segment up, so it catches those, and anything
 * else thrown by a layout below the root.
 *
 * The message itself is deliberately not shown: Next.js only hands a digest to
 * this component in production, and the underlying error may name internals.
 */
export default function RootError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="p-6">
      <Alert variant="destructive">
        <AlertTitle>Something went wrong.</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          This page could not be loaded. Try again, and if it keeps happening,
          ask an administrator to check your account.
          <Button variant="outline" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
