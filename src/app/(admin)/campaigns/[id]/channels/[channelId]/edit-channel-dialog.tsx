"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ChannelSetupRequirement, ChannelSetupStepKey } from "@prisma/client";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setChannelStepRequirementAction, updateChannelAction } from "./actions";

type EditableStep = { key: ChannelSetupStepKey; title: string; requirement: ChannelSetupRequirement };

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
  steps: EditableStep[];
};

export function EditChannelDialog({
  campaignId,
  campaignChannelId,
  currency,
  blockedReason,
  initial,
  steps,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(String(initial.contractedQuantity));
  const [unitPrice, setUnitPrice] = useState(initial.clientUnitPrice);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [requirements, setRequirements] = useState<Record<string, ChannelSetupRequirement>>(
    () => Object.fromEntries(steps.map((s) => [s.key, s.requirement])),
  );

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
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const changedSteps = steps
        .map((s) => ({ key: s.key, requirement: requirements[s.key] ?? s.requirement }))
        .filter((s) => s.requirement !== steps.find((orig) => orig.key === s.key)?.requirement);
      const stepResults = await Promise.all(
        changedSteps.map((s) =>
          setChannelStepRequirementAction(campaignId, campaignChannelId, s.key, s.requirement),
        ),
      );
      const stepError = stepResults.find((r) => !r.ok);
      if (stepError && !stepError.ok) {
        toast.error(stepError.error);
        return;
      }

      toast.success("Channel terms updated");
      setOpen(false);
      router.refresh();
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
        {steps.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <FieldLabel>Setup steps</FieldLabel>
            {steps.map((step) => (
              <div key={step.key} className="flex items-center justify-between gap-4">
                <span className="text-sm">{step.title}</span>
                <Select
                  value={requirements[step.key] ?? step.requirement}
                  onValueChange={(next) =>
                    setRequirements((prev) => ({ ...prev, [step.key]: next as ChannelSetupRequirement }))
                  }
                >
                  <SelectTrigger className="w-28" aria-label={`${step.title} requirement`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">Required</SelectItem>
                    <SelectItem value="optional">Optional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
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
