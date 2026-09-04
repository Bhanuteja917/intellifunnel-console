"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { AssetStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setAssetStatusAction, uploadAssetVersionAction } from "../actions";

const ASSET_STATUSES: AssetStatus[] = ["draft", "active", "archived"];

export function AssetStatusControl({ assetId, status }: { assetId: string; status: AssetStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(async () => {
      const result = await setAssetStatusAction(assetId, next as AssetStatus);
      if (result.ok) {
        toast.success(`Status set to ${next}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Select value={status} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {ASSET_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>{value}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function UploadVersionForm({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function submit() {
    if (file === null) return;
    const selectedFile = file;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("assetId", assetId);
      formData.set("file", selectedFile);
      const result = await uploadAssetVersionAction(formData);
      if (result.ok) {
        toast.success(`Uploaded version ${result.data.version}`);
        setFile(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="version-file">File *</FieldLabel>
        <input
          id="version-file"
          type="file"
          onChange={handleFileChange}
          className="text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
        />
        {file !== null && <p className="text-sm text-muted-foreground">{file.name}</p>}
      </Field>
      <div className="flex justify-end">
        <Button disabled={pending || file === null} onClick={submit}>
          Upload
        </Button>
      </div>
    </FieldGroup>
  );
}
