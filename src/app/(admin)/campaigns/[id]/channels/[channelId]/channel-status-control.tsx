"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { CampaignChannelStatus } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setChannelStatusAction } from "./actions";

const CHANNEL_STATUSES: CampaignChannelStatus[] = ["draft", "pending", "scheduled", "live", "paused", "completed", "cancelled"];

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

  return (
    <Select value={status} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {CHANNEL_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>{value}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
