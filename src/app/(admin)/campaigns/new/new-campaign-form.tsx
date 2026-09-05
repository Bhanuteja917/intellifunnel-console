"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCampaignAction } from "../actions";

type Props = {
  clientOrganizations: { id: string; name: string }[];
  currencies: string[];
};

function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function NewCampaignForm({ clientOrganizations, currencies }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [clientOrganizationId, setClientOrganizationId] = useState(clientOrganizations[0]?.id ?? "");
  const [currency, setCurrency] = useState(currencies[0] ?? "");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const canSubmit =
    name.trim() !== "" &&
    code.trim() !== "" &&
    clientOrganizationId !== "" &&
    currency !== "" &&
    range?.from !== undefined &&
    range?.to !== undefined;

  function submit() {
    if (range?.from === undefined || range.to === undefined) return;
    startTransition(async () => {
      const result = await createCampaignAction({
        clientOrganizationId,
        name,
        code,
        currency,
        startDate: toISODate(range.from!),
        endDate: toISODate(range.to!),
      });
      if (result.ok) {
        toast.success("Campaign created");
        router.push(`/campaigns/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  const rangeLabel =
    range?.from !== undefined && range.to !== undefined
      ? `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`
      : range?.from !== undefined
        ? format(range.from, "MMM d, yyyy")
        : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Campaign Details</CardTitle>
          <CardDescription>Basic information about the campaign</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="campaign-name">Campaign Name *</FieldLabel>
              <Input
                id="campaign-name"
                placeholder="e.g., Q1 2024 Enterprise Campaign"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="campaign-code">Campaign Code *</FieldLabel>
              <Input
                id="campaign-code"
                placeholder="e.g., Q1-2024-ENT"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="campaign-client">Client *</FieldLabel>
                <Select value={clientOrganizationId} onValueChange={setClientOrganizationId}>
                  <SelectTrigger id="campaign-client" className="w-full">
                    <SelectValue placeholder="Select client..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {clientOrganizations.map((organization) => (
                        <SelectItem key={organization.id} value={organization.id}>
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="campaign-currency">Currency *</FieldLabel>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="campaign-currency" className="w-full">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {currencies.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Flight Dates</CardTitle>
          <CardDescription>Campaign timeline</CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="campaign-flight-dates">Flight Date Range *</FieldLabel>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="campaign-flight-dates"
                  type="button"
                  variant="outline"
                  className="w-full justify-start font-normal text-muted-foreground data-[has-value=true]:text-foreground"
                  data-has-value={rangeLabel !== null}
                >
                  <CalendarIcon />
                  {rangeLabel ?? "Select campaign flight dates"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  selected={range}
                  onSelect={(next) => {
                    setRange(next);
                    if (next?.from !== undefined && next.to !== undefined) setCalendarOpen(false);
                  }}
                  defaultMonth={range?.from}
                />
              </PopoverContent>
            </Popover>
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/campaigns")}>
          Cancel
        </Button>
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Create Campaign
        </Button>
      </div>
    </div>
  );
}
