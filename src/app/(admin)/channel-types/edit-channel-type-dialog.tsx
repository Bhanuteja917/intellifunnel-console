"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { updateChannelTypeAction } from "./actions";

const METRIC_MODES = ["event", "aggregate"] as const;
const PRICING_UNITS = ["CPL", "CPM", "CPA", "flat"] as const;

type ChannelType = {
  id: string;
  code: string;
  name: string;
  funnelStageId: string;
  metricMode: (typeof METRIC_MODES)[number];
  pricingUnit: (typeof PRICING_UNITS)[number];
  producesLeads: boolean;
  requiresAsset: boolean;
  requiresTeleVerification: boolean;
  verificationSlaBusinessDays: number | null;
  allowedMetricFields: string[];
};

type Props = {
  channelType: ChannelType;
  funnelStages: { id: string; name: string }[];
};

export function EditChannelTypeDialog({ channelType, funnelStages }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(channelType.name);
  const [funnelStageId, setFunnelStageId] = useState(channelType.funnelStageId);
  const [metricMode, setMetricMode] = useState(channelType.metricMode);
  const [pricingUnit, setPricingUnit] = useState(channelType.pricingUnit);
  const [producesLeads, setProducesLeads] = useState(channelType.producesLeads);
  const [requiresAsset, setRequiresAsset] = useState(channelType.requiresAsset);
  const [requiresTeleVerification, setRequiresTeleVerification] = useState(channelType.requiresTeleVerification);
  const [verificationSlaBusinessDays, setVerificationSlaBusinessDays] = useState(
    channelType.verificationSlaBusinessDays === null ? "" : String(channelType.verificationSlaBusinessDays),
  );
  const [allowedMetricFields, setAllowedMetricFields] = useState(channelType.allowedMetricFields.join(", "));

  const metricFields = allowedMetricFields.split(",").map((v) => v.trim()).filter((v) => v !== "");
  const canSubmit = name.trim() !== "" && funnelStageId !== "" && (metricMode !== "aggregate" || metricFields.length > 0);

  function submit() {
    startTransition(async () => {
      const result = await updateChannelTypeAction(channelType.id, {
        name,
        funnelStageId,
        producesLeads,
        requiresAsset,
        metricMode,
        pricingUnit,
        requiresTeleVerification,
        allowedMetricFields: metricFields,
        verificationSlaBusinessDays:
          verificationSlaBusinessDays.trim() === "" ? undefined : Number(verificationSlaBusinessDays),
      });
      if (result.ok) {
        toast.success("Channel type updated");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Edit</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit channel type</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Code</FieldLabel>
              <Input value={channelType.code} disabled />
            </Field>
            <Field>
              <FieldLabel htmlFor="ct-edit-name">Name *</FieldLabel>
              <Input id="ct-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ct-edit-stage">Funnel stage *</FieldLabel>
            <Select value={funnelStageId} onValueChange={setFunnelStageId}>
              <SelectTrigger id="ct-edit-stage" className="w-full"><SelectValue placeholder="Funnel stage" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {funnelStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ct-edit-metric-mode">Metric mode *</FieldLabel>
              <Select value={metricMode} onValueChange={(v) => setMetricMode(v as (typeof METRIC_MODES)[number])}>
                <SelectTrigger id="ct-edit-metric-mode" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {METRIC_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ct-edit-pricing-unit">Pricing unit *</FieldLabel>
              <Select value={pricingUnit} onValueChange={(v) => setPricingUnit(v as (typeof PRICING_UNITS)[number])}>
                <SelectTrigger id="ct-edit-pricing-unit" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PRICING_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {metricMode === "aggregate" && (
            <Field>
              <FieldLabel htmlFor="ct-edit-metric-fields">Allowed metric fields (comma-separated) *</FieldLabel>
              <Input
                id="ct-edit-metric-fields"
                value={allowedMetricFields}
                onChange={(e) => setAllowedMetricFields(e.target.value)}
                placeholder="e.g. impressions, clicks, spend"
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="ct-edit-sla">Verification SLA (business days, optional)</FieldLabel>
            <Input
              id="ct-edit-sla"
              type="number"
              min="0"
              step="1"
              value={verificationSlaBusinessDays}
              onChange={(e) => setVerificationSlaBusinessDays(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Options</FieldLabel>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={producesLeads} onCheckedChange={(checked) => setProducesLeads(checked === true)} />
                Produces leads
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={requiresAsset} onCheckedChange={(checked) => setRequiresAsset(checked === true)} />
                Requires asset
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={requiresTeleVerification}
                  onCheckedChange={(checked) => setRequiresTeleVerification(checked === true)}
                />
                Requires tele-verification
              </label>
            </div>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={pending || !canSubmit} onClick={submit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
