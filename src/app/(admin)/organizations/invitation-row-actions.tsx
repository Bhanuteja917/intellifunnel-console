"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resendInvitationAction, revokeInvitationAction } from "./actions";
import type { ActionResult } from "@/lib/auth/require";

export function InvitationRowActions({ invitationId }: { invitationId: string }) {
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
    <div className="flex items-center justify-end gap-3">
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0"
        disabled={pending}
        onClick={() => run(() => resendInvitationAction(invitationId), "Invitation resent")}
      >
        Resend
      </Button>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-destructive"
        disabled={pending}
        onClick={() => run(() => revokeInvitationAction(invitationId), "Invitation revoked")}
      >
        Revoke
      </Button>
    </div>
  );
}
