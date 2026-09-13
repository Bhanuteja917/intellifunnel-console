"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { submitCampaignAction } from "../actions";
import type { ActionResult } from "@/lib/auth/require";

type Props = {
  campaignId: string;
  status: string;
  canSubmit: boolean;
};

export function ApprovalActions(props: Props) {
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex gap-2">
      {props.canSubmit && props.status === "draft" && (
        <Button
          disabled={pending}
          onClick={() => run(() => submitCampaignAction(props.campaignId), "Submitted for approval")}
        >
          Submit for approval
        </Button>
      )}
    </div>
  );
}
