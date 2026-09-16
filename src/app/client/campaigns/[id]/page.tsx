import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { getClientCampaignDetail } from "@/lib/approvals/client-view";
import type { ApprovalStatus } from "@/lib/approvals/status";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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

const PACE_VARIANT: Record<"behind" | "onPace" | "ahead", "default" | "secondary" | "destructive"> = {
  behind: "destructive",
  onPace: "secondary",
  ahead: "default",
};

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  assertPortal(actor, "client");

  let campaign;
  try {
    campaign = await getClientCampaignDetail(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const contracted = campaign.channels.reduce((sum, c) => sum + c.contractedQuantity, 0);
  const delivered = campaign.channels.reduce((sum, c) => sum + c.deliveredCount, 0);
  const awaitingYou = campaign.channels.reduce(
    (sum, channel) => sum + (channel.termsStatus === "approved" ? 0 : 1),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <Badge variant="outline">{campaign.code}</Badge>
          <Badge variant="secondary">{campaign.status}</Badge>
          <Button asChild variant="outline" size="sm">
            <Link href={`/client/campaigns/${campaign.campaignId}/leads` as Route}>View leads</Link>
          </Button>
          {awaitingYou > 0 && (
            <Button asChild size="sm">
              <Link href={"/client/approvals" as Route}>
                Review {awaitingYou} item{awaitingYou === 1 ? "" : "s"}
              </Link>
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {campaign.startDate.toISOString().slice(0, 10)} – {campaign.endDate.toISOString().slice(0, 10)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {statCard("Contracted", String(contracted), `across ${campaign.channels.length} channel(s)`)}
        {statCard(
          "Delivered",
          String(delivered),
          contracted > 0 ? `${Math.round((delivered / contracted) * 100)}% of contracted` : "—",
        )}
        {statCard("Awaiting you", String(awaitingYou), "terms")}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Volume &amp; price</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead>Pacing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.channels.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No channels yet.</TableCell>
                </TableRow>
              )}
              {campaign.channels.map((channel) => (
                <TableRow key={channel.channelId} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/client/campaigns/${campaign.campaignId}/channels/${channel.channelId}` as Route}
                      className="block font-medium"
                    >
                      {channel.label}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/client/campaigns/${campaign.campaignId}/channels/${channel.channelId}` as Route}
                      className="block"
                    >
                      {channel.contractedQuantity} leads · {channel.currency} {channel.unitPrice}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/client/campaigns/${campaign.campaignId}/channels/${channel.channelId}` as Route}
                      className="block"
                    >
                      {channel.startDate.toISOString().slice(0, 10)} – {channel.endDate.toISOString().slice(0, 10)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/client/campaigns/${campaign.campaignId}/channels/${channel.channelId}?tab=terms` as Route}
                      className="block"
                    >
                      <Badge variant={STATUS_VARIANT[channel.termsStatus]}>
                        {STATUS_LABEL[channel.termsStatus]}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/client/campaigns/${campaign.campaignId}/channels/${channel.channelId}?tab=pacing` as Route}
                      className="block"
                    >
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-1.5 bg-foreground"
                          style={{
                            width: `${channel.contractedQuantity > 0 ? Math.min((channel.deliveredCount / channel.contractedQuantity) * 100, 100) : 0}%`,
                          }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {channel.deliveredCount} / {channel.contractedQuantity} ·{" "}
                        <Badge variant={PACE_VARIANT[channel.pace]} className="align-middle">
                          {channel.pace}
                        </Badge>
                      </div>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
