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
import { archiveOrganizationAction, unarchiveOrganizationAction } from "./actions";

export function OrganizationRowActions({
  organizationId,
  status,
}: {
  organizationId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();

  function archive() {
    startTransition(async () => {
      const result = await archiveOrganizationAction(organizationId);
      if (result.ok) {
        toast.success("Organisation archived");
      } else {
        toast.error(result.error);
      }
    });
  }

  function unarchive() {
    startTransition(async () => {
      const result = await unarchiveOrganizationAction(organizationId);
      if (result.ok) {
        toast.success("Organisation unarchived");
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
          <span className="sr-only">Organisation actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {status === "active" && (
            <DropdownMenuItem variant="destructive" onSelect={archive}>
              Archive
            </DropdownMenuItem>
          )}
          {status === "archived" && (
            <DropdownMenuItem onSelect={unarchive}>
              Unarchive
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
