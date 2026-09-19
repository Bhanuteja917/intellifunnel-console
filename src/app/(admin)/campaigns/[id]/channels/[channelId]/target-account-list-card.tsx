"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addTargetAccountEntryAction,
  detachTargetAccountListAction,
  removeTargetAccountEntryAction,
  uploadTargetAccountListAction,
} from "./actions";

type Entry = { id: string; accountName: string | null; accountRawDomain: string | null };

type Props = {
  campaignId: string;
  channelId: string;
  listName: string | null;
  rowCount: number;
  entries: Entry[];
  editable: boolean;
  downloadHref: string;
};

const UNMAPPED = "__unmapped__";
const CANONICAL_KEYS = [
  { key: "accountName", label: "Name" },
  { key: "accountRawDomain", label: "Domain" },
  { key: "maxLeadsPerAccountOverride", label: "Max leads override" },
];

export function TargetAccountListCard({ campaignId, channelId, listName, rowCount, entries, editable, downloadHref }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [name, setName] = useState("Target accounts");
  const [content, setContent] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerByKey, setHeaderByKey] = useState<Record<string, string>>({});
  const [manualName, setManualName] = useState("");
  const [manualDomain, setManualDomain] = useState("");
  const [manualCap, setManualCap] = useState("");

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    const text = await file.text();
    setContent(text);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, preview: 1 });
    setHeaders(parsed.meta.fields ?? []);
    setHeaderByKey({});
  }

  const mapping = Object.fromEntries(
    Object.entries(headerByKey).filter(([, header]) => header !== UNMAPPED && header !== "").map(([key, header]) => [header, key]),
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  function submitUpload() {
    if (content === null) return;
    startTransition(async () => {
      const result = await uploadTargetAccountListAction(campaignId, channelId, { name, content, mapping });
      if (result.ok) {
        toast.success(`${result.data.rowsAccepted} of ${result.data.rowsTotal} rows staged`);
        setUploadOpen(false);
        setContent(null);
        setHeaders([]);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitManual() {
    run(
      () =>
        addTargetAccountEntryAction(campaignId, channelId, {
          accountName: manualName.trim() === "" ? undefined : manualName.trim(),
          accountRawDomain: manualDomain.trim() === "" ? undefined : manualDomain.trim(),
          maxLeadsPerAccountOverride: manualCap.trim() === "" ? undefined : Number.parseInt(manualCap, 10),
        }),
      "Account added",
    );
    setManualName("");
    setManualDomain("");
    setManualCap("");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Target account list</CardTitle>
          <p className="text-sm text-muted-foreground">
            {listName === null ? "No list attached yet" : `${listName} — ${rowCount} accounts`}
          </p>
        </div>
        {rowCount > 0 && (
          <Button asChild size="sm" variant="outline">
            <a href={downloadHref}>Download CSV</a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editable && (
          <div className="flex flex-wrap items-end gap-2 border-b pb-4">
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>Upload CSV</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload target accounts</DialogTitle>
                  <DialogDescription>Replaces any list already attached to this channel.</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="tal-name">List name</FieldLabel>
                    <Input id="tal-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="tal-file">CSV file</FieldLabel>
                    <input id="tal-file" type="file" accept=".csv" onChange={handleFile} className="text-sm" />
                  </Field>
                  {headers.length > 0 &&
                    CANONICAL_KEYS.map((field) => (
                      <Field key={field.key}>
                        <FieldLabel htmlFor={`tal-map-${field.key}`}>{field.label}</FieldLabel>
                        <Select
                          value={headerByKey[field.key] ?? ""}
                          onValueChange={(value) => setHeaderByKey((prev) => ({ ...prev, [field.key]: value }))}
                        >
                          <SelectTrigger id={`tal-map-${field.key}`} className="w-full">
                            <SelectValue placeholder="Select column..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value={UNMAPPED}>— not mapped —</SelectItem>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>{header}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    ))}
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={pending}>Cancel</Button>
                  <Button onClick={submitUpload} disabled={pending || content === null}>Upload</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Input placeholder="Name" value={manualName} onChange={(e) => setManualName(e.target.value)} className="w-36" />
            <Input placeholder="Domain" value={manualDomain} onChange={(e) => setManualDomain(e.target.value)} className="w-36" />
            <Input placeholder="Cap" value={manualCap} onChange={(e) => setManualCap(e.target.value)} className="w-20" />
            <Button size="sm" onClick={submitManual} disabled={pending || (manualName.trim() === "" && manualDomain.trim() === "")}>
              Add
            </Button>

            {listName !== null && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive"
                disabled={pending}
                onClick={() => run(() => detachTargetAccountListAction(campaignId, channelId), "List removed")}
              >
                Remove list
              </Button>
            )}
          </div>
        )}

        {entries.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Domain</TableHead>
                {editable && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.accountName ?? "—"}</TableCell>
                  <TableCell>{entry.accountRawDomain ?? "—"}</TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => removeTargetAccountEntryAction(campaignId, channelId, entry.id), "Entry removed")}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rowCount > entries.length && (
          <p className="text-xs text-muted-foreground">
            Showing the first {entries.length} of {rowCount} — download the CSV for the full list.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
