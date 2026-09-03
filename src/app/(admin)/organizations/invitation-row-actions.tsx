"use client";

import { useTransition } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={pending}>
          <MoreHorizontalIcon />
          <span className="sr-only">Invitation actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => run(() => resendInvitationAction(invitationId), "Invitation resent")}
          >
            Resend
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => run(() => revokeInvitationAction(invitationId), "Invitation revoked")}
          >
            Revoke
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
