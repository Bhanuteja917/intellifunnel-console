import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { getClientCampaignDetail } from "@/lib/approvals/client-view";
import { getLeadsForClient } from "@/lib/leads/client-view";
import type { ChannelReadiness, StepOwner } from "@/lib/channels/readiness";
import type { ApprovalStatus } from "@/lib/approvals/status";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "channels", label: "Channels" },
  { id: "leads", label: "Leads" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  approved: "approved",
  pending: "needs your review",
  changesRequested: "changes requested",
  reapprovalNeeded: "changed — review again",
};

const STATUS_VARIANT: Record<ApprovalStatus, "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  changesRequested: "destructive",
  reapprovalNeeded: "destructive",
};

const OWNER_LABEL: Record<StepOwner, string> = { client: "you", agency: "agency", done: "done" };

function statCard(label: string, value: string, hint: string) {
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

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const actor = await requireActor();
  assertPortal(actor, "client");

  let campaign;
  try {
    campaign = await getClientCampaignDetail(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const tab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : "overview";

  const contracted = campaign.channels.reduce((sum, c) => sum + c.contractedQuantity, 0);
  const delivered = campaign.channels.reduce((sum, c) => sum + c.deliveredCount, 0);
  const awaitingYou = campaign.channels.reduce(
    (sum, channel) =>
      sum +
      (channel.termsStatus === "approved" ? 0 : 1) +
      channel.placements.filter((p) => p.status !== "approved").length,
    0,
  );

  const leads =
    tab === "leads" ? await getLeadsForClient(db, actor, { campaignId: campaign.campaignId }) : null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={"/client/campaigns" as Route}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All campaigns
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold">{campaign.name}</h1>
                <Badge variant="outline" className="font-mono text-xs">{campaign.code}</Badge>
                <Badge variant="secondary">{campaign.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {contracted} leads · {campaign.currency} ·{" "}
                {campaign.startDate.toISOString().slice(0, 10)} –{" "}
                {campaign.endDate.toISOString().slice(0, 10)}
              </p>
            </div>
            {awaitingYou > 0 && (
              <Button asChild size="sm">
                <Link href={"/client/approvals" as Route}>
                  Review {awaitingYou} item{awaitingYou === 1 ? "" : "s"}
                </Link>
              </Button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto border-t pt-1">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={`/client/campaigns/${campaign.campaignId}?tab=${t.id}` as Route}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                  tab === t.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {tab === "overview" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Before we can launch</CardTitle>
              <p className="text-sm text-muted-foreground">
                What is still outstanding on each channel, and who it is with.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {campaign.channels.length === 0 && (
                <p className="text-sm text-muted-foreground">No channels set up yet.</p>
              )}
              {campaign.channels.map((channel) => (
                <div key={channel.channelId}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium">{channel.label}</span>
                    <Badge variant={channel.readiness.ready ? "default" : "secondary"}>
                      {channel.readiness.ready ? "ready" : "setup in progress"}
                    </Badge>
                  </div>
                  <ChecklistRows readiness={channel.readiness} />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {statCard("Contracted", String(contracted), `across ${campaign.channels.length} channel(s)`)}
            {statCard(
              "Delivered",
              String(delivered),
              contracted > 0 ? `${Math.round((delivered / contracted) * 100)}% of contracted` : "—",
            )}
            {statCard("Awaiting you", String(awaitingYou), "terms and landing pages")}
            {statCard(
              "Channels ready",
              `${campaign.channels.filter((c) => c.readiness.ready).length} / ${campaign.channels.length}`,
              "setup complete",
            )}
          </div>

          <Card>
            <CardHeader><CardTitle>Delivery pace</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold tabular-nums">{delivered}</span>
                <span className="text-sm text-muted-foreground">/ {contracted} leads accepted</span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-2.5 bg-foreground"
                  style={{
                    width: `${contracted > 0 ? Math.min((delivered / contracted) * 100, 100) : 0}%`,
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{campaign.startDate.toISOString().slice(0, 10)}</span>
                <span>{campaign.endDate.toISOString().slice(0, 10)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "channels" && (
        <div className="flex flex-col gap-6">
          {campaign.channels.length === 0 && (
            <p className="text-sm text-muted-foreground">No channels set up yet.</p>
          )}
          {campaign.channels.map((channel) => (
            <Card key={channel.channelId}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{channel.label}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {channel.contractedQuantity} leads · {channel.currency} {channel.unitPrice} ·{" "}
                    {channel.startDate.toISOString().slice(0, 10)} –{" "}
                    {channel.endDate.toISOString().slice(0, 10)}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[channel.termsStatus]}>
                  terms {STATUS_LABEL[channel.termsStatus]}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Landing pages
                </div>
                {channel.placements.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    None yet — the agency is still setting this channel up.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col">
                    {channel.placements.map((placement) => (
                      <div
                        key={placement.placementId}
                        className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-b-0"
                      >
                        <a
                          href={placement.landingPageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm break-all underline underline-offset-4"
                        >
                          {placement.landingPageUrl}
                        </a>
                        <Badge variant={STATUS_VARIANT[placement.status]}>
                          {STATUS_LABEL[placement.status]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "leads" && leads !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Delivered leads</CardTitle>
            <p className="text-sm text-muted-foreground">
              Accepted leads collected on this campaign.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Delivery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No leads yet.
                    </TableCell>
                  </TableRow>
                )}
                {leads.leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>{lead.accountName}</TableCell>
                    <TableCell>
                      {lead.contactName ?? lead.contactEmail}
                      <div className="text-xs text-muted-foreground">{lead.contactEmail}</div>
                    </TableCell>
                    <TableCell>{lead.channelTypeName}</TableCell>
                    <TableCell>{lead.acceptedAt.toISOString().slice(0, 10)}</TableCell>
                    <TableCell><Badge variant="secondary">{lead.deliveryStatus}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * The same `computeChannelReadiness` output the agency sees on its own channel
 * page, rendered with per-step ownership so the client can tell what is waiting
 * on them from what is waiting on us.
 */
function ChecklistRows({ readiness }: { readiness: ChannelReadiness }) {
  return (
    <div className="flex flex-col">
      {readiness.steps.map((step) => (
        <div key={step.id} className="flex items-center gap-3 border-b py-3 last:border-b-0">
          <div
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
              step.done
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground/40 text-muted-foreground",
            )}
          >
            {step.done ? "✓" : ""}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{step.title}</span>
              {!step.required && <Badge variant="outline" className="text-xs">Optional</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">{step.hint}</div>
          </div>
          <Badge variant={step.owner === "client" ? "secondary" : "outline"}>
            {OWNER_LABEL[step.owner]}
          </Badge>
          {step.owner === "client" ? (
            <Button asChild size="sm">
              <Link href={"/client/approvals" as Route}>Review</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              {step.done ? "Done" : "Track"}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
