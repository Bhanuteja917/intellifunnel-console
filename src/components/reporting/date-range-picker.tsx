"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DateRangePicker({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(searchParams.get("from") ?? defaultFrom);
  const [to, setTo] = useState(searchParams.get("to") ?? defaultTo);

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", from);
    params.set("to", to);
    router.push(`${pathname}?${params.toString()}` as Route);
  }

  return (
    <div className="flex items-end gap-2">
      <div>
        <Label htmlFor="report-from">From</Label>
        <Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
      </div>
      <div>
        <Label htmlFor="report-to">To</Label>
        <Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <Button onClick={apply}>Apply</Button>
    </div>
  );
}
