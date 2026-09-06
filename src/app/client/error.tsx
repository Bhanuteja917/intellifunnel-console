"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function ClientError({ retry }: { error: Error; retry: () => void }) {
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
