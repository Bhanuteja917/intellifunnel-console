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
import { createChannelTypeAction } from "./actions";

const METRIC_MODES = ["event", "aggregate"] as const;
const PRICING_UNITS = ["CPL", "CPM", "CPA", "flat"] as const;

type Props = {
  funnelStages: { id: string; name: string }[];
};

export function NewChannelTypeDialog({ funnelStages }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [funnelStageId, setFunnelStageId] = useState(funnelStages[0]?.id ?? "");
  const [metricMode, setMetricMode] = useState<(typeof METRIC_MODES)[number]>("event");
  const [pricingUnit, setPricingUnit] = useState<(typeof PRICING_UNITS)[number]>("CPL");
  const [producesLeads, setProducesLeads] = useState(true);
  const [requiresAsset, setRequiresAsset] = useState(false);
  const [requiresTeleVerification, setRequiresTeleVerification] = useState(false);
  const [verificationSlaBusinessDays, setVerificationSlaBusinessDays] = useState("");
  const [allowedMetricFields, setAllowedMetricFields] = useState("");

  function reset() {
    setCode("");
    setName("");
    setMetricMode("event");
    setPricingUnit("CPL");
    setProducesLeads(true);
    setRequiresAsset(false);
    setRequiresTeleVerification(false);
    setVerificationSlaBusinessDays("");
    setAllowedMetricFields("");
  }

  const metricFields = allowedMetricFields.split(",").map((v) => v.trim()).filter((v) => v !== "");
  const canSubmit =
    code.trim() !== "" &&
    name.trim() !== "" &&
    funnelStageId !== "" &&
    (metricMode !== "aggregate" || metricFields.length > 0);

  function submit() {
    startTransition(async () => {
      const result = await createChannelTypeAction({
        code,
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
        toast.success("Channel type created");
        reset();
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Create channel type</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a channel type</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ct-code">Code *</FieldLabel>
              <Input id="ct-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ct-name">Name *</FieldLabel>
              <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ct-stage">Funnel stage *</FieldLabel>
            <Select value={funnelStageId} onValueChange={setFunnelStageId}>
              <SelectTrigger id="ct-stage" className="w-full"><SelectValue placeholder="Funnel stage" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {funnelStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ct-metric-mode">Metric mode *</FieldLabel>
              <Select value={metricMode} onValueChange={(v) => setMetricMode(v as (typeof METRIC_MODES)[number])}>
                <SelectTrigger id="ct-metric-mode" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {METRIC_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ct-pricing-unit">Pricing unit *</FieldLabel>
              <Select value={pricingUnit} onValueChange={(v) => setPricingUnit(v as (typeof PRICING_UNITS)[number])}>
                <SelectTrigger id="ct-pricing-unit" className="w-full"><SelectValue /></SelectTrigger>
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
              <FieldLabel htmlFor="ct-metric-fields">Allowed metric fields (comma-separated) *</FieldLabel>
              <Input
                id="ct-metric-fields"
                value={allowedMetricFields}
                onChange={(e) => setAllowedMetricFields(e.target.value)}
                placeholder="e.g. impressions, clicks, spend"
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="ct-sla">Verification SLA (business days, optional)</FieldLabel>
            <Input
              id="ct-sla"
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
