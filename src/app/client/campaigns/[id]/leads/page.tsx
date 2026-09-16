import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { getClientCampaignDetail } from "@/lib/approvals/client-view";
import { getLeadsForClient, getClientLeadBreakdown } from "@/lib/leads/client-view";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LeadBreakdownChart } from "@/components/reporting/lead-breakdown-chart";

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientCampaignLeadsPage({
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

  const leads = await getLeadsForClient(db, actor, { campaignId: campaign.campaignId });
  const breakdown = await getClientLeadBreakdown(db, actor, campaign.campaignId);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/client/campaigns/${campaign.campaignId}` as Route}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to campaign
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{campaign.name}</h1>
          <Badge variant="outline" className="font-mono text-xs">{campaign.code}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Delivered leads for this campaign.</p>
      </div>

      {breakdown.totalCount > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>By job title</CardTitle></CardHeader>
            <CardContent><LeadBreakdownChart data={breakdown.byJobTitle} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>By function</CardTitle></CardHeader>
            <CardContent><LeadBreakdownChart data={breakdown.byJobFunction} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>By geography</CardTitle></CardHeader>
            <CardContent><LeadBreakdownChart data={breakdown.byGeography} /></CardContent>
          </Card>
        </div>
      )}

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
    </div>
  );
}
