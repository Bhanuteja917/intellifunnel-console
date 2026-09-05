"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { AllocationStatus } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setAllocationStatusAction } from "./actions";

const ALLOCATION_STATUSES: AllocationStatus[] = ["draft", "active", "paused", "ended"];

type Props = {
  campaignId: string;
  campaignChannelId: string;
  allocationId: string;
  status: AllocationStatus;
};

export function AllocationStatusControl({ campaignId, campaignChannelId, allocationId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(async () => {
      const result = await setAllocationStatusAction(
        campaignId,
        campaignChannelId,
        allocationId,
        next as AllocationStatus,
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
          {ALLOCATION_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>{value}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
