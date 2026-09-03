"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deactivateChannelTypeAction, publishChannelTypeAction } from "./actions";
import type { ActionResult } from "@/lib/auth/require";

type Props = {
  channelTypeId: string;
  isActive: boolean;
  canPublish: boolean;
  canDeactivate: boolean;
};

export function ChannelTypeActions({ channelTypeId, isActive, canPublish, canDeactivate }: Props) {
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex gap-2">
      {canPublish && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => publishChannelTypeAction(channelTypeId), "Version published")}
        >
          Publish
        </Button>
      )}
      {canDeactivate && isActive && (
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => run(() => deactivateChannelTypeAction(channelTypeId), "Channel type deactivated")}
        >
          Deactivate
        </Button>
      )}
    </div>
  );
}
