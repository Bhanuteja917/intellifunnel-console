"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { setRetentionOverrideAction } from "./actions";

type Props = { organizationId: string; organizationName: string; currentMonths: number | null; platformDefaultMonths: number };

export function RetentionOverrideRow({ organizationId, organizationName, currentMonths, platformDefaultMonths }: Props) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentMonths === null ? "" : String(currentMonths));

  function save() {
    startTransition(async () => {
      const months = value.trim() === "" ? null : Number(value);
      if (months !== null && (!Number.isInteger(months) || months <= 0)) {
        toast.error("Enter a positive whole number, or leave blank to inherit the platform default");
        return;
      }
      const result = await setRetentionOverrideAction({ organizationId, months });
      if (result.ok) toast.success("Retention override saved");
      else toast.error(result.error);
    });
  }

  return (
    <TableRow>
      <TableCell>{organizationName}</TableCell>
      <TableCell>{platformDefaultMonths} (platform default)</TableCell>
      <TableCell>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Inherit default"
          className="w-32"
        />
      </TableCell>
      <TableCell>
        <Button size="sm" disabled={pending} onClick={save}>Save</Button>
      </TableCell>
    </TableRow>
  );
}
