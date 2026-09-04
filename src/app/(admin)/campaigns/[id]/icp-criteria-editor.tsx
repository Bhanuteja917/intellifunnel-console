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
const ICP_OPERATORS: IcpOperator[] = ["in", "notIn", "between", "contains"];

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
                <Select value={row.dimension} onValueChange={(value) => updateRow(index, { dimension: value as IcpDimension })}>
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
                      {ICP_OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  value={row.valuesText}
                  onChange={(event) => updateRow(index, { valuesText: event.target.value })}
                  placeholder="e.g. Software, Fintech"
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
