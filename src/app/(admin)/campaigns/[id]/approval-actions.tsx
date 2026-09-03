"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  approveClientAction,
  approveInternalAction,
  submitCampaignAction,
} from "../actions";
import type { ActionResult } from "@/lib/auth/require";

type Props = {
  campaignId: string;
  status: string;
  canSubmit: boolean;
  canApproveInternal: boolean;
  canApproveClient: boolean;
};

export function ApprovalActions(props: Props) {
  const [pending, startTransition] = useTransition();
  const [comments, setComments] = useState("");
  const [open, setOpen] = useState(false);

  function run(work: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
        setOpen(false);
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
          onClick={() => run(() => submitCampaignAction(props.campaignId), "Sent for internal approval")}
        >
          Submit for internal approval
        </Button>
      )}

      {props.canApproveInternal && props.status === "pendingInternalApproval" && (
        <Button
          disabled={pending}
          onClick={() =>
            run(() => approveInternalAction(props.campaignId, "approved"), "Internally approved")
          }
        >
          Approve internally
        </Button>
      )}

      {props.canApproveClient && props.status === "pendingClientApproval" && (
        <>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => approveClientAction(props.campaignId, "approved"), "Campaign scheduled")
            }
          >
            Approve
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" disabled={pending}>Reject</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Reject this campaign</DialogTitle></DialogHeader>
              <Label htmlFor="comments">Why?</Label>
              <Input
                id="comments"
                value={comments}
                onChange={(event) => setComments(event.target.value)}
              />
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={pending || comments.trim() === ""}
                  onClick={() =>
                    run(
                      () => approveClientAction(props.campaignId, "rejected", comments),
                      "Returned to draft",
                    )
                  }
                >
                  Reject and return to draft
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
