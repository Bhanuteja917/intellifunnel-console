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

type Row = {
  dimension: IcpDimension;
  operator: IcpOperator;
  valuesText: string; // comma-separated, parsed to string[] on save
  isMandatory: boolean;
};

type Props = {
  campaignId: string;
  initialCriteria: { dimension: IcpDimension; operator: IcpOperator; values: unknown[]; isMandatory: boolean }[];
  canEdit: boolean;
};

function toRow(criterion: Props["initialCriteria"][number]): Row {
  return {
    dimension: criterion.dimension,
    operator: criterion.operator,
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

const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

export function IcpCriteriaEditor({ campaignId, initialCriteria, canEdit }: Props) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => initialCriteria.map(toRow));
  const [mode, setMode] = useState<"table" | "json">("table");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");

  if (!canEdit) {
    return (
      <textarea
        disabled
        rows={12}
        className={TEXTAREA_CLASS}
        defaultValue={JSON.stringify(initialCriteria, null, 2)}
      />
    );
  }

  function enterJsonMode() {
    setJsonText(rowsToJson(rows));
    setJsonError("");
    setMode("json");
  }

  function exitJsonMode() {
    const parsed = jsonToRows(jsonText);
    if (parsed === null) {
      setJsonError("Invalid JSON — fix before switching back to table view");
      return;
    }
    setRows(parsed);
    setJsonError("");
    setMode("table");
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

  function save() {
    const criteria = rows.map((row) => ({
      dimension: row.dimension,
      operator: row.operator,
      values: row.valuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
      isMandatory: row.isMandatory,
    }));
    startTransition(async () => {
      const result = await setIcpCriteriaAction(campaignId, criteria);
      if (result.ok) {
        toast.success("ICP criteria saved");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 mb-2">
        <Button
          variant={mode === "table" ? "outline" : "ghost"}
          size="sm"
          onClick={() => { if (mode === "json") exitJsonMode(); }}
        >
          Table
        </Button>
        <Button
          variant={mode === "json" ? "outline" : "ghost"}
          size="sm"
          onClick={() => { if (mode === "table") enterJsonMode(); }}
        >
          JSON
        </Button>
      </div>

      {mode === "json" ? (
        <div>
          <textarea
            rows={12}
            className={TEXTAREA_CLASS}
            value={jsonText}
            onChange={(e) => { setJsonText(e.target.value); setJsonError(""); }}
          />
          {jsonError && <p className="text-sm text-destructive mt-1">{jsonError}</p>}
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dimension</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Values (comma-separated)</TableHead>
                <TableHead>Mandatory</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Select
                      value={row.dimension}
                      onValueChange={(value) => {
                        const dimension = value as IcpDimension;
                        const allowedOperators = DIMENSION_OPERATORS[dimension];
                        const operator = allowedOperators.includes(row.operator) ? row.operator : allowedOperators[0]!;
                        updateRow(index, { dimension, operator });
                      }}
                    >
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {ICP_DIMENSIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={row.operator} onValueChange={(value) => updateRow(index, { operator: value as IcpOperator })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {DIMENSION_OPERATORS[row.dimension].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={row.valuesText}
                      onChange={(event) => updateRow(index, { valuesText: event.target.value })}
                      placeholder={DIMENSION_PLACEHOLDERS[row.dimension]}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={row.isMandatory}
                      onCheckedChange={(checked) => updateRow(index, { isMandatory: checked === true })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={addRow}>Add criterion</Button>
            <Button size="sm" disabled={pending} onClick={save}>Save ICP criteria</Button>
          </div>
        </>
      )}
    </div>
  );
}
