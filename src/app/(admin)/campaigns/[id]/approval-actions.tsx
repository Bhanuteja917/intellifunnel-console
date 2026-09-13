"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { superAdminRevertToDraftAction } from "./actions";
import type { ActionResult } from "@/lib/auth/require";

type Props = {
  campaignId: string;
  status: string;
  canSubmit: boolean;
  canApproveInternal: boolean;
  canApproveClient: boolean;
  canRevertToDraft: boolean;
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
      {props.canRevertToDraft && props.status !== "draft" && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => superAdminRevertToDraftAction(props.campaignId),
              "Campaign reverted to draft",
            )
          }
        >
          Revert to draft
        </Button>
      )}
    </div>
  );
}
