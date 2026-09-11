"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type LeadRow = {
  id: string;
  name: string;
  email: string;
  company: string;
  industry: string | null;
  partner: string;
  channelLabel: string;
  verificationStatus: string;
  lifecycleStatus: string;
  rejectReason: string | null;
  createdAt: string;
  consentText: string;
  fields: { key: string; value: string }[];
  timeline: { title: string; detail: string; when: string }[];
};

type Filter = "all" | "accepted" | "pending" | "rejected";

const VERIFICATION_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  passed: "default",
  failed: "destructive",
  needsReview: "outline",
  pending: "outline",
  autoValidating: "outline",
};

function statCard(label: string, value: number, hint: string) {
  return (
    <Card key={label}>
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function formatDateTime(iso: string) {
  return iso.slice(0, 16).replace("T", " ");
}

export function LeadsTable({
  campaignId, activeFilter, stats, leads,
}: {
  campaignId: string;
  activeFilter: Filter;
  stats: { total: number; accepted: number; pending: number; rejected: number; delivered: number };
  leads: LeadRow[];
}) {
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const openLead = leads.find((l) => l.id === openLeadId) ?? null;

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: stats.total },
    { id: "accepted", label: "Accepted", count: stats.accepted },
    { id: "pending", label: "Pending", count: stats.pending },
    { id: "rejected", label: "Rejected", count: stats.rejected },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {statCard("Collected", stats.total, "across all channels")}
        {statCard("Accepted", stats.accepted, stats.total > 0 ? `${Math.round((stats.accepted / stats.total) * 100)}% acceptance` : "—")}
        {statCard("Pending review", stats.pending, "awaiting verification")}
        {statCard("Rejected", stats.rejected, "ICP or duplicate")}
        {statCard("Delivered", stats.delivered, "pushed to client")}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>Leads <span className="font-normal text-muted-foreground">· {leads.length}</span></CardTitle>
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <Link
                key={chip.id}
                href={`/campaigns/${campaignId}/leads?filter=${chip.id}` as Route}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium",
                  activeFilter === chip.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-input bg-transparent text-foreground hover:bg-muted",
                )}
              >
                {chip.label} {chip.count}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No leads yet.</TableCell>
                </TableRow>
              )}
              {leads.map((lead) => (
                <TableRow key={lead.id} className="cursor-pointer" onClick={() => setOpenLeadId(lead.id)}>
                  <TableCell>
                    <div className="font-medium">{lead.name}</div>
                    <div className="text-xs text-muted-foreground">{lead.email}</div>
                  </TableCell>
                  <TableCell>
                    {lead.company}
                    {lead.industry && <div className="text-xs text-muted-foreground">{lead.industry}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lead.partner}</TableCell>
                  <TableCell>
                    <Badge variant={VERIFICATION_BADGE[lead.verificationStatus] ?? "outline"}>{lead.verificationStatus}</Badge>
                    {lead.rejectReason && <div className="mt-1 text-xs text-muted-foreground">{lead.rejectReason}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(lead.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={openLead !== null} onOpenChange={(open) => !open && setOpenLeadId(null)}>
        <SheetContent className="flex flex-col gap-6 overflow-y-auto sm:max-w-md">
          {openLead && (
            <>
              <SheetHeader>
                <SheetTitle>{openLead.name}</SheetTitle>
                <p className="text-sm text-muted-foreground">{openLead.email} · {openLead.company}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant={VERIFICATION_BADGE[openLead.verificationStatus] ?? "outline"}>{openLead.verificationStatus}</Badge>
                  <Badge variant="secondary">{openLead.lifecycleStatus}</Badge>
                </div>
              </SheetHeader>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead fields</div>
                <div className="divide-y rounded-md border">
                  {openLead.fields.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No captured field values.</div>
                  )}
                  {openLead.fields.map((f) => (
                    <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{f.key}</span>
                      <span className="font-medium">{f.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-muted-foreground">Channel</div>
                    <div className="font-medium">{openLead.channelLabel}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-muted-foreground">Partner</div>
                    <div className="font-medium">{openLead.partner}</div>
                  </div>
                  <div className="col-span-2 rounded-md border px-3 py-2">
                    <div className="text-xs text-muted-foreground">Consent text</div>
                    <div className="font-medium">{openLead.consentText}</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</div>
                <div className="flex flex-col gap-3">
                  {openLead.timeline.length === 0 && (
                    <p className="text-sm text-muted-foreground">No status history recorded yet.</p>
                  )}
                  {openLead.timeline.map((event, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{event.title}</div>
                        {event.detail && <div className="text-xs text-muted-foreground">{event.detail}</div>}
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.when)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accept/reject/redeliver actions from the design mockup have no
                 backing logic anywhere in this codebase yet — that's the future
                 Resolution queue / Verification epic's job, not this redesign's. */}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
