"use client";

import { useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addCampaignChannelAction } from "./actions";

type Props = {
  campaignId: string;
  campaignCurrency: string;
  campaignStartDate: string;
  campaignEndDate: string;
  channelTypes: { id: string; name: string; code: string }[];
};

export function AddChannelDialog({ campaignId, campaignCurrency, campaignStartDate, campaignEndDate, channelTypes }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [channelTypeId, setChannelTypeId] = useState(channelTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [costBudget, setCostBudget] = useState("");
  const [startDate, setStartDate] = useState(campaignStartDate);
  const [endDate, setEndDate] = useState(campaignEndDate);

  function reset() {
    setQuantity("");
    setUnitPrice("");
    setCostBudget("");
    setStartDate(campaignStartDate);
    setEndDate(campaignEndDate);
  }

  function submit() {
    const contractedQuantity = Number(quantity);
    startTransition(async () => {
      const result = await addCampaignChannelAction(campaignId, {
        channelTypeId,
        contractedQuantity,
        clientUnitPrice: unitPrice,
        costBudget: costBudget.trim() === "" ? undefined : costBudget,
        startDate,
        endDate,
      });
      if (result.ok) {
        toast.success("Channel added");
        reset();
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  const canSubmit =
    channelTypeId !== "" &&
    Number.isFinite(Number(quantity)) && Number(quantity) > 0 &&
    unitPrice.trim() !== "" &&
    startDate !== "" && endDate !== "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={channelTypes.length === 0}>Add channel</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a channel</DialogTitle></DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="channel-type">Channel type</FieldLabel>
            <Select value={channelTypeId} onValueChange={setChannelTypeId}>
              <SelectTrigger id="channel-type" className="w-full"><SelectValue placeholder="Channel type" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {channelTypes.map((ct) => <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="channel-quantity">Contracted quantity</FieldLabel>
            <Input id="channel-quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="channel-price">Client unit price ({campaignCurrency})</FieldLabel>
            <Input id="channel-price" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="e.g. 125.00" />
          </Field>
          <Field>
            <FieldLabel htmlFor="channel-budget">Cost budget ({campaignCurrency}, optional)</FieldLabel>
            <Input id="channel-budget" value={costBudget} onChange={(e) => setCostBudget(e.target.value)} placeholder="optional" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="channel-start">Start date</FieldLabel>
              <Input id="channel-start" type="date" min={campaignStartDate} max={campaignEndDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-end">End date</FieldLabel>
              <Input id="channel-end" type="date" min={campaignStartDate} max={campaignEndDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={pending || !canSubmit} onClick={submit}>Add channel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
