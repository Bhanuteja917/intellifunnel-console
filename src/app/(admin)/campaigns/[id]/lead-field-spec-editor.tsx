"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setLeadFieldSpecAction } from "./actions";

type LeadFieldDataType = "string" | "number" | "boolean" | "date" | "email" | "phone" | "url";
const LEAD_FIELD_DATA_TYPES: LeadFieldDataType[] = ["string", "number", "boolean", "date", "email", "phone", "url"];

type InitialField = {
  fieldKey: string;
  label: string;
  dataType: LeadFieldDataType;
  isRequired: boolean;
  rejectIfMissing: boolean;
  allowedValues?: unknown[];
  validationPattern?: string;
};

type Row = {
  fieldKey: string;
  label: string;
  dataType: LeadFieldDataType;
  isRequired: boolean;
  rejectIfMissing: boolean;
  allowedValuesText: string;
  validationPattern: string;
};

type Props = {
  campaignId: string;
  initialFields: InitialField[];
  canEdit: boolean;
};

function toRow(field: InitialField): Row {
  return {
    fieldKey: field.fieldKey,
    label: field.label,
    dataType: field.dataType,
    isRequired: field.isRequired,
    rejectIfMissing: field.rejectIfMissing,
    allowedValuesText: (field.allowedValues ?? []).map((v) => String(v)).join(", "),
    validationPattern: field.validationPattern ?? "",
  };
}

export function LeadFieldSpecEditor({ campaignId, initialFields, canEdit }: Props) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => initialFields.map(toRow));

  if (!canEdit) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field key</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Reject if missing</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {initialFields.map((field) => (
            <TableRow key={field.fieldKey}>
              <TableCell>{field.fieldKey}</TableCell>
              <TableCell>{field.label}</TableCell>
              <TableCell>{field.dataType}</TableCell>
              <TableCell>{field.isRequired ? "yes" : "no"}</TableCell>
              <TableCell>{field.rejectIfMissing ? "yes" : "no"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { fieldKey: "", label: "", dataType: "string", isRequired: false, rejectIfMissing: false, allowedValuesText: "", validationPattern: "" },
    ]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function save() {
    const keys = rows.map((r) => r.fieldKey.trim());
    if (new Set(keys).size !== keys.length) {
      toast.error("Duplicate fieldKey — each field key must be unique");
      return;
    }
    if (keys.some((k) => k === "")) {
      toast.error("Every field needs a field key");
      return;
    }
    const fields = rows.map((row) => ({
      fieldKey: row.fieldKey.trim(),
      label: row.label,
      dataType: row.dataType,
      isRequired: row.isRequired,
      rejectIfMissing: row.rejectIfMissing,
      allowedValues: row.allowedValuesText.trim() === ""
        ? undefined
        : row.allowedValuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
      validationPattern: row.validationPattern.trim() === "" ? undefined : row.validationPattern.trim(),
    }));
    startTransition(async () => {
      const result = await setLeadFieldSpecAction(campaignId, fields);
      if (result.ok) {
        toast.success("Lead field spec saved");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field key</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Reject if missing</TableHead>
            <TableHead>Allowed values</TableHead>
            <TableHead>Pattern</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              <TableCell>
                <Input value={row.fieldKey} onChange={(e) => updateRow(index, { fieldKey: e.target.value })} placeholder="job_title" className="w-32" />
              </TableCell>
              <TableCell>
                <Input value={row.label} onChange={(e) => updateRow(index, { label: e.target.value })} placeholder="Job title" className="w-32" />
              </TableCell>
              <TableCell>
                <Select value={row.dataType} onValueChange={(value) => updateRow(index, { dataType: value as LeadFieldDataType })}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {LEAD_FIELD_DATA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Checkbox checked={row.isRequired} onCheckedChange={(c) => updateRow(index, { isRequired: c === true })} />
              </TableCell>
              <TableCell>
                <Checkbox checked={row.rejectIfMissing} onCheckedChange={(c) => updateRow(index, { rejectIfMissing: c === true })} />
              </TableCell>
              <TableCell>
                <Input value={row.allowedValuesText} onChange={(e) => updateRow(index, { allowedValuesText: e.target.value })} placeholder="optional" className="w-32" />
              </TableCell>
              <TableCell>
                <Input value={row.validationPattern} onChange={(e) => updateRow(index, { validationPattern: e.target.value })} placeholder="optional regex" className="w-32" />
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>Remove</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={addRow}>Add field</Button>
        <Button size="sm" disabled={pending} onClick={save}>Save lead field spec</Button>
      </div>
    </div>
  );
}
