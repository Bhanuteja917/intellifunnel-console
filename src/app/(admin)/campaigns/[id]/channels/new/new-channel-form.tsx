"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { addCampaignChannelAction } from "../../actions";

type ChannelTypeOption = { id: string; name: string; requiresAsset: boolean };

type Props = {
  campaignId: string;
  campaignCurrency: string;
  campaignStartDate: string;
  campaignEndDate: string;
  channelTypes: ChannelTypeOption[];
};

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
  const [startDate, setStartDate] = useState(campaignStartDate);
  const [endDate, setEndDate] = useState(campaignEndDate);

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
        startDate,
        endDate,
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
                onValueChange={setChannelTypeId}
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
