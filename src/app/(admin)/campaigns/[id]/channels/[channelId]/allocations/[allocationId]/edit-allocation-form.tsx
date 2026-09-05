"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CURRENCY_EXPONENTS } from "@/lib/money/currency";
import { updateAllocationAction } from "../actions";

const CURRENCY_CODES = Object.keys(CURRENCY_EXPONENTS);

type Props = {
  campaignId: string;
  campaignChannelId: string;
  allocationId: string;
  allocatedQuantity: number;
  payoutRate: string;
  payoutCurrency: string;
  startDate: string;
  endDate: string;
  revealClientIdentity: boolean;
};

export function EditAllocationForm({
  campaignId,
  campaignChannelId,
  allocationId,
  allocatedQuantity: initialAllocatedQuantity,
  payoutRate: initialPayoutRate,
  payoutCurrency: initialPayoutCurrency,
  startDate: initialStartDate,
  endDate: initialEndDate,
  revealClientIdentity: initialRevealClientIdentity,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allocatedQuantity, setAllocatedQuantity] = useState(String(initialAllocatedQuantity));
  const [payoutRate, setPayoutRate] = useState(initialPayoutRate);
  const [payoutCurrency, setPayoutCurrency] = useState(initialPayoutCurrency);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [revealClientIdentity, setRevealClientIdentity] = useState(initialRevealClientIdentity);

  const canSubmit =
    allocatedQuantity.trim() !== "" &&
    payoutRate.trim() !== "" &&
    payoutCurrency !== "" &&
    startDate !== "" &&
    endDate !== "";

  function submit() {
    startTransition(async () => {
      const result = await updateAllocationAction({
        campaignId,
        campaignChannelId,
        allocationId,
        allocatedQuantity: Number(allocatedQuantity),
        payoutRate,
        payoutCurrency,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        revealClientIdentity,
      });
      if (result.ok) {
        toast.success("Allocation updated");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Allocation details</CardTitle>
          <CardDescription>Reallocation is a plain edit — there is no history or versioning.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="allocation-quantity">Allocated quantity *</FieldLabel>
              <Input
                id="allocation-quantity"
                type="number"
                min="1"
                step="1"
                value={allocatedQuantity}
                onChange={(event) => setAllocatedQuantity(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="allocation-rate">Payout rate *</FieldLabel>
              <Input
                id="allocation-rate"
                placeholder="e.g. 12.50"
                value={payoutRate}
                onChange={(event) => setPayoutRate(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="allocation-currency">Payout currency *</FieldLabel>
              <Select value={payoutCurrency} onValueChange={setPayoutCurrency}>
                <SelectTrigger id="allocation-currency" className="w-full">
                  <SelectValue placeholder="Select a currency..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CURRENCY_CODES.map((code) => (
                      <SelectItem key={code} value={code}>{code}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="allocation-start">Start date *</FieldLabel>
              <Input
                id="allocation-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="allocation-end">End date *</FieldLabel>
              <Input
                id="allocation-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
            <Field>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="allocation-reveal"
                  checked={revealClientIdentity}
                  onCheckedChange={(checked) => setRevealClientIdentity(checked === true)}
                />
                <FieldLabel htmlFor="allocation-reveal" className="font-normal">
                  Reveal client identity to this partner
                </FieldLabel>
              </div>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
