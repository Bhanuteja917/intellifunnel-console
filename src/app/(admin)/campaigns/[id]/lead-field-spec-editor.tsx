"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  channelId: string;
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

function rowsToJson(rows: Row[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      fieldKey: r.fieldKey,
      label: r.label,
      dataType: r.dataType,
      isRequired: r.isRequired,
      rejectIfMissing: r.rejectIfMissing,
      allowedValues:
        r.allowedValuesText.trim() === ""
          ? undefined
          : r.allowedValuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
      validationPattern: r.validationPattern.trim() === "" ? undefined : r.validationPattern.trim(),
    })),
    null,
    2,
  );
}

function jsonToRows(text: string): Row[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return (parsed as Record<string, unknown>[]).map((item) => ({
    fieldKey: typeof item.fieldKey === "string" ? item.fieldKey : "",
    label: typeof item.label === "string" ? item.label : "",
    dataType: (item.dataType as LeadFieldDataType) ?? "string",
    isRequired: item.isRequired === true,
    rejectIfMissing: item.rejectIfMissing === true,
    allowedValuesText: Array.isArray(item.allowedValues)
      ? (item.allowedValues as unknown[]).map((v) => String(v)).join(", ")
      : "",
    validationPattern: typeof item.validationPattern === "string" ? item.validationPattern : "",
  }));
}

function statusLine(row: Row | InitialField) {
  const parts: string[] = [];
  if (row.isRequired) parts.push("required");
  else parts.push("optional");
  if (row.rejectIfMissing) parts.push("reject if missing");
  return parts.join(" · ");
}

const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 font-mono text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export function LeadFieldSpecEditor({ channelId, initialFields, canEdit }: Props) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => initialFields.map(toRow));
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState<"ui" | "json">("ui");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const check = () => setHasMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [rows]);


  function startEditing() {
    setEditMode("ui");
    setIsEditing(true);
  }

  function switchToJson() {
    setJsonText(rowsToJson(rows));
    setJsonError("");
    setEditMode("json");
  }

  function applyJson() {
    const parsed = jsonToRows(jsonText);
    if (parsed === null) {
      setJsonError("Invalid JSON");
      return;
    }
    setRows(parsed);
    setJsonError("");
    setEditMode("ui");
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

  function done() {
    let currentRows = rows;
    if (editMode === "json") {
      const parsed = jsonToRows(jsonText);
      if (parsed === null) {
        setJsonError("Invalid JSON — fix before saving");
        return;
      }
      currentRows = parsed;
      setRows(parsed);
    }
    const keys = currentRows.map((r) => r.fieldKey.trim());
    if (new Set(keys).size !== keys.length) {
      toast.error("Duplicate fieldKey — each field key must be unique");
      return;
    }
    if (keys.some((k) => k === "")) {
      toast.error("Every field needs a field key");
      return;
    }
    const fields = currentRows.map((row) => ({
      fieldKey: row.fieldKey.trim(),
      label: row.label,
      dataType: row.dataType,
      isRequired: row.isRequired,
      rejectIfMissing: row.rejectIfMissing,
      allowedValues:
        row.allowedValuesText.trim() === ""
          ? undefined
          : row.allowedValuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
      validationPattern: row.validationPattern.trim() === "" ? undefined : row.validationPattern.trim(),
    }));
    startTransition(async () => {
      const result = await setLeadFieldSpecAction(channelId, fields);
      if (result.ok) {
        toast.success("Lead field spec saved");
        setIsEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle>Lead field spec</CardTitle>
        {!isEditing ? (
          canEdit && (
            <Button variant="outline" size="sm" onClick={startEditing}>Edit</Button>
          )
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border text-sm">
              <button
                type="button"
                onClick={() => setEditMode("ui")}
                className={`px-3 py-1 transition-colors ${editMode === "ui" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
              >
                UI
              </button>
              <button
                type="button"
                onClick={switchToJson}
                className={`px-3 py-1 transition-colors ${editMode === "json" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
              >
                JSON
              </button>
            </div>
            <Button size="sm" disabled={pending} onClick={done}>Done</Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {!isEditing ? (
          <div className="relative">
            <div
              ref={listRef}
              className="flex max-h-72 flex-col gap-4 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No lead field spec defined.</p>
            )}
            {rows.map((row, i) => (
              <div key={i} className="border-l-2 pl-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{row.label || row.fieldKey}</span>
                  <span className="text-sm text-muted-foreground">{row.fieldKey}</span>
                  <Badge variant="secondary">{row.dataType}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{statusLine(row)}</p>
              </div>
            ))}
          </div>
            {hasMoreBelow && (
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 rounded-b-md bg-gradient-to-t from-card to-transparent" />
            )}
          </div>
        ) : editMode === "json" ? (
          <div className="flex flex-col gap-3">
            <textarea
              rows={12}
              className={TEXTAREA_CLASS}
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); setJsonError(""); }}
            />
            {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
            <Button className="w-fit" onClick={applyJson}>Apply JSON</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex gap-2">
                  <Input
                    value={row.fieldKey}
                    onChange={(e) => updateRow(index, { fieldKey: e.target.value })}
                    placeholder="fieldKey"
                    className="flex-1"
                  />
                  <Input
                    value={row.label}
                    onChange={(e) => updateRow(index, { label: e.target.value })}
                    placeholder="Label"
                    className="flex-1"
                  />
                </div>
                <Select
                  value={row.dataType}
                  onValueChange={(value) => updateRow(index, { dataType: value as LeadFieldDataType })}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {LEAD_FIELD_DATA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={row.isRequired}
                        onCheckedChange={(c) => updateRow(index, { isRequired: c === true })}
                      />
                      required
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={row.rejectIfMissing}
                        onCheckedChange={(c) => updateRow(index, { rejectIfMissing: c === true })}
                      />
                      reject if missing
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/30"
            >
              + Add field
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
