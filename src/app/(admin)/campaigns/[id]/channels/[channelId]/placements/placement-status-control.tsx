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
import type { ApprovalStatus } from "@/lib/approvals/status";
import { setPlacementStatusAction } from "./actions";

const PLACEMENT_STATUSES: AssetPlacementStatus[] = ["draft", "active", "paused", "archived"];

const BLOCKED_REASON: Record<Exclude<ApprovalStatus, "approved">, string> = {
  pending: "The client has not approved this landing page URL yet",
  changesRequested: "The client asked for changes to this placement",
  reapprovalNeeded: "This placement changed since the client approved it",
};

type Props = {
  campaignId: string;
  campaignChannelId: string;
  placementId: string;
  status: AssetPlacementStatus;
  approvalStatus: ApprovalStatus;
};

export function PlacementStatusControl({
  campaignId,
  campaignChannelId,
  placementId,
  status,
  approvalStatus,
}: Props) {
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

  // setPlacementStatus refuses "active" without a current client approval;
  // disabling the option here only saves the operator an error they could have
  // been warned about — the server remains the enforcement point.
  const blockedReason = approvalStatus === "approved" ? null : BLOCKED_REASON[approvalStatus];

  return (
    <div className="flex flex-col gap-1">
      <Select value={status} onValueChange={onChange} disabled={pending}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {PLACEMENT_STATUSES.map((value) => (
              <SelectItem
                key={value}
                value={value}
                disabled={value === "active" && blockedReason !== null}
              >
                {value}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {blockedReason !== null && status !== "active" && (
        <span className="max-w-40 text-xs text-muted-foreground">{blockedReason}</span>
      )}
    </div>
  );
}
