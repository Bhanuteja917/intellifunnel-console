"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ApprovalStatus } from "@/lib/approvals/status";
import { fromMinorUnits, toMinorUnits } from "@/lib/money/currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateChannelAction } from "./actions";

export const TERMS_BADGE: Record<ApprovalStatus, { variant: "default" | "secondary" | "destructive"; label: string }> = {
  approved: { variant: "default", label: "approved by client" },
  pending: { variant: "secondary", label: "awaiting client approval" },
  changesRequested: { variant: "destructive", label: "changes requested" },
  reapprovalNeeded: { variant: "destructive", label: "changed since approval" },
};

function row(label: string, value: string) {
  return (
    <div key={label} className="flex items-baseline justify-between gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function ChannelTermsCard({
  campaignId,
  campaignChannelId,
  channelLabel,
  termsStatus,
  currency,
  canEdit,
  blockedReason,
  initial,
}: {
  campaignId: string;
  campaignChannelId: string;
  channelLabel: string | undefined;
  termsStatus: ApprovalStatus;
  currency: string;
  canEdit: boolean;
  /** Empty when the channel's terms are editable; otherwise the reason they are not. */
  blockedReason: string | null;
  initial: {
    contractedQuantity: number;
    clientUnitPriceMinor: bigint;
    costBudget: string;
    startDate: string;
    endDate: string;
  };
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(String(initial.contractedQuantity));
  const [unitPrice, setUnitPrice] = useState(fromMinorUnits(initial.clientUnitPriceMinor, currency));
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);

  const badge = TERMS_BADGE[termsStatus];

  function startEditing() {
    setQuantity(String(initial.contractedQuantity));
    setUnitPrice(fromMinorUnits(initial.clientUnitPriceMinor, currency));
    setStartDate(initial.startDate);
    setEndDate(initial.endDate);
    setIsEditing(true);
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

      toast.success("Channel terms updated");
      setIsEditing(false);
      router.refresh();
    });
  }

  const contractedValueMinor = isEditing
    ? toMinorUnits(unitPrice || "0", currency) * BigInt(Number.isFinite(Number(quantity)) ? Number(quantity) || 0 : 0)
    : initial.clientUnitPriceMinor * BigInt(initial.contractedQuantity);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Channel terms</CardTitle>
          <p className="text-sm text-muted-foreground">
            {isEditing
              ? "Changing these terms withdraws any approval the client has already given — they will be asked to review the new terms."
              : "What the client is asked to approve. Decisions are made by the client in their own portal — there is no approve button here."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {canEdit && !isEditing && blockedReason !== null && (
            <Button variant="outline" size="sm" disabled title={blockedReason}>
              Edit channel
            </Button>
          )}
          {canEdit && !isEditing && blockedReason === null && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              Edit channel
            </Button>
          )}
          {canEdit && isEditing && (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={pending}>
                {pending ? "Saving…" : "Save terms"}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
        {row("Channel type", channelLabel ?? "—")}
        {isEditing ? (
          <FieldGroup className="py-2.5">
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
          </FieldGroup>
        ) : (
          <>
            {row("Contracted quantity", `${initial.contractedQuantity} leads`)}
            {row("Client unit price", `${currency} ${fromMinorUnits(initial.clientUnitPriceMinor, currency)}`)}
          </>
        )}
        {row("Contracted value", `${currency} ${fromMinorUnits(contractedValueMinor, currency)}`)}
        {isEditing ? (
          <FieldGroup className="py-2.5">
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
        ) : (
          row("Flight window", `${initial.startDate} – ${initial.endDate}`)
        )}
      </CardContent>
    </Card>
  );
}
