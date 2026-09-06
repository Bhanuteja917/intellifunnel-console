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

export function IcpCriteriaEditor({ campaignId, initialCriteria, canEdit }: Props) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => initialCriteria.map(toRow));

  if (!canEdit) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dimension</TableHead>
            <TableHead>Operator</TableHead>
            <TableHead>Values</TableHead>
            <TableHead>Mandatory</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {initialCriteria.map((criterion, index) => (
            <TableRow key={index}>
              <TableCell>{criterion.dimension}</TableCell>
              <TableCell>{criterion.operator}</TableCell>
              <TableCell>{criterion.values.map((v) => String(v)).join(", ")}</TableCell>
              <TableCell>{criterion.isMandatory ? "yes" : "advisory"}</TableCell>
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
    </div>
  );
}
