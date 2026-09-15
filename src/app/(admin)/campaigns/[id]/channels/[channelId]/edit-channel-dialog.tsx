"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateChannelAction } from "./actions";

type Props = {
  campaignId: string;
  campaignChannelId: string;
  currency: string;
  /** Empty when the channel's terms are editable; otherwise the reason they are not. */
  blockedReason: string | null;
  initial: {
    contractedQuantity: number;
    clientUnitPrice: string;
    costBudget: string;
    startDate: string;
    endDate: string;
  };
};

export function EditChannelDialog({
  campaignId,
  campaignChannelId,
  currency,
  blockedReason,
  initial,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(String(initial.contractedQuantity));
  const [unitPrice, setUnitPrice] = useState(initial.clientUnitPrice);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);

  if (blockedReason !== null) {
    return (
      <Button variant="outline" size="sm" disabled title={blockedReason}>
        Edit channel
      </Button>
    );
  }

  function submit() {
    startTransition(async () => {
      const result = await updateChannelAction({
        campaignId,
        campaignChannelId,
        contractedQuantity: Number(quantity),
        clientUnitPrice: unitPrice,
        costBudget: initial.costBudget,
        currency,
        startDate,
        endDate,
      });
      if (result.ok) {
        toast.success("Channel terms updated");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Edit channel</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit channel terms</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Changing these terms withdraws any approval the client has already given — they will be
          asked to review the new terms.
        </p>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="channel-quantity">Contracted quantity</FieldLabel>
            <Input
              id="channel-quantity"
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="channel-unit-price">Client unit price ({currency})</FieldLabel>
            <Input
              id="channel-unit-price"
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="channel-start">Start date</FieldLabel>
            <Input
              id="channel-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="channel-end">End date</FieldLabel>
            <Input
              id="channel-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save terms"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
