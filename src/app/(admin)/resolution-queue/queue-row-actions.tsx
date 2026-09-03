"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { useResolutionQueue } from "@/lib/stores/resolution-queue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createAccountForEntryAction,
  rematchEntryAction,
  resolveEntryAction,
} from "./actions";
import type { ActionResult } from "@/lib/auth/require";

export function QueueRowActions({
  entryId,
  candidateAccountIds,
}: {
  entryId: string;
  candidateAccountIds: string[];
}) {
  const { selectedEntryId, select, clear } = useResolutionQueue();
  const [pending, startTransition] = useTransition();
  const [manualOpen, setManualOpen] = useState(false);
  const [accountId, setAccountId] = useState("");

  function run(work: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
        clear();
        setManualOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) select(entryId);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant={selectedEntryId === entryId ? "secondary" : "ghost"}
            size="icon-sm"
            disabled={pending}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">Row actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {candidateAccountIds.length > 0 && (
            <>
              <DropdownMenuLabel>Resolve to candidate</DropdownMenuLabel>
              <DropdownMenuGroup>
                {candidateAccountIds.map((candidateId) => (
                  <DropdownMenuItem
                    key={candidateId}
                    onSelect={() =>
                      run(() => resolveEntryAction(entryId, candidateId), "Entry resolved")
                    }
                  >
                    {candidateId}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setManualOpen(true)}>
              Resolve to account…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run(() => createAccountForEntryAction(entryId), "Account created")
              }
            >
              Create new account
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => run(() => rematchEntryAction(entryId), "Rematched")}
            >
              Rematch
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve to account</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="account-id">Account ID</FieldLabel>
              <Input
                id="account-id"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={pending || accountId.trim() === ""}
              onClick={() => run(() => resolveEntryAction(entryId, accountId), "Entry resolved")}
            >
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
