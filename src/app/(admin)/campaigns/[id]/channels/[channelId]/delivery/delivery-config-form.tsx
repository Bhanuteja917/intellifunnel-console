"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { saveDeliveryConfigAction, setDeliveryConfigStatusAction } from "./actions";

type Method = "webhook" | "csv";
type MappingRow = { source: string; target: string };

type Props = {
  campaignId: string;
  campaignChannelId: string;
  availableSourceFields: string[];
  initial: {
    method: Method;
    status: "active" | "paused";
    webhookUrl: string | null;
    csvScheduleCron: string | null;
    fieldMapping: MappingRow[];
  } | null;
};

export function DeliveryConfigForm({ campaignId, campaignChannelId, availableSourceFields, initial }: Props) {
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<Method>(initial?.method ?? "webhook");
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [csvScheduleCron, setCsvScheduleCron] = useState(initial?.csvScheduleCron ?? "");
  const [rows, setRows] = useState<MappingRow[]>(initial?.fieldMapping ?? [{ source: "", target: "" }]);

  function updateRow(index: number, patch: Partial<MappingRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setRows((prev) => [...prev, { source: "", target: "" }]);
  }
  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function save() {
    const fieldMapping = rows.filter((r) => r.source.trim() !== "" && r.target.trim() !== "");
    if (fieldMapping.length === 0) {
      toast.error("At least one field mapping row is required");
      return;
    }
    startTransition(async () => {
      const result = await saveDeliveryConfigAction(campaignId, {
        campaignChannelId,
        method,
        webhookUrl: method === "webhook" ? webhookUrl.trim() : undefined,
        webhookSecret: method === "webhook" && webhookSecret.trim() !== "" ? webhookSecret.trim() : undefined,
        csvScheduleCron: method === "csv" ? csvScheduleCron.trim() : undefined,
        fieldMapping,
      });
      if (result.ok) toast.success("Delivery config saved");
      else toast.error(result.error);
    });
  }

  function toggleStatus() {
    if (initial === null) return;
    const next = initial.status === "active" ? "paused" : "active";
    startTransition(async () => {
      const result = await setDeliveryConfigStatusAction(campaignId, campaignChannelId, next);
      if (result.ok) toast.success(`Delivery config ${next}`);
      else toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Delivery configuration</CardTitle>
          <CardDescription>How accepted leads on this channel are pushed to the client</CardDescription>
        </div>
        {initial !== null && (
          <Button variant="outline" size="sm" disabled={pending} onClick={toggleStatus}>
            {initial.status === "active" ? "Pause" : "Resume"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="delivery-method">Method *</FieldLabel>
            <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
              <SelectTrigger id="delivery-method" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="csv">Scheduled CSV</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {method === "webhook" ? (
            <>
              <Field>
                <FieldLabel htmlFor="delivery-webhook-url">Webhook URL *</FieldLabel>
                <Input id="delivery-webhook-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://client.example.com/leads" />
              </Field>
              <Field>
                <FieldLabel htmlFor="delivery-webhook-secret">Webhook secret {initial === null ? "*" : "(leave blank to keep current)"}</FieldLabel>
                <Input id="delivery-webhook-secret" type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
              </Field>
            </>
          ) : (
            <Field>
              <FieldLabel htmlFor="delivery-cron">CSV schedule (cron, e.g. &quot;0 6 * * *&quot;) *</FieldLabel>
              <Input id="delivery-cron" value={csvScheduleCron} onChange={(e) => setCsvScheduleCron(e.target.value)} placeholder="0 6 * * *" />
            </Field>
          )}
        </FieldGroup>

        <div>
          <p className="mb-2 text-sm font-medium">Field mapping</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Target field name</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Select value={row.source} onValueChange={(v) => updateRow(index, { source: v })}>
                      <SelectTrigger className="w-56"><SelectValue placeholder="Select a source field..." /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {availableSourceFields.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input value={row.target} onChange={(e) => updateRow(index, { target: e.target.value })} placeholder="Email" className="w-56" />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button variant="outline" size="sm" className="mt-2" onClick={addRow}>Add field</Button>
        </div>

        <div className="flex justify-end">
          <Button disabled={pending} onClick={save}>Save delivery config</Button>
        </div>
      </CardContent>
    </Card>
  );
}
