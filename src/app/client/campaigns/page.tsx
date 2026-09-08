import Link from "next/link";
import type { Route } from "next";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { getClientCampaigns } from "@/lib/approvals/client-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientCampaignsPage() {
  const actor = await requireActor();
  assertPortal(actor, "client");

  const campaigns = await getClientCampaigns(db, actor);
  const needsYouTotal = campaigns.reduce((sum, c) => sum + c.needsYouCount, 0);
  const firstNeedsYou = campaigns.find((c) => c.needsYouCount > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Your campaigns</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review what we have set up, approve what needs you, and track delivery.
        </p>
      </div>

      {firstNeedsYou !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/40 p-4">
          <div>
            <div className="text-sm font-semibold">
              {needsYouTotal} item{needsYouTotal === 1 ? "" : "s"} need you before{" "}
              {firstNeedsYou.name} can launch
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Channel terms and landing pages wait on your approval before anything goes live.
            </div>
          </div>
          <Button asChild size="sm">
            <Link href={"/client/approvals" as Route}>Review {needsYouTotal} item{needsYouTotal === 1 ? "" : "s"}</Link>
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Flight</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Needs you</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No campaigns yet.
                  </TableCell>
                </TableRow>
              )}
              {campaigns.map((campaign) => (
                <TableRow key={campaign.campaignId}>
                  <TableCell>
                    <Link
                      href={`/client/campaigns/${campaign.campaignId}` as Route}
                      className="block font-medium underline-offset-4 hover:underline"
                    >
                      {campaign.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{campaign.code}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {campaign.startDate.toISOString().slice(0, 10)} –{" "}
                    {campaign.endDate.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-1.5 bg-foreground"
                        style={{
                          width: `${campaign.contractedQuantity > 0 ? Math.min((campaign.deliveredCount / campaign.contractedQuantity) * 100, 100) : 0}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {campaign.deliveredCount} / {campaign.contractedQuantity} leads
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{campaign.status}</Badge></TableCell>
                  <TableCell>
                    {campaign.needsYouCount > 0 ? (
                      <Badge>{campaign.needsYouCount} item{campaign.needsYouCount === 1 ? "" : "s"}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
