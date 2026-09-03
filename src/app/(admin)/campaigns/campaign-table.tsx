"use client";

import Link from "next/link";
import { useCampaignFilters, type CampaignStatusFilter } from "@/lib/stores/campaign-filters";
import { Badge } from "@/components/ui/badge";
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

export type CampaignRow = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
  startDate: string;
  endDate: string;
};

const STATUSES: CampaignStatusFilter[] = [
  "all", "draft", "pendingInternalApproval", "pendingClientApproval",
  "scheduled", "live", "paused", "completed", "cancelled",
];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "live") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "completed") return "secondary";
  return "outline";
}

export function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  const { status, query, setStatus, setQuery } = useCampaignFilters();

  const visible = rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (query === "") return true;
    const needle = query.toLowerCase();
    return (
      row.code.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle) ||
      row.clientName.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          placeholder="Search code, name or client"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <Select value={status} onValueChange={(value) => setStatus(value as CampaignStatusFilter)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {STATUSES.map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Flight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link href={`/campaigns/${row.id}`} className="underline">{row.code}</Link>
              </TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.clientName}</TableCell>
              <TableCell><Badge variant={statusVariant(row.status)}>{row.status}</Badge></TableCell>
              <TableCell>{row.startDate} – {row.endDate}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
