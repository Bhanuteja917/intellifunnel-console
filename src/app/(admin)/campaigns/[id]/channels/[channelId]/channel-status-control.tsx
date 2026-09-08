"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CampaignChannelStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { setChannelStatusAction } from "./actions";

type Props = {
  campaignId: string;
  campaignChannelId: string;
  status: CampaignChannelStatus;
  /** Null when the channel can be activated; otherwise why it cannot. */
  activateBlockedReason: string | null;
};

export function ChannelStatusControl({
  campaignId,
  campaignChannelId,
  status,
  activateBlockedReason,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function set(next: CampaignChannelStatus) {
    startTransition(async () => {
      const result = await setChannelStatusAction({
        campaignId,
        campaignChannelId,
        status: next,
      });
      if (result.ok) {
        toast.success(next === "active" ? "Channel activated" : "Channel paused");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  // completed channels are terminal, and this control does not own that hop.
  if (status === "completed") return null;

  if (status === "active") {
    return (
      <Button variant="outline" size="sm" onClick={() => set("paused")} disabled={pending}>
        Pause channel
      </Button>
    );
  }

  const blocked = status === "draft" ? activateBlockedReason : null;

  return (
    <Button
      size="sm"
      onClick={() => set("active")}
      disabled={pending || blocked !== null}
      title={blocked ?? undefined}
    >
      {status === "paused" ? "Resume channel" : "Activate channel"}
    </Button>
  );
}
