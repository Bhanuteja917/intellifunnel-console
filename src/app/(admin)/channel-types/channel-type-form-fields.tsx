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

export const METRIC_MODES = ["event", "aggregate"] as const;
export const PRICING_UNITS = ["CPL", "CPM", "CPA", "flat"] as const;

type Props = {
  idPrefix: string;
  name: string;
  onNameChange: (value: string) => void;
  funnelStageId: string;
  onFunnelStageIdChange: (value: string) => void;
  funnelStages: { id: string; name: string }[];
  metricMode: (typeof METRIC_MODES)[number];
  onMetricModeChange: (value: (typeof METRIC_MODES)[number]) => void;
  pricingUnit: (typeof PRICING_UNITS)[number];
  onPricingUnitChange: (value: (typeof PRICING_UNITS)[number]) => void;
  allowedMetricFields: string;
  onAllowedMetricFieldsChange: (value: string) => void;
  verificationSlaBusinessDays: string;
  onVerificationSlaBusinessDaysChange: (value: string) => void;
  producesLeads: boolean;
  onProducesLeadsChange: (value: boolean) => void;
  requiresAsset: boolean;
  onRequiresAssetChange: (value: boolean) => void;
  requiresTeleVerification: boolean;
  onRequiresTeleVerificationChange: (value: boolean) => void;
};

/** Shared by NewChannelTypeDialog and EditChannelTypeDialog — every field but Code. */
export function ChannelTypeFormFields({
  idPrefix,
  name,
  onNameChange,
  funnelStageId,
  onFunnelStageIdChange,
  funnelStages,
  metricMode,
  onMetricModeChange,
  pricingUnit,
  onPricingUnitChange,
  allowedMetricFields,
  onAllowedMetricFieldsChange,
  verificationSlaBusinessDays,
  onVerificationSlaBusinessDaysChange,
  producesLeads,
  onProducesLeadsChange,
  requiresAsset,
  onRequiresAssetChange,
  requiresTeleVerification,
  onRequiresTeleVerificationChange,
}: Props) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Name *</FieldLabel>
        <Input id={`${idPrefix}-name`} value={name} onChange={(e) => onNameChange(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-stage`}>Funnel stage *</FieldLabel>
        <Select value={funnelStageId} onValueChange={onFunnelStageIdChange}>
          <SelectTrigger id={`${idPrefix}-stage`} className="w-full"><SelectValue placeholder="Funnel stage" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {funnelStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-metric-mode`}>Metric mode *</FieldLabel>
          <Select value={metricMode} onValueChange={(v) => onMetricModeChange(v as (typeof METRIC_MODES)[number])}>
            <SelectTrigger id={`${idPrefix}-metric-mode`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {METRIC_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-pricing-unit`}>Pricing unit *</FieldLabel>
          <Select value={pricingUnit} onValueChange={(v) => onPricingUnitChange(v as (typeof PRICING_UNITS)[number])}>
            <SelectTrigger id={`${idPrefix}-pricing-unit`} className="w-full"><SelectValue /></SelectTrigger>
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
          <FieldLabel htmlFor={`${idPrefix}-metric-fields`}>Allowed metric fields (comma-separated) *</FieldLabel>
          <Input
            id={`${idPrefix}-metric-fields`}
            value={allowedMetricFields}
            onChange={(e) => onAllowedMetricFieldsChange(e.target.value)}
            placeholder="e.g. impressions, clicks, spend"
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-sla`}>Verification SLA (business days, optional)</FieldLabel>
        <Input
          id={`${idPrefix}-sla`}
          type="number"
          min="0"
          step="1"
          value={verificationSlaBusinessDays}
          onChange={(e) => onVerificationSlaBusinessDaysChange(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Options</FieldLabel>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={producesLeads} onCheckedChange={(checked) => onProducesLeadsChange(checked === true)} />
            Produces leads
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={requiresAsset} onCheckedChange={(checked) => onRequiresAssetChange(checked === true)} />
            Requires asset
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={requiresTeleVerification}
              onCheckedChange={(checked) => onRequiresTeleVerificationChange(checked === true)}
            />
            Requires tele-verification
          </label>
        </div>
      </Field>
    </FieldGroup>
  );
}
