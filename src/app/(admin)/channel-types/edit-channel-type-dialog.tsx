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
import { updateChannelTypeAction } from "./actions";

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
        // Empty input means "clear the SLA" here (the field already had a
        // value), not "leave unchanged" — must send `null`, not `undefined`,
        // or Prisma's update ignores the field and the old value survives.
        verificationSlaBusinessDays:
          verificationSlaBusinessDays.trim() === "" ? null : Number(verificationSlaBusinessDays),
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
          <Field>
            <FieldLabel>Code</FieldLabel>
            <Input value={channelType.code} disabled />
          </Field>
        </FieldGroup>
        <ChannelTypeFormFields
          idPrefix="ct-edit"
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
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
