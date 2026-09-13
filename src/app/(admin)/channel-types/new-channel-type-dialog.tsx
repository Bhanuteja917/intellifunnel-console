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
import { ChannelTypeFormFields, METRIC_MODES, PRICING_UNITS } from "./channel-type-form-fields";
import { createChannelTypeAction } from "./actions";

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
          <Field>
            <FieldLabel htmlFor="ct-code">Code *</FieldLabel>
            <Input id="ct-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
        </FieldGroup>
        <ChannelTypeFormFields
          idPrefix="ct"
          name={name}
          onNameChange={setName}
          funnelStageId={funnelStageId}
          onFunnelStageIdChange={setFunnelStageId}
          funnelStages={funnelStages}
          metricMode={metricMode}
          onMetricModeChange={setMetricMode}
          pricingUnit={pricingUnit}
          onPricingUnitChange={setPricingUnit}
          allowedMetricFields={allowedMetricFields}
          onAllowedMetricFieldsChange={setAllowedMetricFields}
          verificationSlaBusinessDays={verificationSlaBusinessDays}
          onVerificationSlaBusinessDaysChange={setVerificationSlaBusinessDays}
          producesLeads={producesLeads}
          onProducesLeadsChange={setProducesLeads}
          requiresAsset={requiresAsset}
          onRequiresAssetChange={setRequiresAsset}
          requiresTeleVerification={requiresTeleVerification}
          onRequiresTeleVerificationChange={setRequiresTeleVerification}
        />
        <DialogFooter>
          <Button disabled={pending || !canSubmit} onClick={submit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
