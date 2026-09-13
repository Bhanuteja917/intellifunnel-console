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
import { setIcpCriteriaAction } from "./actions";

type IcpDimension = "industry" | "employeeRange" | "revenueRange" | "country" | "region" | "jobFunction" | "seniority" | "jobTitle" | "custom";
type IcpOperator = "in" | "notIn" | "between" | "contains";

const ICP_DIMENSIONS: IcpDimension[] = ["industry", "employeeRange", "revenueRange", "country", "region", "jobFunction", "seniority", "jobTitle", "custom"];

const STRING_OPERATORS: IcpOperator[] = ["in", "notIn", "contains"];
const RANGE_OPERATORS: IcpOperator[] = ["in", "notIn", "contains", "between"];

// `between` only makes sense against a numeric value — matchesIcp
// (src/lib/leads/matching.ts) parses it as Number(account.<field>), which is
// only ever meaningful for the two range dimensions. Every other dimension
// compares strings, so offering `between` there is a dead, confusing choice
// (this is the jobFunction/"between" bug from TESTING.md item 6).
const DIMENSION_OPERATORS: Readonly<Record<IcpDimension, IcpOperator[]>> = {
  industry: STRING_OPERATORS,
  employeeRange: RANGE_OPERATORS,
  revenueRange: RANGE_OPERATORS,
  country: STRING_OPERATORS,
  region: STRING_OPERATORS,
  jobFunction: STRING_OPERATORS,
  seniority: STRING_OPERATORS,
  jobTitle: STRING_OPERATORS,
  custom: STRING_OPERATORS,
};

const DIMENSION_PLACEHOLDERS: Readonly<Record<IcpDimension, string>> = {
  industry: "e.g. Software, Fintech",
  employeeRange: "e.g. 50-200, 200-1000",
  revenueRange: "e.g. 1000000-5000000",
  country: "e.g. US, IN, GB",
  region: "e.g. APAC, EMEA",
  jobFunction: "e.g. Engineering, Sales",
  seniority: "e.g. Director, VP, C-Level",
  jobTitle: "e.g. VP Engineering, Head of Growth",
  custom: "e.g. value1, value2",
};

const DIMENSION_LABELS: Readonly<Record<IcpDimension, string>> = {
  industry: "Industry",
  employeeRange: "Employee Range",
  revenueRange: "Revenue Range",
  country: "Country",
  region: "Region",
  jobFunction: "Job Function",
  seniority: "Seniority",
  jobTitle: "Job Title",
  custom: "Custom",
};

type Row = {
  dimension: IcpDimension;
  operator: IcpOperator;
  valuesText: string; // comma-separated, parsed to string[] on save
  isMandatory: boolean;
};

type Props = {
  channelId: string;
  initialCriteria: { dimension: IcpDimension; operator: IcpOperator; values: unknown[]; isMandatory: boolean }[];
  canEdit: boolean;
};

function toRow(criterion: Props["initialCriteria"][number]): Row {
  // A criterion saved before this dimension/operator restriction existed (or
  // saved by editing an unrelated field on this row, which bypasses the
  // dimension-change handler) can carry an operator no longer valid for its
  // dimension — e.g. jobFunction/"between" (TESTING.md item 6). Normalize on
  // load so it doesn't silently round-trip back to the server unchanged.
  const allowedOperators = DIMENSION_OPERATORS[criterion.dimension];
  const operator = allowedOperators.includes(criterion.operator) ? criterion.operator : allowedOperators[0]!;
  return {
    dimension: criterion.dimension,
    operator,
    valuesText: criterion.values.map((v) => String(v)).join(", "),
    isMandatory: criterion.isMandatory,
  };
}

function rowsToJson(rows: Row[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      dimension: r.dimension,
      operator: r.operator,
      values: r.valuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
      isMandatory: r.isMandatory,
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
    dimension: (item.dimension as IcpDimension) ?? "custom",
    operator: (item.operator as IcpOperator) ?? "in",
    valuesText: Array.isArray(item.values) ? (item.values as unknown[]).map((v) => String(v)).join(", ") : "",
    isMandatory: item.isMandatory === true,
  }));
}

function operatorDisplay(op: IcpOperator) {
  if (op === "notIn") return "not in";
  if (op === "between") return ">";
  return op;
}

function valuesDisplay(row: Row) {
  const vals = row.valuesText.split(",").map((v) => v.trim()).filter(Boolean);
  if (row.operator === "in") return `includes: ${vals.join(", ")}`;
  if (row.operator === "notIn") return `excludes: ${vals.join(", ")}`;
  if (row.operator === "between") return `greater than: ${vals.join(", ")}`;
  return `contains: ${vals.join(", ")}`;
}

const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 font-mono text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export function IcpCriteriaEditor({ channelId, initialCriteria, canEdit }: Props) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => initialCriteria.map(toRow));
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
    setRows((prev) => [...prev, { dimension: "industry", operator: "in", valuesText: "", isMandatory: true }]);
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
    const criteria = currentRows.map((row) => ({
      dimension: row.dimension,
      operator: row.operator,
      values: row.valuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
      isMandatory: row.isMandatory,
    }));
    startTransition(async () => {
      const result = await setIcpCriteriaAction(channelId, criteria);
      if (result.ok) {
        toast.success("ICP criteria saved");
        setIsEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle>ICP criteria</CardTitle>
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
              <p className="text-sm text-muted-foreground">No ICP criteria defined.</p>
            )}
            {rows.map((row, i) => (
              <div key={i} className="border-l-2 pl-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{DIMENSION_LABELS[row.dimension]}</span>
                  <span className="text-sm text-muted-foreground">{operatorDisplay(row.operator)}</span>
                  {row.isMandatory && <Badge variant="secondary">mandatory</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{valuesDisplay(row)}</p>
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
                  <Select
                    value={row.dimension}
                    onValueChange={(value) => {
                      const dimension = value as IcpDimension;
                      const allowedOperators = DIMENSION_OPERATORS[dimension];
                      const operator = allowedOperators.includes(row.operator) ? row.operator : allowedOperators[0]!;
                      updateRow(index, { dimension, operator });
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {ICP_DIMENSIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    value={row.operator}
                    onValueChange={(value) => updateRow(index, { operator: value as IcpOperator })}
                  >
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {DIMENSION_OPERATORS[row.dimension].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={row.valuesText}
                  onChange={(e) => updateRow(index, { valuesText: e.target.value })}
                  placeholder={DIMENSION_PLACEHOLDERS[row.dimension]}
                />
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={row.isMandatory}
                      onCheckedChange={(checked) => updateRow(index, { isMandatory: checked === true })}
                    />
                    mandatory
                  </label>
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
              + Add rule
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
