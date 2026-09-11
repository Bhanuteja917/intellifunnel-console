"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { createAssetPlacementAction } from "../actions";

// Radix Select items can't carry an empty-string value, so "no consent text
// version selected" uses this sentinel instead of "".
const NO_CONSENT_TEXT = "__none__";

type Version = { id: string; version: number; fileName: string };
type ConsentTextVersion = { id: string; name: string; version: number };

type Props = {
  campaignId: string;
  campaignChannelId: string;
  assetId: string;
  versions: Version[];
  consentTextVersions: ConsentTextVersion[];
};

export function NewPlacementForm({ campaignId, campaignChannelId, assetId, versions, consentTextVersions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assetVersionId, setAssetVersionId] = useState(versions[0]?.id ?? "");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [consentTextVersionId, setConsentTextVersionId] = useState(NO_CONSENT_TEXT);

  const canSubmit = assetVersionId !== "" && landingPageUrl.trim() !== "" && formSlug.trim() !== "";

  function submit() {
    startTransition(async () => {
      const result = await createAssetPlacementAction({
        campaignId,
        campaignChannelId,
        assetId,
        assetVersionId,
        landingPageUrl,
        formSlug,
        consentTextVersionId: consentTextVersionId === NO_CONSENT_TEXT ? undefined : consentTextVersionId,
      });
      if (result.ok) {
        toast.success("Placement created");
        router.push(`/campaigns/${campaignId}/channels/${campaignChannelId}?tab=placements` as Route);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Placement details</CardTitle>
          <CardDescription>Pin an asset version to this channel with a landing page and form</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="placement-version">Version *</FieldLabel>
              <Select value={assetVersionId} onValueChange={setAssetVersionId} disabled={versions.length === 0}>
                <SelectTrigger id="placement-version" className="w-full">
                  <SelectValue placeholder="Select a version..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {versions.map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        v{version.version} — {version.fileName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {versions.length === 0 && (
                <p className="text-sm text-muted-foreground">This asset has no uploaded versions yet.</p>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="placement-url">Landing page URL *</FieldLabel>
              <Input
                id="placement-url"
                type="url"
                placeholder="https://example.com/landing"
                value={landingPageUrl}
                onChange={(event) => setLandingPageUrl(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="placement-slug">Form slug *</FieldLabel>
              <Input
                id="placement-slug"
                placeholder="e.g., q1-whitepaper-form"
                value={formSlug}
                onChange={(event) => setFormSlug(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">Must be unique across every placement in the system.</p>
            </Field>
            <Field>
              <FieldLabel htmlFor="placement-consent">Consent text version</FieldLabel>
              <Select value={consentTextVersionId} onValueChange={setConsentTextVersionId}>
                <SelectTrigger id="placement-consent" className="w-full">
                  <SelectValue placeholder="Select consent text..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_CONSENT_TEXT}>— none —</SelectItem>
                    {consentTextVersions.map((consentTextVersion) => (
                      <SelectItem key={consentTextVersion.id} value={consentTextVersion.id}>
                        {consentTextVersion.name} v{consentTextVersion.version}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => router.push(`/campaigns/${campaignId}/channels/${campaignChannelId}?tab=placements` as Route)}
        >
          Cancel
        </Button>
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Create placement
        </Button>
      </div>
    </div>
  );
}
