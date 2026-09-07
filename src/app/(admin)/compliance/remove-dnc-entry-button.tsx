"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteDoNotContactEntryAction } from "./actions";

type Props = { id: string };

export function RemoveDncEntryButton({ id }: Props) {
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteDoNotContactEntryAction(id);
      if (result.ok) {
        toast.success("Do-not-contact entry removed");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
      Remove
    </Button>
  );
}
