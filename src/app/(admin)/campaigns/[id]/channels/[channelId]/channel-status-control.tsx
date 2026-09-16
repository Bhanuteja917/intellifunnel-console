"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CampaignChannelStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteChannelAction,
  setChannelStatusAction,
  submitChannelForApprovalAction,
  withdrawChannelFromApprovalAction,
} from "./actions";

// setChannelStatus only ever accepts "live" or "paused" — every other status
// is derived by the campaign lifecycle (submit-for-approval, client decision,
// flight dates). Offering them here would just error on selection.
const MANUAL_STATUSES: CampaignChannelStatus[] = ["live", "paused"];

type Props = {
  campaignId: string;
  channelId: string;
  status: CampaignChannelStatus;
};

export function ChannelStatusControl({ campaignId, channelId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function onChange(next: string) {
    startTransition(async () => {
      const result = await setChannelStatusAction(
        campaignId,
        channelId,
        next as CampaignChannelStatus,
      );
      if (result.ok) {
        toast.success(`Status set to ${next}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function onSubmitForApproval() {
    startTransition(async () => {
      const result = await submitChannelForApprovalAction(campaignId, channelId);
      if (result.ok) {
        toast.success("Submitted for approval");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function onWithdraw() {
    startTransition(async () => {
      const result = await withdrawChannelFromApprovalAction(campaignId, channelId);
      setConfirmOpen(false);
      if (result.ok) {
        toast.success("Channel returned to draft");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteChannelAction(campaignId, channelId);
      setDeleteOpen(false);
      if (result.ok) {
        toast.success("Channel deleted");
        router.push(`/campaigns/${campaignId}` as Route);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2">
        <Button onClick={onSubmitForApproval} disabled={pending} size="sm">
          Submit for approval
        </Button>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={pending}>Delete channel</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this channel?</DialogTitle>
              <DialogDescription>
                This permanently removes the channel and everything on it — terms, ICP criteria,
                lead field spec, placements and allocations. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={onDelete} disabled={pending}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline">pending</Badge>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>Withdraw to draft</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Withdraw this channel?</DialogTitle>
              <DialogDescription>
                It leaves the client&apos;s approval queue and returns to draft, and the campaign
                returns to draft with it. Channels already approved are unaffected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={onWithdraw} disabled={pending}>Withdraw</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (status === "scheduled" || status === "completed" || status === "cancelled") {
    return <Badge variant="outline">{status}</Badge>;
  }

  return (
    <Select value={status} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {MANUAL_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>{value}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
