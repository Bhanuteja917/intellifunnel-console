"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitLeadFileAction } from "../actions";

type Channel = { id: string; label: string };
type LeadFieldKey = { fieldKey: string; label: string; isRequired: boolean };

type Props = {
  campaignId: string;
  channels: Channel[];
  leadFieldKeys: LeadFieldKey[];
  partnersByChannelId: Record<string, { id: string; name: string }[]>;
};

const SOURCE_TYPES = ["internal", "partner"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

// Sentinel for the "— not mapped —" option — Radix Select items can't carry
// an empty-string value, so a non-required field key that isn't mapped to
// any CSV header uses this instead of "".
const UNMAPPED = "__unmapped__";

export function UploadForm({ campaignId, channels, leadFieldKeys, partnersByChannelId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [campaignChannelId, setCampaignChannelId] = useState(channels[0]?.id ?? "");
  const [sourceType, setSourceType] = useState<SourceType>("internal");
  const [partnerOrganizationId, setPartnerOrganizationId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  // fieldKey -> selected CSV header (or UNMAPPED)
  const [headerByFieldKey, setHeaderByFieldKey] = useState<Record<string, string>>({});

  const availablePartners = partnersByChannelId[campaignChannelId] ?? [];

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    const text = await file.text();
    setFileName(file.name);
    setContent(text);
    // The selected header becomes the actual key of `mapping` sent to the
    // server, so it must match parseDelimited's (src/lib/lists/csv.ts) header
    // row byte-for-byte — including its delimiter auto-detection, which a
    // naive `split(",")` doesn't do (e.g. semicolon-delimited CSVs).
    const parsedHeaders = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      preview: 1,
    });
    setHeaders(parsedHeaders.meta.fields ?? []);
    setHeaderByFieldKey({});
  }

  // mapping: { [csvHeader]: fieldKey } — applyMapping (src/lib/lists/csv.ts)
  // reads mapping[sourceColumnHeader] = canonicalKey, so this must be keyed
  // by the CSV header string, not the field key.
  const mapping = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [fieldKey, header] of Object.entries(headerByFieldKey)) {
      if (header !== UNMAPPED && header !== "") result[header] = fieldKey;
    }
    return result;
  }, [headerByFieldKey]);

  const canSubmit =
    campaignChannelId !== "" &&
    content !== null &&
    (sourceType !== "partner" || partnerOrganizationId !== "") &&
    leadFieldKeys
      .filter((f) => f.isRequired)
      .every((f) => headerByFieldKey[f.fieldKey] !== undefined && headerByFieldKey[f.fieldKey] !== UNMAPPED);

  function submit() {
    if (content === null) return;
    startTransition(async () => {
      const result = await submitLeadFileAction({
        campaignChannelId,
        campaignId,
        sourceType,
        partnerOrganizationId: sourceType === "partner" ? partnerOrganizationId : undefined,
        content,
        mapping,
      });
      if (result.ok) {
        toast.success(`${result.data.rowsAccepted} of ${result.data.rowsTotal} rows staged`);
        // No `/campaigns/[id]/leads` list page exists yet (a later task adds
        // it), so typedRoutes can't validate this literal — same cast
        // header-breadcrumb.tsx uses for a route it builds dynamically.
        router.push(`/campaigns/${campaignId}/leads` as Route);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Destination</CardTitle>
          <CardDescription>Where these leads should land</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="upload-channel">Channel *</FieldLabel>
                <Select value={campaignChannelId} onValueChange={setCampaignChannelId}>
                  <SelectTrigger id="upload-channel" className="w-full">
                    <SelectValue placeholder="Select channel..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {channels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="upload-source-type">Source *</FieldLabel>
                <Select value={sourceType} onValueChange={(value) => setSourceType(value as SourceType)}>
                  <SelectTrigger id="upload-source-type" className="w-full">
                    <SelectValue placeholder="Select source..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {SOURCE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {sourceType === "partner" && (
              <div className="mt-4">
                <Field>
                  <FieldLabel htmlFor="upload-partner">Partner *</FieldLabel>
                  <Select value={partnerOrganizationId} onValueChange={setPartnerOrganizationId}>
                    <SelectTrigger id="upload-partner" className="w-full">
                      <SelectValue placeholder="Select partner..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availablePartners.map((partner) => (
                          <SelectItem key={partner.id} value={partner.id}>
                            {partner.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {availablePartners.length === 0 && (
                    <p className="text-sm text-muted-foreground">No partner is allocated to this channel yet.</p>
                  )}
                </Field>
              </div>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>File</CardTitle>
          <CardDescription>A CSV file with a header row</CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="upload-file">CSV file *</FieldLabel>
            <input
              id="upload-file"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
            />
            {fileName !== null && <p className="text-sm text-muted-foreground">{fileName}</p>}
          </Field>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Column mapping</CardTitle>
            <CardDescription>Map each lead field to a column from the uploaded file</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {leadFieldKeys.map((field) => (
                <Field key={field.fieldKey}>
                  <FieldLabel htmlFor={`mapping-${field.fieldKey}`}>
                    {field.label}
                    {field.isRequired ? " *" : ""}
                  </FieldLabel>
                  <Select
                    value={headerByFieldKey[field.fieldKey] ?? ""}
                    onValueChange={(value) =>
                      setHeaderByFieldKey((prev) => ({ ...prev, [field.fieldKey]: value }))
                    }
                  >
                    <SelectTrigger id={`mapping-${field.fieldKey}`} className="w-full">
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {!field.isRequired && (
                          <SelectItem value={UNMAPPED}>— not mapped —</SelectItem>
                        )}
                        {headers.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </FieldGroup>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push(`/campaigns/${campaignId}`)}>
          Cancel
        </Button>
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Upload leads
        </Button>
      </div>
    </div>
  );
}
