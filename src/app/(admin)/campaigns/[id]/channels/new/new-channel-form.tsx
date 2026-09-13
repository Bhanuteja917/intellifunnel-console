"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Layers, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import type { StepConfig, StepOverride, ChannelStepId } from "@/lib/channels/readiness";
import { addCampaignChannelAction } from "../../actions";

type ChannelTypeOption = { id: string; name: string; requiresAsset: boolean };

type Props = {
  campaignId: string;
  campaignCurrency: string;
  campaignStartDate: string;
  campaignEndDate: string;
  channelTypes: ChannelTypeOption[];
};

type StepDef = {
  id: ChannelStepId;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ALL_STEPS: StepDef[] = [
  {
    id: "placement",
    title: "Add a placement",
    hint: "Asset version, landing page, form slug, and consent text for lead collection.",
    icon: Layers,
  },
  {
    id: "allocations",
    title: "Allocate partner quota",
    hint: "Distribute the contracted quantity across partner organisations. Leave unallocated to run in-house.",
    icon: Users,
  },
];

const OVERRIDE_OPTIONS: { value: StepOverride; label: string }[] = [
  { value: "enabled", label: "Enable" },
  { value: "optional", label: "Make Optional" },
  { value: "skipped", label: "Skip" },
];

export function NewChannelForm({
  campaignId,
  campaignCurrency,
  campaignStartDate,
  campaignEndDate,
  channelTypes,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [channelTypeId, setChannelTypeId] = useState(channelTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [costBudget, setCostBudget] = useState("");
  const [startDate, setStartDate] = useState(campaignStartDate);
  const [endDate, setEndDate] = useState(campaignEndDate);
  const [stepConfig, setStepConfig] = useState<StepConfig>({});

  const selectedType = channelTypes.find((ct) => ct.id === channelTypeId);
  const visibleSteps = ALL_STEPS.filter(
    (s) => s.id !== "placement" || selectedType?.requiresAsset === true,
  );

  function setOverride(stepId: ChannelStepId, override: StepOverride) {
    setStepConfig((prev) => ({ ...prev, [stepId]: override }));
  }

  function getOverride(stepId: ChannelStepId): StepOverride {
    return stepConfig[stepId] ?? "enabled";
  }

  const canSubmit =
    channelTypeId !== "" &&
    Number.isInteger(Number(quantity)) &&
    Number(quantity) > 0 &&
    unitPrice.trim() !== "" &&
    startDate !== "" &&
    endDate !== "";

  function submit() {
    startTransition(async () => {
      const result = await addCampaignChannelAction(campaignId, {
        channelTypeId,
        contractedQuantity: Number(quantity),
        clientUnitPrice: unitPrice,
        costBudget: costBudget.trim() === "" ? undefined : costBudget,
        startDate,
        endDate,
        stepConfig: Object.keys(stepConfig).length > 0 ? stepConfig : undefined,
      });
      if (result.ok) {
        toast.success("Channel created");
        router.push(`/campaigns/${campaignId}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
      <div>
        <h1 className="text-xl font-semibold">Add a channel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the channel details and choose how each setup step is handled.
        </p>
      </div>

      {/* Section 1: Channel details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channel details</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="channel-type">Channel type</FieldLabel>
              <Select
                value={channelTypeId}
                onValueChange={(v) => {
                  setChannelTypeId(v);
                  setStepConfig({});
                }}
              >
                <SelectTrigger id="channel-type" className="w-full">
                  <SelectValue placeholder="Channel type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {channelTypes.map((ct) => (
                      <SelectItem key={ct.id} value={ct.id}>
                        {ct.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-quantity">Contracted quantity</FieldLabel>
              <Input
                id="channel-quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-price">
                Client unit price ({campaignCurrency})
              </FieldLabel>
              <Input
                id="channel-price"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="e.g. 125.00"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-budget">
                Cost budget ({campaignCurrency}, optional)
              </FieldLabel>
              <Input
                id="channel-budget"
                value={costBudget}
                onChange={(e) => setCostBudget(e.target.value)}
                placeholder="optional"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="channel-start">Start date</FieldLabel>
                <Input
                  id="channel-start"
                  type="date"
                  min={campaignStartDate}
                  max={campaignEndDate}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="channel-end">End date</FieldLabel>
                <Input
                  id="channel-end"
                  type="date"
                  min={campaignStartDate}
                  max={campaignEndDate}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      {/* Section 2: Step configuration */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Setup steps</h2>
          <p className="text-sm text-muted-foreground">
            Choose how each step is handled for this channel.
          </p>
        </div>
        {visibleSteps.map((step) => {
          const current = getOverride(step.id);
          const Icon = step.icon;
          return (
            <div key={step.id} className="rounded-lg border p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.hint}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {OVERRIDE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={current === opt.value ? "default" : "outline"}
                    className={cn(current === opt.value && "shadow-none")}
                    onClick={() => setOverride(step.id, opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          disabled={!canSubmit || pending}
          onClick={submit}
        >
          Create channel
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/campaigns/${campaignId}`)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
