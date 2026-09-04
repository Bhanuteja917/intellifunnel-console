"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { assignLeadToSelfAction } from "./actions";

export function QueueRowActions({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition();

  function claim() {
    startTransition(async () => {
      const result = await assignLeadToSelfAction(leadId);
      if (result.ok) {
        toast.success("Lead claimed");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={claim}>
      Claim
    </Button>
  );
}
