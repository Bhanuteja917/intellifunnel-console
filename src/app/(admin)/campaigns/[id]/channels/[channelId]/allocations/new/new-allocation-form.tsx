"use client";

import type { Route } from "next";
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
import { createAllocationAction } from "../actions";

const CURRENCY_CODES = Object.keys(CURRENCY_EXPONENTS);

type PartnerOrg = { id: string; name: string; defaultPayoutCurrency: string | null };

type Props = {
  campaignId: string;
  campaignChannelId: string;
  partnerOrgs: PartnerOrg[];
};

export function NewAllocationForm({ campaignId, campaignChannelId, partnerOrgs }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [partnerOrganizationId, setPartnerOrganizationId] = useState("");
  const [allocatedQuantity, setAllocatedQuantity] = useState("");
  const [payoutRate, setPayoutRate] = useState("");
  const [payoutCurrency, setPayoutCurrency] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [revealClientIdentity, setRevealClientIdentity] = useState(false);

  const canSubmit =
    partnerOrganizationId !== "" &&
    allocatedQuantity.trim() !== "" &&
    payoutRate.trim() !== "" &&
    payoutCurrency !== "" &&
    startDate !== "" &&
    endDate !== "";

  function onPartnerOrgChange(id: string) {
    setPartnerOrganizationId(id);
    const org = partnerOrgs.find((o) => o.id === id);
    setPayoutCurrency(org?.defaultPayoutCurrency ?? "");
  }

  function submit() {
    startTransition(async () => {
      const result = await createAllocationAction({
        campaignId,
        campaignChannelId,
        partnerOrganizationId,
        allocatedQuantity: Number(allocatedQuantity),
        payoutRate,
        payoutCurrency,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        revealClientIdentity,
      });
      if (result.ok) {
        toast.success("Allocation created");
        router.push(`/campaigns/${campaignId}/channels/${campaignChannelId}?tab=allocations` as Route);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Allocation details</CardTitle>
          <CardDescription>Allocate a quantity of this channel to a partner organisation</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="allocation-partner">Partner organisation *</FieldLabel>
              <Select value={partnerOrganizationId} onValueChange={onPartnerOrgChange}>
                <SelectTrigger id="allocation-partner" className="w-full">
                  <SelectValue placeholder="Select a partner organisation..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {partnerOrgs.map((org) => (
                      <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {partnerOrgs.length === 0 && (
                <p className="text-sm text-muted-foreground">No active partner organisations found.</p>
              )}
            </Field>
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
        <Button
          variant="outline"
          onClick={() => router.push(`/campaigns/${campaignId}/channels/${campaignChannelId}?tab=allocations` as Route)}
        >
          Cancel
        </Button>
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Create allocation
        </Button>
      </div>
    </div>
  );
}
