"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { AssetPlacementStatus } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setPlacementStatusAction } from "./actions";

const PLACEMENT_STATUSES: AssetPlacementStatus[] = ["draft", "active", "paused", "archived"];

type Props = {
  campaignId: string;
  campaignChannelId: string;
  placementId: string;
  status: AssetPlacementStatus;
};

export function PlacementStatusControl({ campaignId, campaignChannelId, placementId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(async () => {
      const result = await setPlacementStatusAction(
        campaignId,
        campaignChannelId,
        placementId,
        next as AssetPlacementStatus,
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
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {PLACEMENT_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>{value}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
