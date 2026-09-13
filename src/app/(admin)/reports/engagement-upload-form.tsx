"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importEngagementEventsAction } from "./actions";

export function EngagementUploadForm() {
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);

  function upload(file: File) {
    setFileName(file.name);
    startTransition(async () => {
      const content = await file.text();
      const result = await importEngagementEventsAction(content);
      if (result.ok) {
        toast.success(`Imported ${result.data.rowsAccepted} of ${result.data.rowsTotal} rows (${result.data.rowsFailed} failed)`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-end gap-2">
      <div>
        <Label htmlFor="engagement-csv">Upload engagement CSV</Label>
        <Input
          id="engagement-csv"
          type="file"
          accept=".csv"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) upload(file);
          }}
        />
      </div>
      {fileName !== null && <span className="text-sm text-muted-foreground">{fileName}</span>}
    </div>
  );
}
