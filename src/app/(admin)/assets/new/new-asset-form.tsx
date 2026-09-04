"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { AssetType } from "@prisma/client";
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
import { createAssetAction } from "../actions";

type Props = {
  clientOrganizations: { id: string; name: string }[];
};

const ASSET_TYPES = ["whitepaper", "ebook", "researchPaper", "creative", "webinar", "other"] as const satisfies readonly AssetType[];

export function NewAssetForm({ clientOrganizations }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetType>(ASSET_TYPES[0]);
  const [language, setLanguage] = useState("en");
  const [ownerOrganizationId, setOwnerOrganizationId] = useState(clientOrganizations[0]?.id ?? "");

  const canSubmit = name.trim() !== "" && language.trim() !== "" && ownerOrganizationId !== "";

  function submit() {
    startTransition(async () => {
      const result = await createAssetAction({
        ownerOrganizationId,
        name,
        type,
        language,
      });
      if (result.ok) {
        toast.success("Asset created");
        router.push(`/assets/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Asset Details</CardTitle>
          <CardDescription>Basic information about the asset</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="asset-name">Name *</FieldLabel>
              <Input
                id="asset-name"
                placeholder="e.g., 2026 State of the Industry Whitepaper"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="asset-owner">Owner *</FieldLabel>
                <Select value={ownerOrganizationId} onValueChange={setOwnerOrganizationId}>
                  <SelectTrigger id="asset-owner" className="w-full">
                    <SelectValue placeholder="Select owner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {clientOrganizations.map((organization) => (
                        <SelectItem key={organization.id} value={organization.id}>
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="asset-type">Type *</FieldLabel>
                <Select value={type} onValueChange={(value) => setType(value as AssetType)}>
                  <SelectTrigger id="asset-type" className="w-full">
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {ASSET_TYPES.map((value) => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="asset-language">Language *</FieldLabel>
              <Input
                id="asset-language"
                placeholder="e.g., en"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/assets")}>
          Cancel
        </Button>
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Create Asset
        </Button>
      </div>
    </div>
  );
}
