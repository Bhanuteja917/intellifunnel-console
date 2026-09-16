"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
import { setChannelStatusAction, submitChannelForApprovalAction } from "./actions";

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

  if (status === "draft") {
    return (
      <Button onClick={onSubmitForApproval} disabled={pending} size="sm">
        Submit for approval
      </Button>
    );
  }

  if (status === "pending" || status === "scheduled" || status === "completed" || status === "cancelled") {
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
